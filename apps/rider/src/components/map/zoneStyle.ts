// One description of how a zone looks, used by the native map, the fallback map
// and the legend — so the three cannot disagree about what a colour means.
//
// Two things were wrong before this existed:
//
//  * COVERAGE. `zone_kind` has ten values. The native map styled eight and
//    returned the literal `'transparent'` for the rest, so a charging station or
//    a rebalancing zone was fetched, counted, and then drawn as nothing. The
//    fallback map styled the same eight and defaulted the rest to the PARKING
//    colour, which is worse than invisible: a rebalancing zone looked like a
//    green "park here". Both now go through `zoneStyle`, which has an explicit,
//    visibly neutral fallback and a `known` flag so the legend can say so.
//
//  * Z-ORDER. Everything was drawn in one layer in whatever order the server
//    returned, so a no-go area could be painted UNDER the city-wide operating
//    polygon and disappear. `ZONE_RANK` fixes the stacking: the wider and more
//    permissive a zone is, the lower it sits; restrictions are always on top.
import type { ZoneKind } from '@penny/db-types';
// Imported from the module, not the `brand` barrel: the barrel pulls in
// BrandProvider (and therefore React Native), which keeps this file from being
// exercised outside a device.
import { withAlpha, type RiderTheme } from '../../brand/deriveTheme';

export interface ZoneStyle {
  /** Interior wash. May be fully transparent for the city-wide outline. */
  fill: string;
  /** Boundary — always opaque enough to see on both map styles. */
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  /** Higher draws on top. */
  rank: number;
  label: string;
  /** False when the kind is not one this build knows — shown, but flagged. */
  known: boolean;
}

/**
 * Painting order, lowest first. A rider needs to see a restriction even when it
 * sits inside three permissive zones, so restrictions rank highest.
 */
const ZONE_RANK: Record<ZoneKind, number> = {
  operating: 0,
  speed_limit: 1,
  rebalancing: 2,
  bonus: 3,
  paid_parking: 4,
  parking: 5,
  parking_station: 6,
  charging_station: 7,
  no_parking: 8,
  no_go: 9,
};

/** Fallback rank for a kind added server-side after this build shipped: above
 *  the permissive zones, below the two that mean "do not". */
const UNKNOWN_RANK = 7.5;

export function zoneStyle(theme: RiderTheme, kind: string): ZoneStyle {
  const c = theme.color;
  switch (kind) {
    case 'operating':
      // Outline only. A wash over the whole service area dims the entire map
      // and tells the rider nothing they cannot see from the boundary.
      return { fill: 'transparent', stroke: c.primary, strokeWidth: 2, dashed: true, rank: ZONE_RANK.operating, label: 'Service area', known: true };
    case 'parking':
      return { fill: c.zoneParking, stroke: c.success, strokeWidth: 1.5, dashed: false, rank: ZONE_RANK.parking, label: 'Parking', known: true };
    case 'parking_station':
      return { fill: c.zoneParking, stroke: c.success, strokeWidth: 2, dashed: false, rank: ZONE_RANK.parking_station, label: 'Station', known: true };
    case 'charging_station':
      // Had no colour at all: invisible on the native map, green (= "parking")
      // on the fallback. Given its own tint next to parking, since it IS a
      // legal place to leave a scooter — just a different one.
      return { fill: withAlpha(c.primary, 0.18), stroke: c.primary, strokeWidth: 2, dashed: false, rank: ZONE_RANK.charging_station, label: 'Charging', known: true };
    case 'no_parking':
      return { fill: c.zoneNoParking, stroke: c.danger, strokeWidth: 2, dashed: false, rank: ZONE_RANK.no_parking, label: 'No parking', known: true };
    case 'no_go':
      return { fill: c.zoneNoGo, stroke: c.danger, strokeWidth: 2.5, dashed: false, rank: ZONE_RANK.no_go, label: 'No riding', known: true };
    case 'bonus':
      return { fill: c.zoneBonus, stroke: c.success, strokeWidth: 1.5, dashed: false, rank: ZONE_RANK.bonus, label: 'Bonus', known: true };
    case 'paid_parking':
      return { fill: c.zonePaidParking, stroke: c.warning, strokeWidth: 1.5, dashed: false, rank: ZONE_RANK.paid_parking, label: 'Paid parking', known: true };
    case 'speed_limit':
      return { fill: c.zoneSpeedLimit, stroke: c.warning, strokeWidth: 1.5, dashed: true, rank: ZONE_RANK.speed_limit, label: 'Slow zone', known: true };
    case 'rebalancing':
      // An operations concept, not a rider instruction — drawn faintly and
      // outlined, so it reads as context rather than as a rule.
      return { fill: withAlpha(c.textMuted, 0.1), stroke: c.textMuted, strokeWidth: 1.5, dashed: true, rank: ZONE_RANK.rebalancing, label: 'Rebalancing', known: true };
    default:
      // Neutral and clearly visible. Never `'transparent'` (silently gone) and
      // never a colour that already means something else.
      return { fill: withAlpha(c.textMuted, 0.14), stroke: c.textMuted, strokeWidth: 1.5, dashed: true, rank: UNKNOWN_RANK, label: prettyKind(kind), known: false };
  }
}

/** `paid_parking` → `Paid parking`, for a kind this build has never heard of. */
function prettyKind(kind: string): string {
  const s = kind.replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Zone';
}

/** Sort a copy of `zones` bottom-to-top so restrictions end up drawn last. */
export function sortForDrawing<T extends { kind: string }>(theme: RiderTheme, zones: T[]): T[] {
  return [...zones].sort((a, b) => zoneStyle(theme, a.kind).rank - zoneStyle(theme, b.kind).rank);
}

export interface ZoneLegendItem {
  kind: string;
  label: string;
  fill: string;
  stroke: string;
  dashed: boolean;
  count: number;
}

/**
 * Legend entries for the kinds ACTUALLY on the map, most restrictive first.
 * Derived from the zones rather than hard-coded, so it can never advertise a
 * colour the rider is not being shown (or omit one they are).
 */
export function zoneLegend(theme: RiderTheme, zones: { kind: string }[]): ZoneLegendItem[] {
  const byKind = new Map<string, ZoneLegendItem>();
  for (const z of zones) {
    const existing = byKind.get(z.kind);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const s = zoneStyle(theme, z.kind);
    byKind.set(z.kind, {
      kind: z.kind,
      label: s.label,
      // A transparent fill would render as an empty swatch, so the legend shows
      // the boundary colour washed in — what the rider looks for on the map.
      fill: s.fill === 'transparent' ? withAlpha(s.stroke, 0.18) : s.fill,
      stroke: s.stroke,
      dashed: s.dashed,
      count: 1,
    });
  }
  return [...byKind.values()].sort(
    (a, b) => zoneStyle(theme, b.kind).rank - zoneStyle(theme, a.kind).rank,
  );
}
