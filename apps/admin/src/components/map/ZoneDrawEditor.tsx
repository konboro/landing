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
  /** `drawId` is mapbox-gl-draw's own feature id — store it as the zone id, or
   * later draw.update / draw.delete events will not match any zone. */
  onCreate?: (coordinates: LngLat[][], drawId: string) => void;
  onUpdate?: (id: string, coordinates: LngLat[][]) => void;
  onDelete?: (id: string) => void;
}

type DrawFeature = { id?: string | number; geometry: { type: string; coordinates: unknown } };

/** Polygon rings, or null when the geometry is missing/not a polygon. */
function rings(z: Zone): LngLat[][] | null {
  const c = z.geom?.coordinates as unknown;
  return Array.isArray(c) && Array.isArray(c[0]) ? (c as LngLat[][]) : null;
}

function toFeature(z: Zone, coords: LngLat[][]): GeoJSON.Feature {
  return { id: z.id, type: 'Feature', properties: { kind: z.kind }, geometry: { type: 'Polygon', coordinates: coords } } as GeoJSON.Feature;
}

/** Order-independent fingerprint of what is on the map, used to tell an edit we
 * just made ourselves from zones that arrived from the server. */
function signature(features: Array<{ id?: string | number; geometry?: unknown }>): string {
  return features
    .map((f) => {
      const coords = (f.geometry as { coordinates?: unknown } | undefined)?.coordinates ?? null;
      return `${String(f.id)}:${JSON.stringify(coords)}`;
    })
    .sort()
    .join('|');
}

/** mapbox-gl-draw editor. Falls back to a schematic view (no token) — the
 * Zones page keeps a GeoJSON textarea + point-check so editing still works. */
export function ZoneDrawEditor({ zones, height = 460, onCreate, onUpdate, onDelete }: Props) {
  const token = mapToken();
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Auto-framing happens once: after that the view is the operator's. */
  const framed = useRef(false);

  // Draw events fire long after mount, so the handlers must not close over the
  // props from the first render — every edit after the first one would then be
  // computed from a stale zone list and silently drop the previous edit.
  const cbs = useRef({ onCreate, onUpdate, onDelete });
  cbs.current = { onCreate, onUpdate, onDelete };

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
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    // mapbox-gl-draw fires custom string events not in the typed Map event map.
    const on = map.on.bind(map) as unknown as (type: string, listener: (e: { features: DrawFeature[] }) => void) => void;
    map.on('load', () => setReady(true));
    map.on('error', (e) => {
      // A rejected token yields a blank grey box otherwise; individual tile
      // errors stay non-fatal.
      const status = (e as unknown as { error?: { status?: number } }).error?.status;
      if (status === 401 || status === 403) setFailed(true);
    });
    on('draw.create', (e) => {
      const f = e.features[0];
      if (f && f.geometry.type === 'Polygon' && f.id != null) {
        cbs.current.onCreate?.(f.geometry.coordinates as LngLat[][], String(f.id));
      }
    });
    on('draw.update', (e) => {
      const f = e.features[0];
      if (f && f.geometry.type === 'Polygon' && f.id != null) cbs.current.onUpdate?.(String(f.id), f.geometry.coordinates as LngLat[][]);
    });
    on('draw.delete', (e) => {
      for (const f of e.features) if (f.id != null) cbs.current.onDelete?.(String(f.id));
    });
    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Push the zone list into the draw layer. This has to be its own effect:
  // `zones` is loaded asynchronously, so on the first render it is still empty
  // and adding it inside the map-setup effect meant existing zones never showed
  // up at all — you could only draw new ones.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !ready) return;
    const features = zones.flatMap((z) => { const r = rings(z); return r ? [toFeature(z, r)] : []; });
    // Our own draw events already updated the map; re-setting the collection
    // then would cancel the current selection mid-edit.
    if (signature(features) === signature(draw.getAll().features)) return;
    draw.set({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection);

    // Frame what was loaded instead of a hardcoded city. The editor used to
    // open on Athens no matter what, so a fleet anywhere else got a map with
    // its zones somewhere off-screen and looked broken.
    if (framed.current || !features.length) return;
    const map = mapRef.current;
    if (!map) return;
    const bounds = new mapboxgl.LngLatBounds();
    let any = false;
    for (const z of zones) {
      for (const ring of rings(z) ?? []) {
        for (const p of ring) {
          if (Array.isArray(p) && p.length >= 2) { bounds.extend([p[0], p[1]]); any = true; }
        }
      }
    }
    if (!any) return;
    framed.current = true;
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }, [zones, ready]);

  if (!token || failed) {
    return (
      <MapFallback
        height={height}
        zones={zones.flatMap((z) => { const r = rings(z); return r ? [{ id: z.id, coordinates: r, ...zoneMapStyle(z.kind), label: z.name ?? z.kind }] : []; })}
      />
    );
  }
  return <div className="map-box" style={{ height }}><div ref={ref} style={{ position: 'absolute', inset: 0 }} /></div>;
}
