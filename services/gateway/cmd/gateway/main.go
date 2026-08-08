// Command gateway is the Penny IoT gateway: a TCP server for Teltonika FMB930
// devices (Codec 8E telemetry, Codec 12 commands) plus a command consumer and a
// metrics endpoint. With DB_URL unset it runs against an in-memory fake store so
// it (and the simulator) work without Postgres.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/penny/gateway/internal/adapter"
	"github.com/penny/gateway/internal/commands"
	"github.com/penny/gateway/internal/config"
	"github.com/penny/gateway/internal/ingest"
	"github.com/penny/gateway/internal/metrics"
	"github.com/penny/gateway/internal/server"
	"github.com/penny/gateway/internal/session"
	"github.com/penny/gateway/internal/store"
)

func main() {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st := buildStore(ctx, cfg)

	reg := session.NewRegistry()
	m := metrics.New()
	m.SetSessionsGauge(reg.Count)

	adp := adapter.NewFMB930()
	ing := ingest.New(st, adp, m, nil)

	srv := server.New(cfg, st, reg, adp, ing, m)
	cons := commands.New(st, reg, m, cfg, commands.LogSMS{})

	// Metrics endpoint.
	go func() {
		addr := fmt.Sprintf(":%d", cfg.MetricsPort)
		log.Printf("[metrics] listening on %s/metrics", addr)
		hs := &http.Server{Addr: addr, Handler: m.Handler(), ReadHeaderTimeout: 5 * time.Second}
		if err := hs.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[metrics] %v", err)
		}
	}()

	go cons.Run(ctx)
	go reg.RunReaper(ctx, cfg.SessionIdleClose)

	addr := fmt.Sprintf(":%d", cfg.Port)
	if err := srv.ListenAndServe(ctx, addr); err != nil {
		log.Fatalf("[server] %v", err)
	}
	log.Printf("[gateway] shutdown")
}

// buildStore returns a PGStore when DB_URL is set, otherwise a warning + fake.
func buildStore(ctx context.Context, cfg config.Config) store.Store {
	if cfg.DBURL == "" {
		log.Printf("[gateway] WARNING: DB_URL empty; using in-memory fake store (no persistence)")
		return store.NewFake()
	}
	pg, err := store.NewPG(ctx, cfg.DBURL, cfg.PGMQQueue)
	if err != nil {
		log.Fatalf("[gateway] db connect: %v", err)
	}
	return pg
}
