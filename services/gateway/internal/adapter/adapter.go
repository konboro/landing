// Package adapter isolates all device-specific behaviour behind the
// DeviceAdapter interface. Business logic (ingest, commands, server) depends
// only on this package, never on a concrete device model. Adding an LTE-M model
// means adding a new file that implements DeviceAdapter — nothing else changes.
package adapter

import "time"

// CommandKind is a device-agnostic command verb. The adapter maps each kind to
// concrete on-wire syntax for its device family.
type CommandKind string

const (
	CmdUnlock   CommandKind = "unlock"
	CmdLock     CommandKind = "lock"
	CmdLocate   CommandKind = "locate"
	CmdReboot   CommandKind = "reboot"
	CmdRing     CommandKind = "ring"      // short siren pulse (find-my-scooter)
	CmdAlarmOn  CommandKind = "alarm_on"  // continuous siren
	CmdAlarmOff CommandKind = "alarm_off" // stop siren
	CmdSetParam CommandKind = "setparam"
)

// Args carries command parameters (e.g. setparam id/value, ring duration).
type Args map[string]string

// AckBytes is the raw acknowledgement a device expects after a telemetry packet.
type AckBytes []byte

// TelemetryRecord is one normalized AVL record. GPS is in decimal degrees; IO
// holds every raw AVL id (widened to int64) so unknown ids survive into jsonb.
type TelemetryRecord struct {
	DeviceTs  time.Time
	Priority  uint8
	Lat       float64
	Lng       float64
	Altitude  int
	Angle     int
	Sats      int
	SpeedKmh  int
	EventIOID uint16
	IO        map[uint16]int64
}

// NormalizedState is the device-independent interpretation of an IO map, used by
// ingest for vehicle_state upsert and for derived alert rules.
type NormalizedState struct {
	Ignition          bool
	Dout1             bool // lock relay (per profile)
	Dout2             bool // siren (per profile)
	Locked            bool // convenience: !Dout1 semantics resolved by adapter
	ExtVoltageMv      int
	BattVoltageMv     int
	GSMSignal         int
	Movement          bool
	AxisX             int
	AxisY             int
	AxisZ             int
	OdometerM         int64
	SleepMode         int
	HasExtVoltage     bool
	HasBattVoltage    bool
	HasAccelerometer  bool
}

// DoutExpectation describes the DOUT state a command should produce, letting a
// subsequent AVL telemetry record serve as an ACK (docs/03: "ACK sources: Codec
// 12 response OR next AVL record showing expected DOUT state").
type DoutExpectation struct {
	Applicable bool // false => only a Codec 12 response can ACK this command
	Which      int  // which DOUT (1 or 2) the command drives
	Dout1High  bool // expected DOUT1 level (when Which==1)
	Dout2High  bool // expected DOUT2 level (when Which==2)
}

// AckExpecter is an optional capability: adapters that drive DOUTs implement it
// so the command layer can accept an AVL record as an ACK.
type AckExpecter interface {
	ExpectedDout(kind CommandKind, args Args) DoutExpectation
}

// DeviceAdapter is the single seam between the device-agnostic core and any
// Teltonika (or future) hardware. Its shape is fixed by docs/03.
type DeviceAdapter interface {
	// ParseFrame parses one raw telemetry frame into normalized records plus the
	// ACK bytes to write back to the device.
	ParseFrame([]byte) ([]TelemetryRecord, AckBytes, error)
	// BuildCommand maps a device-agnostic command to GPRS wire bytes and the
	// equivalent SMS text (Teltonika "<login> <pass> <cmd>" is added by caller).
	BuildCommand(kind CommandKind, args Args) (wire []byte, smsText string, err error)
	// InterpretIO normalizes a raw IO map into a NormalizedState.
	InterpretIO(io map[uint16]int64) NormalizedState
}
