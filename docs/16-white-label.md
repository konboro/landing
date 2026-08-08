# 16 — White-labelling the platform

The same codebase runs Penny.rent and any other operator. Nothing about a
client — name, colours, deep-link scheme, support address, legal entity, even
which product features exist — is hardcoded in a screen. It all comes from a
**Brand**.

Source of truth: `packages/ui/src/brand.ts` (unit-tested, framework-free, no
dependencies, so web, native, edge functions and scripts can all load it).

---

## The Brand object

```ts
interface Brand {
  id, name, scheme, domain            // identity + deep links
  defaultLang, currency, locale       // formatting
  colors, darkColors                  // full palette incl. vehicle-status + zone fills
  typography { sans, mono, scale }
  shape { radiusScale, spaceScale }
  assets { wordmark, mark, monogram, emoji }   // inline SVG / data-URI only
  maps { styleDay, styleNight }
  support { email, phone, url, whatsapp }
  legal { legalName, address, vatId, termsUrl, privacyUrl }
  features: Record<string, boolean>   // per-operator feature switches
}
```

`pennyBrand` is the shipped default. Everything else is an override of it.

## Creating a client

```ts
// apps/<app>/src/brand/brands.ts
import { createBrand } from '@penny/ui';

export const acme = createBrand({
  id: 'acme',
  name: 'Acme Go',
  scheme: 'acmego',
  domain: 'acmego.com',
  defaultLang: 'en',
  locale: 'en-GB',
  colors: { primary: '#ff5a1f', onPrimary: '#ffffff' },
  assets: { monogram: 'A', emoji: '🛵' },
  support: { email: 'help@acmego.com', whatsapp: '+441234567890' },
  legal: {
    legalName: 'Acme Mobility Ltd',
    address: 'London, UK',
    termsUrl: 'https://acmego.com/terms',
    privacyUrl: 'https://acmego.com/privacy',
  },
  features: { groupRides: false, reactionTest: false },
});
```

`createBrand` **deep-merges** over the default, so:

- a partial override is always safe — untouched tokens keep working;
- adding a new token to `Brand` later does not break existing client brands.

The default is never mutated (covered by a unit test).

## Where a brand comes from at runtime

Resolution order, highest priority first:

1. **Env** — `VITE_BRAND` (admin) / `EXPO_PUBLIC_BRAND` (rider, ops). Build-time
   selection for a dedicated client build.
2. **Server config** — the `brand` key in `app_config`, parsed with
   `brandFromConfig()`. Lets an operator retheme from the admin panel without a
   release.
3. **`pennyBrand`** — the fallback.

## Applying it

**Web (admin)** — `brandCssVars(brand, mode)` returns `--brand-*` custom
properties; the provider writes them onto `document.documentElement` and the
entire panel re-themes live. Existing CSS variables are fed by these, so no
component needed rewriting.

**Native (rider, ops)** — `useTheme()` returns a theme object with the same
shape the apps already used (`color`, `space`, `radius`, `font`), derived via
`resolveColors()` and the `scaled*` helpers. Migrating a screen is an import
change.

**Anywhere** — `statusColor(brand, status)` for vehicle pins and badges,
`deepLink(brand, '/vehicle/ABC')` for QR and marketing links.

## Feature flags

`brand.features` turns whole product surfaces on and off per operator:

| flag | hides when false |
|---|---|
| `groupRides` | group-unlock flow |
| `reservations` | reserve button + countdown |
| `packages` / `subscriptions` | wallet store sections |
| `referrals` / `loyalty` | profile + stats sections |
| `reactionTest` | night anti-DUI gate |
| `walletTopUp` | prepaid balance top-up |
| `shareMyRide` | live-trip share link |
| `crashCheckIn` | fall check-in prompt |
| `parkingSchool` | parking education screen |

A disabled feature disappears cleanly — no dead navigation entries, no empty
cards.

## Accessibility gate

`validateBrand(brand, mode)` returns WCAG contrast warnings for the pairs that
matter (`text/bg`, `textMuted/bg`, `text/surface`, `onPrimary/primary`,
`danger/surface`, `success/surface`). The admin Branding editor shows these
inline, so an operator cannot ship an unreadable palette.

This check earned its keep immediately: it caught the platform's own
`textMuted` at **2.89:1** on the page background, which was fixed to 3.46:1.

`readableOn(hex)` picks black or white for a chosen background — used to
auto-suggest `onPrimary` when a client picks a brand colour.

## Assets

Logos are **inline SVG or data-URIs** (`brand.assets.wordmark` / `mark`), never
external URLs: pages stay self-contained, CSP-safe and offline-capable. With no
asset supplied, surfaces draw a monogram chip from `assets.monogram`.

Store icons and splash screens are still real files per app — replace
`apps/<app>/assets/*` for a client build.

## Shipping a client build

1. Add the brand to `src/brand/brands.ts` in each app.
2. Set `EXPO_PUBLIC_BRAND` / `VITE_BRAND` to its id.
3. Replace `apps/<app>/assets/*` (icon, splash, adaptive icon).
4. `app.config.ts` derives app name, slug, scheme, iOS bundle id and Android
   package from the selected brand — check them before submitting.
5. Point the client at their own Supabase project
   (`pnpm supabase:provision --env prod --name <client>`; see docs/14).
6. Optionally seed their `app_config.brand` so support can retheme later without
   a release.

## Demoing it

Both mobile apps and the admin panel carry a **brand switcher** (dev menu on
mobile, top bar / Settings on web). Switching brand and light/dark re-themes the
running app instantly — the fastest way to show a prospective operator their own
colours on real screens.

## Rules for contributors

- Never write a hex colour, product name, support address or `penny://` literal
  into a screen. Read it from the brand.
- New brandable value → add it to `Brand` with a sensible default in
  `pennyBrand`. Deep-merge keeps every existing client working.
- Adding a colour token? Add it to `validateBrand`'s checks if text is drawn on
  it.
