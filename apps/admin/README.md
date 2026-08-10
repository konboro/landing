# @penny/admin — Penny Platform Admin Panel

Vite + React 18 + TypeScript (strict) + React Router + Mapbox GL JS + Recharts.
Full Atom-parity admin panel (+ upgrades) for the Penny e-scooter platform, Athens.

## Deployment — Vercel

Live: **https://penny-admin-one.vercel.app** (project `penny-admin`, scope
`konrads-projects-7e53c7e8`).

```bash
pnpm --filter @penny/admin deploy      # build + push to production
```

The build is done **locally and uploaded**, not built on Vercel. That is on
purpose: Vite inlines `VITE_*` at build time, so a remote build would need the
whole pnpm workspace (the app consumes `@penny/*` as TS source via aliases) plus
a second copy of every secret in the Vercel project. Building here means the
artefact is exactly what was tested locally.

Consequence: **`.env.local` is the deployment config.** Change a `VITE_*` value
→ redeploy, or production keeps the old one. If you later connect the Git repo
for CI builds, every `VITE_*` has to be added to the Vercel project's
environment variables first.

`public/vercel.json` (copied into `dist/` by Vite, alongside the Cloudflare
`_redirects`) carries the SPA rewrite, immutable caching for `/assets/*` and the
security headers. The Cloudflare Pages target still works — both config files
ship, each host ignores the other's.

## Run

```bash
# from the monorepo root (central install happens once for the whole workspace)
pnpm install

# dev server (defaults to the mock data source — no backend needed)
pnpm --filter @penny/admin dev
# or
cd apps/admin && npm run dev

# type-check + production build
npm run build      # tsc --noEmit && vite build  → dist/
npm run preview
```

The panel **runs standalone** with zero backend: `VITE_DATA_SOURCE` defaults to
`mock`, which serves a deterministically-generated Athens fleet (~24 vehicles,
~200 rides, ~60 customers, payments, debts, zones, alerts, ops tasks, damage
reports, staff, KPIs, ledger, notifications…) with simulated latency,
pagination, sort and filter.

## Environment

Copy `.env.example` → `.env.local`. All client vars are `VITE_`-prefixed.

