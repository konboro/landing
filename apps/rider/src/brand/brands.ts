// Brand registry for the rider app.
//
// `pennyBrand` is the platform default (see packages/ui/src/brand.ts). Every
// other operator is a `createBrand()` deep-merge over it, so a partial override
// is always safe and new brand tokens keep old clients working.
//
// The identity fields (name / scheme / domain / primary) come from `build.ts`
// so the native build config and the runtime theme can never disagree.
import { createBrand, pennyBrand, type Brand } from '@penny/ui';
import { BUILD_BRANDS, DEFAULT_BRAND_ID, type BuildBrand } from './build';

const meltemiBuild = BUILD_BRANDS.meltemi!;
const nordveiBuild = BUILD_BRANDS.nordvei!;

/** Identity fields every brand shares with the native build config. */
function identity(b: BuildBrand) {
  return { id: b.id, name: b.name, scheme: b.scheme, domain: b.domain };
}

/* ───────────────────────── Meltemi — Syros, Greece ───────────────────────── */
/**
 * Bright, warm, terracotta-and-sea island operator. Rounder shapes than Penny
 * (radiusScale 1.5), an outdoors map style, and two product surfaces switched
 * off: they run a daytime-only fleet (no night reaction test) and sell packages
 * rather than subscriptions.
 */
export const meltemiBrand: Brand = createBrand({
  ...identity(meltemiBuild),

  defaultLang: 'el',
  currency: 'EUR',
  locale: 'el-GR',

  colors: {
    primary: meltemiBuild.primary,
    primaryDark: meltemiBuild.primaryDark,
    primarySoft: '#fff1e8',
    onPrimary: meltemiBuild.onPrimary,

    bg: '#fffaf5',
    surface: '#ffffff',
    surfaceAlt: '#fdeee2',
    border: '#f0dccb',

    text: '#2a1a10',
    textMuted: '#8a6a53',
    textInverse: '#ffffff',

    success: '#12946a',
    warning: '#c77700',
    danger: '#d93838',

    statusAvailable: '#12946a',
    statusReserved: '#f4a261',
    statusInTrip: '#f97316',
    statusLowBattery: '#c77700',
    statusMaintenance: '#8a6a53',
    statusTransport: '#7b5cf0',
    statusOffline: '#c9b6a5',
    statusStolen: '#d93838',

    zoneOperating: 'rgba(194,65,12,0.06)',
    zoneParking: 'rgba(18,148,106,0.18)',
    zoneNoParking: 'rgba(217,56,56,0.20)',
    zoneNoGo: 'rgba(42,26,16,0.30)',
    zoneBonus: 'rgba(249,115,22,0.25)',
    zonePaidParking: 'rgba(199,119,0,0.20)',
    zoneSpeedLimit: 'rgba(199,119,0,0.12)',
  },

  darkColors: {
    bg: '#1a120c',
    surface: '#241811',
    surfaceAlt: '#33241a',
    border: '#4a3527',
    text: '#fff6ef',
    textMuted: '#c2a893',
    // A pale orange needs dark ink on top, so onPrimary flips in dark mode.
    primary: '#fb923c',
    primarySoft: '#33241a',
    onPrimary: '#2a1408',
  },

  typography: { ...pennyBrand.typography, scale: 1.02 },
  shape: { radiusScale: 1.5, spaceScale: 1 },

  // Inline SVG / data-URI only (never an external URL) — with none supplied the
  // app draws a monogram chip.
  assets: { wordmark: null, mark: null, monogram: meltemiBuild.monogram, emoji: meltemiBuild.emoji },

  maps: {
    styleDay: 'mapbox://styles/mapbox/outdoors-v12',
    styleNight: 'mapbox://styles/mapbox/dark-v11',
  },

  support: {
    email: 'help@meltemi.ride',
    phone: '+302281099000',
    url: 'https://meltemi.ride/help',
    whatsapp: '+302281099000',
  },

  legal: {
    legalName: 'Meltemi Mobility MIKE',
    address: 'Ermoupoli, Syros 84100, Greece',
    vatId: 'EL801234567',
    termsUrl: 'https://meltemi.ride/terms',
    privacyUrl: 'https://meltemi.ride/privacy',
  },

  features: {
    // Daytime-only island fleet: no night anti-DUI gate.
    reactionTest: false,
    // Sells minute packages, not monthly plans.
    subscriptions: false,
  },
});

