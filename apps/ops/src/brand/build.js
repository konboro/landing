// Build-time brand identity for the Ops app.
//
// IMPORTANT — why this file is .js and not .ts:
// `app.config.ts` imports it, and Expo's config loader transpiles ONLY the
// config file itself, then `require()`s its relative imports through plain Node
// resolution. Node cannot resolve `./src/brand/build` to a `.ts` file, so a
// TypeScript module here fails every `expo prebuild` / `expo start` with
// "Cannot find module './src/brand/build'". CommonJS is loadable by the config
// loader, by Metro and by tsc alike; the types live in `build.d.ts`.
//
// Zero imports on purpose — it must stay plain data.
//
// Only the values a native build bakes in live here. The runtime brand (full
// palette, support details, feature flags) is in `brands.ts`, which reuses
// these fields so the two can never drift.

const DEFAULT_BRAND_ID = 'penny';

const BUILD_BRANDS = {
  penny: {
    id: 'penny',
    name: 'Penny',
    opsName: 'Penny Ops',
    slug: 'penny-ops',
    scheme: 'pennyops',
    iosBundleId: 'com.pennyrent.ops',
    androidPackage: 'com.pennyrent.ops',
    domain: 'penny.rent',
    primary: '#2f5be0',
    splash: '#111f52',
    onPrimary: '#ffffff',
    monogram: 'P',
    emoji: '🛴',
  },

  // Demo client #1 — bright-orange Mediterranean island operator.
  meltemi: {
    id: 'meltemi',
    name: 'Meltemi',
    opsName: 'Meltemi Field',
    slug: 'meltemi-ops',
    scheme: 'meltemiops',
    iosBundleId: 'ride.meltemi.ops',
    androidPackage: 'ride.meltemi.ops',
    domain: 'meltemi.ride',
    primary: '#c2410c',
    splash: '#1a120c',
    onPrimary: '#ffffff',
    monogram: 'M',
    emoji: '🌊',
  },

  // Demo client #2 — dark-green Nordic operator.
  nordvei: {
    id: 'nordvei',
    name: 'Nordvei',
    opsName: 'Nordvei Drift',
    slug: 'nordvei-ops',
    scheme: 'nordveiops',
    iosBundleId: 'no.nordvei.ops',
    androidPackage: 'no.nordvei.ops',
    domain: 'nordvei.no',
    primary: '#0f6b4f',
    splash: '#08120e',
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
