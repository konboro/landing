// Package metrics exposes a tiny hand-rolled Prometheus-style text endpoint.
// No external prometheus dependency (docs/03 allows expvar/hand-rolled text).
package metrics

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
)

// Metrics holds the gateway's counters and gauges.
type Metrics struct {
	unlockTotal      atomic.Int64
	unlockSuccess    atomic.Int64
	parseErrors      atomic.Int64
	telemetryRecords atomic.Int64
	cmdLatencySum    atomic.Int64 // milliseconds
	cmdLatencyCnt    atomic.Int64
	cmdSent          atomic.Int64
	cmdAcked         atomic.Int64
	smsFallback      atomic.Int64

	mu             sync.Mutex
	sessionsActive func() int // gauge callback
}

// New returns a Metrics with a default zero sessions gauge.
func New() *Metrics {
	return &Metrics{sessionsActive: func() int { return 0 }}
}

// SetSessionsGauge installs the live-sessions gauge callback.
func (m *Metrics) SetSessionsGauge(f func() int) {
	m.mu.Lock()
	m.sessionsActive = f
	m.mu.Unlock()
}

// ParseError increments the parse error counter.
func (m *Metrics) ParseError() { m.parseErrors.Add(1) }

// TelemetryRecords counts AVL records successfully parsed and handed to the
// ingest layer. This is the number to watch on the bench: if sessions are up
// but this stays flat, the device is connecting but not reporting.
func (m *Metrics) TelemetryRecords(n int) { m.telemetryRecords.Add(int64(n)) }

// CmdSent increments commands sent.
func (m *Metrics) CmdSent() { m.cmdSent.Add(1) }

// CmdAcked increments commands acked.
func (m *Metrics) CmdAcked() { m.cmdAcked.Add(1) }

// SMSFallback increments the SMS-fallback counter.
func (m *Metrics) SMSFallback() { m.smsFallback.Add(1) }

// ObserveCmdLatency records a command round-trip latency in milliseconds.
func (m *Metrics) ObserveCmdLatency(ms int64) {
	m.cmdLatencySum.Add(ms)
	m.cmdLatencyCnt.Add(1)
}

// UnlockResult records an unlock outcome for the success-rate gauge.
func (m *Metrics) UnlockResult(success bool) {
	m.unlockTotal.Add(1)
	if success {
		m.unlockSuccess.Add(1)
	}
}

func (m *Metrics) sessions() int {
	m.mu.Lock()
	f := m.sessionsActive
	m.mu.Unlock()
	return f()
}

// Text renders the metrics in Prometheus exposition format.
func (m *Metrics) Text() string {
	total := m.unlockTotal.Load()
	success := m.unlockSuccess.Load()
	var rate float64
	if total > 0 {
		rate = float64(success) / float64(total)
	}
	var avgLatency float64
	if c := m.cmdLatencyCnt.Load(); c > 0 {
		avgLatency = float64(m.cmdLatencySum.Load()) / float64(c)
	}

	var b []byte
	add := func(format string, args ...any) {
		b = append(b, []byte(fmt.Sprintf(format, args...))...)
	}
	add("# HELP gateway_unlock_success_rate Fraction of unlock commands acked.\n")
	add("# TYPE gateway_unlock_success_rate gauge\n")
	add("gateway_unlock_success_rate %g\n", rate)
	add("gateway_unlock_total %d\n", total)
	add("gateway_unlock_success %d\n", success)

	add("# HELP gateway_cmd_latency_ms Average command ACK latency (ms).\n")
	add("# TYPE gateway_cmd_latency_ms gauge\n")
	add("gateway_cmd_latency_ms %g\n", avgLatency)
	add("gateway_cmd_latency_ms_sum %d\n", m.cmdLatencySum.Load())
	add("gateway_cmd_latency_ms_count %d\n", m.cmdLatencyCnt.Load())

	add("# HELP gateway_sessions_active Live device TCP sessions.\n")
	add("# TYPE gateway_sessions_active gauge\n")
	add("gateway_sessions_active %d\n", m.sessions())

	add("# HELP gateway_parse_errors_total AVL frames rejected (bad CRC/format).\n")
	add("# TYPE gateway_parse_errors_total counter\n")
	add("gateway_parse_errors_total %d\n", m.parseErrors.Load())
	add("# HELP gateway_telemetry_records_total AVL records parsed and ingested.\n")
	add("# TYPE gateway_telemetry_records_total counter\n")
	add("gateway_telemetry_records_total %d\n", m.telemetryRecords.Load())

	add("gateway_cmd_sent_total %d\n", m.cmdSent.Load())
	add("gateway_cmd_acked_total %d\n", m.cmdAcked.Load())
	add("gateway_sms_fallback_total %d\n", m.smsFallback.Load())
	return string(b)
}

// Handler serves the metrics text on /metrics.
func (m *Metrics) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = w.Write([]byte(m.Text()))
	})
	return mux
}