/* ───────────────────────── Nordvei — Oslo, Norway ────────────────────────── */
/**
 * Restrained Nordic operator: deep forest green, near-square corners
 * (radiusScale 0.5), slightly smaller type, NOK pricing. Runs a card-only,
 * single-rider product — no prepaid wallet, no packages, no group unlock.
 */
export const nordveiBrand: Brand = createBrand({
  ...identity(nordveiBuild),

  defaultLang: 'en',
  currency: 'NOK',
  locale: 'nb-NO',

  colors: {
    primary: nordveiBuild.primary,
    primaryDark: nordveiBuild.primaryDark,
    primarySoft: '#e6f2ed',
    onPrimary: nordveiBuild.onPrimary,

    bg: '#f2f5f3',
    surface: '#ffffff',
    surfaceAlt: '#e4ebe7',
    border: '#cbd8d1',

    text: '#0b1a14',
    textMuted: '#5c6f66',
    textInverse: '#ffffff',

    success: '#188a5f',
    warning: '#b7791f',
    danger: '#c0392b',

    statusAvailable: '#188a5f',
    statusReserved: '#4c9a82',
    statusInTrip: '#0f6b4f',
    statusLowBattery: '#b7791f',
    statusMaintenance: '#5c6f66',
    statusTransport: '#5b6bd6',
    statusOffline: '#a9b8b1',
    statusStolen: '#c0392b',

    zoneOperating: 'rgba(15,107,79,0.06)',
    zoneParking: 'rgba(24,138,95,0.18)',
    zoneNoParking: 'rgba(192,57,43,0.20)',
    zoneNoGo: 'rgba(11,26,20,0.30)',
    zoneBonus: 'rgba(63,191,143,0.25)',
    zonePaidParking: 'rgba(183,121,31,0.20)',
    zoneSpeedLimit: 'rgba(183,121,31,0.12)',
  },

  darkColors: {
    bg: '#08120e',
    surface: '#0f1d17',
    surfaceAlt: '#16291f',
    border: '#25473a',
    text: '#eaf3ee',
    textMuted: '#9db3a8',
    primary: '#3fbf8f',
    primarySoft: '#16291f',
    onPrimary: '#06150f',
  },

  typography: { ...pennyBrand.typography, scale: 0.95 },
  shape: { radiusScale: 0.5, spaceScale: 1.05 },

  assets: { wordmark: null, mark: null, monogram: nordveiBuild.monogram, emoji: nordveiBuild.emoji },

  maps: {
    styleDay: 'mapbox://styles/mapbox/light-v11',
    styleNight: 'mapbox://styles/mapbox/navigation-night-v1',
  },

  support: {
    email: 'support@nordvei.no',
    phone: '+4721000000',
    url: 'https://nordvei.no/support',
    whatsapp: null,
  },

  legal: {
    legalName: 'Nordvei Mobilitet AS',
    address: 'Storgata 12, 0155 Oslo, Norway',
    vatId: 'NO 923 456 789 MVA',
    termsUrl: 'https://nordvei.no/vilkar',
    privacyUrl: 'https://nordvei.no/personvern',
  },

  features: {
    // Card-only, single-rider product.
    groupRides: false,
    packages: false,
    walletTopUp: false,
  },
});

/* ──────────────────────────────── registry ───────────────────────────────── */

export const BRANDS: Brand[] = [pennyBrand, meltemiBrand, nordveiBrand];

export const BRANDS_BY_ID: Record<string, Brand> = Object.fromEntries(
  BRANDS.map((b) => [b.id, b]),
);

export const DEFAULT_BRAND: Brand = BRANDS_BY_ID[DEFAULT_BRAND_ID] ?? pennyBrand;

/** Look up a brand by id. Unknown ids fall back to the platform default. */
export function brandById(id: string | null | undefined): Brand {
  const key = (id ?? '').trim().toLowerCase();
  return BRANDS_BY_ID[key] ?? DEFAULT_BRAND;
}

export { pennyBrand };
