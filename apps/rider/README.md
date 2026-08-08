# Penny Rider app

Native iOS + Android rider app for **Penny.rent** (free-floating e-scooter sharing, Athens).
Expo SDK 54 (dev client) · React Native · TypeScript strict · expo-router · `@rnmapbox/maps` (with a graceful fallback).

## Run it (mock mode — no backend needed)

From the repo root (after the central `pnpm install`):

```bash
pnpm --filter @penny/rider start
# or, inside apps/rider:
npx expo start
```

Then press **i** (iOS simulator), **a** (Android emulator), or scan the QR with **Expo Go**.

The app boots straight into onboarding and is **fully clickable end-to-end on mock data** —
no Supabase / Stripe / Sumsub / Mapbox required. In the OTP step the mock code is **`000000`**
(shown on screen). KYC auto-approves a few seconds after you tap "Start verification".

### The core ride flow to demo

`Map → tap a pin → Scan / Unlock → pre-unlock sheet → unlock progress (the "waking… up to 20s"
sequence) → active ride (timer + live cost, pause, ring, share, safety) → slide to end → forced
parking photo → zone check → rating → receipt.`

Every screen from `docs/06` is implemented: Map, Scan/unlock, Active ride, End ride, Wallet,
History, Profile, Onboarding, Support, Reaction test, plus inbox, parking school and the crash
check-in prompt (tap the shield icon during a ride to trigger it).

## Map behaviour

`<FleetMap>` renders the **native Mapbox map** only when `EXPO_PUBLIC_MAPBOX_TOKEN` (a `pk.*`
token) is set **and** the native module loads. Otherwise it renders a **styled, fully interactive
fallback** (real Athens fleet + zones projected onto a canvas, tappable pins). This is why it runs
in Expo Go without a native build. All native modules (Mapbox, camera, Stripe, haptics, location,
notifications) are guarded — missing natives never crash mock mode.

## Environment

Copy `.env.example` → `.env.local`. Key vars:

| Var | Default | Meaning |
|---|---|---|
| `EXPO_PUBLIC_DATA_SOURCE` | `mock` | `mock` (offline) or `supabase` (live) |
| `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | — | required for live mode |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | — | unset → fallback map; `pk.*` → native map |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | — | PaymentSheet (native build) |

## Live mode (ready for cutover)

Set `EXPO_PUBLIC_DATA_SOURCE=supabase` + the Supabase vars. The app then uses `SupabaseRiderApi`
(`src/services/supabase/`), which is wired to `@penny/api-client`: reads via RLS repos, and
money/unlock/zone mutations via edge functions (unlock requires an ACK before billing —
Hard Rule #1). Methods without a backend surface yet throw a visible `not_implemented` refusal
rather than failing silently. Card entry / Sumsub KYC are marked as SDK placeholders.

## Architecture

```
src/
  app/                     expo-router routes (auto-detected from src/app)
    _layout.tsx            root stack + providers + session/trip hydration
    index.tsx              splash → onboarding | map gate
    (tabs)/                map · wallet · history · profile · support
    onboarding/            value slides → phone → otp → name → consents → kyc → card → tutorial
    scan · unlock · vehicle/[code] · ride/(active,end) · reaction-test
    trip/[id] · report/[code] · inbox · parking-school
  components/
    ui/                    design system (Button, Card, Sheet, Badge, ListRow, SlideToConfirm, …)
    map/                   FleetMap abstraction (Mapbox impl + fallback + supercluster)
    camera/                guarded QR scanner + forced parking-photo camera
    CrashCheckin, MiniRoute, onboarding/StepDots
  services/                RiderApi interface + MockRiderApi (default) + SupabaseRiderApi
  store/                   zustand: session, trip (live ticker), flags (tooltips/night gate)
  i18n/                    PL / EN / EL tables + device-language detection
  lib/                     theme (built on @penny/ui tokens), native guards, ids, hooks
```

Shared packages reused: `@penny/ui` (tokens + formatters), `@penny/geo` (zone checks / distance),
`@penny/db-types` (types), `@penny/api-client` (live client).

## Things to double-check before the central install

- **Versions**: `package.json` pins plausible SDK 54 ranges. After install, run
  `npx expo install --fix` inside `apps/rider` to align every Expo/RN package to the exact SDK-54
  versions (especially `react`, `react-native`, `expo-router`, `react-native-reanimated`,
  `react-native-svg`, `@rnmapbox/maps`).
- **Reanimated / gesture-handler**: `babel.config.js` includes the reanimated plugin (must stay
  last) and `_layout.tsx` imports `react-native-gesture-handler` first — both required.
- **Metro monorepo**: `metro.config.js` watches the workspace root, resolves both node_modules
  trees, and shims the shared packages' `.js`-in-source imports to their `.ts` sources.
- **Assets**: `assets/*.png` are solid-color placeholders — swap for real brand art before a store
  build.
- **@rnmapbox/maps download token**: `app.config.ts` uses a placeholder; set `MAPBOX_DOWNLOAD_TOKEN`
  before any native prebuild.
```
