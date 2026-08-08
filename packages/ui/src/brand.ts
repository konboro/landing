// White-label brand system.
//
// Every visual and identity decision that differs between operators lives in a
// `Brand`. The platform ships `pennyBrand` as the default; a new client is one
// `createBrand({...})` call plus (optionally) a `brand` row in `app_config`, so
// the same codebase can run Penny.rent, another city operator, or a franchise
// without forking.
//
// Rules:
//   * Never hardcode a colour, product name, or support address in a screen —
//     read it from the brand.
//   * `createBrand` deep-merges over the default, so a partial override is safe
//     and new tokens added here keep old brands working.
//   * This module is framework-free (no React, no RN) so web + native share it.

export type ThemeMode = 'light' | 'dark';

/**
 * Default ramp for the shipped brand. Mirrors `palette` in tokens.ts but is
 * declared here so this module stays dependency-free — a brand definition must
 * be loadable anywhere (edge function, script, native, web) with no imports.
 */
const ramp = {
  blue50: '#eef4ff',
  blue400: '#5a82f7',
  blue500: '#2f5be0',
  blue600: '#1f43b8',
  blue700: '#183492',
  green400: '#3fce7a',
  green500: '#1faa59',
  amber500: '#e8a317',
  red500: '#e04141',
  ink50: '#f6f8fb',
  ink100: '#eceff4',
  ink200: '#d7dce6',
  ink300: '#b5bccb',
  ink400: '#7b8699',
  ink600: '#38425c',
  ink700: '#232c42',
  ink800: '#161d2e',
  ink900: '#0d1220',
  white: '#ffffff',
} as const;

export interface BrandColors {
  primary: string;
  primaryDark: string;
  primarySoft: string;
  onPrimary: string;

  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;

  text: string;
  textMuted: string;
  textInverse: string;

  success: string;
  warning: string;
  danger: string;

  /** Vehicle status colours used on every map and table. */
  statusAvailable: string;
  statusReserved: string;
  statusInTrip: string;
  statusLowBattery: string;
  statusMaintenance: string;
  statusTransport: string;
  statusOffline: string;
  statusStolen: string;

  /** Zone overlay fills (rgba recommended). */
  zoneOperating: string;
  zoneParking: string;
  zoneNoParking: string;
  zoneNoGo: string;
  zoneBonus: string;
  zonePaidParking: string;
  zoneSpeedLimit: string;
}

export interface BrandTypography {
  /** CSS font stack (web) / font family name (native). */
  sans: string;
  mono: string;
  /** Multiplier applied to the base type scale. 1 = default. */
  scale: number;
}

export interface BrandShape {
  /** Multiplier on the radius scale. 0 = square, 1 = default, 2 = very round. */
  radiusScale: number;
  /** Multiplier on the spacing scale. */
  spaceScale: number;
}

export interface BrandAssets {
  /**
   * Inline SVG or data-URI. Kept inline so pages stay self-contained and no
   * external host is required (CSP-safe, works offline).
   */
  wordmark: string | null;
  mark: string | null;
  /** 1–2 characters drawn when no logo asset is supplied. */
  monogram: string;
  /** Optional favicon emoji for web surfaces. */
  emoji: string | null;
}

export interface BrandMaps {
  styleDay: string;
  styleNight: string;
}

export interface BrandSupport {
  email: string;
  phone: string | null;
  url: string | null;
  whatsapp: string | null;
}

export interface BrandLegal {
  /** Registered entity — appears on receipts, invoices and emails. */
  legalName: string;
  address: string;
  vatId: string | null;
  termsUrl: string;
  privacyUrl: string;
}

export interface Brand {
  /** Stable slug. Used as the app_config key suffix and in analytics. */
  id: string;
  /** Consumer-facing product name. */
  name: string;
  /** Deep-link scheme, without `://`. */
  scheme: string;
  /** Primary web domain (used for links in emails and QR fallbacks). */
  domain: string;

  defaultLang: string;
  currency: string;
  /** BCP-47 locale used for number/date formatting. */
  locale: string;

  colors: BrandColors;
  darkColors: Partial<BrandColors>;
  typography: BrandTypography;
  shape: BrandShape;
  assets: BrandAssets;
  maps: BrandMaps;
  support: BrandSupport;
  legal: BrandLegal;

