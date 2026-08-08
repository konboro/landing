// Brand + theme context for the Ops app.
//
// Resolution order (docs/16):
//   1. EXPO_PUBLIC_BRAND       — build-time selection for a dedicated client build
//   2. app_config.brand        — server override (best-effort; ops is offline-first)
//   3. pennyBrand              — the platform default
//
// A manual override picked in the dev menu beats all three. Both the brand and
// the light/dark choice persist through the SQLite `meta` table — the same
// guarded storage the staff session uses, so it survives an offline shift.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { resolveColors, type Brand, type BrandColors, type ThemeMode } from '@penny/ui';
import { metaGet, metaSet, isSqliteAvailable } from '../offline/db';
import { BRANDS, DEFAULT_BRAND, brandById, opsNameFor } from './brands';
import { deriveTheme, type OpsTheme } from './deriveTheme';
import { loadRemoteBrand } from './remoteBrand';

const MODE_KEY = 'theme_mode';
const BRAND_KEY = 'brand_override';

/** Ops ships dark-first: high contrast for outdoor use, day and night. */
const DEFAULT_MODE: ThemeMode = 'dark';

const ENV_BRAND_ID = process.env.EXPO_PUBLIC_BRAND ?? null;

export interface BrandContextValue {
  brand: Brand;
  colors: BrandColors;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** `brand.features[name]` — unknown flags default to OFF. */
  isEnabled: (feature: string) => boolean;

  /** Fully derived theme (same shape lib/theme.ts always exported). */
  theme: OpsTheme;
  /** Ops-facing product name, e.g. "Penny Ops" / "Meltemi Field". */
  opsName: string;
  brands: Brand[];
  setBrandId: (id: string) => void;
  ready: boolean;
}

const BrandContext = createContext<BrandContextValue | null>(null);

async function readMeta(key: string): Promise<string | null> {
  if (!isSqliteAvailable()) return null;
  try {
    return await metaGet(key);
  } catch {
    return null;
  }
}
async function writeMeta(key: string, value: string): Promise<void> {
  if (!isSqliteAvailable()) return;
  try {
    await metaSet(key, value);
  } catch {
    /* ignore — a theme preference is never worth failing a shift over */
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<Brand>(() =>
    ENV_BRAND_ID ? brandById(ENV_BRAND_ID) : DEFAULT_BRAND,
  );
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [savedMode, savedBrandId] = await Promise.all([
        readMeta(MODE_KEY),
        readMeta(BRAND_KEY),
      ]);
      if (cancelled) return;
      if (savedMode === 'light' || savedMode === 'dark') setModeState(savedMode);

      if (savedBrandId) {
        setBrand(brandById(savedBrandId));
        setReady(true);
        return;
      }
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
    void writeMeta(MODE_KEY, next);
  }, []);

  const setBrandId = useCallback((id: string) => {
    setBrand(brandById(id));
    void writeMeta(BRAND_KEY, id);
  }, []);

  const theme = useMemo(() => deriveTheme(brand, mode), [brand, mode]);
  const colors = useMemo(() => resolveColors(brand, mode), [brand, mode]);
  const isEnabled = useCallback((feature: string) => brand.features[feature] === true, [brand]);

  const value = useMemo<BrandContextValue>(
    () => ({
      brand,
      colors,
      mode,
      setMode,
      isEnabled,
      theme,
      opsName: opsNameFor(brand.id),
      brands: BRANDS,
      setBrandId,
      ready,
    }),
    [brand, colors, mode, setMode, isEnabled, theme, setBrandId, ready],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

const FALLBACK_CONTEXT: BrandContextValue = {
  brand: DEFAULT_BRAND,
  colors: resolveColors(DEFAULT_BRAND, DEFAULT_MODE),
  mode: DEFAULT_MODE,
  setMode: () => {},
  isEnabled: (feature: string) => DEFAULT_BRAND.features[feature] === true,
  theme: deriveTheme(DEFAULT_BRAND, DEFAULT_MODE),
  opsName: opsNameFor(DEFAULT_BRAND.id),
  brands: BRANDS,
  setBrandId: () => {},
  ready: true,
};

/** Read the brand context; safe (default brand) outside the provider. */
export function useBrand(): BrandContextValue {
  return useContext(BrandContext) ?? FALLBACK_CONTEXT;
}
