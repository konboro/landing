# Penny IoT Gateway (Go)

TCP gateway for the Penny e-scooter fleet's **Teltonika FMB930** devices (2G):
Codec 8 Extended (`0x8E`) telemetry in, Codec 12 (`0x0C`) commands out, plus a
device simulator for CI and a pgmq-driven command consumer.

It is device-agnostic at the core: everything FMB930-specific lives behind the
`DeviceAdapter` interface (`internal/adapter/`). Adding an LTE-M model is a new
adapter file, no business-logic changes (CLAUDE rule 5).

Source of truth: `docs/03-iot-gateway.md` and `docs/01-architecture.md`.

## Running

```bash
# Gateway. With DB_URL unset it uses an in-memory fake store and logs a warning,
# so it runs (and the simulator works) with no Postgres.
go run ./cmd/gateway

# Fake FMB930: handshake + Codec 8E telemetry stream + answers setdigout.
go run ./cmd/simdevice -addr localhost:5027 -imei 350612070000001 -interval 2s

# Tests (protocol round-trips, alert rules, command delivery, full e2e loop).
go test ./...
go test -race ./...
go vet ./...
go build ./...
```

Point the simulator at a running gateway. Note: the in-memory store starts
empty, so `DeviceByIMEI` will reject an unknown IMEI (handshake `0x00`). For a
DB-less end-to-end demo the device must be pre-seeded — the wired-together path
with seeding is exercised by `internal/server/integration_test.go`
(`TestFullUnlockLoop`), which is the canonical "does the whole loop work" test.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `5027` | Device TCP listener |
| `METRICS_PORT` | `9100` | Prometheus text endpoint (`/metrics`) |
| `DB_URL` | *(empty)* | Postgres URL; empty ⇒ in-memory fake store |
| `PGMQ_QUEUE` | `commands` | pgmq queue read for outbound commands |
| `CMD_TIMEOUT_MS` | `8000` | ACK wait per send attempt |
| `CMD_SMS_ESCALATE_MS` | `5000` | Reconnect wait before SMS fallback |
| `SESSION_IDLE_CLOSE_S` | `300` | Idle session close / read deadline |

Unlock hard-expiry is fixed at **20 s** (docs/03) and is not env-tunable.

## Architecture (packages)

```
cmd/gateway      wiring: config, store, TCP server, command consumer, metrics
cmd/simdevice    fake FMB930 CLI
internal/protocol  crc16/ibm, codec 8E parse+encode, codec 12 build+parse, framing
internal/adapter   DeviceAdapter interface + fmb930 impl (DOUT semantics live here)
internal/session   IMEI→Session registry, per-device serial exec, ACK signalling, idle reaper
internal/server    TCP handshake, frame read loop, ACK, dispatch to ingest/session
internal/ingest    telemetry → batch insert + vehicle_state upsert + derived alerts
internal/commands  pgmq consumer → Codec 12 delivery, retry, SMS fallback, unlock expiry
internal/store     Store interface + FakeStore (in-memory) + PGStore (pgx/pgmq)
internal/metrics   hand-rolled Prometheus text (no external prom lib)
internal/simdevice reusable simulator (also used by the integration test)
```

### Key invariants enforced

- **CRC16/IBM** over codec-id..trailing-count; bad CRC ⇒ drop, `parse_errors++`,
  no ACK.
- **Per-device serial execution**: one in-flight command per IMEI
  (`session.Lock`).
- **ACK = Codec 12 response OR next AVL record showing the expected DOUT state.**
- **Unlock expiry (20 s) is gated before every send** — an expired unlock is
  never delivered over GPRS *or* SMS. Unlock is never SMS-delivered at all
  (a scooter unlocking late on a shelf is unacceptable); GPRS-only.
- **Idempotent by command id** — re-delivery of a handled id is a no-op.
- **DOUT semantics are data, not code**: only the `DoutProfile` in
  `internal/adapter/fmb930.go` decides DOUT1=lock / DOUT2=siren, polarity, and
  `setdigout` syntax. Nothing else hardcodes it.
- **Clock skew > 48 h rejected** on ingest (CLAUDE rule 9).

## Metrics (`/metrics`)

`gateway_unlock_success_rate`, `gateway_cmd_latency_ms`,
`gateway_sessions_active`, `gateway_parse_errors_total`, plus
`gateway_cmd_sent_total` / `_acked_total` / `gateway_sms_fallback_total`.

## Open items — `TODO(verify wiki)` (resolve on bench before mass rollout)

All are in `internal/adapter/fmb930.go` unless noted. These are **Teltonika
FMB930 firmware specifics** that must be confirmed against the wiki / a bench
device; the code uses sensible assumptions gated behind named constants and the
`DoutProfile` so a fix is one edit.

1. **AVL IO id — DOUT1 (lock relay):** assumed `179`. Confirm.
2. **AVL IO id — DOUT2 (siren):** assumed `180`. Confirm.
3. **AVL IO ids — accelerometer axes X/Y/Z:** assumed `17/18/19` (drives fall
   detection). Confirm.
4. **AVL IO id — sleep mode state:** assumed `200`. Confirm.
5. **AVL IO id — total (virtual) odometer:** assumed `16`, meters. Confirm.
6. **Relay polarity (`DoutProfile.LockedWhenDoutHigh`):** assumed *false*
   (energising DOUT1 = unlock, de-energised = locked). Confirm which physical
   level locks vs unlocks — this decides the unlock digit in `setdigout`.
7. **Timed `setdigout` syntax for `ring`/`alarm_on`:** assumed
   `setdigout <digits> <timeout1> <timeout2>` on FMB9xx. Confirm exact form and
   units (the pulse/duration encoding for the siren).
8. **Server-profile param ids (docs/03):** server domain/port params `2004/2005`
   for the `penny` FOTA profile — verify ids for the FMB930 firmware before mass
   rollout (used by `setparam`, not hardcoded in the gateway).

The confident ids (ignition `239`, movement `240`, ext voltage `66`, battery
voltage `67`, GSM signal `21`) are stable across FMBxxx firmware but should still
get a quick bench sanity check.

## Notes / deliberate scope

- **SoC** (`vehicle_state.soc_pct`) is left to the edge layer's per-model
  `battery_curves` (CLAUDE §Battery); the gateway does not guess a SoC from
  voltage. It is written as `0` here.
- **SMS provider** is a logging stub (`commands.LogSMS`); wire a real provider by
  implementing `commands.SMSSender`.
- **Command consumption is globally serial** today (drain loop processes one
  command at a time), which satisfies "one in-flight per IMEI" strictly. Per-IMEI
  worker fan-out is a future throughput optimization.
- **PGStore** column names (e.g. `pos_lng`/`pos_lat`) are a plain mapping of
  docs/02; reconcile with the actual migration (PostGIS `geometry(Point,4326)`)
  when the schema lands.
