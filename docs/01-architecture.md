# 01 — Architecture

## System map

```
 [FMB930 fleet] --TCP 2G (Codec 8E)--> [Gateway (Go, VPS)] --SQL/pgmq--> [Supabase Postgres+PostGIS]
        ^                                   |  ^                              |        ^
        |--SMS fallback (Codec-like cmds)---|  |--Codec 12 commands-----------|        |
                                               |                                       |
 [Rider app] --anon+RLS / edge fns------------------------------------------> [Edge Functions]
 [Ops app]   --anon+RLS (offline queue) ------------------------------------>   - trips (start/end/pause)
 [Admin]     --edge fns only (admin JWT) ----------------------------------->   - payments (Stripe)
                                                                                - webhooks (Stripe, Sumsub)
 [Stripe] --webhooks--> edge/webhooks                                           - gbfs / mds (public feeds)
 [Sumsub] --webhooks--> edge/webhooks                                           - photo-review (AI assist)
```

## Services & responsibilities

| Component | Owns | Never does |
|---|---|---|
| Gateway (Go) | TCP sessions, Codec 8E parse, telemetry ingest, Codec 12 command delivery, SMS fallback, session registry (IMEI→conn) | pricing, zones, payments |
| Edge functions | trip lifecycle, pricing, zone validation, Stripe, Sumsub, feeds, admin actions | long-lived connections |
| Postgres | state of truth, pgmq queues, pg_cron jobs (debt retry, retention, reservation expiry) | — |
| Apps | UX, optimistic UI, offline queue (ops) | authoritative decisions |

## Data flow: telemetry

1. Device opens TCP → sends IMEI handshake → gateway ACKs.
2. AVL packets (Codec 8E) parsed → batch INSERT into `telemetry` (partitioned) + UPSERT `vehicle_state` (hot row per vehicle: pos, soc, ignition, speed, last_seen, movement, alarm flags).
3. Gateway publishes Realtime-friendly changes only via `vehicle_state` (apps subscribe to this table only).
4. Derived events (crash/fall via accelerometer axes, geofence exit while not in trip, power-cut) → `vehicle_alerts` + push to admin/ops.

## Data flow: unlock

1. Rider scans QR → `POST /trips/start` (edge fn): checks KYC, debt=0, vehicle available, inside operating zone, payment method valid → creates `trips(status=unlocking)` + enqueues command `{vehicle_id, cmd: unlock}` in pgmq.
2. Gateway consumes queue → finds live session for device → sends Codec 12 `setdigout` → waits for reply / DOUT state change in next AVL record.
3. ACK → gateway marks command done → edge fn transitions trip to `active`, starts billing clock, sends push.
4. No ACK in 8 s → retry once → escalate SMS → if still nothing by 20 s: trip `aborted`, no charge, vehicle flagged for ops if repeated.

## Realtime channels

- `vehicle_state` (filtered by bbox on client) — rider map, ops map, admin live map.
- `trips:user_id=eq.X` — rider's active trip.
- `ops_tasks:assignee=eq.X` — ops task push.

## Deployment

- Gateway: Hetzner CX22, Docker-less (systemd unit), Caddy only for metrics endpoint; TCP :5027 exposed raw. Static IP is the value configured in devices — treat as immutable; keep a reserved floating IP.
- Edge functions: Supabase deploy via CI (GitHub Actions).
- Admin: Cloudflare Pages. Rider/Ops: EAS build, internal distribution for ops app (no store review needed).
- Backups: Supabase PITR + nightly logical dump to R2. Gateway is stateless (session registry in memory; commands persisted in pgmq).

## Observability (docs/10 has SLOs)

- Gateway: Prometheus metrics (`unlock_success_rate`, `cmd_latency`, `sessions_active`, `parse_errors`).
- Uptime Kuma or Better Stack for probes; alerts to Telegram.
- `iot_data_log` view (parity with Atom) = filtered read on `telemetry` + `commands`.
