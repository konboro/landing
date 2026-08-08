// Build-time brand identity.
//
// IMPORTANT: this module has **zero imports** on purpose. `app.config.ts` loads
// it directly through Expo's TypeScript config loader (which transpiles files
// one at a time, outside Metro), so anything it pulls in must be plain data.
//
// It holds only the values a native build bakes in — app name, slug, deep-link
// scheme, bundle identifiers and the splash/icon background. The *runtime*
// brand (full palette, support details, feature flags) lives in `brands.ts`,
// which reuses these same values so the two can never drift.

export interface BuildBrand {
  /** Stable slug — the value you put in EXPO_PUBLIC_BRAND. */
  id: string;
  /** Consumer-facing product name (app icon label, headers, onboarding). */
  name: string;
  /** Expo project slug. */
  slug: string;
  /** Deep-link scheme, without `://`. */
  scheme: string;
  iosBundleId: string;
  androidPackage: string;
  /** Primary web domain. */
  domain: string;
  /** Splash / adaptive-icon background + notification accent. */
  primary: string;
  /** Darker primary (pressed states, hero cards). */
  primaryDark: string;
  /** Text/iconography drawn on `primary`. */
  onPrimary: string;
  /** 1–2 characters drawn when no logo asset is supplied. */
  monogram: string;
  emoji: string;
}

export const DEFAULT_BRAND_ID = 'penny';

/**
 * Every brand this app can be built for. Adding a client = one entry here plus
 * one entry in `brands.ts` (see the README's "Ship for a new client").
 */
export const BUILD_BRANDS: Record<string, BuildBrand> = {
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
export function resolveBuildBrand(id: string | null | undefined): BuildBrand {
  const key = (id ?? '').trim().toLowerCase();
  return BUILD_BRANDS[key] ?? BUILD_BRANDS[DEFAULT_BRAND_ID]!;
}
