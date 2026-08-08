package adapter

import (
	"fmt"
	"time"

	"github.com/penny/gateway/internal/protocol"
)

// Teltonika AVL IO ids for the FMB930. The values below marked TODO(verify wiki)
// must be confirmed against the FMB930 firmware AVL id list on the Teltonika wiki
// during the bench session before mass rollout. They are grouped here as named
// constants so no magic numbers leak into logic and the bench session has one
// place to reconcile.
const (
	// Confident (stable across FMBxxx firmware):
	ioIgnition    uint16 = 239 // DIN1 / ignition
	ioMovement    uint16 = 240 // movement sensor
	ioExtVoltage  uint16 = 66  // external voltage, mV
	ioBattVoltage uint16 = 67  // internal battery voltage, mV
	ioGSMSignal   uint16 = 21  // GSM signal strength (1..5)

	// Need bench confirmation:
	ioDout1     uint16 = 179 // TODO(verify wiki): FMB930 Digital Output 1 AVL id (lock relay)
	ioDout2     uint16 = 180 // TODO(verify wiki): FMB930 Digital Output 2 AVL id (siren)
	ioAxisX     uint16 = 17  // TODO(verify wiki): accelerometer axis X (fall detection)
	ioAxisY     uint16 = 18  // TODO(verify wiki): accelerometer axis Y
	ioAxisZ     uint16 = 19  // TODO(verify wiki): accelerometer axis Z
	ioSleepMode uint16 = 200 // TODO(verify wiki): sleep mode state
	ioOdometer  uint16 = 16  // TODO(verify wiki): total odometer (virtual), meters
)

// DoutProfile makes DOUT semantics data, not code. Only this struct decides
// which physical output is the lock relay and which is the siren, and the exact
// setdigout syntax. DOUT1=lock, DOUT2=siren is CONFIRMED by owner (docs/03).
type DoutProfile struct {
	LockDoutPos  int    // 1-based position of the lock relay in setdigout digits
	SirenDoutPos int    // 1-based position of the siren in setdigout digits
	LockDoutIO   uint16 // AVL io id reporting the lock relay state
	SirenDoutIO  uint16 // AVL io id reporting the siren state

	// RingPulseMs / AlarmSeconds parameterise the timed siren commands. The exact
	// setdigout timeout syntax on FMB9xx firmware is TODO(verify wiki).
	RingPulseMs  int
	AlarmSeconds int

	// LockedWhenDoutHigh: if true the lock relay energised (DOUT high) means the
	// vehicle is LOCKED; if false, DOUT high means UNLOCKED. Bench-confirmed value.
	LockedWhenDoutHigh bool
}

// DefaultFMB930Profile is the confirmed DOUT mapping for the current fleet.
func DefaultFMB930Profile() DoutProfile {
	return DoutProfile{
		LockDoutPos:  1,
		SirenDoutPos: 2,
		LockDoutIO:   ioDout1,
		SirenDoutIO:  ioDout2,
		RingPulseMs:  300, // 3x 300ms pulse pattern, see docs/03
		AlarmSeconds: 30,
		// TODO(verify wiki): confirm relay polarity on bench. Assumed: energising
		// DOUT1 releases the lock (unlock), de-energised = locked.
		LockedWhenDoutHigh: false,
	}
}

// FMB930 implements DeviceAdapter for the Teltonika FMB930.
type FMB930 struct {
	Profile DoutProfile
}

// NewFMB930 builds an adapter with the confirmed default profile.
func NewFMB930() *FMB930 { return &FMB930{Profile: DefaultFMB930Profile()} }

// ParseFrame parses a Codec 8E AVL packet into normalized telemetry records and
// the ACK bytes (record count, big-endian).
func (d *FMB930) ParseFrame(buf []byte) ([]TelemetryRecord, AckBytes, error) {
	recs, count, err := protocol.ParseAVL(buf)
	if err != nil {
		return nil, nil, err
	}
	out := make([]TelemetryRecord, 0, len(recs))
	for _, r := range recs {
		out = append(out, TelemetryRecord{
			DeviceTs:  time.UnixMilli(int64(r.TimestampMs)).UTC(),
			Priority:  r.Priority,
			Lat:       r.GPS.Lat(),
			Lng:       r.GPS.Lng(),
			Altitude:  int(r.GPS.Altitude),
			Angle:     int(r.GPS.Angle),
			Sats:      int(r.GPS.Sats),
			SpeedKmh:  int(r.GPS.Speed),
			EventIOID: r.EventIOID,
			IO:        r.IO,
		})
	}
	return out, AckBytes(protocol.BuildAck(uint32(count))), nil
}

// setdigout builds a digit string like "1?" where position i is the value for
// that DOUT and '?' means "leave unchanged". posValue maps 1-based positions to
// desired '0'/'1'; positions not present become '?'.
func (d *FMB930) setdigout(posValue map[int]byte) string {
	// FMB9xx setdigout takes two digits (DOUT1, DOUT2).
	digits := []byte{'?', '?'}
	for pos, v := range posValue {
		if pos >= 1 && pos <= len(digits) {
			digits[pos-1] = v
		}
	}
	return "setdigout " + string(digits)
}

