# 11 — Roadmap (sequential, each phase has an exit gate)

## Phase 0 — Bench (target: 2 weeks)
Gateway skeleton: handshake, Codec 8E parse of real frames, telemetry into DB; Codec 12 `setdigout` unlock/lock from curl; capture testdata hex; confirm DOUT wiring semantics; FOTA profiles `atom`/`penny` created; simdevice for CI.
**Gate:** bench scooter unlocks < 5 s reliably over 2G; parse error rate 0 on 24 h capture.

## Phase 1 — Headless product (3–4 weeks)
Schema migrated; trip state machine + zones engine + pricing in edge fns; Stripe: setup, hold, capture, debt basics; ledger; full ride via HTTP calls (Postman collection in repo); photo upload + AI pre-screen; audit_log.
**Gate:** e2e test: reserve→unlock→ride(sim)→end→charge, incl. failure paths (no ACK, card fail), green in CI.

## Phase 2 — Rider app (4–5 weeks)
All rider screens; OTP auth; Sumsub SDK; Stripe SDK; realtime map; i18n PL/EN/EL; internal TestFlight with 5 pilot vehicles (dual-run starts).
**Gate:** 50 real staff/friendly rides, unlock_success ≥ 97%, zero billing discrepancies vs ledger audit.

## Phase 3 — Ops app + Admin core (4–5 weeks, parallel tracks)
Ops offline-first with tasks/actions/damage; Admin: dashboard, rides, vehicles, customers, zones editor, ride verification, manual charge/refund, IoT manage/log, transaction history.
**Gate:** one full operational day run WITHOUT opening Atom panel.

## Phase 4 — Commercial completeness (3–4 weeks)
Packages, subscriptions, add-ons, promo, referrals, loyalty, campaigns push/email, analytics+heatmaps, custom reports, corporate accounts, GBFS, invoices + myDATA provider integration, monitoring/SLO/alerting hardened, runbooks.
**Gate:** finance reconciliation month-close matches Stripe to the cent; myDATA test transmissions accepted.

## Phase 5 — Migration & cutover (4+ weeks, overlaps 4)
Per docs/09: users import, Sumsub mapping, card migration/campaign, fleet batches, marketing switch, Atom termination.
**Gate:** 100% fleet on Penny, Atom read-only archive exported, unlock_success ≥ 97% for 2 consecutive weeks.

## Post-launch backlog (designed, not built)
LTE-M device adapter + hardware refresh plan; BLE unlock (needs new hardware); station-mode cities; battery id tracking; route optimization for ops; ML demand forecast; helmet detection in end photo; Android Auto/watch quick-unlock.

## Working agreement
One phase at a time; no feature pulled forward past its gate. Weekly: SLO review + burn-down. All estimates assume ~1 senior dev + Claude Code + part-time help (Alicja), and shift right if Tycoon.Live beta (Sept) takes priority weeks.