| Var | Purpose | Default |
|---|---|---|
| `VITE_DATA_SOURCE` | `mock` (standalone) or `supabase` (production) | `mock` |
| `VITE_MAPBOX_TOKEN` | Mapbox GL token. **Optional** — without it, every map renders a graceful "map unavailable" fallback (with a schematic scatter) and the rest of the panel still works. | — |
| `VITE_BRAND` | Pins the deployment to a built-in white-label brand (`penny`, `aegean`, `volta`). Empty ⇒ the brand stored in `app_config.brand` wins, falling back to `pennyBrand`. | — |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_EDGE_BASE_URL` | Only used when `VITE_DATA_SOURCE=supabase` | — |

Nothing crashes if env is missing — the app boots on the mock source with a
placeholder-free map fallback.

## Data layer

`src/data/api.ts` defines the `DataSource` interface and a factory selected by
`VITE_DATA_SOURCE`:

- **`MockDataSource`** (`src/data/mockSource.ts`) — reads `src/data/mock/db.ts`
  (a seeded in-memory database) through the shared query engine
  (`src/data/query.ts`: pagination + multi-sort + search + filters). Money and
  destructive actions mutate the in-memory store and append to an in-memory
  **audit log** visible in **Team → Activity log**.
- **`SupabaseDataSource`** (`src/data/supabaseSource.ts`) — wires
  `@penny/api-client` (repos + edge functions). Mutations already call the real
  edge fns (`admin-charge`, `admin-refund`, `vehicle-command`, `zones-save`…).
  Reads that need admin-only `v_*` views are marked `TODO` for integration day;
  they throw a clear message so it's obvious what to wire.

## Shared packages reused

`@penny/ui` (design tokens + formatters — components are built in-house here, as
required), `@penny/db-types` (types + enums), `@penny/api-client` (Supabase +
edge), `@penny/geo` (the point-check simulator in the Zone editor uses
`evaluateZones`).

## Pages (all implemented)

Dashboard · Ride verification (keyboard A/R + AI pre-screen + SLA) · Rides +
Ride detail (route playback, telemetry, timeline, refund/adjust/dispute) ·
Vehicles + Vehicle detail (command console, telemetry, IoT log, device swap
wizard, QR label print) · Customers + Customer detail (KYC, ledger, debts,
penalties, disputes, referrals; **manual charge with mandatory reason+evidence**,
refund, credit, block, re-KYC, GDPR, impersonate) · Analytics (heatmaps, demand
vs supply → create rebalance tasks, revenue, cohorts, ops utilization, funnel,
report builder) · Zones (mapbox-gl-draw editor + GeoJSON + versioning + point
check) · Pricing (plans, dynamic preview, packages, subs, add-ons, penalties) ·
Marketing (promos, groups rule builder, campaigns with device preview, loyalty,
POIs, referrals) · Fleet maintenance (tasks, damage→penalty, Manage IoT +
provisioning wizard, IoT log with **Codec 8E hex frame viewer**, scan log, error
log) · **Connectivity** (SIM inventory, data-plan usage bars, cost MTD, alerts
strip, provider sync, SIM detail drawer with 30-day usage chart and audited
lifecycle actions) · Finance (transactions, ledger explorer, debt aging, invoices/myDATA,
Stripe↔ledger reconciliation) · Subscriptions & Add-ons content + purchase
history + FAQ editor · Team & accounts (staff, permission matrix, audit log,
corporate, MDS/GBFS) · Settings (preferences, models + **battery curve editor**,
customer form builder, reaction test, localization PL/EN/EL, personalization,
tutorials, **alerts & notification rules** editor with test-fire, **Branding**
white-label editor).

## Connectivity (SIM management)

`Fleet → Connectivity` manages the SIM behind every IoT device. Provider is
Truphone / 1GLOBAL behind a swappable adapter; the panel reads the `v_sim_*`
views and mutates through the `sim-sync` / `sim-command` / `admin-sim-detail`
edge functions. In mock mode the whole fleet is generated locally (one SIM per
device + spares, 30 days of daily usage, deliberate over-limit / silent /
unassigned / terminated-but-fitted outliers so the alerts strip is never empty).

Why it matters operationally: per docs/03 the **MSISDN is the SMS-fallback
address** the gateway uses when a device has no GPRS session, so a suspended or
silent SIM means commands cannot reach that scooter — not just a billing issue.
Outbound SMS volume feeds the SMS-budget alarm surfaced as a KPI tile.

ICCID / IMSI / MSISDN / IMEI are always rendered monospace and **exactly as
stored** (Hard Rule #10). Suspend and Terminate require a reason and write to
the audit log.

## White-label branding

`@penny/ui`'s `brand.ts` is the single source of truth. `src/context/BrandContext.tsx`
resolves the active brand — `VITE_BRAND` → `app_config.brand` (via
`DataSource.getBrandConfig()`) → `pennyBrand` — and `src/lib/theme.ts` pushes it
into `<html>` as the CSS custom properties the whole panel already used
(`--color-*`, `--space-*`, `--radius-*`, `--fs-*`, `--font-*`), so re-theming is
live and needs no component changes. Vehicle status colours come from
`statusColor(brand, …)`, never a hardcoded hex.

`Settings → Branding` is the editor: colour pickers (with a `readableOn`
suggestion for `onPrimary`), typography/shape sliders, support + legal fields,
feature-flag toggles, a live preview that re-renders on every keystroke,
inline `validateBrand()` contrast warnings, a light/dark preview toggle,
JSON import/export in the exact shape `brandFromConfig()` accepts, "Reset to
Penny", and an audited Save. The top bar carries a brand switcher (Penny +
two demo operators) and a light/dark toggle for instant demos.

## Conventions honored

- Every money / destructive action → confirm modal with a **mandatory reason**
  where the spec requires it, written to the audit log.
- Role-gated UI via `useAuth().can(permission)`; a demo role switcher lives in
  the top bar so you can see gating (mock signed-in staff = `owner`).
- Global ⌘K search: customer by phone, vehicle by code, trip by id.
- Every table: server-style pagination, multi-column sort (shift-click),
  column picker, CSV export, saved-view chips.
- Design system driven by the **active brand** injected as CSS variables
  (`src/lib/theme.ts` + `src/styles/global.css`). No component hardcodes a hex;
  light and dark both come from the brand.

## Notes / TODO for reviewers

- Cannot `pnpm install` here (central install runs later) so the app was not
  executed. Double-check versions resolve and the Mapbox/Draw CSS imports.
- The QR label (`src/components/ui/Qr.tsx`) is a deterministic **placeholder**
  glyph, not a scannable QR — swap in a real encoder (`qrcode`) for production.
- `noUncheckedIndexedAccess` is relaxed in this app's `tsconfig.json` (base has
  it on) to keep the large mock/data layer ergonomic; `strict` stays on.