// BuildCommand maps a device-agnostic command to Codec 12 wire bytes and SMS
// text. All DOUT semantics come from d.Profile — nothing is hardcoded elsewhere.
func (d *FMB930) BuildCommand(kind CommandKind, args Args) ([]byte, string, error) {
	unlockDigit := byte('1')
	lockDigit := byte('0')
	if d.Profile.LockedWhenDoutHigh {
		unlockDigit, lockDigit = '0', '1'
	}

	var ascii string
	switch kind {
	case CmdUnlock:
		ascii = d.setdigout(map[int]byte{d.Profile.LockDoutPos: unlockDigit})
	case CmdLock:
		ascii = d.setdigout(map[int]byte{d.Profile.LockDoutPos: lockDigit})
	case CmdRing:
		// short pulse on the siren output.
		// TODO(verify wiki): FMB9xx timed setdigout syntax
		// "setdigout <d1><d2> <timeout1> <timeout2>" — confirm on bench.
		secs := 1
		ascii = fmt.Sprintf("%s %d %d",
			d.setdigout(map[int]byte{d.Profile.SirenDoutPos: '1'}), 0, secs)
	case CmdAlarmOn:
		secs := d.Profile.AlarmSeconds
		if v, ok := args["seconds"]; ok {
			fmt.Sscanf(v, "%d", &secs)
		}
		// TODO(verify wiki): timed setdigout syntax as above.
		ascii = fmt.Sprintf("%s %d %d",
			d.setdigout(map[int]byte{d.Profile.SirenDoutPos: '1'}), 0, secs)
	case CmdAlarmOff:
		ascii = d.setdigout(map[int]byte{d.Profile.SirenDoutPos: '0'})
	case CmdLocate:
		ascii = "getinfo" // returns GPS/status; docs/03 lists getinfo/getstatus
	case CmdReboot:
		ascii = "cpureset"
	case CmdSetParam:
		id, okID := args["id"]
		val, okVal := args["value"]
		if !okID || !okVal {
			return nil, "", fmt.Errorf("setparam requires id and value")
		}
		ascii = fmt.Sprintf("setparam %s:%s", id, val)
	default:
		return nil, "", fmt.Errorf("unknown command kind %q", kind)
	}

	wire := protocol.BuildCommand(ascii)
	return wire, ascii, nil
}

// ExpectedDout reports the DOUT state a command should produce, so the command
// layer can accept the next AVL record as an ACK. All semantics come from the
// profile — DOUT positions and polarity are never hardcoded elsewhere.
func (d *FMB930) ExpectedDout(kind CommandKind, _ Args) DoutExpectation {
	unlockHigh := true
	if d.Profile.LockedWhenDoutHigh {
		unlockHigh = false
	}
	switch kind {
	case CmdUnlock:
		return DoutExpectation{Applicable: true, Which: d.Profile.LockDoutPos, Dout1High: unlockHigh}
	case CmdLock:
		return DoutExpectation{Applicable: true, Which: d.Profile.LockDoutPos, Dout1High: !unlockHigh}
	case CmdRing, CmdAlarmOn:
		return DoutExpectation{Applicable: true, Which: d.Profile.SirenDoutPos, Dout2High: true}
	case CmdAlarmOff:
		return DoutExpectation{Applicable: true, Which: d.Profile.SirenDoutPos, Dout2High: false}
	default:
		// getinfo/cpureset/setparam: only a Codec 12 response can ACK.
		return DoutExpectation{}
	}
}

// InterpretIO normalizes a raw IO map. Movement/fall/theft rules read from the
// returned NormalizedState in the ingest layer.
func (d *FMB930) InterpretIO(io map[uint16]int64) NormalizedState {
	var s NormalizedState
	if v, ok := io[ioIgnition]; ok {
		s.Ignition = v != 0
	}
	if v, ok := io[ioMovement]; ok {
		s.Movement = v != 0
	}
	if v, ok := io[d.Profile.LockDoutIO]; ok {
		s.Dout1 = v != 0
	}
	if v, ok := io[d.Profile.SirenDoutIO]; ok {
		s.Dout2 = v != 0
	}
	// Resolve lock semantics via profile polarity.
	if d.Profile.LockedWhenDoutHigh {
		s.Locked = s.Dout1
	} else {
		s.Locked = !s.Dout1
	}
	if v, ok := io[ioExtVoltage]; ok {
		s.ExtVoltageMv = int(v)
		s.HasExtVoltage = true
	}
	if v, ok := io[ioBattVoltage]; ok {
		s.BattVoltageMv = int(v)
		s.HasBattVoltage = true
	}
	if v, ok := io[ioGSMSignal]; ok {
		s.GSMSignal = int(v)
	}
	if v, ok := io[ioAxisX]; ok {
		s.AxisX = int(int16(v))
		s.HasAccelerometer = true
	}
	if v, ok := io[ioAxisY]; ok {
		s.AxisY = int(int16(v))
		s.HasAccelerometer = true
	}
	if v, ok := io[ioAxisZ]; ok {
		s.AxisZ = int(int16(v))
		s.HasAccelerometer = true
	}
	if v, ok := io[ioOdometer]; ok {
		s.OdometerM = v
	}
	if v, ok := io[ioSleepMode]; ok {
		s.SleepMode = int(v)
	}
	return s
}
