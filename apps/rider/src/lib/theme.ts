// Rider app theme — built on the shared @penny/ui design tokens.
// Light theme is the product default (per docs/06). We add a `map` sub-theme
// for day/night map styling and a handful of RN-specific derived values.
import { palette, colors as base, space, radius, font } from '@penny/ui/tokens';

export const theme = {
  palette,
  color: {
    ...base,
    // RN-specific additions / clarifications
    scrim: 'rgba(13,18,32,0.45)',
    overlay: 'rgba(13,18,32,0.06)',
    successSoft: 'rgba(31,170,89,0.12)',
    warningSoft: 'rgba(232,163,23,0.14)',
    dangerSoft: 'rgba(224,65,65,0.12)',
    primarySoft: base.primarySoft,
    tabInactive: palette.ink400,
  },
  space,
  radius,
  font,
  // Native shadow presets (iOS shadow* + Android elevation).
  shadow: {
    card: {
      shadowColor: '#0d1220',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 3,
      elevation: 2,
    },
    pop: {
      shadowColor: '#0d1220',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 20,
      elevation: 10,
    },
  },
} as const;

export type Theme = typeof theme;

// Mapbox style URLs (day/night). Used only when native Mapbox is active.
export const mapStyles = {
  day: 'mapbox://styles/mapbox/light-v11',
  night: 'mapbox://styles/mapbox/navigation-night-v1',
} as const;

export const MIN_TOUCH = 44; // accessibility — minimum tap target (pt)
