// Brand → theme derivation for the rider app.
//
// The returned object has EXACTLY the shape `src/lib/theme.ts` always had
// (`palette`, `color`, `space`, `radius`, `font`, `shadow`), so migrating a
// screen from the static `theme` import to the `useTheme()` hook is a one-line
// change, not a rewrite. Colours come from `resolveColors()`; spacing, radii and
// type sizes are scaled by the brand's `shape` / `typography` multipliers.
//
// Pure data + pure functions: no React, no native imports. `lib/theme.ts` calls
// it once at module scope for the static default; `BrandProvider` calls it
// again whenever the brand or theme mode changes.
import { palette, space as baseSpace, radius as baseRadius, font as baseFont } from '@penny/ui/tokens';
import {
  resolveColors,
  scaledFontSize,
  scaledRadius,
  scaledSpace,
  statusColor as brandStatusColor,
  type Brand,
  type BrandColors,
  type ThemeMode,
} from '@penny/ui';

/* ───────────────────────────── colour helpers ────────────────────────────── */

/**
 * `#rrggbb` → `rgba(r,g,b,alpha)`. Used for the soft tint surfaces the app
 * derives from the brand's semantic colours (success/warning/danger banners).
 * Non-hex input (a brand may supply an rgba() already) is passed through.
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color.trim());
  if (!m) return color;
  const r = parseInt(m[1]!, 16);
  const g = parseInt(m[2]!, 16);
  const b = parseInt(m[3]!, 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ───────────────────────────────── shape ─────────────────────────────────── */

export interface RiderThemeColors extends BrandColors {
  /** Modal/sheet backdrop. */
  scrim: string;
  /** Barely-there wash over the map + pressed rows. */
  overlay: string;
  successSoft: string;
  warningSoft: string;
  dangerSoft: string;
  /** Inactive tab-bar tint. */
  tabInactive: string;
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

export interface RiderTheme {
  /** The brand this theme was derived from. */
  brand: Brand;
  mode: ThemeMode;
  /** Raw ramp — kept for the handful of non-brandable chrome surfaces (camera, scanner). */
  palette: typeof palette;
  color: RiderThemeColors;
  space: SpaceScale;
  radius: RadiusScale;
  font: {
    family: { sans: string; mono: string };
    size: FontSizes;
    weight: typeof baseFont.weight;
  };
  shadow: {
    card: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
    pop: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
  /** Mapbox style URLs for this brand (only used when native Mapbox is active). */
  map: { day: string; night: string };
  /** Vehicle status → colour, already bound to this brand + mode. */
  statusColor: (status: string) => string;
}

/* ─────────────────────────────── derivation ──────────────────────────────── */

export function deriveTheme(brand: Brand, mode: ThemeMode = 'light'): RiderTheme {
  const c = resolveColors(brand, mode);

  const color: RiderThemeColors = {
    ...c,
    scrim: withAlpha(mode === 'dark' ? '#000000' : palette.ink900, 0.45),
    overlay: withAlpha(c.text, 0.06),
    successSoft: withAlpha(c.success, 0.12),
    warningSoft: withAlpha(c.warning, 0.14),
    dangerSoft: withAlpha(c.danger, 0.12),
    tabInactive: c.textMuted,
  };

  const space = {
    xs: scaledSpace(brand, baseSpace.xs),
    sm: scaledSpace(brand, baseSpace.sm),
    md: scaledSpace(brand, baseSpace.md),
    lg: scaledSpace(brand, baseSpace.lg),
    xl: scaledSpace(brand, baseSpace.xl),
    xxl: scaledSpace(brand, baseSpace.xxl),
    xxxl: scaledSpace(brand, baseSpace.xxxl),
  };

  const radius = {
    sm: scaledRadius(brand, baseRadius.sm),
    md: scaledRadius(brand, baseRadius.md),
    lg: scaledRadius(brand, baseRadius.lg),
    xl: scaledRadius(brand, baseRadius.xl),
    // A pill is a pill at any radius scale — never scale it, or buttons square off.
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

  const shadowColor = mode === 'dark' ? '#000000' : palette.ink900;

  return {
    brand,
    mode,
    palette,
    color,
    space,
    radius,
    font,
    shadow: {
      card: {
        shadowColor,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: mode === 'dark' ? 0.4 : 0.1,
        shadowRadius: 3,
        elevation: 2,
      },
      pop: {
        shadowColor,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: mode === 'dark' ? 0.5 : 0.16,
        shadowRadius: 20,
        elevation: 10,
      },
    },
    map: { day: brand.maps.styleDay, night: brand.maps.styleNight },
    statusColor: (status: string) => brandStatusColor(brand, status, mode),
  };
}
