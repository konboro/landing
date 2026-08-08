import { Rng } from '@/lib/rng';
import type { LngLat } from '@penny/db-types';
import type { TelemetrySample } from '@/types/domain';

export const ATHENS_CENTER: LngLat = [23.7275, 37.9838];

function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Random point within `radiusM` metres of a centre. */
export function jitterPoint(center: LngLat, radiusM: number, rng: Rng): LngLat {
  const r = radiusM * Math.sqrt(rng.next());
  const theta = rng.next() * Math.PI * 2;
  const dLat = (r * Math.cos(theta)) / 111_320;
  const dLng = (r * Math.sin(theta)) / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  return [center[0] + dLng, center[1] + dLat];
}

/** Deterministic wandering route between two points. */
export function buildRoute(start: LngLat, end: LngLat, seed: string, points = 40): LngLat[] {
  const rng = new Rng(seedFromString(seed));
  const out: LngLat[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const lng = start[0] + (end[0] - start[0]) * t + (rng.next() - 0.5) * 0.0016 * Math.sin(t * Math.PI);
    const lat = start[1] + (end[1] - start[1]) * t + (rng.next() - 0.5) * 0.0016 * Math.sin(t * Math.PI);
    out.push([lng, lat]);
  }
  return out;
}

/** Telemetry series aligned to a route, for the ride-detail chart. */
export function buildTelemetry(
  route: LngLat[],
  startedAt: string,
  durationS: number,
  startSoc: number,
  seed: string,
): TelemetrySample[] {
  const rng = new Rng(seedFromString(seed + ':tel'));
  const t0 = new Date(startedAt).getTime();
  const n = route.length;
  const out: TelemetrySample[] = [];
  for (let i = 0; i < n; i++) {
    const frac = i / Math.max(1, n - 1);
    const ts = new Date(t0 + frac * durationS * 1000).toISOString();
    const soc = Math.max(2, startSoc - frac * (8 + rng.next() * 6));
    const speed = i === 0 || i === n - 1 ? 0 : Math.max(0, 14 + Math.sin(i / 3) * 8 + (rng.next() - 0.5) * 6);
    const battMv = Math.round(36000 + soc * 42);
    out.push({
      device_ts: ts,
      server_ts: ts,
      pos: { type: 'Point', coordinates: route[i]! },
      speed_kmh: +speed.toFixed(1),
      ext_voltage_mv: battMv,
      batt_voltage_mv: battMv,
      soc_pct: +soc.toFixed(1),
      din1: true,
      dout1: false,
      dout2: false,
      gsm_signal: rng.int(2, 5),
      sats: rng.int(6, 12),
    });
  }
  return out;
}

/** Rectangle-ish polygon ring around a centre, in metres. */
export function boxPolygon(center: LngLat, wM: number, hM: number, rng?: Rng): LngLat[][] {
  const dLat = hM / 2 / 111_320;
  const dLng = wM / 2 / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  const wob = (v: number) => (rng ? v * (0.85 + rng.next() * 0.3) : v);
  const ring: LngLat[] = [
    [center[0] - wob(dLng), center[1] - wob(dLat)],
    [center[0] + wob(dLng), center[1] - wob(dLat)],
    [center[0] + wob(dLng), center[1] + wob(dLat)],
    [center[0] - wob(dLng), center[1] + wob(dLat)],
    [center[0] - wob(dLng), center[1] - wob(dLat)],
  ];
  return [ring];
}
