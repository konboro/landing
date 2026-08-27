// Which zones a rider is allowed to be shown, and in what shape.
//
// Everything here is pure so the live source, the mock source and the tests all
// apply exactly the same rule. Three things go wrong at this boundary and all
// three were live:
//
//  1. NO CITY FILTER — `zones` is a global table. Selecting `active=true` and
//     nothing else downloads every city's geometry to every rider, so a rider in
//     Thessaloniki was being handed polygons that belong to other cities.
//  2. NO VALIDITY WINDOW — `valid_from` / `valid_to` were selected by nobody and
//     filtered by nobody, so a zone scheduled for next month already applied and
//     an expired one applied forever. Null on either side means unbounded.
//  3. GEOMETRY TAKEN ON TRUST — PostGIS renders `geometry` as GeoJSON with an
//     extra `crs` member that is not in the usual Polygon shape, and a row can
//     legitimately hold a MultiPolygon or (for a half-drawn zone) nothing at
//     all. Passing that straight to a renderer is how a map goes blank.
//
// None of this is a geofence DECISION — Hard Rule #3 keeps those on the server.
// It only decides what the rider is shown and warned about.
import { ZoneKind } from '@penny/db-types';
import type { GeoPolygon } from '@penny/db-types';
import type { LngLat, MapZone } from './types';

/** Every `zone_kind` the database can hold. Renderers must cover all of them. */
export const ALL_ZONE_KINDS: readonly ZoneKind[] = Object.values(ZoneKind);

const KIND_SET: ReadonlySet<string> = new Set<string>(ALL_ZONE_KINDS);

/** Columns the app needs. `city_id` and the window are what the filters use. */
export const ZONE_COLUMNS = 'id,kind,name,geom,rules,city_id,valid_from,valid_to';

/** The raw row as PostgREST hands it over — every field possibly absent/null. */
export interface RawZoneRow {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  geom?: unknown;
  rules?: unknown;
  city_id?: unknown;
  valid_from?: unknown;
  valid_to?: unknown;
}

/**
 * Is this zone in force at `nowMs`?
 *
 * Applied client-side as well as in the query. The query filter is what keeps
 * the download small; this is what keeps a long-lived app session from acting
 * on a zone that expired while the map was open, and it is the only filter the
 * SQLite mirror in the ops app can rely on when it is offline.
 */
export function isZoneInForce(
  z: { valid_from?: string | null; valid_to?: string | null },
  nowMs: number = Date.now(),
): boolean {
  const from = z.valid_from ? Date.parse(z.valid_from) : NaN;
  const to = z.valid_to ? Date.parse(z.valid_to) : NaN;
  // An unparseable timestamp is treated as "no bound" rather than as a reason
  // to hide a zone: dropping a real no-go zone is the worse failure.
  if (!Number.isNaN(from) && nowMs < from) return false;
  if (!Number.isNaN(to) && nowMs > to) return false;
  return true;
}

/** A ring is usable only if it has enough real [lng,lat] pairs to close. */
function toRing(raw: unknown): LngLat[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const ring: LngLat[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
    ring.push([p[0], p[1]]);
  }
  return ring;
}

function toRings(raw: unknown): LngLat[][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rings: LngLat[][] = [];
  for (const r of raw) {
    const ring = toRing(r);
    if (!ring) return null;
    rings.push(ring);
  }
  return rings;
}

/**
 * PostGIS GeoJSON → the plain `{type,coordinates}` polygons a renderer accepts.
 *
 * Returns a LIST because a `geometry` column may hold a MultiPolygon, and an
 * island of a two-part zone is still part of that zone — rendering only the
 * first ring would silently shrink the service area. The `crs` member PostGIS
 * adds is dropped here rather than passed through: it is not part of the shape
 * anything downstream expects, so no consumer has to know about it.
 */
export function toPolygons(raw: unknown): GeoPolygon[] {
  if (!raw || typeof raw !== 'object') return [];
  const g = raw as { type?: unknown; coordinates?: unknown };
  if (g.type === 'Polygon') {
    const rings = toRings(g.coordinates);
    return rings ? [{ type: 'Polygon', coordinates: rings }] : [];
  }
  if (g.type === 'MultiPolygon') {
    if (!Array.isArray(g.coordinates)) return [];
    const out: GeoPolygon[] = [];
    for (const part of g.coordinates) {
      const rings = toRings(part);
      if (rings) out.push({ type: 'Polygon', coordinates: rings });
    }
    return out;
  }
  return [];
}

/** Unknown kinds survive as-is so a kind added server-side still draws (the
 *  renderers give it a neutral style) instead of vanishing from the map. */
function toKind(raw: unknown): ZoneKind {
  return typeof raw === 'string' && KIND_SET.has(raw) ? (raw as ZoneKind) : (raw as ZoneKind);
}

/**
 * Rows → the zones the app renders and evaluates.
 *
 * `cityId` is belt-and-braces on top of the query filter, so a source that
 * forgets the `.eq('city_id', …)` still cannot leak another city's geometry
 * into the map. Rows with no usable polygon are dropped, not defaulted.
 */
export function normalizeZoneRows(
  rows: RawZoneRow[],
  opts: { cityId?: string | null; nowMs?: number } = {},
): MapZone[] {
  const nowMs = opts.nowMs ?? Date.now();
  const out: MapZone[] = [];
  for (const r of rows) {
    const id = typeof r.id === 'string' ? r.id : null;
    if (!id) continue;
    const cityId = typeof r.city_id === 'string' ? r.city_id : null;
    if (opts.cityId && cityId && cityId !== opts.cityId) continue;
    const valid_from = typeof r.valid_from === 'string' ? r.valid_from : null;
    const valid_to = typeof r.valid_to === 'string' ? r.valid_to : null;
    if (!isZoneInForce({ valid_from, valid_to }, nowMs)) continue;

    const polygons = toPolygons(r.geom);
    const rules =
      r.rules && typeof r.rules === 'object' ? (r.rules as Record<string, unknown>) : {};
    polygons.forEach((geom, i) => {
      out.push({
        // A MultiPolygon becomes several features; the suffix keeps React keys
        // and Mapbox feature ids unique without inventing a new zone id.
        id: polygons.length > 1 ? `${id}#${i}` : id,
        kind: toKind(r.kind),
        name: typeof r.name === 'string' ? r.name : null,
        geom,
        rules,
      });
    });
  }
  return out;
}
