# 03 — IoT Gateway (Go) — Teltonika FMB930

## Protocol: connection lifecycle (TCP, Codec 8 Extended)

1. **Handshake:** device sends `[2B length][IMEI ASCII]`. Gateway validates IMEI exists in `devices` → reply `0x01` (accept) else `0x00` + close.
2. **AVL data packet:**
   `[4B zeroes][4B data length][1B codec id=0x8E][1B record count][records...][1B record count][4B CRC16]`
   Each record: `[8B timestamp ms][1B priority][GPS: lng lat alt angle sats speed][IO: event id 2B, counts + elements 1/2/4/8B + variable]` (Codec 8E uses 2-byte IO ids).
3. **ACK:** reply `[4B record count]` (big-endian). No ACK → device resends (dedupe by device_ts+imei).
4. **CRC16/IBM** over codec-id..record-count-2. Invalid → drop packet, metric `parse_errors`, do NOT ack.

Session registry: `map[imei]*Session` with last-activity; devices on 2G will drop often — treat reconnect as normal, don't alert unless gap > threshold.

## Commands (Codec 12)

Frame: `[4B zeroes][4B size][0x0C][1B qty=1][0x05 cmd type][4B cmd size][command ASCII][1B qty=1][4B CRC16]`
Response type `0x06` with ASCII payload.

Commands used:
- `setdigout 1?` / `setdigout ?1` etc. — **exact DOUT syntax and which DOUT drives lock vs ignition: confirm on bench, wire into config `devices.model` profile, do not hardcode.**
- `getinfo`, `getstatus`, `cpureset`
- `setparam <id>:<value>` — server/APN changes (also over SMS)

**Delivery rules:**
- Command can only go over GPRS if session is live. If not live → wait `cmd_gprs_wait_ms` (default 5000) for reconnect → **SMS fallback** (same ASCII command, Teltonika SMS format `<login> <pass> <command>`; login/pass per-device from `devices` config).
- ACK sources (either counts): Codec 12 response OR next AVL record showing expected DOUT state.
- Idempotency: `commands.id` is the key; re-delivery of same id is a no-op if status >= sent. Unlock commands expire (`expired`) after 20 s — expired unlock must NEVER be delivered late (scooter unlocking on a shelf at midnight).
- Per-device serial execution (one in-flight command per IMEI).

## Adapter interface (device-agnostic core)

```go
type DeviceAdapter interface {
    ParseFrame([]byte) ([]TelemetryRecord, AckBytes, error)
    BuildCommand(kind CommandKind, args Args) (wire []byte, smsText string, err error)
    InterpretIO(io map[uint16]int64) NormalizedState  // ignition, dout1/2, voltages, movement, fall
}
```
`fmb930.go` implements it. Future LTE-M model = new file, zero business-logic changes.

## IO elements to capture (FMB930, AVL ids)

Ignition (din1), movement, DOUT1/DOUT2 state, external voltage, battery voltage, GSM signal, speed, accelerometer axes (fall detection: |axis| threshold + speed=0 + ignition off), sleep mode state, odometer (virtual). Full id list per firmware — capture raw into `telemetry.io` jsonb regardless, normalize known ids. `TODO(verify wiki)` markers for ids before bench session.

## Fall / theft detection (server-side rules on ingest)

- `fall`: axes indicate tilt > 60° sustained 10 s, no active trip → alert ops.
- `moved_while_locked`: displacement > 30 m while locked & no trip → alarm: send `lock` reinforce + alert + vehicle status `stolen?` review.
- `power_cut`: ext_voltage drops to ~0 while battery present → high-priority alert (battery theft signature).

## Device provisioning & migration (FOTA WEB)

- Keep FOTA WEB as config manager. Two named profiles: `atom` (current) and `penny` (our server).
- `penny` profile changes: server domain/port (param 2004/2005 — **verify ids for FMB930 fw on wiki before mass rollout**), protocol TCP, data acquisition: on-move 15 s / on-stop 120 s (2G-friendly), no deep sleep (online sleep only) so Codec 12 works; SMS login/pass set; secondary server optional = keep Atom as backup channel during dual-run OFF (one server at a time; switching = the migration switch).
- Rollout: bench device → 5 pilot → batches of 20; `devices.server_profile` tracks where each device points. Rollback = re-apply `atom` profile via FOTA.
- Adding new IoT (panel feature): admin enters IMEI+ICCID+SIM MSISDN → device row `status=bench` → auto-provision checklist (appears online, GPS fix, unlock/lock test) → attach to vehicle → `active`.

## SMS channel

Provider: SMS API supporting Greek network (e.g., Twilio/Vonage) OR a GSM modem gateway later. Outbound only (commands). Budget alarm on >N SMS/day (indicates GPRS problems). All SMS logged into `commands.channel='sms'`.

## Config (env)

`PORT=5027 DB_URL PGMQ_QUEUE=commands SMS_PROVIDER_KEYS CMD_TIMEOUT_MS=8000 CMD_SMS_ESCALATE_MS=5000 SESSION_IDLE_CLOSE_S=300 METRICS_PORT=9100`

**`PGMQ_QUEUE` must match the queue the database sends to.** `enqueue_vehicle_command()`
pushes onto `commands`; the gateway defaults to the same name. If they ever
diverge, commands sit at `queued` forever and nothing unlocks — the queue is
created explicitly in migration 00240 so this is verifiable:
`select queue_name from pgmq.list_queues();`

**`DB_URL` on Supabase: use the pooler, not the direct host.**
`db.<ref>.supabase.co` resolves to **IPv6 only** on current projects, so an
IPv4-only VPS cannot reach it. Use session mode (5432 — not transaction mode
6543, which breaks the prepared statements pgx relies on):

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

## Testing

- `testdata/*.hex` — captured real frames (bench phase produces these). Table-driven parse tests.
- Fake device simulator (`cmd/simdevice`) speaking Codec 8E/12 for CI e2e: connect → handshake → stream telemetry → respond to setdigout. CI runs full unlock flow against a local Postgres.

## DOUT mapping (CONFIRMED by owner)

- **DOUT1 = lock/power relay** (unlock/lock rides).
- **DOUT2 = SIREN.** Uses:
  - `ring` command: pulse pattern (e.g. 3× 300 ms) via timed `setdigout` with duration param — rider "find my scooter", ops locate, admin console. Rate-limit: max 1 ring / 10 s / vehicle, riders only within 100 m of vehicle.
  - `alarm` command: continuous siren N seconds (config, default 30 s, re-triggerable) — auto-fired on `moved_without_rental` (optional rule toggle, default ON at night 22:00–06:00), `power_cut` attempt, manual from ops/admin. Auto-stop failsafe: gateway always schedules an OFF command; if unreachable, SMS OFF.
  - Exact `setdigout` duration syntax per firmware → confirm on bench (Codec 12 supports `setdigout <d1><d2> <timeout1> <timeout2>` style on FMB9xx — verify) and encode in fmb930 adapter profile.
