// Client-side geometry helpers. UX ONLY — geofence decisions are
// server-authoritative (see docs Hard Rule #3). Never bill or block based on these.

export type LngLat = [number, number];
export interface Polygon {
  type: 'Polygon';
  coordinates: LngLat[][];
}
export interface Point {
  type: 'Point';
  coordinates: LngLat;
}

const R = 6371000; // earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two [lng,lat] points. */
export function haversine(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Ray-casting point-in-polygon over a single ring (ignores holes). */
export function pointInRing(pt: LngLat, ring: LngLat[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    const xi = pi[0];
    const yi = pi[1];
    const xj = pj[0];
    const yj = pj[1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon with hole support: inside outer ring, not inside any hole. */
export function pointInPolygon(pt: LngLat, polygon: Polygon): boolean {
  const rings = polygon.coordinates;
  if (rings.length === 0) return false;
  const outer = rings[0]!;
  if (!pointInRing(pt, outer)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(pt, rings[i]!)) return false;
  }
  return true;
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function bboxContains(bbox: BBox, pt: LngLat): boolean {
  const [lng, lat] = pt;
  return (
    lng >= bbox.minLng &&
    lng <= bbox.maxLng &&
    lat >= bbox.minLat &&
    lat <= bbox.maxLat
  );
}

export function polygonBBox(polygon: Polygon): BBox {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const ring of polygon.coordinates) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

/** Snap a point to a grid of `cellMeters` — used for heatmap aggregation preview. */
export function snapToGrid(pt: LngLat, cellMeters: number): LngLat {
  const [lng, lat] = pt;
  const latCell = cellMeters / 111_320;
  const lngCell = cellMeters / (111_320 * Math.cos(toRad(lat)) || 1);
  return [Math.round(lng / lngCell) * lngCell, Math.round(lat / latCell) * latCell];
}

/**
 * Estimate remaining range in metres from state-of-charge %.
 * Rough model: full-charge range * soc fraction. Config per model in prod.
 */
export function estimateRangeM(socPct: number, fullRangeM = 30_000): number {
  return Math.max(0, Math.round((socPct / 100) * fullRangeM));
}

/** Total length of a path (metres). */
export function pathLength(points: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1]!, points[i]!);
  }
  return total;
}

export interface ZoneLike {
  kind: string;
  geom: Polygon;
  rules?: Record<string, unknown>;
}

export interface ZoneEvaluation {
  inOperating: boolean;
  inNoGo: boolean;
  inNoParking: boolean;
  inParking: boolean;
  inParkingStation: boolean;
  bonusCents: number;
  paidParkingFeeCents: number;
  speedLimitKmh: number | null;
  matched: ZoneLike[];
}

/** Evaluate a position against a set of zones. UX-only mirror of the server engine. */
export function evaluateZones(pt: LngLat, zones: ZoneLike[]): ZoneEvaluation {
  const ev: ZoneEvaluation = {
    inOperating: false,
    inNoGo: false,
    inNoParking: false,
    inParking: false,
    inParkingStation: false,
    bonusCents: 0,
    paidParkingFeeCents: 0,
    speedLimitKmh: null,
    matched: [],
  };
  for (const z of zones) {
    if (!pointInPolygon(pt, z.geom)) continue;
    ev.matched.push(z);
    switch (z.kind) {
      case 'operating':
        ev.inOperating = true;
        break;
      case 'no_go':
        ev.inNoGo = true;
        break;
      case 'no_parking':
        ev.inNoParking = true;
        break;
      case 'parking':
        ev.inParking = true;
        break;
      case 'parking_station':
        ev.inParkingStation = true;
        break;
      case 'bonus':
        ev.bonusCents = Math.max(ev.bonusCents, Number(z.rules?.bonus_cents ?? 0));
        break;
      case 'paid_parking':
        ev.paidParkingFeeCents = Math.max(
          ev.paidParkingFeeCents,
          Number(z.rules?.fee_cents ?? 0),
        );
        break;
      case 'speed_limit': {
        const l = Number(z.rules?.limit_kmh ?? 0);
        if (l > 0) ev.speedLimitKmh = ev.speedLimitKmh === null ? l : Math.min(ev.speedLimitKmh, l);
        break;
      }
    }
  }
  return ev;
}

/** Can a trip legally end here (UX pre-check; server re-validates). */
export function canEndHere(ev: ZoneEvaluation, stationModeCity = false): { ok: boolean; reason?: string } {
  if (!ev.inOperating) return { ok: false, reason: 'outside_operating_zone' };
  if (ev.inNoParking) return { ok: false, reason: 'no_parking_zone' };
  if (stationModeCity && !ev.inParkingStation)
    return { ok: false, reason: 'must_park_in_station' };
  return { ok: true };
}
