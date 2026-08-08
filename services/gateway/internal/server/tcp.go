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

// ListenAndServe runs the TCP accept loop until ctx is cancelled.
func (s *Server) ListenAndServe(ctx context.Context, addr string) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[server] listening on %s", addr)
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
	defer s.reg.Remove(sess)
	log.Printf("[server] session up imei=%s vehicle=%s", imei, dev.VehicleID)

	for {
		if ctx.Err() != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(s.cfg.SessionIdleClose))
		frame, err := readFrame(br)
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

// readFrame reads one preamble-framed packet: [4B zero][4B len][data][4B crc].
func readFrame(br *bufio.Reader) ([]byte, error) {
	hdr := make([]byte, 8)
	if _, err := io.ReadFull(br, hdr); err != nil {
		return nil, err
	}
	dataLen := binary.BigEndian.Uint32(hdr[4:8])
	if dataLen == 0 || dataLen > 1<<20 {
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
