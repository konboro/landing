// JS-side clustering (supercluster) — required by the Fabric constraint noted in
// CLAUDE.md (no native clustering). Used by the Mapbox map implementation.
import Supercluster from 'supercluster';
import type { MapVehicle } from '../../services/types';

export interface ClusterPoint {
  id: string;
  lng: number;
  lat: number;
  count: number; // 1 => single vehicle
  code?: string;
  soc?: number;
}

export function buildIndex(vehicles: MapVehicle[]): Supercluster<{ code: string; soc: number }> {
  const index = new Supercluster<{ code: string; soc: number }>({ radius: 48, maxZoom: 18 });
  index.load(
    vehicles.map((v) => ({
      type: 'Feature' as const,
      properties: { code: v.code, soc: v.soc_pct },
      geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
    })),
  );
  return index;
}

export function clustersFor(
  index: Supercluster<{ code: string; soc: number }>,
  bbox: [number, number, number, number],
  zoom: number,
): ClusterPoint[] {
  return index.getClusters(bbox, Math.round(zoom)).map((f) => {
    const [lng, lat] = f.geometry.coordinates as [number, number];
    const props = f.properties as any;
    if (props.cluster) {
      return { id: `c-${props.cluster_id}`, lng, lat, count: props.point_count as number };
    }
    return { id: props.code, lng, lat, count: 1, code: props.code, soc: props.soc };
  });
}
