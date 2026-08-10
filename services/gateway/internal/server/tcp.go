// Package server is the TCP front door for devices. It performs the IMEI
// handshake, reads AVL (Codec 8E) and command-response (Codec 12) frames,
// acknowledges telemetry, feeds ingest, and signals pending commands.
package server

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"log"
	"net"
	"time"

	"github.com/penny/gateway/internal/adapter"
	"github.com/penny/gateway/internal/config"
	"github.com/penny/gateway/internal/ingest"
	"github.com/penny/gateway/internal/metrics"
	"github.com/penny/gateway/internal/protocol"
	"github.com/penny/gateway/internal/session"
	"github.com/penny/gateway/internal/store"
)

// Server accepts device connections.
type Server struct {
	cfg     config.Config
	store   store.Store
	reg     *session.Registry
	adapter adapter.DeviceAdapter
	ingest  *ingest.Ingestor
	metrics *metrics.Metrics
}

// New builds a Server.
func New(cfg config.Config, st store.Store, reg *session.Registry, adp adapter.DeviceAdapter, ing *ingest.Ingestor, m *metrics.Metrics) *Server {
	return &Server{cfg: cfg, store: st, reg: reg, adapter: adp, ingest: ing, metrics: m}
}

// ListenAndServe binds addr and serves until ctx is cancelled.
func (s *Server) ListenAndServe(ctx context.Context, addr string) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	return s.Serve(ctx, ln)
}

// Serve runs the TCP accept loop on ln until ctx is cancelled.
func (s *Server) Serve(ctx context.Context, ln net.Listener) error {
	log.Printf("[server] listening on %s", ln.Addr())
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			log.Printf("[server] accept: %v", err)
			continue
		}
		go s.Handle(ctx, conn)
	}
}

// Handle runs the full lifecycle for one connection.
func (s *Server) Handle(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	br := bufio.NewReader(conn)

	imei, err := readHandshake(br, s.cfg.SessionIdleClose)
	if err != nil {
		log.Printf("[server] handshake read: %v", err)
		return
	}
	dev, err := s.store.DeviceByIMEI(ctx, imei)
	if err != nil {
		log.Printf("[server] reject imei %s: %v", imei, err)
		_, _ = conn.Write([]byte{0x00}) // reject
		return
	}
	if _, err := conn.Write([]byte{0x01}); err != nil { // accept
		return
	}

	sess := session.New(imei, dev, conn)
	s.reg.Add(sess)
	defer func() {
		s.reg.Remove(sess)
		// The flag is only ever written true on ingest, so if the session end does
		// not clear it the vehicle stays "online" for good — visible to riders on a
		// map it is no longer on. Uses a fresh context: ctx is usually already
		// cancelled by the time we get here.
		if dev.VehicleID != "" {
			offCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := s.store.MarkVehicleOffline(offCtx, dev.VehicleID); err != nil {
				log.Printf("[server] mark offline imei=%s: %v", imei, err)
			}
		}
		log.Printf("[server] session down imei=%s vehicle=%s", imei, dev.VehicleID)
	}()
	log.Printf("[server] session up imei=%s vehicle=%s", imei, dev.VehicleID)

	for {
		if ctx.Err() != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(s.cfg.SessionIdleClose))
		frame, err := readFrame(br)
		if errors.Is(err, errKeepalive) {
			// A ping carries no data and needs no reply — it exists so the link
			// stays up between records, which is exactly what makes a
			// server-initiated unlock possible. It still counts as activity.
			sess.Touch()
			continue
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				log.Printf("[server] read imei=%s: %v", imei, err)
			}
			return
		}
		sess.Touch()
		s.dispatch(ctx, sess, dev, frame)
	}
}

// dispatch routes a framed packet by codec id.
func (s *Server) dispatch(ctx context.Context, sess *session.Session, dev store.Device, frame []byte) {
	codec := frame[8] // first byte of data field
	switch codec {
	case protocol.Codec8Extended:
		recs, ack, err := s.adapter.ParseFrame(frame)
		if err != nil {
			s.metrics.ParseError()
			log.Printf("[server] parse avl imei=%s: %v", sess.IMEI, err)
			return // do NOT ack a bad packet
		}
		if err := sess.Send(ack); err != nil {
			log.Printf("[server] ack imei=%s: %v", sess.IMEI, err)
			return
		}
		s.metrics.TelemetryRecords(len(recs))
		// Notify any pending command of the latest DOUT state (last record wins).
		if len(recs) > 0 {
			st := s.adapter.InterpretIO(recs[len(recs)-1].IO)
			sess.NotifyTelemetry(st.Dout1, st.Dout2)
		}
		if err := s.ingest.Process(ctx, dev, recs); err != nil {
			log.Printf("[server] ingest imei=%s: %v", sess.IMEI, err)
		}
	case protocol.Codec12:
		typ, payload, err := protocol.ParseCodec12(frame)
		if err != nil {
			s.metrics.ParseError()
			log.Printf("[server] parse codec12 imei=%s: %v", sess.IMEI, err)
			return
		}
		if typ == protocol.Codec12TypeResponse {
			// The device's own words. Only the fact of a reply was used, as an ACK,
			// and the text was dropped — which makes `getparam` useless, since its
			// entire value is in the answer, and hides the reason a command was
			// refused.
			log.Printf("[server] codec12 response imei=%s: %s", sess.IMEI, payload)
			sess.NotifyCodec12(payload)
		}
	default:
		s.metrics.ParseError()
		log.Printf("[server] unknown codec 0x%02x imei=%s", codec, sess.IMEI)
	}
}

// readHandshake reads the [2B length][IMEI ASCII] handshake message.
func readHandshake(br *bufio.Reader, timeout time.Duration) (string, error) {
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(br, hdr); err != nil {
		return "", err
	}
	n := int(binary.BigEndian.Uint16(hdr))
	if n == 0 || n > 32 {
		return "", errors.New("server: implausible imei length")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(br, buf); err != nil {
		return "", err
	}
	return string(buf), nil
}

// errKeepalive marks a zero-length frame — the device's link ping. It is a
// normal part of the stream, not a failure, and must never close the session.
var errKeepalive = errors.New("server: keepalive")

// readFrame reads one preamble-framed packet: [4B zero][4B len][data][4B crc].
func readFrame(br *bufio.Reader) ([]byte, error) {
	hdr := make([]byte, 8)
	if _, err := io.ReadFull(br, hdr); err != nil {
		return nil, err
	}
	dataLen := binary.BigEndian.Uint32(hdr[4:8])
	if dataLen == 0 {
		// Not a malformed packet: a zero-length frame is the device's keepalive.
		// It was treated as a protocol violation, so the gateway hung up on the
		// scooter every time one arrived — seven times in one afternoon, each
		// disconnect measured at the device's ping interval. Every failed unlock
		// today traces back to this: the command was written to a socket the
		// gateway itself had just closed.
		return nil, errKeepalive
	}
	if dataLen > 1<<20 {
		return nil, errors.New("server: implausible data length")
	}
	rest := make([]byte, int(dataLen)+4)
	if _, err := io.ReadFull(br, rest); err != nil {
		return nil, err
	}
	frame := make([]byte, 8+len(rest))
	copy(frame, hdr)
	copy(frame[8:], rest)
	return frame, nil
}
