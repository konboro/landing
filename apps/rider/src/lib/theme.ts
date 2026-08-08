// Rider app theme — the STATIC DEFAULT.
//
// This is now derived from `pennyBrand` (packages/ui/src/brand.ts) rather than
// duplicating literals: one source of truth for the shipped brand.
//
// Use this only where a React hook isn't available (module-scope constants,
// non-component helpers). Anything that renders should call `useTheme()` from
// `src/brand` so it re-themes when the brand or light/dark mode changes.
import { pennyBrand } from '@penny/ui';
import { deriveTheme, type RiderTheme } from '../brand/deriveTheme';

export const theme: RiderTheme = deriveTheme(pennyBrand, 'light');

export type Theme = RiderTheme;

/**
 * Mapbox style URLs for the default brand. Brand-aware screens should read
 * `useTheme().map` instead — this stays for non-component call sites.
 */
export const mapStyles = {
  day: pennyBrand.maps.styleDay,
  night: pennyBrand.maps.styleNight,
} as const;

export const MIN_TOUCH = 44; // accessibility — minimum tap target (pt)
