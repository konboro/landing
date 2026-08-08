# 07 — Ops app (serwisanci) — OFFLINE-FIRST

Same Expo base as rider, separate app config/bundle id, staff login (OTP + staff role check).

## Offline architecture (non-negotiable)

- Local SQLite (expo-sqlite) mirror of: assigned tasks, vehicles in scope, zones, checklists.
- Mutation queue: every action = row in local `outbox` (uuid id, kind, payload, created_at) → sync worker flushes when online, server dedupes by id. Photos queued to storage with resumable upload.
- Conflict rule: server wins on vehicle status; task completion never lost (idempotent apply).

## Features

1. **Map:** full fleet (not just available): status colors (offline, low-batt, maintenance, stolen-suspect, in-trip), alarms layer, rebalancing zones with target counts, idle-heatmap overlay.
2. **Task manager (parity + auto-generation):** list/map of `ops_tasks`, filters, claim/assign, navigate (deep link Google Maps), per-kind checklists with required photos (before/after), complete → auto status updates (e.g., battery_swap → prompts voltage before/after).
   Auto-rules (pg_cron): low_batt < threshold → battery_swap task; offline > 24 h → inspect; idle > 72 h in low-demand cell → rebalance to top-demand cell; fall alarm → inspect priority high; damage_report confirmed → repair.
3. **Vehicle actions:** scan QR / search code → unlock/lock (service mode — no billing), locate/beep, reboot IoT, set status (maintenance/transport/available), view live telemetry + last errors, service history (`maintenance_log`), swap device (re-link IMEI with guided test), decommission.
4. **Damage reports:** create/confirm/resolve with photos; link to task; escalate to penalty (sends to admin review, not direct charge).
5. **Deploy mode:** batch-place vehicles: scan → drop-pin confirm → available (used for morning deployment vans).
6. **Battery/inventory:** swap log; optional battery id scan (future).
7. **My day:** task route optimization (simple nearest-neighbor ordering, upgrade later), shift summary (tasks done, km).

Everything writes `audit_log` via edge functions on sync.

## Status management (explicit, requested)

`vehicle_status_log(id, vehicle_id, from_status, to_status, by, role, reason, photos text[], pos, at)` — every change logged with optional photos.

Allowed transitions (ops role): available ↔ maintenance • available ↔ transport • maintenance → available (requires checklist done + photo) • any → offline-investigate • stolen-suspect flow: flag → admin confirms `stolen` → auto: alarm rule armed, visible=false, police-report note field. Admin role: all transitions incl. decommissioned. Rider app never sees maintenance/transport/stolen vehicles.

**Visibility toggle (requested):** `vehicles.visible bool` independent of status — hide from rider map without touching status (e.g., staged for event, VIP hold). Visible=false vehicles show grey in ops/admin maps with "hidden" badge.

## Photos everywhere (requested)

Attach photos (camera or queued offline) to: task completion (required per checklist kind), damage reports, status changes (required for maintenance→available and stolen flow), battery swap (optional), deploy mode drop confirmation, free-form vehicle note. All stored in Storage bucket `ops-photos/{vehicle_id}/`, linked via `photos text[]`, visible in admin vehicle timeline.

## Ring / siren from ops app

Buttons on vehicle sheet: **Ring** (3 pulses, find in a courtyard), **Siren 30 s** (scare-off/locate in traffic), **Stop siren**. All → commands table, audit-logged.
