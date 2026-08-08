// Build-time brand identity for the Ops app.
//
// IMPORTANT: zero imports on purpose — `app.config.ts` loads this file directly
// through Expo's TypeScript config loader, outside Metro.
//
// Only the values a native build bakes in live here. The runtime brand (full
// palette, support details, feature flags) is in `brands.ts`, which reuses
// these fields so the two can never drift.

export interface BuildBrand {
  /** Stable slug — the value you put in EXPO_PUBLIC_BRAND. */
  id: string;
  /** Rider-facing product name (the operator). */
  name: string;
  /** Ops app display name — what field techs see on the home screen. */
  opsName: string;
  slug: string;
  /** Deep-link scheme, without `://`. Distinct from the rider app's. */
  scheme: string;
  iosBundleId: string;
  androidPackage: string;
  domain: string;
  primary: string;
  /** Splash / adaptive-icon background — the ops chrome is dark by default. */
  splash: string;
  onPrimary: string;
  monogram: string;
  emoji: string;
}

export const DEFAULT_BRAND_ID = 'penny';

export const BUILD_BRANDS: Record<string, BuildBrand> = {
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
export function resolveBuildBrand(id: string | null | undefined): BuildBrand {
  const key = (id ?? '').trim().toLowerCase();
  return BUILD_BRANDS[key] ?? BUILD_BRANDS[DEFAULT_BRAND_ID]!;
}
