// Simple equirectangular projection for the fallback map. Good enough at city
// scale to place vehicles/zones sensibly inside a fixed-size container.
import type { LngLat } from '../../services/types';

export interface Bounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function boundsOf(points: LngLat[], pad = 0.15): Bounds {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (!isFinite(minLng)) return { minLng: 23.70, minLat: 37.96, maxLng: 23.76, maxLat: 38.00 };
  const dLng = (maxLng - minLng) || 0.01;
  const dLat = (maxLat - minLat) || 0.01;
  return {
    minLng: minLng - dLng * pad,
    minLat: minLat - dLat * pad,
    maxLng: maxLng + dLng * pad,
    maxLat: maxLat + dLat * pad,
  };
}

export function makeProjector(b: Bounds, width: number, height: number) {
  const spanLng = b.maxLng - b.minLng || 1e-6;
  const spanLat = b.maxLat - b.minLat || 1e-6;
  return ([lng, lat]: LngLat): { x: number; y: number } => ({
    x: ((lng - b.minLng) / spanLng) * width,
    y: (1 - (lat - b.minLat) / spanLat) * height, // invert Y
  });
}
