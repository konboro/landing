// The hook every screen uses.
//
//   -import { theme } from '../../lib/theme';
//   +import { useTheme } from '../../brand';
//   …
//   +const theme = useTheme();
//
// `useTheme()` returns the same shape the static `theme` always had, so the rest
// of a screen keeps working unchanged. Module-scope `StyleSheet.create` blocks
// become `makeStyles((t) => …)` + `useStyles(theme)`.
import { useBrand } from './BrandProvider';
import type { RiderTheme } from './deriveTheme';

/** Fully derived, brand- and mode-aware theme. */
export function useTheme(): RiderTheme {
  return useBrand().theme;
}

/** `isEnabled('reservations')` — hide a whole product surface for this operator. */
export function useFeature(feature: string): boolean {
  return useBrand().isEnabled(feature);
}

export type { RiderTheme };
