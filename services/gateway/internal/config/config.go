// Package config loads gateway configuration from the environment. See docs/03.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all runtime configuration.
type Config struct {
	Port              int           // TCP listener for devices (default 5027)
	MetricsPort       int           // HTTP metrics (default 9100)
	DBURL             string        // Postgres URL; empty => in-memory fake store
	PGMQQueue         string        // pgmq command queue name (default "commands")
	CmdTimeout        time.Duration // ACK wait per attempt (default 8000ms)
	CmdSMSEscalate    time.Duration // wait for reconnect before SMS (default 5000ms)
	// SessionIdleClose must stay comfortably ABOVE the fleet's reporting period.
	// It was 300s — exactly the period an FMB930 uses when parked — so the server
	// tore down the link in the same window the device was about to send its next
	// record. Observed on the first real scooter: last record 09:28:25, read
	// deadline fired 09:33:14, eleven seconds before the next one was due, and the
	// device never came back. Default 1800s (30 min).
	SessionIdleClose  time.Duration
	UnlockExpiry      time.Duration // unlock hard expiry (fixed 20s per docs/03)
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func atoi(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}

// Load reads configuration from the environment, applying documented defaults.
func Load() Config {
	return Config{
		Port:             atoi(getenv("PORT", "5027"), 5027),
		MetricsPort:      atoi(getenv("METRICS_PORT", "9100"), 9100),
		DBURL:            os.Getenv("DB_URL"),
		PGMQQueue:        getenv("PGMQ_QUEUE", "commands"),
		CmdTimeout:       time.Duration(atoi(getenv("CMD_TIMEOUT_MS", "8000"), 8000)) * time.Millisecond,
		CmdSMSEscalate:   time.Duration(atoi(getenv("CMD_SMS_ESCALATE_MS", "5000"), 5000)) * time.Millisecond,
		SessionIdleClose: time.Duration(atoi(getenv("SESSION_IDLE_CLOSE_S", "1800"), 1800)) * time.Second,
		UnlockExpiry:     20 * time.Second,
	}
}
