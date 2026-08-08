package commands

import (
	"context"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/penny/gateway/internal/config"
	"github.com/penny/gateway/internal/metrics"
	"github.com/penny/gateway/internal/session"
	"github.com/penny/gateway/internal/store"
)

func metricsForTest() *metrics.Metrics { return metrics.New() }

func testCfg() config.Config {
	return config.Config{
		CmdTimeout:     500 * time.Millisecond,
		CmdSMSEscalate: 150 * time.Millisecond,
		UnlockExpiry:   20 * time.Second,
	}
}

func newStore() (*store.FakeStore, store.Device) {
	fs := store.NewFake()
	dev := store.Device{ID: "dev1", IMEI: "123", VehicleID: "veh1", Model: "fmb930",
		PhoneNumber: "+3069000000", SMSLogin: "log", SMSPass: "pw"}
	fs.AddDevice(dev)
	return fs, dev
}

// recordSMS records SMS sends for assertions.
type recordSMS struct {
	mu   sync.Mutex
	sent []string
}

func (r *recordSMS) Send(_ context.Context, to, text string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sent = append(r.sent, to+"|"+text)
	return nil
}
func (r *recordSMS) count() int { r.mu.Lock(); defer r.mu.Unlock(); return len(r.sent) }

// liveSession wires a session whose peer end acks via Codec 12 once it receives
// the command bytes.
func liveSession(t *testing.T, reg *session.Registry, dev store.Device, ack bool) (*session.Session, net.Conn) {
	t.Helper()
	gw, peer := net.Pipe()
	sess := session.New(dev.IMEI, dev, gw)
	reg.Add(sess)
	go func() {
		buf := make([]byte, 4096)
		_ = peer.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, _ := peer.Read(buf)
		if n > 0 && ack {
			sess.NotifyCodec12("setdigout:OK")
		}
	}()
	return sess, peer
}

func TestExpiredUnlockNeverDelivered(t *testing.T) {
	fs, dev := newStore()
	reg := session.NewRegistry()
	sms := &recordSMS{}
	c := New(fs, reg, metricsForTest(), testCfg(), sms)

	// A live session exists AND would ack, but the unlock is already expired.
	var delivered atomic.Bool
	gw, peer := net.Pipe()
	sess := session.New(dev.IMEI, dev, gw)
	reg.Add(sess)
	go func() {
		buf := make([]byte, 64)
		_ = peer.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		if n, _ := peer.Read(buf); n > 0 {
			delivered.Store(true)
			sess.NotifyCodec12("OK")
		}
	}()
	defer peer.Close()

	cmd := store.Command{ID: "u1", IMEI: dev.IMEI, VehicleID: dev.VehicleID, Kind: "unlock",
		QueuedAt: time.Now().Add(-21 * time.Second)} // > 20s old
	c.Deliver(context.Background(), cmd)

	time.Sleep(350 * time.Millisecond)
	if delivered.Load() {
		t.Fatal("expired unlock was written to the device — MUST NOT happen")
	}
	if got := fs.Status("u1"); got != store.StatusExpiry {
		t.Fatalf("status = %q, want expired", got)
	}
	if sms.count() != 0 {
		t.Fatal("expired unlock must not be SMS-delivered")
	}
}

func TestUnlockHappyPathAcked(t *testing.T) {
	fs, dev := newStore()
	reg := session.NewRegistry()
	c := New(fs, reg, metricsForTest(), testCfg(), &recordSMS{})
	_, peer := liveSession(t, reg, dev, true)
	defer peer.Close()

	cmd := store.Command{ID: "u2", IMEI: dev.IMEI, VehicleID: dev.VehicleID, Kind: "unlock", QueuedAt: time.Now()}
	c.Deliver(context.Background(), cmd)

	if got := fs.Status("u2"); got != store.StatusAcked {
		t.Fatalf("status = %q, want acked", got)
	}
}

func TestUnlockNoSessionFailsNoSMS(t *testing.T) {
	fs, dev := newStore()
	reg := session.NewRegistry()
	sms := &recordSMS{}
	c := New(fs, reg, metricsForTest(), testCfg(), sms)

	cmd := store.Command{ID: "u3", IMEI: dev.IMEI, VehicleID: dev.VehicleID, Kind: "unlock", QueuedAt: time.Now()}
	c.Deliver(context.Background(), cmd)

	if got := fs.Status("u3"); got != store.StatusFailed {
		t.Fatalf("status = %q, want failed", got)
	}
	if sms.count() != 0 {
		t.Fatal("unlock must never fall back to SMS (physical safety)")
	}
}

func TestNonUnlockFallsBackToSMS(t *testing.T) {
	fs, dev := newStore()
	reg := session.NewRegistry()
	sms := &recordSMS{}
	c := New(fs, reg, metricsForTest(), testCfg(), sms)

	// No session => lock command escalates to SMS with Teltonika "<login> <pass> <cmd>".
	cmd := store.Command{ID: "l1", IMEI: dev.IMEI, VehicleID: dev.VehicleID, Kind: "lock", QueuedAt: time.Now()}
	c.Deliver(context.Background(), cmd)

	if sms.count() != 1 {
		t.Fatalf("sms count = %d, want 1", sms.count())
	}
	if got := fs.Status("l1"); got != store.StatusSent {
		t.Fatalf("status = %q, want sent", got)
	}
}

func TestIdempotentRedelivery(t *testing.T) {
	fs, dev := newStore()
	reg := session.NewRegistry()
	c := New(fs, reg, metricsForTest(), testCfg(), &recordSMS{})
	_, peer := liveSession(t, reg, dev, true)
	defer peer.Close()

	cmd := store.Command{ID: "u4", IMEI: dev.IMEI, VehicleID: dev.VehicleID, Kind: "unlock", QueuedAt: time.Now()}
	c.Deliver(context.Background(), cmd)
	if got := fs.Status("u4"); got != store.StatusAcked {
		t.Fatalf("first deliver status = %q", got)
	}
	// Re-deliver same id: must be a no-op (no new session interaction / panic).
	c.Deliver(context.Background(), cmd)
}

// discard drains a pipe end to keep writers from blocking (unused here but handy).
var _ = io.Discard
