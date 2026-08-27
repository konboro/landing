// Geometry helpers for the zone editor.
//
// AUTHORING AID ONLY. Hard rule #3: geofence decisions are server-side
// authoritative. Nothing here may gate a trip — it exists so an operator can
// see what they drew (how many pins, how big, whether the outline crosses
// itself) before they commit a version. Every check below produces a message,
// never a silent correction of the operator's geometry.
//
// Point-in-polygon comes from @penny/geo so this file and the server-mirroring
// point-check simulator agree.
import { haversine, pointInPolygon } from '@penny/geo';
import type { LngLat, Zone } from '@penny/db-types';

export type Ring = LngLat[];

const EARTH_R = 6378137; // metres, WGS84 equatorial
const rad = (d: number) => (d * Math.PI) / 180;
/** Coordinates closer than this are the same pin (~1 cm at the equator). */
const EPS = 1e-9;

function samePoint(a: LngLat, b: LngLat): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
}

/**
 * Polygon rings, or null when the row carries no usable polygon.
 * Tolerates the `crs`-bearing shape PostGIS/PostgREST returns and MultiPolygon
 * (first part only) so a hand-imported GeoJSON does not blank the map.
 */
export function zoneRings(geom: unknown): Ring[] | null {
  const g = geom as { type?: string; coordinates?: unknown } | null | undefined;
  if (!g || !Array.isArray(g.coordinates)) return null;
  const c = g.coordinates as unknown[];
  if (c.length === 0) return null;
  if (g.type === 'MultiPolygon') {
    const first = c[0];
    return Array.isArray(first) && Array.isArray(first[0]) ? (first as Ring[]) : null;
  }
  return Array.isArray(c[0]) && Array.isArray((c[0] as unknown[])[0]) ? (c as Ring[]) : null;
}

/** Ring without the repeated closing coordinate — one entry per placed pin. */
export function openRing(ring: Ring): Ring {
  if (ring.length > 1 && samePoint(ring[0]!, ring[ring.length - 1]!)) return ring.slice(0, -1);
  return ring.slice();
}

/** Ring with the first coordinate repeated last, as GeoJSON requires. */
export function closeRing(ring: Ring): Ring {
  const open = openRing(ring);
  return open.length ? [...open, open[0]!] : open;
}

/** Pins the operator actually placed: closing point and exact duplicates dropped. */
export function distinctVertexCount(rings: Ring[] | null): number {
  const outer = rings?.[0];
  if (!outer) return 0;
  const seen = new Set<string>();
  for (const p of openRing(outer)) seen.add(`${p[0].toFixed(9)},${p[1].toFixed(9)}`);
  return seen.size;
}

/** Pins on the outer ring, duplicates included — what the map shows as handles. */
export function vertexCount(rings: Ring[] | null): number {
  const outer = rings?.[0];
  return outer ? openRing(outer).length : 0;
}

/** Spherical-excess ring area in m². Sign-independent (winding order is free). */
function ringAreaM2(ring: Ring): number {
  const c = closeRing(ring);
  if (c.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const lower = c[i === 0 ? c.length - 2 : i - 1]!;
    const middle = c[i]!;
    const upper = c[i + 1]!;
    total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]));
  }
  return Math.abs((total * EARTH_R * EARTH_R) / 2);
}

/** Polygon area in km²: outer ring minus any holes. */
export function polygonAreaKm2(rings: Ring[] | null): number {
  if (!rings || rings.length === 0) return 0;
  let m2 = ringAreaM2(rings[0]!);
  for (let i = 1; i < rings.length; i++) m2 -= ringAreaM2(rings[i]!);
  return Math.max(0, m2) / 1e6;
}

/** Human-readable area. Small zones read as m² — "0.001 km²" tells nobody anything. */
export function formatArea(km2: number): string {
  if (!(km2 > 0)) return '—';
  if (km2 < 0.001) return `${Math.round(km2 * 1e6).toLocaleString('en-GB')} m²`;
  if (km2 < 1) return `${km2.toFixed(3)} km²`;
  return `${km2.toFixed(2)} km²`;
}

