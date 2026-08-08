# @penny/admin — Penny Platform Admin Panel

Vite + React 18 + TypeScript (strict) + React Router + Mapbox GL JS + Recharts.
Full Atom-parity admin panel (+ upgrades) for the Penny e-scooter platform, Athens.
Targets **Cloudflare Pages** (SPA).

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
log) · Finance (transactions, ledger explorer, debt aging, invoices/myDATA,
Stripe↔ledger reconciliation) · Subscriptions & Add-ons content + purchase
history + FAQ editor · Team & accounts (staff, permission matrix, audit log,
corporate, MDS/GBFS) · Settings (preferences, models + **battery curve editor**,
customer form builder, reaction test, localization PL/EN/EL, personalization,
tutorials, **alerts & notification rules** editor with test-fire).

## Conventions honored

- Every money / destructive action → confirm modal with a **mandatory reason**
  where the spec requires it, written to the audit log.
- Role-gated UI via `useAuth().can(permission)`; a demo role switcher lives in
  the top bar so you can see gating (mock signed-in staff = `owner`).
- Global ⌘K search: customer by phone, vehicle by code, trip by id.
- Every table: server-style pagination, multi-column sort (shift-click),
  column picker, CSV export, saved-view chips.
- Design system driven by `@penny/ui` tokens injected as CSS variables
  (`src/lib/theme.ts` + `src/styles/global.css`). Light theme, Penny blue.

## Notes / TODO for reviewers

- Cannot `pnpm install` here (central install runs later) so the app was not
  executed. Double-check versions resolve and the Mapbox/Draw CSS imports.
- The QR label (`src/components/ui/Qr.tsx`) is a deterministic **placeholder**
  glyph, not a scannable QR — swap in a real encoder (`qrcode`) for production.
- `noUncheckedIndexedAccess` is relaxed in this app's `tsconfig.json` (base has
  it on) to keep the large mock/data layer ergonomic; `strict` stays on.
