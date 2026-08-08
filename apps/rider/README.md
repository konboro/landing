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
- **gesture-handler**: `_layout.tsx` imports `react-native-gesture-handler` first (required). The
  app deliberately does **not** depend on `react-native-reanimated` (the slide-to-end control uses
  core `Animated`/`PanResponder`), avoiding the Reanimated 4 + worklets babel chain. If you later
  add a navigator that needs it, run `npx expo install react-native-reanimated`.
- **Metro monorepo**: `metro.config.js` watches the workspace root, resolves both node_modules
  trees, and shims the shared packages' `.js`-in-source imports to their `.ts` sources.
- **Assets**: `assets/*.png` are solid-color placeholders — swap for real brand art before a store
  build.
- **@rnmapbox/maps download token**: `app.config.ts` uses a placeholder; set `MAPBOX_DOWNLOAD_TOKEN`
  before any native prebuild.
```

---

## White-labelling — ship for a new client

The whole app is themed from a **Brand** (`packages/ui/src/brand.ts`). No screen
hardcodes a colour, product name, support address or `penny://` literal.

```
src/brand/
  build.ts          build-time identity (name, slug, scheme, bundle ids, splash colour)
                    — zero imports, because app.config.ts loads it directly
  brands.ts         the registry: pennyBrand + the demo clients (createBrand deep-merges)
  deriveTheme.ts    Brand → the theme object screens already used (color/space/radius/font/shadow)
  BrandProvider.tsx context: { brand, colors, mode, setMode, isEnabled(feature) }
  useTheme.ts       the hook every screen calls
  makeStyles.ts     themed StyleSheet factory (memoised per brand+mode)
  remoteBrand.ts    app_config.brand seam (see the SEAM note in the file)
```

**Where a brand comes from at runtime** (highest priority first):

1. `EXPO_PUBLIC_BRAND` — build-time selection for a dedicated client build
2. `app_config.brand` — server override, parsed with `brandFromConfig()`
3. `pennyBrand` — the fallback

A brand picked in the dev switcher beats all three and is persisted (together
with the light/dark choice) via the guarded `Storage` helper in `lib/native.ts`.

### Add a client

1. **`src/brand/build.ts`** — add an entry: id, name, slug, scheme, iOS bundle
   id, Android package, domain, primary/onPrimary, monogram, emoji.
2. **`src/brand/brands.ts`** — add a `createBrand({ … })` using those identity
   fields, plus the palette, `darkColors`, `typography.scale`,
   `shape.radiusScale/spaceScale`, `maps`, `support`, `legal` and any
   `features` you want switched **off**. Register it in `BRANDS`.
3. **Assets** — replace `assets/icon.png`, `assets/splash.png`,
   `assets/adaptive-icon.png`. Logos inside the app are inline
   SVG/data-URI or the monogram from `brand.assets` — never an external URL.
4. **Build** — `EXPO_PUBLIC_BRAND=<id> npx expo run:ios` (or `run:android` /
   `eas build`). `app.config.ts` derives app name, slug, scheme, bundle
   identifiers, permission copy and the splash/icon background from the brand.
5. Optionally seed the client's `app_config.brand` so support can retheme later
   without a release.

### Feature flags

`brand.features` removes whole product surfaces — cleanly, with no dead nav
entries or empty cards:

| flag | hides |
| --- | --- |
| `reservations` | Reserve button + reservation banner on the map sheet |
| `packages` / `subscriptions` | those Wallet store sections |
| `walletTopUp` | Top-up button + amount sheet |
| `referrals` | Profile referral card, Stats referral card |
| `loyalty` | Profile points badge, Stats loyalty card |
| `reactionTest` | night anti-DUI gate before unlock |
| `shareMyRide` | live-trip share button + sheet |
| `crashCheckIn` | safety shield during a ride + the fall prompt |
| `parkingSchool` | Profile entry, end-ride and trip-detail links |
| `groupRides` | group badge on the active ride |

### Demo it

Profile → **long-press the "Profile" title** → brand switcher. Pick an operator
or light/dark and the running app re-themes instantly (colours, corner radius,
type scale, map style, support links, which features exist). The sheet also runs
`validateBrand()` and shows any WCAG contrast warnings for the selected palette.

Shipped demo brands: **Meltemi** (Syros, bright orange, rounder, no night
reaction test, no subscriptions) and **Nordvei** (Oslo, deep green, near-square
corners, NOK, no wallet top-up / packages / group rides).
