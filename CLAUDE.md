# Penny Platform — CLAUDE.md

Full in-house replacement of Atom Mobility for **Penny.rent** (free-floating e-scooter sharing, Greece).
Three clients (Rider app, Ops app, Admin panel) + backend (Supabase) + IoT Gateway (Go) for **Teltonika FMB930** (2G, Codec 8E/12).

## Repo layout (pnpm + turborepo monorepo)

```
apps/
  rider/          # Expo (dev client), React Native, @rnmapbox/maps
  ops/            # Expo, same base; OFFLINE-FIRST (SQLite + mutation queue)
  admin/          # Vite + React + Mapbox GL JS + mapbox-gl-draw → Cloudflare Pages
services/
  gateway/        # Go: TCP server, Codec 8E parser, Codec 12 command bus. Deployed on VPS (Hetzner), NOT Supabase
  edge/           # Supabase Edge Functions (payments, webhooks, GBFS/MDS, photo review)
packages/
  db-types/       # generated from Supabase
  api-client/     # typed client shared by all apps
  geo/            # zone checks, distance, snapping
  ui/             # shared design system (rider+ops)
docs/             # THE SPEC (00-12). Read the relevant doc before touching a domain. Notifications/alerts/onboarding: docs/12.
```

## Hard rules (never violate)

1. **Never charge a card without a confirmed unlock ACK.** Unlock flow: command → DOUT ACK within 8 s → then start billing. No ACK = trip aborted, zero charge, user-visible error.
2. **All money movements go through the double-entry ledger** (`ledger_entries`). Never UPDATE a balance column directly. Balances are materialized views/derived.
3. **Geofence decisions are server-side authoritative.** Client-side zone checks are UX only. Trip end validation (parking zone, photo) happens in the `end-trip` edge function.
4. **Every state transition of a trip is persisted** in `trip_events` (append-only). The `trips.status` column is a cache of the last event.
5. **Gateway is device-agnostic.** All Teltonika-specific code lives behind the `DeviceAdapter` interface in `services/gateway/adapter/`. Adding an LTE-M model must not touch business logic.
6. **`service_role` key exists only in edge functions and gateway.** Apps use anon key + RLS. Admin panel calls edge functions, never the DB directly with elevated rights.
7. **IMEI is the device identity, vehicle_id is the business identity.** They are linked in `devices.vehicle_id` and can be re-linked (device swap). Never use IMEI in business tables.
8. **All admin/ops mutations write to `audit_log`** (who, what, before/after, reason). Manual card charges REQUIRE a reason string.
9. **Timestamps: UTC in DB (`timestamptz`), device time from AVL records is validated** (reject records with clock skew > 48 h; store both `device_ts` and `server_ts`).
10. **Don't strip or reformat IMEI/api ids.** Store as text, exact.
11. **PII minimization:** GPS traces linked to a user are retention-limited (see docs/10). Never log full card numbers, Sumsub docs, or tokens.
12. **Migrations:** every schema change via `supabase/migrations`, never dashboard-only.

## Stack constants

- Expo SDK 56 / RN 0.85, dev client (JSC config as in tycoon-app), TypeScript strict.
- Mapbox via @rnmapbox/maps (mobile), mapbox-gl-js (admin). JS-side supercluster if clustering needed (Fabric constraint — same as Tycoon).
- Supabase: Postgres 15 + PostGIS + pgmq + pg_cron. Realtime for live vehicle state.
- Payments: Stripe (SetupIntent, off-session PaymentIntents, SCA). Greece: EUR, myDATA e-invoicing (Phase 4, see docs/05).
- KYC: **existing Sumsub app token** (reuse applicants via externalUserId mapping, see docs/09).
- Gateway: Go 1.22+, single static binary, systemd, Hetzner VPS with static IP. Redis optional; default queue = pgmq.

## Environments

- `dev` (Supabase project + gateway on :5027 with 1 bench scooter)
- `prod` (separate Supabase project + gateway :5027; SMS fallback enabled)
- Feature flags in `app_config` table, fetched at app boot.

## Battery / SoC

Voltage-based SoC via per-model calibration table `battery_curves(model_id, voltage_mv, soc_pct)` — linear interpolation. Confirmed working acceptably on current fleet. Show % in all apps; low-battery thresholds configurable per model.

## Workflow for Claude Code

- Read `docs/NN-*.md` for the domain you're changing. The docs are the source of truth; if code and docs diverge, flag it, don't silently pick one.
- DB changes: write migration + regenerate `packages/db-types`.
- Gateway changes: table-driven tests with real captured Codec 8E hex frames in `services/gateway/testdata/`.
- Anything touching money or unlock flow: add/extend integration tests first.
- Do not invent Teltonika parameter IDs — they are listed in docs/03; if one is missing, mark `TODO(verify wiki)`.

## Parallel sessions — TWO agents work in this repo at once

Both sessions share **one working tree on one branch**. There is no isolation,
so the rules below are the only thing preventing lost work. This is not
hypothetical: migration numbers have already collided three times (00310,
00320, 00330), and a mock data source was deleted underneath a feature that
depended on it.

**Announce your area here at the start of a session.** Overwrite the line for
your session; leave the other one alone.

- Session A — admin panel, rider app, gateway, payments/Stripe
- Session B — ops field app, notifications/broadcasts, fleet admin edge fns

**Never `git add -A` / `git commit -a`.** Stage explicit paths you touched.
The other agent almost certainly has uncommitted work in the same tree, and a
blanket add commits it under your message.

**Commit early.** Uncommitted work is the only work at risk. If you finish a
coherent slice, commit it — do not batch a night's work into one final commit.

**Migrations: claim the number by creating the file immediately.** Run
`ls supabase/migrations | tail -3` first and take the next free number. Do not
reserve a block "for later" — the other session will fill it while you work.

**Shared code is additive-only without a heads-up**: `packages/**`,
`services/edge/_shared/**`, `supabase/migrations/**`, root `package.json`.
Changing a shared signature breaks the other session's in-flight files, and
they will see it as a mysterious type error in code they never touched. If you
must change one, say so in your final report so it reaches the human.

**Typechecking during parallel work**: `npx tsc --noEmit` will show errors from
the other session's half-written files. Do not "fix" them — you will fight an
editor that is still typing. Verify only the files you own.
