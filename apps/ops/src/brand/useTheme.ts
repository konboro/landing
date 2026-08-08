// The hook every ops screen uses.
//
//   -import { c, space, radius, font } from '../lib/theme';
//   +import { useTheme } from '../brand';
//   …
//   +const { c, space, radius, font } = useTheme();
//
// Same names, same shapes — migrating a screen is an import change.
import { useBrand } from './BrandProvider';
import type { OpsTheme } from './deriveTheme';

export function useTheme(): OpsTheme {
  return useBrand().theme;
}

/** `isEnabled('opsDeployMode')` — hide a whole ops surface for this operator. */
export function useFeature(feature: string): boolean {
  return useBrand().isEnabled(feature);
}

export type { OpsTheme };
