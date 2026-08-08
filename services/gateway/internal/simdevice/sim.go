// Package simdevice emulates a Teltonika FMB930 well enough for CI: it performs
// the IMEI handshake, streams Codec 8E telemetry, and answers setdigout commands
// by flipping its DOUT state and replying (Codec 12 response + a telemetry record
// reflecting the new DOUT). It is dependency-free of the gateway core so it truly
// exercises the wire protocol.
package simdevice

import (
	"bufio"
	"context"
	"encoding/binary"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/penny/gateway/internal/protocol"
)

// AVL IO ids emitted by the emulated firmware. These mirror the ids the fmb930
// adapter normalizes; here they represent the device's own firmware mapping.
const (
	ioIgnition    = 239
	ioMovement    = 240
	ioDout1       = 179
	ioDout2       = 180
	ioExtVoltage  = 66
	ioBattVoltage = 67
	ioGSMSignal   = 21
)

// Simulator is a single fake device.
type Simulator struct {
	IMEI     string
	Interval time.Duration // telemetry cadence

	conn net.Conn
	bw   *bufio.Writer
	wmu  sync.Mutex

	mu    sync.Mutex
	dout1 bool
	dout2 bool

	// Acks counts telemetry ACKs received (test observability).
	acks int
	// commands counts Codec 12 commands received.
	commands int
}

// New builds a simulator over an already-connected conn.
func New(imei string, conn net.Conn) *Simulator {
	return &Simulator{IMEI: imei, Interval: 500 * time.Millisecond, conn: conn, bw: bufio.NewWriter(conn)}
}

// Dial connects to a gateway TCP address and returns a simulator.
func Dial(addr, imei string) (*Simulator, error) {
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return nil, err
	}
	return New(imei, conn), nil
}

// Handshake performs the IMEI handshake and returns true if accepted.
func (s *Simulator) Handshake() (bool, error) {
	hdr := make([]byte, 2)
	binary.BigEndian.PutUint16(hdr, uint16(len(s.IMEI)))
	if err := s.write(append(hdr, []byte(s.IMEI)...)); err != nil {
		return false, err
	}
	reply := make([]byte, 1)
	if _, err := io.ReadFull(s.conn, reply); err != nil {
		return false, err
	}
	return reply[0] == 0x01, nil
}

func (s *Simulator) write(b []byte) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	if _, err := s.bw.Write(b); err != nil {
		return err
	}
	return s.bw.Flush()
}

// telemetry builds a Codec 8E packet reflecting the current DOUT state.
func (s *Simulator) telemetry() []byte {
	s.mu.Lock()
	d1, d2 := s.dout1, s.dout2
	s.mu.Unlock()

	io := map[uint16]int64{
		ioIgnition:    0,
		ioMovement:    0,
		ioExtVoltage:  39500, // ~39.5V vehicle battery
		ioBattVoltage: 4000,  // internal backup battery mV
		ioGSMSignal:   4,
		ioDout1:       b2i(d1),
		ioDout2:       b2i(d2),
	}
	rec := protocol.Record{
		TimestampMs: uint64(time.Now().UnixMilli()),
		Priority:    1,
		GPS: protocol.GPS{
			LngE7: 237261000, // ~23.7261 E (Athens)
			LatE7: 379838000, // ~37.9838 N
			Sats:  9,
			Speed: 0,
		},
		EventIOID: 0,
		IO:        io,
	}
	return protocol.BuildAVL([]protocol.Record{rec})
}

// SendTelemetry sends one telemetry packet.
func (s *Simulator) SendTelemetry() error { return s.write(s.telemetry()) }

// Run performs the handshake and then streams telemetry and answers commands
// until ctx is cancelled or the connection drops.
func (s *Simulator) Run(ctx context.Context) error {
	ok, err := s.Handshake()
	if err != nil {
		return err
	}
	if !ok {
		return io.ErrUnexpectedEOF
	}
	go s.readLoop(ctx)

	// initial telemetry so the gateway has state immediately.
	_ = s.SendTelemetry()
	t := time.NewTicker(s.Interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			if err := s.SendTelemetry(); err != nil {
				return err
			}
		}
	}
}

// readLoop reads inbound messages: 4-byte telemetry ACKs and Codec 12 command
// frames. Disambiguation: a command frame begins with a 4-byte zero preamble,
// while an ACK is the record count (low byte non-zero).
func (s *Simulator) readLoop(ctx context.Context) {
	br := bufio.NewReader(s.conn)
	for {
		if ctx.Err() != nil {
			return
		}
		head := make([]byte, 4)
		if _, err := io.ReadFull(br, head); err != nil {
			return
		}
		if head[0] == 0 && head[1] == 0 && head[2] == 0 && head[3] == 0 {
			// Codec 12 command frame: read size then data+crc.
			sz := make([]byte, 4)
			if _, err := io.ReadFull(br, sz); err != nil {
				return
			}
			dataLen := binary.BigEndian.Uint32(sz)
			rest := make([]byte, int(dataLen)+4)
			if _, err := io.ReadFull(br, rest); err != nil {
				return
			}
			frame := make([]byte, 0, 8+len(rest))
			frame = append(frame, head...)
			frame = append(frame, sz...)
			frame = append(frame, rest...)
			s.handleCommand(frame)
		} else {
			// telemetry ACK.
			s.mu.Lock()
			s.acks++
			s.mu.Unlock()
		}
	}
}

// handleCommand parses a Codec 12 command, applies setdigout, and replies with a
// Codec 12 response plus a fresh telemetry record showing the new DOUT state.
func (s *Simulator) handleCommand(frame []byte) {
	typ, payload, err := protocol.ParseCodec12(frame)
	if err != nil || typ != protocol.Codec12TypeCommand {
		return
	}
	s.mu.Lock()
	s.commands++
	s.mu.Unlock()

	resp := "OK"
	if strings.HasPrefix(payload, "setdigout") {
		s.applySetdigout(payload)
		resp = payload + ":OK"
	}
	_ = s.write(protocol.BuildResponse(resp))
	// Reflect the new DOUT in telemetry so the gateway's AVL-based ACK fires too.
	_ = s.SendTelemetry()
}

// applySetdigout parses "setdigout d1 d2 ..." where each digit is '0','1' or '?'.
func (s *Simulator) applySetdigout(cmd string) {
	fields := strings.Fields(cmd)
	if len(fields) < 2 {
		return
	}
	digits := fields[1]
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(digits) >= 1 {
		switch digits[0] {
		case '1':
			s.dout1 = true
		case '0':
			s.dout1 = false
		}
	}
	if len(digits) >= 2 {
		switch digits[1] {
		case '1':
			s.dout2 = true
		case '0':
			s.dout2 = false
		}
	}
}

// Acks returns the number of telemetry ACKs received so far.
func (s *Simulator) Acks() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.acks
}

// Commands returns the number of Codec 12 commands received so far.
func (s *Simulator) Commands() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.commands
}

// Dout returns the current DOUT states.
func (s *Simulator) Dout() (bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dout1, s.dout2
}

// Close closes the connection.
func (s *Simulator) Close() error { return s.conn.Close() }

func b2i(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
