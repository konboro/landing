import { useEffect, useRef, useState, type ReactNode } from 'react';
import mapboxgl from 'mapbox-gl';
import { colors } from '@penny/ui';
import type { LngLat } from '@penny/db-types';

export interface MapMarker {
  id: string;
  lng: number;
  lat: number;
  color: string;
  label?: string;
  onClick?: () => void;
}
export interface MapZone {
  id: string;
  coordinates: LngLat[][];
  fill: string;
  line: string;
  label?: string;
}
export interface HeatPoint { lng: number; lat: number; weight: number }
export interface MapPath { coordinates: LngLat[]; color: string }

export interface MapViewProps {
  center?: LngLat;
  zoom?: number;
  height?: number | string;
  markers?: MapMarker[];
  zones?: MapZone[];
  heat?: HeatPoint[];
  paths?: MapPath[];
  legend?: Array<{ color: string; label: string }>;
  toolbar?: ReactNode;
  interactive?: boolean;
}

export function mapToken(): string | null {
  const t = import.meta.env.VITE_MAPBOX_TOKEN;
  return t && t.startsWith('pk.') ? t : null;
}

export function MapView(props: MapViewProps) {
  const token = mapToken();
  if (!token) return <MapFallback {...props} />;
  return <RealMap token={token} {...props} />;
}

