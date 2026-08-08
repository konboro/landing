// White-label brand provider.
//
// Resolution order (first hit wins):
//   1. `VITE_BRAND` — a built-in brand id, so a deployment can be pinned to an
//      operator at build time (`VITE_BRAND=aegean pnpm build`).
//   2. `app_config.brand` from the data source — lets an operator re-brand
//      from the panel itself without a deploy.
//   3. `pennyBrand` — the platform default.
//
// Whatever wins is pushed into <html> as CSS custom properties, so the entire
// panel re-themes live (see lib/theme.ts). Nothing renders a hardcoded product
// name, colour or support address — it all comes from here.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  brandFromConfig,
  createBrand,
  pennyBrand,
  resolveColors,
  statusColor,
  type Brand,
  type BrandColors,
  type ThemeMode,
} from '@penny/ui';
import { applyBrandTheme } from '@/lib/theme';
import { useDS } from '@/context/DataContext';

/* ─────────────────────────── demo brands ──────────────────────────────── */

/**
 * Shipped demo operators. They exist so the panel can be shown re-themed
 * instantly (brand switcher in the top bar) and so `createBrand()`'s
 * partial-override contract is exercised by real code, not only tests.
 */
export const aegeanBrand: Brand = createBrand({
  id: 'aegean',
  name: 'Aegean Ride',
  scheme: 'aegeanride',
  domain: 'aegean.ride',
  locale: 'el-GR',
  colors: {
    primary: '#0d7a8f',
    primaryDark: '#075263',
    primarySoft: '#e3f4f7',
    onPrimary: '#ffffff',
    statusAvailable: '#0f9d76',
    statusInTrip: '#0d7a8f',
    statusReserved: '#4bb3c6',
  },
  darkColors: { primary: '#4bb3c6', primarySoft: '#0f3b45' },
  assets: { monogram: 'Æ', emoji: '🌊' },
  support: { email: 'support@aegean.ride', url: 'https://aegean.ride/help' },
  legal: {
    legalName: 'Aegean Ride Μ.Ι.Κ.Ε.',
    address: 'Piraeus, Greece',
    termsUrl: 'https://aegean.ride/terms',
    privacyUrl: 'https://aegean.ride/privacy',
  },
  features: { loyalty: false, groupRides: false },
});

export const voltaBrand: Brand = createBrand({
  id: 'volta',
  name: 'Volta Mobility',
  scheme: 'volta',
  domain: 'voltamobility.eu',
  defaultLang: 'en',
  locale: 'en-GB',
  colors: {
    primary: '#f25c05',
    primaryDark: '#b23f00',
    primarySoft: '#fff0e6',
    onPrimary: '#ffffff',
    text: '#1b1b1f',
    statusAvailable: '#2fa84f',
    statusInTrip: '#f25c05',
    statusTransport: '#7b4bd8',
  },
  darkColors: { primary: '#ff8a44', primarySoft: '#4a2308' },
  typography: { scale: 1.05 },
  shape: { radiusScale: 1.6, spaceScale: 1 },
  assets: { monogram: 'V', emoji: '⚡' },
  support: { email: 'hello@voltamobility.eu', phone: '+30 210 000 0000', url: 'https://voltamobility.eu/support' },
  legal: {
    legalName: 'Volta Mobility BV',
    address: 'Rotterdam, Netherlands',
    vatId: 'NL861234567B01',
    termsUrl: 'https://voltamobility.eu/terms',
    privacyUrl: 'https://voltamobility.eu/privacy',
  },
  features: { packages: false, parkingSchool: false },
});

/** Brands selectable from the switcher / pinnable via `VITE_BRAND`. */
export const BUILT_IN_BRANDS: Brand[] = [pennyBrand, aegeanBrand, voltaBrand];

/* ──────────────────────────── the context ─────────────────────────────── */

export interface BrandCtx {
  brand: Brand;
  setBrand: (brand: Brand) => void;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Colours already resolved for the current mode. */
  colors: BrandColors;
  /** Per-operator feature switch (`brand.features`). Unknown key = off. */
  isEnabled: (feature: string) => boolean;
  /** Vehicle status → colour for the active brand + mode. */
  statusColor: (status: string) => string;
  /** Where the active brand came from — surfaced in the Branding editor. */
  source: 'env' | 'config' | 'default';
  /** False until the server-side brand config has been read. */
  ready: boolean;
}

const Ctx = createContext<BrandCtx | null>(null);

const MODE_STORAGE_KEY = 'penny-admin-theme-mode';

function initialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const ds = useDS();
  const envId = (import.meta.env.VITE_BRAND ?? '').trim();
  const envBrand = envId ? BUILT_IN_BRANDS.find((b) => b.id === envId) ?? null : null;

  const [brand, setBrandState] = useState<Brand>(envBrand ?? pennyBrand);
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [source, setSource] = useState<BrandCtx['source']>(envBrand ? 'env' : 'default');
  const [ready, setReady] = useState(Boolean(envBrand));

  // 2. Server-side override — skipped when the build pins a brand.
  useEffect(() => {
    if (envBrand) return;
    let alive = true;
    ds.getBrandConfig()
      .then((config) => {
        if (!alive) return;
        if (config) {
          setBrandState(brandFromConfig(config));
          setSource('config');
        }
      })
      .catch(() => {
        /* A missing/unreadable brand row must never block the panel. */
      })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [ds, envBrand]);

  // Push the resolved brand into <html> — this is what actually re-themes.
  useEffect(() => { applyBrandTheme(brand, mode); }, [brand, mode]);

  // Product identity in the browser chrome.
  useEffect(() => {
    document.title = `${brand.name} Admin`;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon && brand.assets.emoji) {
      icon.href = `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="78" font-size="78">${brand.assets.emoji}</text></svg>`,
      )}`;
    }
  }, [brand]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try { window.localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* private mode */ }
  }, []);

  const setBrand = useCallback((next: Brand) => {
    setBrandState(next);
    setSource((prev) => (prev === 'env' ? 'env' : 'config'));
  }, []);

  const value = useMemo<BrandCtx>(() => {
    const colors = resolveColors(brand, mode);
    return {
      brand,
      setBrand,
      mode,
      setMode,
      colors,
      isEnabled: (feature: string) => brand.features[feature] === true,
      statusColor: (status: string) => statusColor(brand, status, mode),
      source,
      ready,
    };
  }, [brand, mode, setBrand, setMode, source, ready]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBrand must be used within BrandProvider');
  return ctx;
}

/** Convenience for components that only need the resolved palette. */
export function useBrandColors(): BrandColors {
  return useBrand().colors;
}
