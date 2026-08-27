// Build-time brand identity.
//
// IMPORTANT — why this file is .js and not .ts:
// `app.config.ts` imports it, and Expo's config loader transpiles ONLY the
// config file itself, then `require()`s its relative imports through plain Node
// resolution. Node cannot resolve `./src/brand/build` to a `.ts` file, so a
// TypeScript module here fails every `expo prebuild` / `expo start` with
// "Cannot find module './src/brand/build'". Keeping the data in CommonJS makes
// it loadable by the config loader, by Metro and by tsc alike; the types live
// beside it in `build.d.ts`, so callers still get full checking.
//
// This module has **zero imports** on purpose — it must stay plain data.
//
// It holds only the values a native build bakes in — app name, slug, deep-link
// scheme, bundle identifiers and the splash/icon background. The *runtime*
// brand (full palette, support details, feature flags) lives in `brands.ts`,
// which reuses these same values so the two can never drift.

const DEFAULT_BRAND_ID = 'penny';

/**
 * Every brand this app can be built for. Adding a client = one entry here plus
 * one entry in `brands.ts` (see the README's "Ship for a new client").
 */
const BUILD_BRANDS = {
  penny: {
    id: 'penny',
    name: 'Penny',
    slug: 'penny-rider',
    scheme: 'penny',
    iosBundleId: 'com.pennyrent.rider',
    androidPackage: 'com.pennyrent.rider',
    domain: 'penny.rent',
    primary: '#2f5be0',
    primaryDark: '#183492',
    onPrimary: '#ffffff',
    monogram: 'P',
    emoji: '🛴',
  },

  // Demo client #1 — a bright-orange Mediterranean island operator.
  meltemi: {
    id: 'meltemi',
    name: 'Meltemi',
    slug: 'meltemi-rider',
    scheme: 'meltemi',
    iosBundleId: 'ride.meltemi.rider',
    androidPackage: 'ride.meltemi.rider',
    domain: 'meltemi.ride',
    primary: '#c2410c',
    primaryDark: '#8a2c06',
    onPrimary: '#ffffff',
    monogram: 'M',
    emoji: '🌊',
  },

  // Demo client #2 — a dark-green Nordic operator.
  nordvei: {
    id: 'nordvei',
    name: 'Nordvei',
    slug: 'nordvei-rider',
    scheme: 'nordvei',
    iosBundleId: 'no.nordvei.rider',
    androidPackage: 'no.nordvei.rider',
    domain: 'nordvei.no',
    primary: '#0f6b4f',
    primaryDark: '#0a4633',
    onPrimary: '#ffffff',
    monogram: 'N',
    emoji: '🌲',
  },
};

/** Resolve a brand id (usually `process.env.EXPO_PUBLIC_BRAND`) to its build config. */
function resolveBuildBrand(id) {
  const key = (id ?? '').trim().toLowerCase();
  return BUILD_BRANDS[key] ?? BUILD_BRANDS[DEFAULT_BRAND_ID];
}

module.exports = { DEFAULT_BRAND_ID, BUILD_BRANDS, resolveBuildBrand };
