# Penny Ops — field service app (OFFLINE-FIRST)

Native iOS + Android (Expo / React Native, TypeScript strict, expo-router) ops
app for Penny.rent e-scooter operations in Athens. Built to run **standalone**
with a realistic mock backend so it can be tested tomorrow with no Supabase
project and **no network**.

> Read `docs/07-ops-app.md` for the spec. Offline architecture is
> non-negotiable and implemented here for real: SQLite mirror + mutation
> outbox + sync worker with idempotent server dedupe.

---

## Run it

From the repo root (central install happens once for the whole monorepo):

```bash
pnpm install                 # installs all workspaces
npx expo install --fix -w    # (optional) reconcile Expo SDK 54 native versions
pnpm ops:start               # = pnpm --filter @penny/ops start  (dev client)
```

Or from `apps/ops`:

```bash
pnpm start        # expo start --dev-client
pnpm start:go     # expo start (Expo Go — map falls back to the vehicle list)
```

- **Default backend is the mock** (`EXPO_PUBLIC_DATA_SOURCE=mock`). No env
  needed. Copy `.env.example` → `.env.local` to change anything.
- **No Mapbox token?** The map renders a styled fallback panel + scrollable
  vehicle list (same graceful-fallback pattern as the rider app), so it runs in
  Expo Go. Set `EXPO_PUBLIC_MAPBOX_TOKEN=pk.…` and use a dev client for the
  live map.
- **Login (mock):** any phone number, OTP `000000` (or any 6 digits).

## Offline demo (do this to see the star feature)

1. Sign in (mock). The app seeds SQLite from the mock Athens fleet on first run
   (~130 vehicles, 20 tasks of each of the 6 kinds, damage reports, zones).
2. Tap the **sync pill** at the top → opens **Sync & Dev tools**.
3. Tap **Go OFFLINE**. The pill turns orange ("Offline").
4. Go do real work — all of it succeeds with no network:
   - Complete a task (checklist + required before/after photos; a battery-swap
     task prompts for voltage before/after).
   - Change a vehicle's status (matrix-enforced; maintenance→available forces a
     photo).
   - Ring / siren a vehicle; service unlock/lock.
   - Create a damage report; deploy a vehicle in Deploy mode.
5. Back in **Dev tools** you'll see the **outbox** filling with `pending` rows,
   each with a client-generated uuid. The pill shows `N pending`.
6. Tap **Go ONLINE**. Watch the outbox **drain**: rows go `syncing → done`, the
   pill shows "N pending • syncing…" then "All synced". Server patches (e.g.
   corrected vehicle status) are written back to the mirror.
7. The mock backend randomly injects a ~8% transient network error so you can
   see **exponential backoff + retry** (rows go to `error` with a countdown,
   then re-send). Idempotency means re-sends never double-apply.

**Reset & reseed** and **Clear completed** are in Dev tools too.

## Architecture

```
src/
  app/                     expo-router routes (see tree below)
  components/              ui primitives, FleetMap (+fallback), PhotoCapture,
                          SyncPill, TaskCard, StatusLegend
  services/               OpsApi seam:
                            MockOpsApi   (default; Athens fleet, idempotent
                                          syncPush, server-wins on status)
                            SupabaseOpsApi (edge fns via @penny/api-client)
                          selected by EXPO_PUBLIC_DATA_SOURCE
  offline/                THE CORE
    db.ts                 expo-sqlite schema (vehicles, tasks, zones, damage,
                          status_log, battery_swaps, maintenance, heat, photos,
                          + outbox)
    repo.ts               reads + optimistic local writes (seed on first run)
    outbox.ts             enqueue every mutation (uuid = idempotency key),
                          queue photos for resumable upload, backoff bookkeeping
    sync.ts               foreground timer + on-connectivity-change worker,
                          exponential backoff, server dedupe, pull deltas,
                          drives the pending-count pill
    actions.ts            high-level mutations screens call (optimistic mirror
                          write → 1 outbox row → nudge sync)
    bootstrap.ts          first-run seed + start sync
  lib/                    theme (extends @penny/ui tokens), status-matrix,
                          checklists, net (NetInfo + dev override), route
                          (nearest-neighbor via @penny/geo), store (zustand),
                          env, ids, nav (maps deep link), geoloc, auth, useMirror
```

**Conflict rule:** server wins on vehicle status; task completion is never lost
(idempotent apply). **Photos everywhere:** task steps, damage reports, status
changes (required for maintenance→available and the stolen flow), battery swap,
deploy drop, and free-form notes. Offline photos queue and upload later.

## Feature map (docs/07)

1. Map — full fleet with status colors, alarms layer, rebalancing zones with
   target counts, idle-heatmap overlay, hidden (`visible=false`) vehicles greyed
   with a "hidden" badge. Layer toggles on the Map tab.
2. Task manager — list + filters (mine/unassigned/open/in-progress/auto/kind),
   claim/start/complete, per-kind checklists with required before/after photos,
   navigate deep-link, battery-swap voltage prompt, auto-generated tasks shown
   with an **Auto** tag.
3. Vehicle actions — scan QR / search code → service unlock/lock (no billing),
   locate/beep, reboot IoT, set status (matrix-enforced), live telemetry + last
   errors, service history, **swap-device wizard** (IMEI + guided
   online/GPS/unlock tests), decommission (admin).
4. Damage reports — create/confirm/resolve with photos, link to task, escalate
   to penalty → **admin review, never a direct charge**.
5. Deploy mode — batch: add by code → drop pin + photo → set available.
6. Battery/inventory — swap log with voltage before/after (in vehicle history).
7. My day — nearest-neighbor route ordering (haversine) + shift summary
   (tasks done, remaining, km).
8. Status management — every change writes `vehicle_status_log` with
   optional/required photos; visibility toggle independent of status.
9. Ring / siren — Ring (3 pulses), Siren 30s, Stop siren; all enqueue commands
   and are audit-logged on sync.
10. Ops onboarding — task-types walkthrough + offline-mode explainer (docs/12 F);
    replayable from More.

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_DATA_SOURCE` | `mock` | `mock` (standalone) or `supabase` |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | _(empty)_ | `pk.*` for the live map; empty → fallback list |
| `EXPO_PUBLIC_SUPABASE_URL` | _(empty)_ | only for `supabase` mode |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | _(empty)_ | only for `supabase` mode (anon + RLS) |

## Notes for the central install

- Native versions in `package.json` target **Expo SDK 54**; run
  `npx expo install --fix` after `pnpm install` to pin exact compatible
  versions (`react-native`, `@rnmapbox/maps`, `@react-native-community/netinfo`,
  `expo-router`, `expo-camera`, `expo-sqlite`, `expo-location`).
- `@rnmapbox/maps`, `expo-camera`, `expo-sqlite`, `expo-location` require a
  **dev client** for full native behavior. Every native import is guarded, so
  the app still boots (with fallbacks) in Expo Go.
- `metro.config.js` is monorepo-aware (watches the repo root, resolves the
  `@penny/*` workspace packages, and rewrites their `.js` source specifiers to
  `.ts`). `@` is aliased to `src`.
- The Mapbox download token in `app.config.ts` is a placeholder until
  `EXPO_PUBLIC_MAPBOX_TOKEN` is set; replace before making a store build.
- App icons in `assets/` are 1×1 placeholders — swap for real artwork before a
  production build.
```
