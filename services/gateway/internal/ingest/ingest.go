// Package ingest turns parsed telemetry into persisted rows and derived alerts.
// Alert rules (fall, moved_while_locked, power_cut) follow docs/03 exactly.
package ingest

import (
	"context"
	"math"
	"sync"
	"time"

	"github.com/penny/gateway/internal/adapter"
	"github.com/penny/gateway/internal/metrics"
	"github.com/penny/gateway/internal/store"
)

// Alert rule thresholds (docs/03).
const (
	fallTiltDegrees      = 60.0
	fallSustain          = 10 * time.Second
	movedWhileLockedMinM = 30.0
	powerCutExtMv        = 500  // ~0V external
	batteryPresentMinMv  = 3000 // internal battery considered present
	clockSkewLimit       = 48 * time.Hour
)

// TripChecker reports whether a vehicle currently has an active trip. Alert
// rules that require "no active trip" consult it. A nil checker means the
// gateway has no trip knowledge and treats every vehicle as not-in-trip.
type TripChecker interface {
	HasActiveTrip(vehicleID string) bool
}

// Ingestor is stateful: it remembers per-vehicle context needed by the
// time-windowed alert rules (last locked position, tilt-onset time).
type Ingestor struct {
	store   store.Store
	adapter adapter.DeviceAdapter
	metrics *metrics.Metrics
	trips   TripChecker
	now     func() time.Time

	mu  sync.Mutex
	mem map[string]*vehMem // keyed by vehicle_id
}

type vehMem struct {
	lastLockedLat, lastLockedLng float64
	hasLockedPos                 bool
	tiltSince                    time.Time
	fallFired                    bool
	powerCutFired                bool
	movedFired                   bool
}

// New builds an Ingestor.
func New(s store.Store, a adapter.DeviceAdapter, m *metrics.Metrics, trips TripChecker) *Ingestor {
	return &Ingestor{
		store:   s,
		adapter: a,
		metrics: m,
		trips:   trips,
		now:     time.Now,
		mem:     map[string]*vehMem{},
	}
}

func (in *Ingestor) memFor(vid string) *vehMem {
	in.mu.Lock()
	defer in.mu.Unlock()
	m, ok := in.mem[vid]
	if !ok {
		m = &vehMem{}
		in.mem[vid] = m
	}
	return m
}

func (in *Ingestor) inTrip(vid string) bool {
	if in.trips == nil {
		return false
	}
	return in.trips.HasActiveTrip(vid)
}

// Process persists a batch of records for one device and evaluates alert rules.
// Records with clock skew beyond the limit are dropped (CLAUDE rule 9).
func (in *Ingestor) Process(ctx context.Context, dev store.Device, recs []adapter.TelemetryRecord) error {
	if len(recs) == 0 {
		return nil
	}
	serverTs := in.now().UTC()
	batch := make([]store.Telemetry, 0, len(recs))
	var last *adapter.TelemetryRecord
	var lastState adapter.NormalizedState

	for i := range recs {
		r := recs[i]
		if skew := serverTs.Sub(r.DeviceTs); skew > clockSkewLimit || skew < -clockSkewLimit {
			continue // reject implausible device clock
		}
		st := in.adapter.InterpretIO(r.IO)
		batch = append(batch, store.Telemetry{
			DeviceID:      dev.ID,
			VehicleID:     dev.VehicleID,
			DeviceTs:      r.DeviceTs,
			ServerTs:      serverTs,
			Lat:           r.Lat,
			Lng:           r.Lng,
			SpeedKmh:      r.SpeedKmh,
			Heading:       r.Angle,
			Altitude:      r.Altitude,
			Sats:          r.Sats,
			ExtVoltageMv:  st.ExtVoltageMv,
			BattVoltageMv: st.BattVoltageMv,
			Din1:          st.Ignition,
			Dout1:         st.Dout1,
			Dout2:         st.Dout2,
			GSMSignal:     st.GSMSignal,
			IO:            r.IO,
		})
		in.evaluateAlerts(ctx, dev, r, st)
		last = &recs[i]
		lastState = st
	}

	if err := in.store.InsertTelemetry(ctx, batch); err != nil {
		return err
	}

	if last != nil && dev.VehicleID != "" {
		m := in.memFor(dev.VehicleID)
		vs := store.VehicleState{
			VehicleID: dev.VehicleID,
			Lat:       last.Lat,
			Lng:       last.Lng,
			// A record with no satellites reports 0,0. Treating that as a position
			// teleported the vehicle out of its operating zone and off the map.
			HasFix:           last.Sats > 0 && (last.Lat != 0 || last.Lng != 0),
			SpeedKmh:         last.SpeedKmh,
			Ignition:        lastState.Ignition,
			Locked:           lastState.Locked,
			LastSeen:         serverTs,
			SessionOnline:    true,
			Fall:             m.fallFired,
			PowerCut:         m.powerCutFired,
			MovedWhileLocked: m.movedFired,
		}
		if err := in.store.UpsertVehicleState(ctx, vs); err != nil {
			return err
		}
	}
	return nil
}

