// Brand → theme derivation for the Ops app.
//
// The returned object carries EXACTLY the pieces `src/lib/theme.ts` always
// exported (`c`, `palette`, `space`, `radius`, `font`, `tap`, `statusColor`,
// `colorForStatus`, the status legend), so migrating a screen is:
//
//   -import { c, space, radius, font } from '../lib/theme';
//   +const { c, space, radius, font } = useTheme();
//
// Pure data + pure functions: no React, no native imports. `lib/theme.ts` calls
// it once for the static default; `BrandProvider` calls it per brand+mode.
import { palette, space as baseSpace, radius as baseRadius, font as baseFont } from '@penny/ui';
import {
  resolveColors,
  scaledFontSize,
  scaledRadius,
  scaledSpace,
  readableOn,
  statusColor as brandStatusColor,
  type Brand,
  type BrandColors,
  type ThemeMode,
} from '@penny/ui';
import type { VehicleStatus } from '@penny/db-types';

/** `#rrggbb` → `rgba(r,g,b,a)`; non-hex input passes through untouched. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color.trim());
  if (!m) return color;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})`;
}

export interface OpsColors extends BrandColors {
  /** Dimmer than textMuted — timestamps, ids, secondary metadata. */
  textFaint: string;
  /** Deep primary used for filled chips/pills on the dark chrome. */
  primaryDeep: string;
  /**
   * Auto-picked black/white ink for text drawn on a filled semantic chip.
   * A client can pick any amber/green/red; `readableOn` keeps the label legible.
   */
  onWarning: string;
  onSuccess: string;
  onDanger: string;
}

export interface SpaceScale {
  xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; xxxl: number;
}
export interface RadiusScale {
  sm: number; md: number; lg: number; xl: number; pill: number;
}
export interface FontSizes {
  xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; display: number;
}

export interface LegendItem {
  status: string;
  label: string;
  color: string;
}

/** Glove-friendly hit targets. Ergonomics, not branding — never scaled. */
export const tap = { min: 52, row: 64, fab: 64 } as const;

const LEGEND_LABELS: [string, string][] = [
  ['available', 'Available'],
  ['in_trip', 'In trip'],
  ['reserved', 'Reserved'],
  ['low_battery', 'Low battery'],
  ['maintenance', 'Maintenance'],
  ['transport', 'Transport'],
  ['offline', 'Offline'],
  ['stolen', 'Stolen-suspect'],
  ['decommissioned', 'Decommissioned'],
];

export interface OpsTheme {
  brand: Brand;
  mode: ThemeMode;
  palette: typeof palette;
  c: OpsColors;
  space: SpaceScale;
  radius: RadiusScale;
  font: {
    family: { sans: string; mono: string };
    size: FontSizes;
    weight: typeof baseFont.weight;
  };
  tap: typeof tap;
  /** status → colour map for this brand + mode. */
  statusColor: Record<string, string>;
  colorForStatus: (status: VehicleStatus | string) => string;
  legend: LegendItem[];
  /** Mapbox style URLs (only used when native Mapbox is active). */
  map: { day: string; night: string };
}

export function deriveTheme(brand: Brand, mode: ThemeMode = 'dark'): OpsTheme {
  const base = resolveColors(brand, mode);

  const c: OpsColors = {
    ...base,
    textFaint: withAlpha(base.textMuted, 0.7),
    primaryDeep: base.primaryDark,
    onWarning: readableOn(base.warning),
    onSuccess: readableOn(base.success),
    onDanger: readableOn(base.danger),
  };

  const space: SpaceScale = {
    xs: scaledSpace(brand, baseSpace.xs),
    sm: scaledSpace(brand, baseSpace.sm),
    md: scaledSpace(brand, baseSpace.md),
    lg: scaledSpace(brand, baseSpace.lg),
    xl: scaledSpace(brand, baseSpace.xl),
    xxl: scaledSpace(brand, baseSpace.xxl),
    xxxl: scaledSpace(brand, baseSpace.xxxl),
  };

  const radius: RadiusScale = {
    sm: scaledRadius(brand, baseRadius.sm),
    md: scaledRadius(brand, baseRadius.md),
    lg: scaledRadius(brand, baseRadius.lg),
    xl: scaledRadius(brand, baseRadius.xl),
    // A pill is a pill at any radius scale.
    pill: baseRadius.pill,
  };

  const font = {
    family: { sans: brand.typography.sans, mono: brand.typography.mono },
    size: {
      xs: scaledFontSize(brand, baseFont.size.xs),
      sm: scaledFontSize(brand, baseFont.size.sm),
      md: scaledFontSize(brand, baseFont.size.md),
      lg: scaledFontSize(brand, baseFont.size.lg),
      xl: scaledFontSize(brand, baseFont.size.xl),
      xxl: scaledFontSize(brand, baseFont.size.xxl),
      display: scaledFontSize(brand, baseFont.size.display),
    },
    weight: baseFont.weight,
  };

  const statusColor: Record<string, string> = {};
  for (const [status] of LEGEND_LABELS) statusColor[status] = brandStatusColor(brand, status, mode);

  const colorForStatus = (status: VehicleStatus | string): string =>
    statusColor[status] ?? brandStatusColor(brand, String(status), mode);

  const legend: LegendItem[] = LEGEND_LABELS.map(([status, label]) => ({
    status,
    label,
    color: statusColor[status]!,
  }));

  return {
    brand,
    mode,
    palette,
    c,
    space,
    radius,
    font,
    tap,
    statusColor,
    colorForStatus,
    legend,
    map: { day: brand.maps.styleDay, night: brand.maps.styleNight },
  };
}