/** Do segments p1→p2 and p3→p4 properly cross (shared endpoints don't count)? */
function segmentsCross(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d = (a: LngLat, b: LngLat, c: LngLat) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  // Proper crossing only. Touching/collinear cases are left alone: they are
  // usually a duplicated pin, and reporting those as "self-intersecting" would
  // cry wolf on geometry that renders exactly as the operator intended.
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Does the outline cross itself? A bow-tie renders as two lobes but PostGIS
 * reads "inside" differently than the operator sees it, so it is worth a
 * warning — never an automatic repair.
 */
export function selfIntersects(rings: Ring[] | null): boolean {
  const outer = rings?.[0];
  if (!outer) return false;
  const p = openRing(outer);
  const n = p.length;
  // O(n²); city outlines are tens of pins. Bail on imported monsters rather
  // than freezing the editor.
  if (n < 4 || n > 400) return false;
  for (let i = 0; i < n; i++) {
    const a1 = p[i]!;
    const a2 = p[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (j === (i + 1) % n || i === (j + 1) % n) continue; // adjacent: share an endpoint
      if (segmentsCross(a1, a2, p[j]!, p[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/** Average of the outer ring's pins. Good enough to frame or label a zone. */
export function ringCentroid(rings: Ring[] | null): LngLat | null {
  const outer = rings?.[0];
  if (!outer) return null;
  const open = openRing(outer);
  if (!open.length) return null;
  let lng = 0;
  let lat = 0;
  for (const p of open) {
    lng += p[0];
    lat += p[1];
  }
  return [lng / open.length, lat / open.length];
}

/** How far from its neighbours a zone may sit before it looks like a leftover. */
const OUTLIER_M = 60_000;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * The centre of gravity of a set of zones, as a median rather than a mean, so
 * one polygon a thousand kilometres away cannot drag it.
 * Null when there are too few zones for "away from the others" to mean anything.
 */
export function medianCentre(zones: Array<{ geom: unknown }>): LngLat | null {
  const centres = zones.map((z) => ringCentroid(zoneRings(z.geom))).filter((c): c is LngLat => c !== null);
  if (centres.length < 3) return null;
  return [median(centres.map((c) => c[0])), median(centres.map((c) => c[1]))];
}

/**
 * Zones close enough to the median centre to belong to the same city, as
 * polygon ring sets ready for the camera.
 *
 * This decides the *opening view* only. Every zone is still drawn, still in the
 * list, and "Fit" still frames all of them — that is how an operator finds the
 * outlier. Nothing here changes anyone's geometry.
 */
export function mainCluster<T extends { geom: unknown }>(zones: T[]): T[] {
  const centre = medianCentre(zones);
  if (!centre) return zones;
  const near = zones.filter((z) => {
    const c = ringCentroid(zoneRings(z.geom));
    return c ? haversine(centre, c) <= OUTLIER_M : false;
  });
  return near.length ? near : zones;
}

export interface ZoneIssue {
  level: 'error' | 'warning';
  text: string;
}

/** Above this a rectangle is almost certainly a stray pin, not a service area. */
const HUGE_KM2 = 400;

/**
 * Everything worth telling the operator about one zone.
 *
 * `error` blocks the save (the geometry cannot be stored meaningfully);
 * `warning` never blocks — an operator may well mean an odd shape, and this
 * panel is not the authority on what is valid (the server is).
 */
export function zoneIssues(zone: Zone, all: Zone[]): ZoneIssue[] {
  const out: ZoneIssue[] = [];
  const rings = zoneRings(zone.geom);
  if (!rings || !rings[0]?.length) {
    out.push({ level: 'error', text: 'No polygon — this zone has nothing to store.' });
    return out;
  }
  const distinct = distinctVertexCount(rings);
  if (distinct < 3) {
    out.push({ level: 'error', text: `Needs at least 3 distinct pins to enclose an area (has ${distinct}).` });
  }
  if (vertexCount(rings) > distinct) {
    out.push({ level: 'warning', text: 'Two pins sit on the same spot — drag one apart or remove it.' });
  }
  const crosses = selfIntersects(rings);
  if (crosses) {
    out.push({ level: 'warning', text: 'The outline crosses itself. The server may read the inside of this shape differently than it looks here.' });
  }
  const km2 = polygonAreaKm2(rings);
  // A crossed outline's lobes cancel each other out, so its area is not a
  // number worth reasoning about — the crossing warning above is the real one.
  if (!crosses) {
    if (km2 > HUGE_KM2) {
      out.push({ level: 'warning', text: `${formatArea(km2)} is very large for one zone — check for a pin dropped far from the rest.` });
    }
    if (km2 > 0 && km2 < 0.00002) {
      out.push({ level: 'warning', text: `Only ${formatArea(km2)} — riders will struggle to hit a zone this small.` });
    }
  }

  // Far from every other zone in the city. Usually a leftover test polygon, and
  // nothing else flags it: an outlier can be a perfectly valid operating zone,
  // it is just nowhere near the fleet.
  const centre = medianCentre(all);
  const own = ringCentroid(rings);
  if (centre && own) {
    const away = haversine(centre, own);
    if (away > OUTLIER_M) {
      out.push({ level: 'warning', text: `Sits ${Math.round(away / 1000)} km from the rest of this city's zones — is it a leftover?` });
    }
  }

  // A non-operating zone outside every operating zone is dead weight: the trip
  // engine only ever evaluates positions inside the service area.
  if (zone.kind !== 'operating') {
    const operating = all.filter((z) => z.kind === 'operating' && z.active && z.id !== zone.id);
    if (operating.length) {
      const centroid = ringCentroid(rings);
      const probes = [...openRing(rings[0]!), ...(centroid ? [centroid] : [])];
      const touches = probes.some((pt) =>
        operating.some((op) => {
          const opRings = zoneRings(op.geom);
          return opRings ? pointInPolygon(pt, { type: 'Polygon', coordinates: opRings }) : false;
        }),
      );
      if (!touches) {
        out.push({ level: 'warning', text: 'Lies outside every operating zone, so the trip engine will never evaluate it.' });
      }
    }
  }
  return out;
}

/** Convenience for the page: does this zone block a save? */
export function hasBlockingIssue(issues: ZoneIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
