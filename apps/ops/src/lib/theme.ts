// Ops theme — the STATIC DEFAULT.
//
// Utilitarian, high-contrast, glove-friendly. Now derived from `pennyBrand`
// (packages/ui/src/brand.ts) in dark mode rather than duplicating literals, so
// there is a single source of truth for the shipped brand.
//
// Use this only where a React hook isn't available (module-scope constants,
// non-component helpers). Anything that renders should destructure
// `useTheme()` from `src/brand` so it re-themes when brand or mode changes.
import { palette } from '@penny/ui';
import type { VehicleStatus } from '@penny/db-types';
import { deriveTheme, tap, type LegendItem, type OpsTheme } from '../brand/deriveTheme';
import { pennyOpsBrand } from '../brand/brands';

const defaultTheme: OpsTheme = deriveTheme(pennyOpsBrand, 'dark');

export { palette, tap };
export type { LegendItem, OpsTheme };

export const space = defaultTheme.space;
export const radius = defaultTheme.radius;
export const font = defaultTheme.font;

/** Dark, high-contrast ops chrome for the default brand. */
export const c = defaultTheme.c;

/** status → colour for the default brand. */
export const statusColor: Record<string, string> = defaultTheme.statusColor;

export function colorForStatus(status: VehicleStatus | string): string {
  return defaultTheme.colorForStatus(status);
}

export const STATUS_LEGEND: LegendItem[] = defaultTheme.legend;
