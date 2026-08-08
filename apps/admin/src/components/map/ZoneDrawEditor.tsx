import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { mapToken } from './MapView';
import { MapFallback } from './MapView';
import { zoneMapStyle } from '@/lib/zoneStyle';
import type { Zone } from '@penny/db-types';
import type { LngLat } from '@penny/db-types';

interface Props {
  zones: Zone[];
  height?: number;
  onCreate?: (coordinates: LngLat[][]) => void;
  onUpdate?: (id: string, coordinates: LngLat[][]) => void;
  onDelete?: (id: string) => void;
}

/** mapbox-gl-draw editor. Falls back to a schematic view (no token) — the
 * Zones page keeps a GeoJSON textarea + point-check so editing still works. */
export function ZoneDrawEditor({ zones, height = 460, onCreate, onUpdate, onDelete }: Props) {
  const token = mapToken();
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token || !ref.current) return;
    mapboxgl.accessToken = token;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({ container: ref.current, style: 'mapbox://styles/mapbox/light-v11', center: [23.7275, 37.9838], zoom: 12, attributionControl: false });
    } catch { setFailed(true); return; }
    mapRef.current = map;
    const draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
    drawRef.current = draw;
    map.addControl(draw as unknown as mapboxgl.IControl);
    // mapbox-gl-draw fires custom string events not in the typed Map event map.
    type DrawFeature = { id?: string | number; geometry: { type: string; coordinates: unknown } };
    const on = map.on.bind(map) as unknown as (type: string, listener: (e: { features: DrawFeature[] }) => void) => void;
    map.on('load', () => {
      for (const z of zones) {
        try {
          draw.add({ id: z.id, type: 'Feature', properties: { kind: z.kind }, geometry: { type: 'Polygon', coordinates: z.geom.coordinates } } as GeoJSON.Feature);
        } catch { /* ignore malformed */ }
      }
    });
    on('draw.create', (e) => {
      const f = e.features[0];
      if (f && f.geometry.type === 'Polygon') onCreate?.(f.geometry.coordinates as LngLat[][]);
    });
    on('draw.update', (e) => {
      const f = e.features[0];
      if (f && f.geometry.type === 'Polygon' && typeof f.id === 'string') onUpdate?.(f.id, f.geometry.coordinates as LngLat[][]);
    });
    on('draw.delete', (e) => {
      const f = e.features[0];
      if (f && typeof f.id === 'string') onDelete?.(f.id);
    });
    return () => { map.remove(); mapRef.current = null; drawRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token || failed) {
    return <MapFallback height={height} zones={zones.map((z) => ({ id: z.id, coordinates: z.geom.coordinates, ...zoneMapStyle(z.kind), label: z.name ?? z.kind }))} />;
  }
  return <div className="map-box" style={{ height }}><div ref={ref} style={{ position: 'absolute', inset: 0 }} /></div>;
}