  /** Per-operator feature switches. Unknown keys are allowed. */
  features: Record<string, boolean>;
}

/* ────────────────────────────── default brand ───────────────────────────── */

export const pennyBrand: Brand = {
  id: 'penny',
  name: 'Penny',
  scheme: 'penny',
  domain: 'penny.rent',

  defaultLang: 'el',
  currency: 'EUR',
  locale: 'el-GR',

  colors: {
    primary: ramp.blue500,
    primaryDark: ramp.blue700,
    primarySoft: ramp.blue50,
    onPrimary: ramp.white,

    bg: ramp.ink50,
    surface: ramp.white,
    surfaceAlt: ramp.ink100,
    border: ramp.ink200,

    text: ramp.ink900,
    textMuted: ramp.ink400,
    textInverse: ramp.white,

    success: ramp.green500,
    warning: ramp.amber500,
    danger: ramp.red500,

    statusAvailable: ramp.green500,
    statusReserved: ramp.blue400,
    statusInTrip: ramp.blue600,
    statusLowBattery: ramp.amber500,
    statusMaintenance: ramp.ink400,
    statusTransport: '#8a5cf6',
    statusOffline: ramp.ink300,
    statusStolen: ramp.red500,

    zoneOperating: 'rgba(47,91,224,0.06)',
    zoneParking: 'rgba(31,170,89,0.18)',
    zoneNoParking: 'rgba(224,65,65,0.20)',
    zoneNoGo: 'rgba(13,18,32,0.30)',
    zoneBonus: 'rgba(63,206,122,0.25)',
    zonePaidParking: 'rgba(232,163,23,0.20)',
    zoneSpeedLimit: 'rgba(232,163,23,0.12)',
  },

  // Only the tokens that actually change in dark mode.
  darkColors: {
    bg: ramp.ink900,
    surface: ramp.ink800,
    surfaceAlt: ramp.ink700,
    border: ramp.ink600,
    text: ramp.white,
    textMuted: ramp.ink300,
    primary: ramp.blue400,
    primarySoft: ramp.ink700,
  },

  typography: {
    sans: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    scale: 1,
  },

  shape: { radiusScale: 1, spaceScale: 1 },

  assets: { wordmark: null, mark: null, monogram: 'P', emoji: '🛴' },

  maps: {
    styleDay: 'mapbox://styles/mapbox/streets-v12',
    styleNight: 'mapbox://styles/mapbox/navigation-night-v1',
  },

  support: {
    email: 'support@penny.rent',
    phone: null,
    url: 'https://penny.rent/support',
    whatsapp: null,
  },

  legal: {
    legalName: 'Penny Rent',
    address: 'Athens, Greece',
    vatId: null,
    termsUrl: 'https://penny.rent/terms',
    privacyUrl: 'https://penny.rent/privacy',
  },

  features: {
    groupRides: true,
    reservations: true,
    packages: true,
    subscriptions: true,
    referrals: true,
    loyalty: true,
    reactionTest: true,
    walletTopUp: true,
    shareMyRide: true,
    crashCheckIn: true,
    parkingSchool: true,
  },
};

/* ───────────────────────────────── merge ────────────────────────────────── */

/**
 * Recursively optional.
 *
 * Note the `extends object` test rather than `extends Record<string, unknown>`:
 * an `interface` without an index signature does NOT satisfy the latter, so the
 * earlier version silently fell through and required every nested field —
 * defeating the point of `createBrand({ colors: { primary } })`. Arrays and
 * nullable primitives are passed through untouched.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object | undefined
      ? DeepPartial<NonNullable<T[K]>>
      : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

/**
 * Build a brand from a partial override of the platform default.
 *
 *   export const acme = createBrand({
 *     id: 'acme', name: 'Acme Go', scheme: 'acmego', domain: 'acmego.com',
 *     colors: { primary: '#ff5a1f' },
 *     assets: { monogram: 'A', emoji: '🛵' },
 *   });
 */
export function createBrand(overrides: DeepPartial<Brand> = {}): Brand {
  return deepMerge(pennyBrand, overrides);
}

/** Parse a brand stored as JSON in `app_config` (falls back to the default). */
export function brandFromConfig(value: unknown): Brand {
  if (!isPlainObject(value)) return pennyBrand;
  return createBrand(value as DeepPartial<Brand>);
}