func (in *Ingestor) evaluateAlerts(ctx context.Context, dev store.Device, r adapter.TelemetryRecord, st adapter.NormalizedState) {
	vid := dev.VehicleID
	if vid == "" {
		return
	}
	m := in.memFor(vid)

	// power_cut: external voltage collapses while the internal battery is present.
	if st.HasExtVoltage && st.HasBattVoltage {
		if st.ExtVoltageMv <= powerCutExtMv && st.BattVoltageMv >= batteryPresentMinMv {
			if !m.powerCutFired {
				m.powerCutFired = true
				in.raise(ctx, vid, "power_cut", map[string]any{
					"ext_voltage_mv":  st.ExtVoltageMv,
					"batt_voltage_mv": st.BattVoltageMv,
					"device_ts":       r.DeviceTs,
				})
			}
		} else if st.ExtVoltageMv > powerCutExtMv {
			m.powerCutFired = false // recovered; re-arm
		}
	}

	// moved_while_locked: >30 m displacement while locked and not in a trip.
	if st.Locked && !in.inTrip(vid) {
		if m.hasLockedPos {
			d := haversineMeters(m.lastLockedLat, m.lastLockedLng, r.Lat, r.Lng)
			if d > movedWhileLockedMinM && !m.movedFired {
				m.movedFired = true
				in.raise(ctx, vid, "moved_locked", map[string]any{
					"displacement_m": int(d),
					"lat":            r.Lat,
					"lng":            r.Lng,
				})
			}
		} else {
			m.lastLockedLat, m.lastLockedLng, m.hasLockedPos = r.Lat, r.Lng, true
		}
	} else {
		// unlocked or in trip: reset the locked-anchor and moved latch.
		m.hasLockedPos = false
		m.movedFired = false
	}

	// fall: tilt > 60° sustained >=10s, stationary, ignition off, no active trip.
	tilted := st.HasAccelerometer && tiltDegrees(st.AxisX, st.AxisY, st.AxisZ) > fallTiltDegrees
	stationary := r.SpeedKmh == 0 && !st.Ignition && !in.inTrip(vid)
	if tilted && stationary {
		if m.tiltSince.IsZero() {
			m.tiltSince = r.DeviceTs
		}
		if !m.fallFired && r.DeviceTs.Sub(m.tiltSince) >= fallSustain {
			m.fallFired = true
			in.raise(ctx, vid, "fall", map[string]any{
				"tilt_deg":  int(tiltDegrees(st.AxisX, st.AxisY, st.AxisZ)),
				"axis":      []int{st.AxisX, st.AxisY, st.AxisZ},
				"device_ts": r.DeviceTs,
			})
		}
	} else {
		m.tiltSince = time.Time{}
		m.fallFired = false
	}
}

func (in *Ingestor) raise(ctx context.Context, vid, kind string, payload map[string]any) {
	_ = in.store.InsertAlert(ctx, store.Alert{
		VehicleID: vid,
		Kind:      kind,
		Payload:   payload,
		CreatedAt: in.now().UTC(),
	})
}

// tiltDegrees returns the angle between the device's Z axis and gravity, given
// accelerometer readings in mg. 0° = upright, 90° = on its side.
func tiltDegrees(x, y, z int) float64 {
	fx, fy, fz := float64(x), float64(y), float64(z)
	mag := math.Sqrt(fx*fx + fy*fy + fz*fz)
	if mag == 0 {
		return 0
	}
	cos := math.Abs(fz) / mag
	if cos > 1 {
		cos = 1
	}
	return math.Acos(cos) * 180 / math.Pi
}

// haversineMeters returns great-circle distance in meters.
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000.0
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Asin(math.Min(1, math.Sqrt(a)))
}
