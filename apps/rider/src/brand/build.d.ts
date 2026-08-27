// Types for `build.js`. The data lives in CommonJS so Expo's config loader can
// require it from `app.config.ts` (see the note at the top of build.js); this
// file keeps every consumer — brands.ts, index.ts, the config — fully typed.

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

export declare const DEFAULT_BRAND_ID: string;
export declare const BUILD_BRANDS: Record<string, BuildBrand>;
export declare function resolveBuildBrand(id: string | null | undefined): BuildBrand;
