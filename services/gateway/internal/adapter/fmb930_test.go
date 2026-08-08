package adapter

import (
	"testing"

	"github.com/penny/gateway/internal/protocol"
)

func TestBuildCommandUnlockIsSetdigout(t *testing.T) {
	d := NewFMB930()
	wire, sms, err := d.BuildCommand(CmdUnlock, nil)
	if err != nil {
		t.Fatal(err)
	}
	// DOUT1=lock at position 1; unlock energises it => "setdigout 1?".
	if sms != "setdigout 1?" {
		t.Fatalf("unlock sms = %q, want %q", sms, "setdigout 1?")
	}
	typ, payload, err := protocol.ParseCodec12(wire)
	if err != nil {
		t.Fatalf("parse wire: %v", err)
	}
	if typ != protocol.Codec12TypeCommand || payload != "setdigout 1?" {
		t.Fatalf("wire type=0x%02X payload=%q", typ, payload)
	}
}

func TestBuildCommandVariants(t *testing.T) {
	d := NewFMB930()
	cases := map[CommandKind]string{
		CmdLock:     "setdigout 0?",
		CmdAlarmOff: "setdigout ?0",
		CmdLocate:   "getinfo",
		CmdReboot:   "cpureset",
	}
	for kind, want := range cases {
		_, sms, err := d.BuildCommand(kind, nil)
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if sms != want {
			t.Errorf("%s sms = %q, want %q", kind, sms, want)
		}
	}
}

func TestBuildCommandSetParam(t *testing.T) {
	d := NewFMB930()
	_, sms, err := d.BuildCommand(CmdSetParam, Args{"id": "2004", "value": "tcp.penny.rent"})
	if err != nil {
		t.Fatal(err)
	}
	if sms != "setparam 2004:tcp.penny.rent" {
		t.Fatalf("setparam sms = %q", sms)
	}
	if _, _, err := d.BuildCommand(CmdSetParam, nil); err == nil {
		t.Fatal("expected error for setparam without args")
	}
}

func TestInterpretIO(t *testing.T) {
	d := NewFMB930()
	st := d.InterpretIO(map[uint16]int64{
		ioIgnition:    1,
		ioMovement:    1,
		ioDout1:       1, // lock relay energised => unlocked (default polarity)
		ioDout2:       0,
		ioExtVoltage:  39500,
		ioBattVoltage: 4000,
		ioGSMSignal:   5,
	})
	if !st.Ignition || !st.Movement {
		t.Error("ignition/movement not set")
	}
	if !st.Dout1 || st.Dout2 {
		t.Errorf("dout1=%v dout2=%v", st.Dout1, st.Dout2)
	}
	if st.Locked {
		t.Error("DOUT1 high with default polarity should mean UNLOCKED")
	}
	if st.ExtVoltageMv != 39500 || st.BattVoltageMv != 4000 || st.GSMSignal != 5 {
		t.Errorf("voltages/signal wrong: %+v", st)
	}
}

func TestExpectedDout(t *testing.T) {
	d := NewFMB930()
	e := d.ExpectedDout(CmdUnlock, nil)
	if !e.Applicable || e.Which != 1 || !e.Dout1High {
		t.Fatalf("unlock expectation wrong: %+v", e)
	}
	e = d.ExpectedDout(CmdAlarmOn, nil)
	if !e.Applicable || e.Which != 2 || !e.Dout2High {
		t.Fatalf("alarm_on expectation wrong: %+v", e)
	}
	e = d.ExpectedDout(CmdReboot, nil)
	if e.Applicable {
		t.Fatalf("reboot should not be DOUT-ackable: %+v", e)
	}
}
