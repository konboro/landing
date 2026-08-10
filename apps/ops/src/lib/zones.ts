// Zone rules that must hold in BOTH directions of the offline-first flow: when
// a snapshot is mapped off the wire, and again every time the SQLite mirror is
// read. Kept here rather than in `services/supabaseMappers` so the offline layer
// does not have to reach into the backend adapter for a rule it enforces itself.
import type { ISOTimestamp } from '@penny/db-types';

export interface ZoneWindow {
  valid_from?: ISOTimestamp | null;
  valid_to?: ISOTimestamp | null;
}

/**
 * Is a zone in force at `nowMs`? Null on either side means unbounded.
 *
 * `valid_from` / `valid_to` were selected by nobody and filtered by nobody, so
 * a zone scheduled for next month already applied and an expired one applied
 * forever. This is checked on every mirror read, not just at sync time: a crew
 * can be offline for a whole shift, and a zone that expires at noon has to stop
 * being drawn at noon.
 *
 * An unparseable timestamp counts as "no bound" — wrongly hiding a live no-go
 * zone is the worse failure of the two.
 */
export function isZoneInForce(z: ZoneWindow, nowMs: number = Date.now()): boolean {
  const from = z.valid_from ? Date.parse(z.valid_from) : NaN;
  const to = z.valid_to ? Date.parse(z.valid_to) : NaN;
  if (!Number.isNaN(from) && nowMs < from) return false;
  if (!Number.isNaN(to) && nowMs > to) return false;
  return true;
}

// --- What a zone MEANS in the field ----------------------------------------
//
// Ten `zone_kind` values collapse into four things a crew acts on. This lived
// privately inside the Place screen, so the main fleet map — the one an operator
// actually works from — knew nothing about it and painted every zone the same
// flat blue: a no-go area and an approved parking bay were indistinguishable.
export type ZoneLayerKey = 'operating' | 'parking' | 'nogo' | 'rebalance';

const KIND_TO_LAYER: Record<string, ZoneLayerKey> = {
  operating: 'operating',
  speed_limit: 'operating',
  parking: 'parking',
  paid_parking: 'parking',
  parking_station: 'parking',
  charging_station: 'parking',
  bonus: 'parking',
  no_go: 'nogo',
  no_parking: 'nogo',
  rebalancing: 'rebalance',
};

/** Draw order, lowest first — a no-go inside an operating zone must be on top. */
export const ZONE_LAYER_ORDER: readonly ZoneLayerKey[] = ['operating', 'rebalance', 'parking', 'nogo'];

/**
 * A zone's field meaning. Unknown or absent kinds fall to `rebalance`: the
 * local mock generates rebalancing zones without a `kind` at all, and a
 * neutral bucket is better than pretending a new kind is a restriction.
 */
export function zoneLayerOf(z: { kind?: string }): ZoneLayerKey {
  return (z.kind ? KIND_TO_LAYER[z.kind] : undefined) ?? 'rebalance';
}

/** Sort a copy bottom-to-top so restrictions are painted last. */
export function sortZonesForDrawing<T extends { kind?: string }>(zones: T[]): T[] {
  return [...zones].sort(
    (a, b) => ZONE_LAYER_ORDER.indexOf(zoneLayerOf(a)) - ZONE_LAYER_ORDER.indexOf(zoneLayerOf(b)),
  );
}