function RealMap({ token, center, zoom, height = 360, markers = [], zones = [], heat = [], paths = [], legend, toolbar, interactive = true }: MapViewProps & { token: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerObjs = useRef<mapboxgl.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    mapboxgl.accessToken = token;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: ref.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: center ?? [23.7275, 37.9838],
        zoom: zoom ?? 12,
        interactive,
        attributionControl: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.on('load', () => setLoaded(true));
    map.on('error', () => { /* keep map; individual tile errors are non-fatal */ });
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // zones
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = 'zones-src';
    const fc = {
      type: 'FeatureCollection' as const,
      features: (zones ?? []).map((z) => ({ type: 'Feature' as const, properties: { fill: z.fill, line: z.line }, geometry: { type: 'Polygon' as const, coordinates: z.coordinates } })),
    };
    const existing = map.getSource(src) as mapboxgl.GeoJSONSource | undefined;
    if (existing) { existing.setData(fc); return; }
    map.addSource(src, { type: 'geojson', data: fc });
    map.addLayer({ id: 'zones-fill', type: 'fill', source: src, paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.5 } });
    map.addLayer({ id: 'zones-line', type: 'line', source: src, paint: { 'line-color': ['get', 'line'], 'line-width': 1.5 } });
  }, [zones, loaded]);

  // heat
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = 'heat-src';
    const fc = {
      type: 'FeatureCollection' as const,
      features: (heat ?? []).map((h) => ({ type: 'Feature' as const, properties: { w: h.weight }, geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] } })),
    };
    const existing = map.getSource(src) as mapboxgl.GeoJSONSource | undefined;
    if (existing) { existing.setData(fc); return; }
    map.addSource(src, { type: 'geojson', data: fc });
    map.addLayer({
      id: 'heat-layer', type: 'heatmap', source: src,
      paint: {
        'heatmap-weight': ['get', 'w'],
        'heatmap-radius': 26,
        'heatmap-opacity': 0.7,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(47,91,224,0)', 0.4, '#8aabff', 0.7, '#e8a317', 1, '#e04141'],
      },
    });
  }, [heat, loaded]);

  // paths (route lines)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = 'paths-src';
    const fc = {
      type: 'FeatureCollection' as const,
      features: (paths ?? []).map((p) => ({ type: 'Feature' as const, properties: { color: p.color }, geometry: { type: 'LineString' as const, coordinates: p.coordinates } })),
    };
    const existing = map.getSource(src) as mapboxgl.GeoJSONSource | undefined;
    if (existing) { existing.setData(fc); return; }
    map.addSource(src, { type: 'geojson', data: fc });
    map.addLayer({ id: 'paths-line', type: 'line', source: src, paint: { 'line-color': ['get', 'color'], 'line-width': 3 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  }, [paths, loaded]);

  // markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    markerObjs.current.forEach((m) => m.remove());
    markerObjs.current = [];
    for (const mk of markers ?? []) {
      const el = document.createElement('div');
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${mk.color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);cursor:${mk.onClick ? 'pointer' : 'default'}`;
      if (mk.onClick) el.addEventListener('click', mk.onClick);
      const marker = new mapboxgl.Marker(el).setLngLat([mk.lng, mk.lat]);
      if (mk.label) marker.setPopup(new mapboxgl.Popup({ offset: 14, closeButton: false }).setText(mk.label));
      marker.addTo(map);
      markerObjs.current.push(marker);
    }
  }, [markers, loaded]);

  if (failed) return <MapFallback height={height} markers={markers} zones={zones} heat={heat} center={center} legend={legend} toolbar={toolbar} />;

  return (
    <div className="map-box" style={{ height }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {toolbar ? <div className="map-toolbar">{toolbar}</div> : null}
      {legend ? <Legend legend={legend} /> : null}
    </div>
  );
}

function Legend({ legend }: { legend: Array<{ color: string; label: string }> }) {
  return (
    <div className="map-legend">
      {legend.map((l) => (
        <div key={l.label} className="lg-row">
          <span style={{ width: 9, height: 9, borderRadius: 3, background: l.color }} />
          {l.label}
        </div>
      ))}
    </div>
  );
}

/** Graceful fallback: token missing/invalid. Plots markers/zones as an SVG
 * scatter so the panel is still informative. */
export function MapFallback({ height = 360, markers = [], zones = [], heat = [], paths = [], center, legend, toolbar }: MapViewProps) {
  const pts = [...markers.map((m) => [m.lng, m.lat] as LngLat), ...heat.map((h) => [h.lng, h.lat] as LngLat)];
  for (const z of zones) for (const ring of z.coordinates) for (const p of ring) pts.push(p);
  for (const pth of paths) for (const p of pth.coordinates) pts.push(p);
  const hasPts = pts.length > 0;
  const minLng = hasPts ? Math.min(...pts.map((p) => p[0])) : (center?.[0] ?? 23.7) - 0.05;
  const maxLng = hasPts ? Math.max(...pts.map((p) => p[0])) : (center?.[0] ?? 23.7) + 0.05;
  const minLat = hasPts ? Math.min(...pts.map((p) => p[1])) : (center?.[1] ?? 37.98) - 0.05;
  const maxLat = hasPts ? Math.max(...pts.map((p) => p[1])) : (center?.[1] ?? 37.98) + 0.05;
  const W = 600, H = 320, pad = 24;
  const sx = (lng: number) => pad + ((lng - minLng) / (maxLng - minLng || 1)) * (W - pad * 2);
  const sy = (lat: number) => H - pad - ((lat - minLat) / (maxLat - minLat || 1)) * (H - pad * 2);
  return (
    <div className="map-box" style={{ height }}>
      <div className="map-fallback">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: '100%' }}>
          {zones.map((z) => (
            <polygon key={z.id} points={(z.coordinates[0] ?? []).map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')} fill={z.fill} stroke={z.line} strokeWidth={1.5} />
          ))}
          {heat.map((h, i) => <circle key={`h${i}`} cx={sx(h.lng)} cy={sy(h.lat)} r={6 + h.weight * 6} fill={colors.warning} opacity={0.12} />)}
          {paths.map((p, i) => (
            <polyline key={`p${i}`} points={p.coordinates.map((c) => `${sx(c[0])},${sy(c[1])}`).join(' ')} fill="none" stroke={p.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {markers.map((m) => (
            <circle key={m.id} cx={sx(m.lng)} cy={sy(m.lat)} r={5} fill={m.color} stroke="#fff" strokeWidth={1.5} onClick={m.onClick} style={{ cursor: m.onClick ? 'pointer' : 'default' }}>
              {m.label ? <title>{m.label}</title> : null}
            </circle>
          ))}
        </svg>
        <div style={{ fontSize: 12 }}>🗺️ Map unavailable — add <code className="mono">VITE_MAPBOX_TOKEN</code> for the interactive Mapbox view. Showing schematic positions.</div>
      </div>
      {toolbar ? <div className="map-toolbar">{toolbar}</div> : null}
      {legend ? <Legend legend={legend} /> : null}
    </div>
  );
}
