// Hand-rolled validators (no npm dependency — Supabase edge runs Deno).
// Small, explicit, and throw the structured EdgeError on bad input.
import { EdgeError } from './responses.ts';

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    throw new Error('body must be an object');
  } catch (e) {
    throw new EdgeError('bad_request', `invalid JSON body: ${(e as Error).message}`, 400);
  }
}

export function str(o: Record<string, unknown>, key: string, required = true): string | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new EdgeError('bad_request', `missing field: ${key}`, 400);
    return undefined;
  }
  if (typeof v !== 'string') throw new EdgeError('bad_request', `field ${key} must be a string`, 400);
  return v;
}

export function num(o: Record<string, unknown>, key: string, required = true): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) throw new EdgeError('bad_request', `missing field: ${key}`, 400);
    return undefined;
  }
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new EdgeError('bad_request', `field ${key} must be a number`, 400);
  }
  return v;
}

export function bool(o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new EdgeError('bad_request', `field ${key} must be a boolean`, 400);
  return v;
}

export function strArray(o: Record<string, unknown>, key: string, required = false): string[] | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) throw new EdgeError('bad_request', `missing field: ${key}`, 400);
    return undefined;
  }
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new EdgeError('bad_request', `field ${key} must be a string[]`, 400);
  }
  return v as string[];
}

/** LngLat tuple = [lng, lat] (GeoJSON order), matches packages/db-types LngLat. */
export function lngLat(o: Record<string, unknown>, key: string): [number, number] {
  const v = o[key];
  if (
    !Array.isArray(v) || v.length !== 2 ||
    typeof v[0] !== 'number' || typeof v[1] !== 'number'
  ) {
    throw new EdgeError('bad_request', `field ${key} must be [lng, lat]`, 400);
  }
  const [lng, lat] = v as [number, number];
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new EdgeError('bad_request', `field ${key} out of range`, 400);
  }
  return [lng, lat];
}

/** Haversine distance in metres between two [lng, lat] points. */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** PostGIS WKT POINT from [lng, lat]. */
export function wktPoint([lng, lat]: [number, number]): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
