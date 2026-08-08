// Brand + theme context for the rider app.
//
// Resolution order (docs/16):
//   1. EXPO_PUBLIC_BRAND       — build-time selection for a dedicated client build
//   2. app_config.brand        — server override, so support can retheme without a release
//   3. pennyBrand              — the platform default
//
// A manual override picked in the dev brand switcher (Profile → long-press the
// title) beats all three and is persisted, together with the light/dark choice,
// through the guarded `Storage` helper.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { resolveColors, type Brand, type BrandColors, type ThemeMode } from '@penny/ui';
import { Storage } from '../lib/native';
import { BRANDS, DEFAULT_BRAND, brandById } from './brands';
import { deriveTheme, type RiderTheme } from './deriveTheme';
import { loadRemoteBrand } from './remoteBrand';

const MODE_KEY = 'penny.theme.mode';
const BRAND_KEY = 'penny.brand.override';

/** The rider app ships light-first (docs/06); dark is opt-in. */
const DEFAULT_MODE: ThemeMode = 'light';

/** Brand id baked in at build time, if any. */
const ENV_BRAND_ID = process.env.EXPO_PUBLIC_BRAND ?? null;

export interface BrandContextValue {
  brand: Brand;
  colors: BrandColors;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** `brand.features[name]` — unknown flags default to OFF. */
  isEnabled: (feature: string) => boolean;

  /** Fully derived theme (same shape as the old static `theme`). */
  theme: RiderTheme;
  /** Every brand this build can switch to — powers the dev switcher. */
  brands: Brand[];
  /** Demo affordance: switch brand at runtime and persist the choice. */
  setBrandId: (id: string) => void;
  /** True once the server-config lookup has settled. */
  ready: boolean;
}

const BrandContext = createContext<BrandContextValue | null>(null);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  // Start on the env brand (or the default) so the very first frame is correct.
  const [brand, setBrand] = useState<Brand>(() =>
    ENV_BRAND_ID ? brandById(ENV_BRAND_ID) : DEFAULT_BRAND,
  );
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);

  // Hydrate: persisted override → server config → keep what we have.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [savedMode, savedBrandId] = await Promise.all([
        Storage.get(MODE_KEY),
        Storage.get(BRAND_KEY),
      ]);
      if (cancelled) return;
      if (savedMode === 'light' || savedMode === 'dark') setModeState(savedMode);

      if (savedBrandId) {
        setBrand(brandById(savedBrandId));
        setReady(true);
        return;
      }
      // An explicit build-time brand wins over the server config.
      if (!ENV_BRAND_ID) {
        const remote = await loadRemoteBrand();
        if (!cancelled && remote) setBrand(remote);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void Storage.set(MODE_KEY, next);
  }, []);

  const setBrandId = useCallback((id: string) => {
    setBrand(brandById(id));
    void Storage.set(BRAND_KEY, id);
  }, []);

  // One stable theme object per (brand, mode) — `makeStyles` caches against it.
  const theme = useMemo(() => deriveTheme(brand, mode), [brand, mode]);
  const colors = useMemo(() => resolveColors(brand, mode), [brand, mode]);

  const isEnabled = useCallback(
    (feature: string) => brand.features[feature] === true,
    [brand],
  );

  const value = useMemo<BrandContextValue>(
    () => ({ brand, colors, mode, setMode, isEnabled, theme, brands: BRANDS, setBrandId, ready }),
    [brand, colors, mode, setMode, isEnabled, theme, setBrandId, ready],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

/**
 * Read the brand context. Falls back to a default-brand context when a
 * component renders outside the provider (Storybook-style isolated renders,
 * error boundaries) so nothing ever crashes on a missing provider.
 */
export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (ctx) return ctx;
  return FALLBACK_CONTEXT;
}

const FALLBACK_CONTEXT: BrandContextValue = {
  brand: DEFAULT_BRAND,
  colors: resolveColors(DEFAULT_BRAND, DEFAULT_MODE),
  mode: DEFAULT_MODE,
  setMode: () => {},
  isEnabled: (feature: string) => DEFAULT_BRAND.features[feature] === true,
  theme: deriveTheme(DEFAULT_BRAND, DEFAULT_MODE),
  brands: BRANDS,
  setBrandId: () => {},
  ready: true,
};
