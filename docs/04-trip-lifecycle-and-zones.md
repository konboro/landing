# 04 — Trip lifecycle, pricing, zones

## State machine (authoritative; every transition → trip_events)

```
reserved --user cancels/timeout--> aborted
reserved --scan/start----------.
(none) --scan/start------------+--> unlocking --ACK--> active --end req--> ending --validated--> ended --payment ok--> charged
                                \--no ACK/timeout--> aborted (no charge)                    \--payment fail--> ended + debt
active <--> paused (lock engaged, reduced tariff)
ended --dispute--> disputed --resolution--> charged/refunded
```

## Start preconditions (edge fn `trips-start`)

kyc approved • no open debt • no other active trip • payment method valid OR wallet/package covers estimate • vehicle `available` & online (last_seen < 3 min) & soc >= min_start (config, default 15%) • user inside `operating` zone or within 150 m of vehicle • if night hours (config 23:00–05:00) and `reaction_test_required` flag → passed test within last 30 min • age/licence check for models requiring it • corporate rides: member limit not exceeded.

## Reservation

Free minutes (config, default 10, then per-min reserve fee), max 15 min → auto-release via pg_cron. Vehicle shows `reserved` on map only for the reserving user.

## During trip

- Telemetry drives `trip_routes` (append points server-side from telemetry, not from phone — phone GPS only as fallback when device offline).
- Zone engine evaluates each position (PostGIS `ST_Contains`, zones cached in gateway memory, refreshed on `zone_versions` change):
  - `no_go`: push + loud in-app alarm + flag; if persists > 60 s → auto `lock at next stop` policy DISABLED by default (safety) — instead penalty flag + ops alert.
  - `speed_limit`: informational banner + beep (FMB930 cannot enforce).
  - leaving `operating`: warning; trip cannot END outside.
- Pause: user locks temporarily; `setdigout` lock, tariff switches to pause rate; resume re-unlocks.
- Lost connectivity: trip continues; billing continues; end allowed via phone-GPS + photo with `pending manual review` if device unreachable (grace policy, config).

## End flow (edge fn `trips-end`) — the money moment

1. Position fix (device pos preferred, phone fallback + flag).
2. Zone validation: must be inside `operating`, not in `no_parking`, and if station-mode is on: inside `parking_station`. `paid_parking` → add fee from zone rules. `bonus` → subtract bonus.

   Station mode is currently a **single global flag** — `app_config.station_mode`, read by `trips-end` — not a per-city setting; `cities` has no such column. Per-city station mode is roadmap (docs/11), so "if city is in station-mode" describes the intended end state, not today's behaviour. Clients must not branch on a per-city flag that does not exist.
3. **Mandatory parking photo** → upload → `photo_review='pending'`.
4. Send `lock` command → require ACK (retry/SMS). No ACK → keep `ending`, tell user "hold on", ops alert after 60 s (manual resolution; user not billed for the stuck time).
5. Compute price from `pricing_snapshot`: unlock + minutes*rate + pause + paid_parking − bonus − promo/package/subscription perks; apply day cap; corporate → route to corporate account.
6. Payment (docs/05). Success → `charged`; failure → `ended` + `debts` row.
7. Loyalty points accrual; referral completion check; rider score adjustments.

## Photo review (parity: Ride verification, + AI upgrade)

- Every end-photo enters `v_ride_verification_queue`.
- **AI pre-screen (edge fn `photo-review`):** Claude vision (claude-sonnet-4-6) classifies: scooter visible? upright? on sidewalk edge/rack? blocking path? Returns confidence. `>= threshold` (config, default 0.85) → `auto_ok`, else stays for human review in panel. All AI decisions sampled 10% for human QA.
- Rejected → penalty flow (config: warning → 5 € → 10 € escalation), photo + reason pushed to user, appealable (→ disputed).

## Pricing / dynamic pricing (parity + more)

`pricing_plans.dynamic` jsonb: `{happy_hours:[{dow,from,to,multiplier}], demand:{enabled,cell_size_m,thresholds}}`. Demand multiplier computed per grid cell from live idle-vehicle density vs trailing demand; shown BEFORE unlock (transparency; cap 1.5×).

## Penalties catalogue (table `penalties`)

bad parking, no_go riding, abandoned outside operating zone (recovery fee tiers by distance), damage (from damage_reports after review). All penalties = `payments.kind='penalty'` with photo evidence + appeal path.

Row per penalty: `code` (stable key used in charges and appeals), `label`, `tiers_cents int[]` (escalation by offence count, first tier may be 0 for a warning), `requires_photo`, `appealable`, `active`. Edited in Admin → Pricing → Penalties through `admin-write`, so each change is audited individually.

Moved out of `app_config.penalties` in migration 00490. The jsonb object there could not carry the per-penalty flags this table needs, and one blob meant one audit entry for the whole catalogue. The configured amounts were imported unchanged.

The catalogue is **advisory**: nothing charges from it automatically. A penalty is raised by `admin-charge` with an explicit amount and a mandatory reason, so editing a tier changes what operators are shown, not what anyone is billed.

## Heatmaps (requested)

`v_heatmap_starts/ends`: `SELECT ST_SnapToGrid(pos, cell), date_trunc('hour', started_at), count(*)`. Admin renders as Mapbox heatmap layer with time slider (day/week/hour-of-day). Also `v_heatmap_idle` (vehicle idle time by cell) → feeds auto-generated rebalance tasks (docs/07).
