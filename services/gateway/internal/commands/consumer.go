// Package commands consumes queued commands and delivers them to devices over
// GPRS (Codec 12) with SMS fallback, honouring the delivery rules in docs/03:
// per-device serial execution, ACK via Codec 12 response OR next AVL DOUT state,
// retry once, SMS fallback, and a hard 20s unlock expiry that must never be
// delivered late.
package commands

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/penny/gateway/internal/adapter"
	"github.com/penny/gateway/internal/config"
	"github.com/penny/gateway/internal/metrics"
	"github.com/penny/gateway/internal/session"
	"github.com/penny/gateway/internal/store"
)

// SMSSender delivers a command over the SMS channel (outbound only).
type SMSSender interface {
	Send(ctx context.Context, to, text string) error
}

// LogSMS is a stub SMS sender that only logs. Production wires a real provider.
type LogSMS struct{}

// Send logs the SMS instead of sending it.
func (LogSMS) Send(_ context.Context, to, text string) error {
	log.Printf("[sms-stub] to=%s text=%q", to, text)
	return nil
}

// AdapterFactory returns a DeviceAdapter for a device model string.
type AdapterFactory func(model string) adapter.DeviceAdapter

// DefaultAdapterFactory maps model strings to adapters.
func DefaultAdapterFactory(model string) adapter.DeviceAdapter {
	switch model {
	case "fmb930", "":
		return adapter.NewFMB930()
	default:
		return adapter.NewFMB930()
	}
}

// Consumer polls the queue and delivers commands.
type Consumer struct {
	store   store.Store
	reg     *session.Registry
	metrics *metrics.Metrics
	cfg     config.Config
	sms     SMSSender
	newAdp  AdapterFactory
	now     func() time.Time

	poll    time.Duration
	reconn  time.Duration // poll interval while waiting for reconnect

	seen map[string]bool // idempotency: command ids already delivered/terminal
}

// New builds a Consumer.
func New(st store.Store, reg *session.Registry, m *metrics.Metrics, cfg config.Config, sms SMSSender) *Consumer {
	return &Consumer{
		store:   st,
		reg:     reg,
		metrics: m,
		cfg:     cfg,
		sms:     sms,
		newAdp:  DefaultAdapterFactory,
		now:     time.Now,
		poll:    250 * time.Millisecond,
		reconn:  100 * time.Millisecond,
		seen:    map[string]bool{},
	}
}

// Run polls the queue until ctx is cancelled.
func (c *Consumer) Run(ctx context.Context) {
	t := time.NewTicker(c.poll)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.drain(ctx)
		}
	}
}

func (c *Consumer) drain(ctx context.Context) {
	for {
		cmd, ok, err := c.store.NextCommand(ctx)
		if err != nil {
			log.Printf("[commands] NextCommand: %v", err)
			return
		}
		if !ok {
			return
		}
		c.Deliver(ctx, cmd)
	}
}

// isUnlock reports whether a command is an unlock (subject to 20s expiry).
func isUnlock(kind string) bool { return adapter.CommandKind(kind) == adapter.CmdUnlock }

// expired reports whether an unlock command is past its hard expiry and must
// never be delivered.
func (c *Consumer) expired(cmd store.Command) bool {
	if !isUnlock(cmd.Kind) {
		return false
	}
	return c.now().Sub(cmd.QueuedAt) > c.cfg.UnlockExpiry
}

// Deliver runs the full delivery state machine for one command. Safe to call
// with a duplicate id (idempotent no-op once delivered/terminal).
func (c *Consumer) Deliver(ctx context.Context, cmd store.Command) {
	// Idempotency: same id already handled => no-op (docs/03).
	if c.seen[cmd.ID] {
		return
	}

	// Hard unlock expiry gate BEFORE any delivery attempt. An expired unlock is
	// never sent — not over GPRS, not over SMS.
	if c.expired(cmd) {
		c.markExpired(ctx, cmd)
		return
	}

	dev, derr := c.store.DeviceByIMEI(ctx, cmd.IMEI)
	if derr != nil {
		log.Printf("[commands] device %s: %v", cmd.IMEI, derr)
		_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusFailed, "", derr.Error())
		c.seen[cmd.ID] = true
		return
	}
	adp := c.newAdp(dev.Model)
	wire, smsText, err := adp.BuildCommand(adapter.CommandKind(cmd.Kind), adapter.Args(cmd.Payload))
	if err != nil {
		log.Printf("[commands] build %s: %v", cmd.Kind, err)
		_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusFailed, "", err.Error())
		c.seen[cmd.ID] = true
		return
	}

	// Find a live session, or wait briefly for reconnect (cmd_gprs_wait_ms).
	sess := c.waitForSession(ctx, cmd.IMEI, c.cfg.CmdSMSEscalate)
	if sess == nil {
		c.smsFallback(ctx, cmd, dev, smsText, "no live session")
		return
	}

	// Per-device serial execution: one in-flight command per IMEI.
	sess.Lock()
	defer sess.Unlock()

	exp := expectation(adp, adapter.CommandKind(cmd.Kind), adapter.Args(cmd.Payload))

	// Attempt up to 2 times (initial + one retry).
	start := c.now()
	for attempt := 1; attempt <= 2; attempt++ {
		// Re-check expiry immediately before every send: never deliver late.
		if c.expired(cmd) {
			c.markExpired(ctx, cmd)
			return
		}
		ch := sess.BeginAckWait()
		if err := sess.Send(wire); err != nil {
			sess.EndAckWait()
			log.Printf("[commands] send %s to %s: %v", cmd.Kind, cmd.IMEI, err)
			break // fall through to SMS fallback
		}
		_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusSent, "gprs", "")
		c.metrics.CmdSent()

		acked := c.awaitAck(ctx, ch, exp, c.cfg.CmdTimeout)
		sess.EndAckWait()
		if acked {
			latency := c.now().Sub(start).Milliseconds()
			c.metrics.ObserveCmdLatency(latency)
			c.metrics.CmdAcked()
			if isUnlock(cmd.Kind) {
				c.metrics.UnlockResult(true)
			}
			_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusAcked, "gprs", "")
			c.seen[cmd.ID] = true
			return
		}
		// timeout: loop retries once
	}

	// GPRS attempts exhausted -> SMS fallback (unless it's an expired unlock).
	c.smsFallback(ctx, cmd, dev, smsText, "no ack over gprs")
}