/* ──────────────────────────── derived surfaces ──────────────────────────── */

/** Resolve the colour set for a theme mode. */
export function resolveColors(brand: Brand, mode: ThemeMode = 'light'): BrandColors {
  return mode === 'dark' ? { ...brand.colors, ...brand.darkColors } : brand.colors;
}

const CSS_VAR_PREFIX = '--brand';

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * CSS custom properties for web surfaces. Apply to :root and the whole panel
 * re-themes — no rebuild, no per-component wiring.
 */
export function brandCssVars(brand: Brand, mode: ThemeMode = 'light'): Record<string, string> {
  const c = resolveColors(brand, mode);
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) vars[`${CSS_VAR_PREFIX}-${kebab(k)}`] = v;
  vars[`${CSS_VAR_PREFIX}-font-sans`] = brand.typography.sans;
  vars[`${CSS_VAR_PREFIX}-font-mono`] = brand.typography.mono;
  vars[`${CSS_VAR_PREFIX}-type-scale`] = String(brand.typography.scale);
  vars[`${CSS_VAR_PREFIX}-radius-scale`] = String(brand.shape.radiusScale);
  vars[`${CSS_VAR_PREFIX}-space-scale`] = String(brand.shape.spaceScale);
  return vars;
}

/** Serialize the vars into a `:root { … }` block (for SSR or a <style> tag). */
export function brandCssBlock(brand: Brand, selector = ':root', mode: ThemeMode = 'light'): string {
  const body = Object.entries(brandCssVars(brand, mode))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

/** Scale the shared spacing/radius ramps by the brand's shape multipliers. */
export function scaledSpace(brand: Brand, base: number): number {
  return Math.round(base * brand.shape.spaceScale);
}
export function scaledRadius(brand: Brand, base: number): number {
  return Math.round(base * brand.shape.radiusScale);
}
export function scaledFontSize(brand: Brand, base: number): number {
  return Math.round(base * brand.typography.scale);
}

/** Vehicle status → colour, resolved against a brand. */
export function statusColor(brand: Brand, status: string, mode: ThemeMode = 'light'): string {
  const c = resolveColors(brand, mode);
  const map: Record<string, string> = {
    available: c.statusAvailable,
    reserved: c.statusReserved,
    in_trip: c.statusInTrip,
    low_battery: c.statusLowBattery,
    maintenance: c.statusMaintenance,
    transport: c.statusTransport,
    offline: c.statusOffline,
    stolen: c.statusStolen,
    decommissioned: c.textMuted,
  };
  return map[status] ?? c.textMuted;
}

/** Deep-link builder — `penny://vehicle/ATH-1001` for the active brand. */
export function deepLink(brand: Brand, path: string): string {
  return `${brand.scheme}://${path.replace(/^\/+/, '')}`;
}

/* ───────────────────────────── contrast helper ──────────────────────────── */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return 1;
  const la = luminance(ra);
  const lb = luminance(rb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

/** Pick black or white text for a background — used when a client picks a colour. */
export function readableOn(background: string): string {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000')
    ? '#ffffff'
    : '#000000';
}

export interface BrandWarning {
  token: string;
  message: string;
  ratio: number;
}

/**
 * Accessibility check for a client-supplied ramp. Surfaces in the admin
 * Branding editor so an operator can't ship an unreadable theme.
 */
export function validateBrand(brand: Brand, mode: ThemeMode = 'light'): BrandWarning[] {
  const c = resolveColors(brand, mode);
  const checks: Array<[string, string, string, number]> = [
    ['text/bg', c.text, c.bg, 4.5],
    ['textMuted/bg', c.textMuted, c.bg, 3],
    ['text/surface', c.text, c.surface, 4.5],
    ['onPrimary/primary', c.onPrimary, c.primary, 4.5],
    ['danger/surface', c.danger, c.surface, 3],
    ['success/surface', c.success, c.surface, 3],
  ];
  const out: BrandWarning[] = [];
  for (const [token, fg, bg, min] of checks) {
    const ratio = contrastRatio(fg, bg);
    if (ratio < min) {
      out.push({ token, ratio, message: `contrast ${ratio}:1 is below the ${min}:1 minimum` });
    }
  }
  return out;
}
