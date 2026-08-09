// Package store is the persistence seam. The gateway core depends only on the
// Store interface; production uses the pgx-backed implementation, tests and
// DB-less runs use FakeStore. Domain types here mirror docs/02 schema.
package store

import (
	"context"
	"log"
	"sync"
	"time"
)

// Device is a row from the devices table (identity + SMS fallback config).
type Device struct {
	ID          string
	IMEI        string
	VehicleID   string
	Model       string // "fmb930", ...
	PhoneNumber string // SIM MSISDN for SMS fallback
	SMSLogin    string
	SMSPass     string
	Status      string // active, bench, faulty, retired
}

// Telemetry is one row to insert into the telemetry table.
type Telemetry struct {
	DeviceID      string
	VehicleID     string
	DeviceTs      time.Time
	ServerTs      time.Time
	Lat           float64
	Lng           float64
	SpeedKmh      int
	Heading       int
	Altitude      int
	Sats          int
	ExtVoltageMv  int
	BattVoltageMv int
	Din1          bool
	Dout1         bool
	Dout2         bool
	GSMSignal     int
	IO            map[uint16]int64
}

// VehicleState is the hot per-vehicle row (UPSERT target).
type VehicleState struct {
	VehicleID        string
	Lat              float64
	Lng              float64
	SoCPct           int
	SpeedKmh         int
	Ignition         bool
	Locked           bool
	LastSeen         time.Time
	SessionOnline    bool
	Fall             bool
	PowerCut         bool
	MovedWhileLocked bool
}

// Alert is a derived vehicle_alerts row.
type Alert struct {
	VehicleID string
	Kind      string // fall, power_cut, moved_locked, ...
	Payload   map[string]any
	CreatedAt time.Time
}

// Command is a dequeued command to deliver.
type Command struct {
	ID        string
	VehicleID string
	DeviceID  string
	IMEI      string // joined from devices for session lookup
	Kind      string // unlock, lock, locate, reboot, ring, alarm_on, alarm_off, setparam
	Payload   map[string]string
	Channel   string // gprs, sms
	TripID    string
	QueuedAt  time.Time
}

// Command status values.
const (
	StatusQueued = "queued"
	StatusSent   = "sent"
	StatusAcked  = "acked"
	StatusFailed = "failed"
	StatusExpiry = "expired"
)

// Store is the persistence interface used by the gateway core.
type Store interface {
	DeviceByIMEI(ctx context.Context, imei string) (Device, error)
	InsertTelemetry(ctx context.Context, batch []Telemetry) error
	UpsertVehicleState(ctx context.Context, st VehicleState) error
	InsertAlert(ctx context.Context, a Alert) error
	// NextCommand pops the next queued command (pgmq read). ok=false if none.
	NextCommand(ctx context.Context) (cmd Command, ok bool, err error)
	// MarkCommand records terminal/intermediate status transitions. It must be
	// idempotent-safe: setting a status no lower than the current one.
	MarkCommand(ctx context.Context, id, status, channel, errText string) error
}

// ---- FakeStore: in-memory implementation for tests and DB-less runs ----

// FakeStore is a thread-safe in-memory Store.
type FakeStore struct {
	mu           sync.Mutex
	devices      map[string]Device // keyed by IMEI
	autoRegister bool              // bench mode: adopt unknown IMEIs
	queue        []Command
	Telemetry    []Telemetry
	States       map[string]VehicleState
	Alerts       []Alert
	CmdStatus    map[string]string // command id -> latest status
}

// NewFake returns an empty FakeStore.
func NewFake() *FakeStore {
	return &FakeStore{
		devices:   map[string]Device{},
		States:    map[string]VehicleState{},
		CmdStatus: map[string]string{},
	}
}

// SetAutoRegister makes DeviceByIMEI accept an unknown IMEI by registering it
// on the spot instead of rejecting the handshake.
//
// This is for the DB-less bench mode only (`DB_URL` empty). Without it the
// fake store starts with zero devices, so nothing can connect at all and
// `pnpm gateway:run` is useless for a bench session. Production runs on
// PGStore, which always checks `devices` for real — an unknown IMEI is
// rejected there, as Hard Rule #7 requires.
func (f *FakeStore) SetAutoRegister(on bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.autoRegister = on
}

// AddDevice registers a device so DeviceByIMEI can find it.
func (f *FakeStore) AddDevice(d Device) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.devices[d.IMEI] = d
}

// Enqueue adds a command to the in-memory queue (test helper).
func (f *FakeStore) Enqueue(c Command) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if c.Channel == "" {
		c.Channel = "gprs"
	}
	if c.QueuedAt.IsZero() {
		c.QueuedAt = time.Now()
	}
	f.CmdStatus[c.ID] = StatusQueued
	f.queue = append(f.queue, c)
}

// ErrNotFound is returned when a device does not exist.
type ErrNotFound struct{ IMEI string }

func (e ErrNotFound) Error() string { return "device not found: " + e.IMEI }

func (f *FakeStore) DeviceByIMEI(_ context.Context, imei string) (Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	d, ok := f.devices[imei]
	if !ok {
		if !f.autoRegister {
			return Device{}, ErrNotFound{IMEI: imei}
		}
		// Bench mode: adopt the device so a real scooter (or simdevice) can be
		// pointed at a laptop with no database and still complete a handshake.
		d = Device{
			ID:        "bench-" + imei,
			IMEI:      imei,
			VehicleID: "bench-vehicle-" + imei,
			Model:     "fmb930",
			Status:    "bench",
		}
		f.devices[imei] = d
		log.Printf("[store] bench mode: auto-registered unknown IMEI %s", imei)
	}
	return d, nil
}

func (f *FakeStore) InsertTelemetry(_ context.Context, batch []Telemetry) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Telemetry = append(f.Telemetry, batch...)
	return nil
}

func (f *FakeStore) UpsertVehicleState(_ context.Context, st VehicleState) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.States[st.VehicleID] = st
	return nil
}

func (f *FakeStore) InsertAlert(_ context.Context, a Alert) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a.CreatedAt.IsZero() {
		a.CreatedAt = time.Now()
	}
	f.Alerts = append(f.Alerts, a)
	return nil
}

func (f *FakeStore) NextCommand(_ context.Context) (Command, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.queue) == 0 {
		return Command{}, false, nil
	}
	c := f.queue[0]
	f.queue = f.queue[1:]
	return c, true, nil
}

func (f *FakeStore) MarkCommand(_ context.Context, id, status, _, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.CmdStatus[id] = status
	return nil
}

// Status returns the last recorded status for a command id (test helper).
func (f *FakeStore) Status(id string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.CmdStatus[id]
}

// TelemetryLen returns the number of stored telemetry rows (thread-safe helper).
func (f *FakeStore) TelemetryLen() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.Telemetry)
}

// HasState reports whether a vehicle_state row exists (thread-safe helper).
func (f *FakeStore) HasState(vehicleID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.States[vehicleID]
	return ok
}
