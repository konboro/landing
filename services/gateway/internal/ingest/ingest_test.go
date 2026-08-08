package ingest

import (
	"context"
	"testing"
	"time"

	"github.com/penny/gateway/internal/adapter"
	"github.com/penny/gateway/internal/metrics"
	"github.com/penny/gateway/internal/store"
)

func setup() (*Ingestor, *store.FakeStore, store.Device) {
	fs := store.NewFake()
	dev := store.Device{ID: "dev1", IMEI: "123", VehicleID: "veh1", Model: "fmb930"}
	fs.AddDevice(dev)
	in := New(fs, adapter.NewFMB930(), metrics.New(), nil)
	return in, fs, dev
}

// io ids mirrored from fmb930 firmware mapping.
const (
	ioExtVoltage  = 66
	ioBattVoltage = 67
	ioDout1       = 179
	ioAxisX       = 17
	ioAxisY       = 18
	ioAxisZ       = 19
)

func rec(ts time.Time, lat, lng float64, speed int, io map[uint16]int64) adapter.TelemetryRecord {
	return adapter.TelemetryRecord{DeviceTs: ts, Lat: lat, Lng: lng, SpeedKmh: speed, IO: io}
}

func alertCount(fs *store.FakeStore, kind string) int {
	n := 0
	for _, a := range fs.Alerts {
		if a.Kind == kind {
			n++
		}
	}
	return n
}

func TestPowerCutAlert(t *testing.T) {
	in, fs, dev := setup()
	ctx := context.Background()
	now := time.Now().UTC()
	// ext voltage collapses while internal battery present => power_cut.
	err := in.Process(ctx, dev, []adapter.TelemetryRecord{
		rec(now, 37.98, 23.72, 0, map[uint16]int64{ioExtVoltage: 100, ioBattVoltage: 4000, ioDout1: 0}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if alertCount(fs, "power_cut") != 1 {
		t.Fatalf("power_cut alerts = %d, want 1", alertCount(fs, "power_cut"))
	}
	// Edge-triggered: a second collapsing record does not double-fire.
	_ = in.Process(ctx, dev, []adapter.TelemetryRecord{
		rec(now.Add(time.Second), 37.98, 23.72, 0, map[uint16]int64{ioExtVoltage: 50, ioBattVoltage: 4000, ioDout1: 0}),
	})
	if alertCount(fs, "power_cut") != 1 {
		t.Fatalf("power_cut re-fired: %d", alertCount(fs, "power_cut"))
	}
}

func TestMovedWhileLockedAlert(t *testing.T) {
	in, fs, dev := setup()
	ctx := context.Background()
	now := time.Now().UTC()
	locked := map[uint16]int64{ioDout1: 0} // dout1 low => locked (default polarity)
	// First record anchors the locked position.
	_ = in.Process(ctx, dev, []adapter.TelemetryRecord{rec(now, 37.9838, 23.7261, 0, locked)})
	if alertCount(fs, "moved_locked") != 0 {
		t.Fatal("premature moved alert")
	}
	// ~150 m north while still locked => alert.
	_ = in.Process(ctx, dev, []adapter.TelemetryRecord{rec(now.Add(time.Minute), 37.9851, 23.7261, 0, locked)})
	if alertCount(fs, "moved_locked") != 1 {
		t.Fatalf("moved_locked = %d, want 1", alertCount(fs, "moved_locked"))
	}
	st := fs.States["veh1"]
	if !st.MovedWhileLocked {
		t.Fatal("vehicle_state.moved_while_locked not set")
	}
}

func TestFallAlert(t *testing.T) {
	in, fs, dev := setup()
	ctx := context.Background()
	now := time.Now().UTC()
	// Device on its side: Z≈0, X≈1000mg => tilt ~90°, stationary, ignition off.
	tilted := map[uint16]int64{ioAxisX: 1000, ioAxisY: 0, ioAxisZ: 0, ioDout1: 0}
	// t0: onset (no alert yet).
	_ = in.Process(ctx, dev, []adapter.TelemetryRecord{rec(now, 37.98, 23.72, 0, tilted)})
	if alertCount(fs, "fall") != 0 {
		t.Fatal("fall fired before sustain window")
	}
	// t0+11s: sustained beyond 10s => fall.
	_ = in.Process(ctx, dev, []adapter.TelemetryRecord{rec(now.Add(11*time.Second), 37.98, 23.72, 0, tilted)})
	if alertCount(fs, "fall") != 1 {
		t.Fatalf("fall = %d, want 1", alertCount(fs, "fall"))
	}
}

func TestNoFallWhenUpright(t *testing.T) {
	in, fs, dev := setup()
	ctx := context.Background()
	now := time.Now().UTC()
	upright := map[uint16]int64{ioAxisX: 0, ioAxisY: 0, ioAxisZ: 1000, ioDout1: 0}
	_ = in.Process(ctx, dev, []adapter.TelemetryRecord{rec(now, 37.98, 23.72, 0, upright)})
	_ = in.Process(ctx, dev, []adapter.TelemetryRecord{rec(now.Add(20*time.Second), 37.98, 23.72, 0, upright)})
	if alertCount(fs, "fall") != 0 {
		t.Fatalf("false fall alert while upright: %d", alertCount(fs, "fall"))
	}
}

func TestClockSkewDropped(t *testing.T) {
	in, fs, dev := setup()
	ctx := context.Background()
	skewed := time.Now().UTC().Add(-72 * time.Hour) // beyond 48h limit
	_ = in.Process(ctx, dev, []adapter.TelemetryRecord{rec(skewed, 37.98, 23.72, 0, map[uint16]int64{ioDout1: 0})})
	if len(fs.Telemetry) != 0 {
		t.Fatalf("skewed record was stored: %d rows", len(fs.Telemetry))
	}
}
