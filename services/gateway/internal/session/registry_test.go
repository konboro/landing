package session

import (
	"net"
	"testing"
	"time"

	"github.com/penny/gateway/internal/store"
)

func newTestSession(imei string) (*Session, net.Conn) {
	a, b := net.Pipe()
	s := New(imei, store.Device{IMEI: imei}, a)
	return s, b
}

func TestRegistryAddGetRemove(t *testing.T) {
	r := NewRegistry()
	s, peer := newTestSession("111")
	defer peer.Close()
	r.Add(s)
	if got, ok := r.Get("111"); !ok || got != s {
		t.Fatal("Get failed")
	}
	if r.Count() != 1 {
		t.Fatalf("count = %d", r.Count())
	}
	r.Remove(s)
	if _, ok := r.Get("111"); ok {
		t.Fatal("still present after Remove")
	}
}

func TestSerialLock(t *testing.T) {
	s, peer := newTestSession("222")
	defer peer.Close()
	s.Lock()
	if s.TryLock() {
		t.Fatal("TryLock succeeded while locked (serial execution broken)")
	}
	s.Unlock()
	if !s.TryLock() {
		t.Fatal("TryLock failed after Unlock")
	}
	s.Unlock()
}

func TestReapIdle(t *testing.T) {
	r := NewRegistry()
	s, peer := newTestSession("333")
	defer peer.Close()
	r.Add(s)
	// force last-activity into the past.
	s.last.Store(time.Now().Add(-10 * time.Minute))
	if n := r.ReapIdle(5 * time.Minute); n != 1 {
		t.Fatalf("reaped %d, want 1", n)
	}
	if r.Count() != 0 {
		t.Fatal("session not removed by reaper")
	}
}

func TestAckSignal(t *testing.T) {
	s, peer := newTestSession("444")
	defer peer.Close()
	ch := s.BeginAckWait()
	s.NotifyCodec12("OK")
	select {
	case ev := <-ch:
		if !ev.Codec12 || ev.Payload != "OK" {
			t.Fatalf("bad event %+v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("no ack event delivered")
	}
	s.EndAckWait()
	// After EndAckWait, signals are dropped (no panic, no delivery).
	s.NotifyTelemetry(true, false)
}
