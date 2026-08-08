package server_test

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/penny/gateway/internal/adapter"
	"github.com/penny/gateway/internal/commands"
	"github.com/penny/gateway/internal/config"
	"github.com/penny/gateway/internal/ingest"
	"github.com/penny/gateway/internal/metrics"
	"github.com/penny/gateway/internal/server"
	"github.com/penny/gateway/internal/session"
	"github.com/penny/gateway/internal/simdevice"
	"github.com/penny/gateway/internal/store"
)

func waitFor(t *testing.T, d time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return cond()
}

// TestFullUnlockLoop drives the real wire protocol end to end: simdevice
// connects, handshakes, streams Codec 8E telemetry; an unlock is enqueued; the
// consumer delivers Codec 12 and the command reaches "acked".
func TestFullUnlockLoop(t *testing.T) {
	const imei = "350612070000001"
	cfg := config.Config{
		CmdTimeout:       2 * time.Second,
		CmdSMSEscalate:   1 * time.Second,
		SessionIdleClose: 5 * time.Minute,
		UnlockExpiry:     20 * time.Second,
	}

	fs := store.NewFake()
	dev := store.Device{ID: "dev1", IMEI: imei, VehicleID: "veh1", Model: "fmb930"}
	fs.AddDevice(dev)

	reg := session.NewRegistry()
	m := metrics.New()
	m.SetSessionsGauge(reg.Count)
	adp := adapter.NewFMB930()
	ing := ingest.New(fs, adp, m, nil)
	srv := server.New(cfg, fs, reg, adp, ing, m)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go srv.Serve(ctx, ln)

	cons := commands.New(fs, reg, m, cfg, commands.LogSMS{})
	go cons.Run(ctx)

	sim, err := simdevice.Dial(ln.Addr().String(), imei)
	if err != nil {
		t.Fatal(err)
	}
	sim.Interval = 150 * time.Millisecond
	defer sim.Close()
	go func() { _ = sim.Run(ctx) }()

	// Wait until the session is up and telemetry is flowing.
	if !waitFor(t, 3*time.Second, func() bool {
		_, ok := reg.Get(imei)
		return ok && sim.Acks() > 0
	}) {
		t.Fatal("session/telemetry never established")
	}
	if fs.TelemetryLen() == 0 {
		t.Fatal("no telemetry ingested")
	}
	if !fs.HasState("veh1") {
		t.Fatal("vehicle_state not upserted")
	}

	// Enqueue an unlock and expect it to be acked via the wire.
	fs.Enqueue(store.Command{ID: "cmd-unlock-1", IMEI: imei, VehicleID: "veh1", Kind: "unlock", QueuedAt: time.Now()})

	if !waitFor(t, 4*time.Second, func() bool { return fs.Status("cmd-unlock-1") == store.StatusAcked }) {
		t.Fatalf("unlock not acked; status=%q, sim.Commands=%d", fs.Status("cmd-unlock-1"), sim.Commands())
	}

	// The device must have received a setdigout command and raised DOUT1 (unlock).
	if sim.Commands() == 0 {
		t.Fatal("simdevice received no command")
	}
	if d1, _ := sim.Dout(); !d1 {
		t.Fatal("DOUT1 (lock relay) not raised by unlock")
	}
}
