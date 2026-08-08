// Simple nearest-neighbor task route ordering (docs/07 feature 7 "My day").
// Uses @penny/geo haversine. Upgradeable to a real optimizer later.
import { haversine } from '@penny/geo';
import type { LngLat } from '@penny/db-types';

export interface Stop<T> {
  item: T;
  pos: LngLat;
}

export interface OrderedStop<T> extends Stop<T> {
  legMeters: number;
  cumulativeMeters: number;
}

export function nearestNeighborRoute<T>(start: LngLat, stops: Stop<T>[]): {
  ordered: OrderedStop<T>[];
  totalMeters: number;
} {
  const remaining = [...stops];
  const ordered: OrderedStop<T>[] = [];
  let cursor = start;
  let cumulative = 0;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(cursor, remaining[i]!.pos);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    cumulative += bestDist;
    ordered.push({ ...next, legMeters: bestDist, cumulativeMeters: cumulative });
    cursor = next.pos;
  }

  return { ordered, totalMeters: cumulative };
}
