// Penny design tokens — single source of truth for color, spacing, type.
// Pure data (no framework imports) so web (admin) and RN (rider/ops) share it.

export const palette = {
  // Penny sky-blue ramp, sampled from the logo (white "penn" + lime "y" on a
  // sky-blue field). It replaces an indigo ramp that predated the logo and
  // never matched it.
  blue50: '#eff8ff',
  blue100: '#daeeff',
  blue200: '#b8dffe',
  blue300: '#84cbfc',
  blue400: '#54b8fa',
  blue500: '#35aef7', // primary — the logo's field
  blue600: '#1f8fd6',
  blue700: '#1a71ab',
  blue800: '#1a5c88',
  blue900: '#1b4a6d',

  // The logo's lime "y". Brand mark and true accents only — deliberately NOT
  // the success colour, so a lime button never reads as "confirmed".
  lime500: '#5de617',
  lime600: '#4bc410',
  lime100: '#e8fbd9',

  // Indigo / violet: decorative background blobs only.
  indigo400: '#7b8ff5',
  indigo500: '#5f6fe0',
  violet400: '#a08cf0',

  green500: '#1faa59',
  green400: '#3fce7a',
  amber500: '#e8a317',
  red500: '#e04141',
  red400: '#f26d6d',

  ink900: '#0d1220',
  ink800: '#161d2e',
  ink700: '#232c42',
  ink600: '#38425c',
  ink500: '#5a6780',
  ink400: '#7b8699',
  ink300: '#b5bccb',
  ink200: '#d7dce6',
  ink100: '#eceff4',
  ink50: '#f6f8fb',
  white: '#ffffff',
  black: '#000000',
} as const;

// Semantic colors (light theme). Map/night theme overrides in-app.
export const colors = {
  primary: palette.blue500,
  primaryDark: palette.blue700,
  primarySoft: palette.blue50,
  onPrimary: palette.white,

  bg: palette.ink50,
  surface: palette.white,
  surfaceAlt: palette.ink100,
  border: palette.ink200,

  text: palette.ink900,
  textMuted: palette.ink400,
  textInverse: palette.white,

  success: palette.green500,
  warning: palette.amber500,
  danger: palette.red500,

  // vehicle status colors (ops/admin maps)
  statusAvailable: palette.green500,
  statusReserved: palette.blue400,
  statusInTrip: palette.blue600,
  statusLowBattery: palette.amber500,
  statusMaintenance: palette.ink400,
  statusTransport: '#8a5cf6',
  statusOffline: palette.ink300,
  statusStolen: palette.red500,

  // zone fills
  zoneOperating: 'rgba(47,91,224,0.06)',
  zoneParking: 'rgba(31,170,89,0.18)',
  zoneNoParking: 'rgba(224,65,65,0.20)',
  zoneNoGo: 'rgba(13,18,32,0.30)',
  zoneBonus: 'rgba(63,206,122,0.25)',
  zonePaidParking: 'rgba(232,163,23,0.20)',
  zoneSpeedLimit: 'rgba(232,163,23,0.12)',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const font = {
  family: {
    // system stacks — swap to a brand font at build time
    sans: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  size: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 18,
    xl: 22,
    xxl: 28,
    display: 36,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const shadow = {
  card: '0 1px 3px rgba(13,18,32,0.08), 0 1px 2px rgba(13,18,32,0.04)',
  pop: '0 8px 24px rgba(13,18,32,0.12)',
} as const;

export const vehicleStatusColor: Record<string, string> = {
  available: colors.statusAvailable,
  reserved: colors.statusReserved,
  in_trip: colors.statusInTrip,
  low_battery: colors.statusLowBattery,
  maintenance: colors.statusMaintenance,
  transport: colors.statusTransport,
  offline: colors.statusOffline,
  stolen: colors.statusStolen,
  decommissioned: palette.ink300,
};
