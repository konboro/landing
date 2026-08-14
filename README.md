# Penny Platform

In-house replacement for Atom Mobility, powering **Penny.rent** — free-floating
e-scooter sharing in Greece. Native **Rider** and **Ops** apps (iOS + Android),
a web **Admin** panel, a Supabase **backend**, and a Go **IoT gateway** for
Teltonika FMB930 devices (2G, Codec 8E/12).

> The specification is the source of truth. Read `CLAUDE.md` and `docs/00`–`docs/13`
> before changing a domain. If code and docs diverge, flag it — don't silently pick one.

## Monorepo layout

```
apps/
  rider/     Expo (RN) rider app        — @penny/rider
  ops/       Expo (RN) ops app          — @penny/ops   (offline-first)
  admin/     Vite + React admin panel   — @penny/admin
services/
  gateway/   Go TCP gateway (Teltonika) — not on Supabase; runs on a VPS
  edge/      Supabase Edge Functions    — trips, payments, webhooks, feeds
packages/
  db-types/  shared TS domain model + enums (matches SQL)
  api-client/ typed Supabase client + edge wrappers + repos
  geo/       zone checks, distance, snapping (tested)
  ui/        design tokens, white-label brand system, formatters (tested)
  emails/    transactional email templates (Resend), PL/EN/EL
supabase/
  migrations/ full Postgres + PostGIS schema, RLS, views, seed
docs/        THE SPEC (00–13)
```

Tooling: **pnpm** workspaces + **turborepo**. Node ≥ 22 (unit tests use native
TS type-stripping), Go ≥ 1.22.

## Running each piece (standalone, for testing)

Every app ships with a **mock data layer** so it runs before the backend is wired.
Tomorrow's integration flips each app's data source from `mock` to `supabase`.

### 1. Install (once, from repo root)
```bash
pnpm install
```

### 2. Admin panel (browser — quickest to demo)
```bash
pnpm --filter @penny/admin dev
# open http://localhost:5173  (runs on mock data; add VITE_MAPBOX_TOKEN for live maps)
```

### 3. Rider app (Expo)
```bash
pnpm --filter @penny/rider start      # then press i (iOS) / a (Android) / scan QR
# runs on mock data in Expo Go; native maps activate with EXPO_PUBLIC_MAPBOX_TOKEN + dev client
```

### 4. Ops app (Expo, offline-first)
```bash
pnpm --filter @penny/ops start
# toggle Online/Offline in the dev menu to watch the outbox queue drain
```

### 5. Gateway (Go) — runs without Postgres (in-memory fake store)
```bash
pnpm gateway:run          # TCP :5027, metrics :9100/metrics
pnpm gateway:sim          # simulated FMB930: handshake + telemetry + setdigout ACK
pnpm gateway:test         # go test ./...
```

### 6. Backend (Supabase)
```bash
# with the Supabase CLI + Docker locally:
supabase start
supabase db reset          # applies supabase/migrations + seed
supabase functions serve   # serves services/edge/functions
```

## Data-source switch

| App   | Env var                      | Values           | Default |
|-------|------------------------------|------------------|---------|
| admin | `VITE_DATA_SOURCE`           | `mock`/`supabase`| `mock`  |
| rider | `EXPO_PUBLIC_DATA_SOURCE`    | `mock`/`supabase`| `mock`  |
| ops   | `EXPO_PUBLIC_DATA_SOURCE`    | `mock`/`supabase`| `mock`  |

Copy `.env.example` → `.env.local` per app and fill real keys for live mode.

## Hard rules (never violate — see CLAUDE.md)

1. Never charge a card without a confirmed unlock ACK.
2. All money via the double-entry ledger (`ledger_entries`). Never UPDATE a balance.
3. Geofence decisions are server-side authoritative; client checks are UX only.
4. Every trip state transition is persisted in `trip_events` (append-only).
5. Gateway is device-agnostic (Teltonika behind `DeviceAdapter`).
6. `service_role` only in edge functions + gateway. Apps use anon + RLS.
7. IMEI = device identity, `vehicle_id` = business identity.
8. All admin/ops mutations write `audit_log` (manual charges require a reason).

## Verify the workspace

```bash
pnpm typecheck     # all packages
pnpm test          # geo + ui unit tests, gateway go tests
pnpm build         # build shared packages + admin
```

## White-labelling

The platform is multi-tenant by design: name, colours, deep-link scheme, support
and legal details, and which product features exist all come from a **Brand**
(`packages/ui/src/brand.ts`). A new operator is a `createBrand({...})` override
plus an env var — no fork. Both apps and the panel carry a brand switcher for
live demos, and the admin has a Branding editor with a WCAG contrast gate.

See **`docs/16-white-label.md`**.

## Connectivity (SIM cards)

Every tracker carries an IoT SIM (Truphone / 1GLOBAL). The panel manages the SIM
estate — inventory, data usage vs bundle, cost, activate/suspend/terminate,
alerts for over-limit and silent SIMs — behind a swappable provider adapter.

See **`docs/15-connectivity-sims.md`**.

## Greek myDATA (AADE)

Every successful charge produces a retail receipt (ΑΠΥ) transmitted directly to
AADE. This replaces a standalone Flask pipeline that ran on PythonAnywhere from
2024-12-01; its 22,471-row history imports into `mydata_submissions` so
reconciliation spans the cutover. Receipt numbering is a row-locked counter, a
retry re-sends the same number, and a Stripe charge can only be filed once —
the three failures that put 578 holes in the legacy series.

New receipts start in `dry_run`: numbered and rendered, never transmitted, so
the output can be compared against the legacy system before going live.

See **`docs/18-mydata.md`**.

## Status

See `docs/11-roadmap.md` for phases. This tree implements the full product
surface across all clients + backend + gateway with mock-backed runnable apps,
ready for the live integration pass.
