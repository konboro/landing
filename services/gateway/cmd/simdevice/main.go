// Command simdevice is a fake Teltonika FMB930 for local testing and CI. It
// connects to a running gateway, completes the IMEI handshake, streams Codec 8E
// telemetry, and answers setdigout commands.
//
// Usage:
//
//	go run ./cmd/simdevice -addr localhost:5027 -imei 350612070000001
package main

import (
	"context"
	"flag"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/penny/gateway/internal/simdevice"
)

func main() {
	addr := flag.String("addr", "localhost:5027", "gateway TCP address")
	imei := flag.String("imei", "350612070000001", "device IMEI")
	interval := flag.Duration("interval", 2*time.Second, "telemetry interval")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	sim, err := simdevice.Dial(*addr, *imei)
	if err != nil {
		log.Fatalf("[simdevice] dial: %v", err)
	}
	sim.Interval = *interval
	defer sim.Close()

	log.Printf("[simdevice] connecting imei=%s -> %s", *imei, *addr)
	if err := sim.Run(ctx); err != nil {
		log.Fatalf("[simdevice] run: %v", err)
	}
	log.Printf("[simdevice] done")
}
