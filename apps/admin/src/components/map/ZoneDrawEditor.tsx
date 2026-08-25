import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { mapToken } from './MapView';
import { MapFallback } from './MapView';
import { zoneMapStyle, ZONE_KINDS } from '@/lib/zoneStyle';
import type { Zone } from '@penny/db-types';
import type { LngLat } from '@penny/db-types';

interface Props {
  zones: Zone[];
  height?: number;
  /** The zone currently unlocked for editing (in the draw layer), or null. Every
   * other saved zone renders read-only and cannot be moved/reshaped/deleted. */
  editingId?: string | null;
  /** Highlighted-but-still-locked zone (e.g. picked from the table or a map click). */
  selectedId?: string | null;
  /** `drawId` is mapbox-gl-draw's own feature id — store it as the zone id, or
   * later draw.update / draw.delete events will not match any zone. */
  onCreate?: (coordinates: LngLat[][], drawId: string) => void;
  onUpdate?: (id: string, coordinates: LngLat[][]) => void;
  onDelete?: (id: string) => void;
  /** A read-only zone was clicked on the map — the page decides what to do (select
   * it, offer an Edit button). Clicking never moves or unlocks a zone by itself. */
  onSelect?: (id: string) => void;
}

type DrawFeature = { id?: string | number; geometry: { type: string; coordinates: unknown } };

const LOCKED_SRC = 'zones-locked';
const LOCKED_FILL = 'zones-locked-fill';
const LOCKED_LINE = 'zones-locked-line';

/** Polygon rings, or null when the geometry is missing/not a polygon. */
function rings(z: Zone): LngLat[][] | null {
  const c = z.geom?.coordinates as unknown;
  return Array.isArray(c) && Array.isArray(c[0]) ? (c as LngLat[][]) : null;
}

function toFeature(z: Zone, coords: LngLat[][]): GeoJSON.Feature {
  return { id: z.id, type: 'Feature', properties: { kind: z.kind }, geometry: { type: 'Polygon', coordinates: coords } } as GeoJSON.Feature;
}

/** match(kind → color) expression covering every zone kind, with a grey default. */
function kindColor(pick: 'fill' | 'line'): mapboxgl.ExpressionSpecification {
  const stops = ZONE_KINDS.flatMap((k) => [k, zoneMapStyle(k)[pick]]);
  return ['match', ['get', 'kind'], ...stops, pick === 'fill' ? 'rgba(90,103,128,0.15)' : '#5a6780'] as unknown as mapboxgl.ExpressionSpecification;
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

/**
 * mapbox-gl-draw editor with a LOCK model: saved zones are painted as a read-only
 * source (`zones-locked`) and cannot be selected/moved/deleted through the draw
 * tool. Only the zone named by `editingId` — or a brand-new polygon you draw — is
 * loaded into MapboxDraw and therefore editable. Falls back to a schematic view
 * (no token); the Zones page keeps a rules table + point-check so editing still works.
 */
export function ZoneDrawEditor({ zones, height = 460, editingId = null, selectedId = null, onCreate, onUpdate, onDelete, onSelect }: Props) {
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
  const cbs = useRef({ onCreate, onUpdate, onDelete, onSelect });
  cbs.current = { onCreate, onUpdate, onDelete, onSelect };
  // Latest zones read by the centering effect without making it a dependency —
  // otherwise every drag (which changes `zones`) would recentre mid-edit.
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

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
    map.on('load', () => {
      // Read-only layer for locked zones. It sits BELOW the draw layers (added by
      // the control) because it is added first here, so an editable polygon always
      // renders on top of the locked ones.
      if (!map.getSource(LOCKED_SRC)) {
        map.addSource(LOCKED_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: LOCKED_FILL, type: 'fill', source: LOCKED_SRC,
          paint: { 'fill-color': kindColor('fill'), 'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.85, 0.5] },
        });
        map.addLayer({
          id: LOCKED_LINE, type: 'line', source: LOCKED_SRC,
          paint: { 'line-color': kindColor('line'), 'line-width': ['case', ['boolean', ['get', 'selected'], false], 4, 1.6] },
        });
      }
      // Clicking a locked zone asks the page to select it — it never moves or
      // unlocks anything on its own.
      map.on('click', LOCKED_FILL, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null) cbs.current.onSelect?.(String(id));
      });
      map.on('mouseenter', LOCKED_FILL, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', LOCKED_FILL, () => { map.getCanvas().style.cursor = ''; });
      setReady(true);
    });
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

  // Split the zone list into "editable" (the one being edited, in the draw layer)
  // and "locked" (everyone else, painted read-only). This has to be its own effect:
  // `zones` loads asynchronously, so on the first render it is still empty.
  useEffect(() => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map || !ready) return;

    // Editable = only the zone unlocked for editing (or the new polygon just drawn,
    // which the page immediately makes the editingId).
    const editable = zones.flatMap((z) => (z.id === editingId ? (rings(z) ? [toFeature(z, rings(z)!)] : []) : []));
    // Our own draw events already updated the map; re-setting the collection then
    // would cancel the current selection or an in-progress polygon mid-edit.
    if (signature(editable) !== signature(draw.getAll().features)) {
      draw.set({ type: 'FeatureCollection', features: editable } as GeoJSON.FeatureCollection);
    }

    // Locked = everything except the editable zone, painted read-only.
    const lockedFeatures = zones.flatMap((z) => {
      if (z.id === editingId) return [];
      const r = rings(z);
      if (!r) return [];
      return [{ type: 'Feature', id: z.id, properties: { kind: z.kind, name: z.name ?? z.kind, id: z.id, selected: z.id === selectedId }, geometry: { type: 'Polygon', coordinates: r } } as GeoJSON.Feature];
    });
    const src = map.getSource(LOCKED_SRC) as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: lockedFeatures });

    // Frame what was loaded once, instead of a hardcoded city.
    if (framed.current) return;
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
  }, [zones, editingId, selectedId, ready]);

  // Centre the map on a zone when it becomes selected (e.g. clicking its table
  // row). Keyed on `selectedId` only — reads the latest geometry from a ref so an
  // in-progress edit does not keep snapping the view back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId) return;
    const z = zonesRef.current.find((zz) => zz.id === selectedId);
    const r = z ? rings(z) : null;
    if (!r) return;
    const bounds = new mapboxgl.LngLatBounds();
    let any = false;
    for (const ring of r) {
      for (const p of ring) {
        if (Array.isArray(p) && p.length >= 2) { bounds.extend([p[0], p[1]]); any = true; }
      }
    }
    if (any) map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 600 });
  }, [selectedId, ready]);

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
