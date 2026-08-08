// Package session tracks live device connections. One Session per IMEI, with
// last-activity tracking, per-device serial command execution (one in-flight
// command per IMEI) and an ACK-signalling channel fed by the read loop.
package session

import (
	"context"
	"net"
	"sync"
	"time"

	"github.com/penny/gateway/internal/store"
)

// AckEvent is a signal that may satisfy a pending command's ACK wait. It comes
// either from a Codec 12 response or from a telemetry record reporting DOUT.
type AckEvent struct {
	Codec12    bool   // true if this came from a Codec 12 response frame
	Payload    string // Codec 12 ASCII payload, if any
	FromAVL    bool   // true if this came from a telemetry record
	Dout1High  bool
	Dout2High  bool
}

// Session is a live device connection.
type Session struct {
	IMEI   string
	Device store.Device

	conn net.Conn

	writeMu sync.Mutex // guards writes to conn
	cmdMu   sync.Mutex // serializes command execution: one in-flight per IMEI

	last atomic[time.Time]

	ackMu sync.Mutex
	ackCh chan AckEvent // non-nil only while a command is waiting for ACK
}

// atomic is a tiny generic mutex-guarded cell (kept dependency-free).
type atomic[T any] struct {
	mu sync.Mutex
	v  T
}

func (a *atomic[T]) Store(v T) { a.mu.Lock(); a.v = v; a.mu.Unlock() }
func (a *atomic[T]) Load() T   { a.mu.Lock(); defer a.mu.Unlock(); return a.v }

// New creates a session for a connection.
func New(imei string, dev store.Device, conn net.Conn) *Session {
	s := &Session{IMEI: imei, Device: dev, conn: conn}
	s.Touch()
	return s
}

// Touch records activity now.
func (s *Session) Touch() { s.last.Store(time.Now()) }

// LastActivity returns the last activity time.
func (s *Session) LastActivity() time.Time { return s.last.Load() }

// Send writes raw bytes to the device.
func (s *Session) Send(b []byte) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	_, err := s.conn.Write(b)
	return err
}

// Close closes the underlying connection.
func (s *Session) Close() error { return s.conn.Close() }

// Lock acquires the per-device command lock (serial execution). Callers must
// pair with Unlock. TryLock lets the consumer skip a device already busy.
func (s *Session) Lock()         { s.cmdMu.Lock() }
func (s *Session) Unlock()       { s.cmdMu.Unlock() }
func (s *Session) TryLock() bool { return s.cmdMu.TryLock() }

// BeginAckWait installs a fresh ACK channel and returns it. Call once before
// sending a command; drain with WaitAck; always call EndAckWait after.
func (s *Session) BeginAckWait() <-chan AckEvent {
	s.ackMu.Lock()
	defer s.ackMu.Unlock()
	ch := make(chan AckEvent, 8)
	s.ackCh = ch
	return ch
}

// EndAckWait tears down the ACK channel so later events are dropped.
func (s *Session) EndAckWait() {
	s.ackMu.Lock()
	defer s.ackMu.Unlock()
	s.ackCh = nil
}

// signal delivers an event to a waiting command, if any (non-blocking).
func (s *Session) signal(ev AckEvent) {
	s.ackMu.Lock()
	ch := s.ackCh
	s.ackMu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- ev:
	default:
	}
}

// NotifyCodec12 is called by the read loop when a Codec 12 response arrives.
func (s *Session) NotifyCodec12(payload string) {
	s.Touch()
	s.signal(AckEvent{Codec12: true, Payload: payload})
}

// NotifyTelemetry is called by the read loop after each telemetry record so a
// pending command can observe the expected DOUT state.
func (s *Session) NotifyTelemetry(dout1High, dout2High bool) {
	s.signal(AckEvent{FromAVL: true, Dout1High: dout1High, Dout2High: dout2High})
}

// Registry maps IMEI -> Session and reaps idle sessions.
type Registry struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{sessions: map[string]*Session{}}
}

// Add stores a session, replacing (and closing) any prior one for that IMEI.
func (r *Registry) Add(s *Session) {
	r.mu.Lock()
	if old, ok := r.sessions[s.IMEI]; ok && old != s {
		_ = old.Close()
	}
	r.sessions[s.IMEI] = s
	r.mu.Unlock()
}

// Get returns the live session for an IMEI.
func (r *Registry) Get(imei string) (*Session, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.sessions[imei]
	return s, ok
}

// Remove deletes a session if it is still the current one for that IMEI.
func (r *Registry) Remove(s *Session) {
	r.mu.Lock()
	if cur, ok := r.sessions[s.IMEI]; ok && cur == s {
		delete(r.sessions, s.IMEI)
	}
	r.mu.Unlock()
}

// Count returns the number of live sessions.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.sessions)
}

// ReapIdle closes and removes sessions idle longer than idle. Returns count reaped.
func (r *Registry) ReapIdle(idle time.Duration) int {
	cutoff := time.Now().Add(-idle)
	r.mu.Lock()
	var stale []*Session
	for _, s := range r.sessions {
		if s.LastActivity().Before(cutoff) {
			stale = append(stale, s)
		}
	}
	for _, s := range stale {
		delete(r.sessions, s.IMEI)
	}
	r.mu.Unlock()
	for _, s := range stale {
		_ = s.Close()
	}
	return len(stale)
}

// RunReaper runs ReapIdle on a ticker until ctx is done.
func (r *Registry) RunReaper(ctx context.Context, idle time.Duration) {
	t := time.NewTicker(idle / 3)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.ReapIdle(idle)
		}
	}
}
