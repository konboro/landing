import type { MapVehicle, MapZone, MapPoi, LngLat } from '../../services/types';

export interface FleetMapProps {
  vehicles: MapVehicle[];
  zones: MapZone[];
  pois: MapPoi[];
  userPos: LngLat | null;
  center: LngLat;
  selectedCode: string | null;
  night?: boolean;
  showZones?: boolean;
  showPois?: boolean;
  onSelectVehicle: (code: string) => void;
  onMapPress?: () => void;
  /** programmatic camera target (e.g. recenter / deep-link focus). */
  focus?: LngLat | null;
}

/** Whether the native Mapbox token is configured. */
export function hasMapboxToken(): boolean {
  const t = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  return !!t && t.startsWith('pk.');
}

export type { MapVehicle, MapZone, MapPoi, LngLat };