// smsFallback delivers over SMS, respecting the unlock expiry gate.
func (c *Consumer) smsFallback(ctx context.Context, cmd store.Command, dev store.Device, smsText, reason string) {
	if c.expired(cmd) {
		c.markExpired(ctx, cmd)
		return
	}
	// An unlock over SMS would arrive far too late to be safe; treat GPRS failure
	// of an unlock as a failure, do not blindly SMS a physical unlock. Other
	// commands (lock, alarm_off, setparam) are safe over SMS.
	if isUnlock(cmd.Kind) {
		log.Printf("[commands] unlock %s not acked over gprs (%s); not SMS-delivering an unlock", cmd.ID, reason)
		_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusFailed, "gprs", "no ack: "+reason)
		c.metrics.UnlockResult(false)
		c.seen[cmd.ID] = true
		return
	}

	to := dev.PhoneNumber
	text := smsText
	if login := dev.SMSLogin; login != "" {
		// Teltonika SMS format: "<login> <pass> <command>"
		text = strings.TrimSpace(login + " " + dev.SMSPass + " " + smsText)
	}
	if to == "" {
		log.Printf("[commands] no MSISDN for %s; cannot SMS", cmd.IMEI)
		_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusFailed, "sms", "no msisdn")
		c.seen[cmd.ID] = true
		return
	}
	c.metrics.SMSFallback()
	if err := c.sms.Send(ctx, to, text); err != nil {
		_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusFailed, "sms", err.Error())
		c.seen[cmd.ID] = true
		return
	}
	// SMS is fire-and-forget (no GPRS ack path); mark sent over sms channel.
	_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusSent, "sms", "gprs fallback: "+reason)
	c.seen[cmd.ID] = true
}

func (c *Consumer) markExpired(ctx context.Context, cmd store.Command) {
	_ = c.store.MarkCommand(ctx, cmd.ID, store.StatusExpiry, "", "unlock expired before delivery")
	if isUnlock(cmd.Kind) {
		c.metrics.UnlockResult(false)
	}
	c.seen[cmd.ID] = true
}

// waitForSession returns a live session for imei, waiting up to d for reconnect.
func (c *Consumer) waitForSession(ctx context.Context, imei string, d time.Duration) *session.Session {
	deadline := c.now().Add(d)
	for {
		if s, ok := c.reg.Get(imei); ok {
			return s
		}
		if c.now().After(deadline) {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(c.reconn):
		}
	}
}

// awaitAck blocks until an ACK-satisfying event arrives or timeout elapses.
func (c *Consumer) awaitAck(ctx context.Context, ch <-chan session.AckEvent, exp adapter.DoutExpectation, timeout time.Duration) bool {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-timer.C:
			return false
		case ev := <-ch:
			if matchAck(ev, exp) {
				return true
			}
		}
	}
}

// matchAck decides whether an event counts as an ACK. A Codec 12 response always
// counts (unless it is an explicit error); an AVL record counts if it shows the
// expected DOUT state.
func matchAck(ev session.AckEvent, exp adapter.DoutExpectation) bool {
	if ev.Codec12 {
		p := strings.ToLower(ev.Payload)
		if strings.Contains(p, "error") || strings.Contains(p, "invalid") {
			return false
		}
		return true
	}
	if ev.FromAVL && exp.Applicable {
		switch exp.Which {
		case 1:
			return ev.Dout1High == exp.Dout1High
		case 2:
			return ev.Dout2High == exp.Dout2High
		}
	}
	return false
}

// expectation asks the adapter (if capable) what DOUT state a command should
// produce, so an AVL record can serve as an ACK.
func expectation(adp adapter.DeviceAdapter, kind adapter.CommandKind, args adapter.Args) adapter.DoutExpectation {
	if e, ok := adp.(adapter.AckExpecter); ok {
		return e.ExpectedDout(kind, args)
	}
	return adapter.DoutExpectation{}
}
