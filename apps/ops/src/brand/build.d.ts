// Types for `build.js`. The data lives in CommonJS so Expo's config loader can
// require it from `app.config.ts` (see the note at the top of build.js); this
// file keeps every consumer — brands.ts, the config — fully typed.

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

export declare const DEFAULT_BRAND_ID: string;
export declare const BUILD_BRANDS: Record<string, BuildBrand>;
export declare function resolveBuildBrand(id: string | null | undefined): BuildBrand;
