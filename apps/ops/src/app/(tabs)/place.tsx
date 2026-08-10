// Place / Heatmap — the "where do I go next" screen.
//
// Two lenses on one city rather than two destinations, so it is a segmented
// control over a single full-bleed map and not a pair of tabs:
//   * Place   — where a scooter is ALLOWED to be (operating / parking / no-go)
//               and where rebalancing wants more of them.
//   * Heatmap — where scooters are PILING UP idle, which is the opposite
//               question and needs the same map underneath it.
//
// The reference design draws orange blobs with no legend, which tells an
// operator nothing: orange could mean "busy, good" or "dead stock, bad". Here
// the ramp is bucketed on the ABSOLUTE idle count (what a crew acts on — "six
// scooters sitting on one block"), never the normalised weight, and the legend
// spells out the counts and what to do about them.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, type LayoutChangeEvent } from 'react-native';
import Svg, { Polygon as SvgPolygon, Circle as SvgCircle } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LngLat } from '@penny/db-types';
import { useTheme, makeStyles, withAlpha, type OpsTheme } from '../../brand';
import {
  BottomSheet,
  SegmentedControl,
  Icon,
  Body,
  Muted,
  Badge,
  Divider,
  type IconName,
} from '../../components/ui';
import { useMirror } from '../../lib/useMirror';
import { getZones, getHeatCells } from '../../offline/repo';
import { hasMapboxToken, env } from '../../lib/env';
import { getCurrentPos } from '../../lib/geoloc';
import { ATHENS_CENTER } from '../../services/mockData';
import type { HeatCell, RebalanceZone } from '../../lib/types';

// --- Mapbox guard (same degradation contract as components/FleetMap.tsx) -----
// The native module is optional: in Expo Go, or in any build without a public
// token, `require` throws or `MapView` is missing and the screen falls back to a
// projected SVG plot instead of a blank rectangle.
type MapboxComponent = React.ComponentType<{ children?: React.ReactNode } & Record<string, unknown>>;
interface MapboxModule {
  MapView?: MapboxComponent;
  Camera?: MapboxComponent;
  ShapeSource?: MapboxComponent;
  FillLayer?: MapboxComponent;
  LineLayer?: MapboxComponent;
  PointAnnotation?: MapboxComponent;
  setAccessToken?: (token: string) => void;
}

let Mapbox: MapboxModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@rnmapbox/maps') as { default?: MapboxModule } & MapboxModule;
  Mapbox = mod.default ?? mod;
  if (Mapbox?.setAccessToken && env.mapboxToken) Mapbox.setAccessToken(env.mapboxToken);
} catch {
  Mapbox = null;
}

// --- Zone classification ----------------------------------------------------
type ZoneLayerKey = 'operating' | 'parking' | 'nogo' | 'rebalance';
type ZoneLayers = Record<ZoneLayerKey, boolean>;

/**
 * The mirror stores each zone as opaque JSON, so a backend that already tags a
 * row with `zones.kind` (docs/04) round-trips the field even though
 * `RebalanceZone` does not declare it. Read it when it is there; everything the
 * local mock generates is a rebalancing zone, which is the fallback.
 */
type MirrorZone = RebalanceZone & { kind?: string };

const KIND_TO_LAYER: Record<string, ZoneLayerKey> = {
  operating: 'operating',
  speed_limit: 'operating',
  parking: 'parking',
  paid_parking: 'parking',
  parking_station: 'parking',
  charging_station: 'parking',
  bonus: 'parking',
  no_go: 'nogo',
  no_parking: 'nogo',
  rebalancing: 'rebalance',
};

function layerOf(z: MirrorZone): ZoneLayerKey {
  return (z.kind ? KIND_TO_LAYER[z.kind] : undefined) ?? 'rebalance';
}

interface LayerDef {
  key: ZoneLayerKey;
  label: string;
  icon: IconName;
  /** What the boundary means in the field — shown in the legend and layers sheet. */
  hint: string;
  color: (t: OpsTheme) => string;
  dashed: boolean;
}

const LAYER_DEFS: LayerDef[] = [
  {
    key: 'operating',
    label: 'Operating',
    icon: 'map',
    hint: 'Inside = rentable. Outside, a trip cannot start.',
    color: (t) => t.c.primary,
    dashed: false,
  },
  {
    key: 'parking',
    label: 'Parking',
    icon: 'parking',
    hint: 'Approved drop spots — deploy here first.',
    color: (t) => t.c.success,
    dashed: false,
  },
  {
    key: 'nogo',
    label: 'No-go',
    icon: 'nogo',
    hint: 'Never leave a scooter here. Clear it if you find one.',
    color: (t) => t.c.danger,
    dashed: true,
  },
  {
    key: 'rebalance',
    label: 'Rebalance',
    icon: 'route',
    hint: 'Demand target vs. what is actually parked there now.',
    color: (t) => t.c.warning,
    dashed: false,
  },
];

// --- Heat buckets -----------------------------------------------------------
type HeatBucket = 'quiet' | 'building' | 'hot';

/** Absolute idle counts, not `weight`: a crew acts on scooters, not on ratios. */
const BUILDING_MIN = 3;
const HOT_MIN = 5;

function bucketOf(cell: HeatCell): HeatBucket {
  if (cell.idle_count >= HOT_MIN) return 'hot';
  if (cell.idle_count >= BUILDING_MIN) return 'building';
  return 'quiet';
}

const HEAT_LEGEND: { bucket: HeatBucket; label: string; hint: string }[] = [
  { bucket: 'quiet', label: `1–${BUILDING_MIN - 1} idle`, hint: 'Normal. Leave it alone.' },
  { bucket: 'building', label: `${BUILDING_MIN}–${HOT_MIN - 1} idle`, hint: 'Filling up — check on the next pass.' },
  { bucket: 'hot', label: `${HOT_MIN}+ idle`, hint: 'Pile-up. Redistribute or collect.' },
];

function heatColor(bucket: HeatBucket, t: OpsTheme): string {
  if (bucket === 'hot') return t.c.danger;
  if (bucket === 'building') return t.c.warning;
  return t.c.success;
}

// --- Geometry helpers -------------------------------------------------------
const DEG_LAT_M = 111_320;
/** Flat-top hexagon around a cell centre. ~1 grid step of the mirror's snapping. */
const HEX_RADIUS_M = 70;

function hexRing(center: LngLat, radiusM: number): LngLat[] {
  const lngM = DEG_LAT_M * Math.cos((center[1] * Math.PI) / 180) || DEG_LAT_M;
  const pts: LngLat[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push([center[0] + (radiusM * Math.cos(a)) / lngM, center[1] + (radiusM * Math.sin(a)) / DEG_LAT_M]);
  }
  pts.push(pts[0] ?? center);
  return pts;
}

interface Bounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

function boundsOf(points: LngLat[]): Bounds | null {
  if (points.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

function zonePoints(z: MirrorZone): LngLat[] {
  return z.geom.coordinates.flat();
}

function zoneCenter(z: MirrorZone): LngLat {
  const b = boundsOf(zonePoints(z));
  if (!b) return ATHENS_CENTER;
  return [(b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2];
}

/**
 * Equirectangular projection into a canvas box, longitude squeezed by cos(lat)
 * so Athens does not come out stretched sideways. Aspect ratio is preserved and
 * the drawing is centred in whatever box it is handed.
 */
function makeProjector(b: Bounds, w: number, h: number, pad: number): (p: LngLat) => [number, number] {
  const kx = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180) || 1;
  const lngSpan = Math.max(1e-6, (b.maxLng - b.minLng) * kx);
  const latSpan = Math.max(1e-6, b.maxLat - b.minLat);
  const iw = Math.max(1, w - pad * 2);
  const ih = Math.max(1, h - pad * 2);
  const s = Math.min(iw / lngSpan, ih / latSpan);
  const ox = pad + (iw - lngSpan * s) / 2;
  const oy = pad + (ih - latSpan * s) / 2;
  return ([lng, lat]) => [ox + (lng - b.minLng) * kx * s, oy + (b.maxLat - lat) * s];
}

// ---------------------------------------------------------------------------
export default function PlaceTab() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const insets = useSafeAreaInsets();
  const { c, space } = theme;

  const zonesQ = useMirror(getZones, [] as RebalanceZone[]);
  const heatQ = useMirror(getHeatCells, [] as HeatCell[]);
  const zones: MirrorZone[] = zonesQ.data;
  const heat = heatQ.data;

  const [mode, setMode] = useState<'place' | 'heatmap'>('place');
  const [layers, setLayers] = useState<ZoneLayers>({
    operating: true,
    parking: true,
    nogo: true,
    rebalance: true,
  });
  // One sheet at a time: BottomSheet is a Modal, and two stacked modals on
  // Android eat each other's back-button handling.
  const [sheet, setSheet] = useState<'summary' | 'layers' | null>(null);
  const [center, setCenter] = useState<LngLat>(ATHENS_CENTER);
  const [locating, setLocating] = useState(false);

  const drawnZones = useMemo(() => zones.filter((z) => layers[layerOf(z)]), [zones, layers]);
  const deficits = useMemo(
    () =>
      zones
        .map((z) => ({ zone: z, gap: z.target_count - z.current_count }))
        .filter((d) => d.gap > 0)
        .sort((a, b) => b.gap - a.gap),
    [zones],
  );
  const hotCells = useMemo(
    () => heat.filter((h) => bucketOf(h) === 'hot').sort((a, b) => b.idle_count - a.idle_count),
    [heat],
  );
  const busiest = useMemo(() => [...heat].sort((a, b) => b.idle_count - a.idle_count).slice(0, 8), [heat]);
  const totalIdle = useMemo(() => heat.reduce((s, h) => s + h.idle_count, 0), [heat]);

  const locateMe = useCallback(() => {
    setLocating(true);
    getCurrentPos()
      .then(({ pos }) => setCenter(pos))
      .catch(() => {
        /* geoloc already falls back to city centre; nothing to recover from */
      })
      .finally(() => setLocating(false));
  }, []);

  const summaryLine =
    mode === 'heatmap'
      ? hotCells.length > 0
        ? `${hotCells.length} pile-up${hotCells.length === 1 ? '' : 's'} · ${totalIdle} idle`
        : `No pile-ups · ${totalIdle} idle`
      : deficits.length > 0
        ? `${deficits.length} zone${deficits.length === 1 ? '' : 's'} short · need ${deficits.reduce((s, d) => s + d.gap, 0)}`
        : `${zones.length} zones · all stocked`;

  const nativeAvailable = !!Mapbox?.MapView && hasMapboxToken;

  return (
    <View style={st.root}>
      {nativeAvailable ? (
        <NativeCanvas mode={mode} zones={drawnZones} heat={heat} center={center} layers={layers} />
      ) : (
        <FallbackCanvas mode={mode} zones={drawnZones} heat={heat} />
      )}

      {/* --- floating chrome --------------------------------------------- */}
      <View style={[st.topBar, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <SegmentedControl
          options={[
            { key: 'place', label: 'Place', icon: 'place' },
            { key: 'heatmap', label: 'Heatmap', icon: 'map' },
          ]}
          value={mode}
          onChange={(k) => setMode(k === 'heatmap' ? 'heatmap' : 'place')}
          style={st.segmented}
        />
      </View>

      <View style={[st.rail, { top: insets.top + 88 }]} pointerEvents="box-none">
        <RoundButton icon="qr" label="Scan a scooter" onPress={() => router.push('/scan')} />
        <RoundButton icon="layers" label="Layers" onPress={() => setSheet('layers')} active={sheet === 'layers'} />
        <RoundButton icon="locate" label="Centre on me" onPress={locateMe} active={locating} />
      </View>

      {/* No `insets.bottom` here: the tab bar already sits inside the safe area,
          so adding it again would float the summary bar off the tab bar. */}
      <View style={[st.bottom, { paddingBottom: space.sm }]} pointerEvents="box-none">
        <Legend mode={mode} layers={layers} />
        <Pressable
          onPress={() => setSheet('summary')}
          accessibilityRole="button"
          accessibilityLabel={`Summary: ${summaryLine}`}
          style={({ pressed }) => [st.summaryBar, pressed && { opacity: 0.75 }]}
        >
          <Icon name={mode === 'heatmap' ? 'alert' : 'route'} size={20} color={c.text} />
          <Text style={st.summaryText} numberOfLines={1}>
            {summaryLine}
          </Text>
          <Icon name="chevronUp" size={18} color={c.textMuted} />
        </Pressable>
      </View>

      {/* --- sheets ------------------------------------------------------- */}
      <BottomSheet
        open={sheet === 'summary'}
        onClose={() => setSheet(null)}
        title={mode === 'heatmap' ? 'Idle pile-ups' : 'Zones on screen'}
        snapPoints={[0.45, 0.85]}
      >
        <ScrollView contentContainerStyle={st.sheetBody}>
          {mode === 'heatmap' ? (
            <HeatSummary hot={hotCells} busiest={busiest} totalIdle={totalIdle} cellCount={heat.length} />
          ) : (
            <ZoneSummary zones={drawnZones} deficits={deficits} />
          )}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        open={sheet === 'layers'}
        onClose={() => setSheet(null)}
        title="Layers"
        snapPoints={[0.5]}
      >
        <ScrollView contentContainerStyle={st.sheetBody}>
          <Muted>
            {mode === 'place'
              ? 'Which zone boundaries are drawn. Turning one off only hides it — the rules still apply.'
              : 'The heatmap draws every idle cell. Switch to Place to pick zone boundaries.'}
          </Muted>
          {LAYER_DEFS.map((def) => (
            <Pressable
              key={def.key}
              onPress={() => setLayers((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
              accessibilityRole="switch"
              accessibilityState={{ checked: layers[def.key] }}
              style={({ pressed }) => [st.layerRow, pressed && { opacity: 0.75 }]}
            >
              <View style={[st.swatch, swatchStyle(def, theme)]} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '700' }}>{def.label}</Body>
                <Muted>{def.hint}</Muted>
              </View>
              <Icon
                name={layers[def.key] ? 'check' : 'close'}
                size={22}
                color={layers[def.key] ? c.success : c.textFaint}
              />
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

// --- Native Mapbox canvas ---------------------------------------------------
function NativeCanvas({
  mode,
  zones,
  heat,
  center,
  layers,
}: {
  mode: 'place' | 'heatmap';
  zones: MirrorZone[];
  heat: HeatCell[];
  center: LngLat;
  layers: ZoneLayers;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const mb = Mapbox;
  if (!mb?.MapView || !mb.Camera || !mb.ShapeSource || !mb.FillLayer || !mb.LineLayer) return null;
  const { MapView, Camera, ShapeSource, FillLayer, LineLayer, PointAnnotation } = mb;

  // One source per bucket/layer instead of a data-driven expression: the paint
  // colour then comes straight from the theme and stays brand-switchable.
  const heatGroups: HeatBucket[] = ['quiet', 'building', 'hot'];

  return (
    <MapView
      style={st.fill}
      styleURL={theme.mode === 'dark' ? theme.map.night : theme.map.day}
      scaleBarEnabled={false}
      logoEnabled={false}
      attributionEnabled={false}
    >
      <Camera zoomLevel={12.5} centerCoordinate={center} animationDuration={600} />

      {mode === 'place'
        ? LAYER_DEFS.filter((d) => layers[d.key]).map((def) => {
            const group = zones.filter((z) => layerOf(z) === def.key);
            if (group.length === 0) return null;
            const tint = def.color(theme);
            return (
              <ShapeSource
                key={def.key}
                id={`zones-${def.key}`}
                shape={{
                  type: 'FeatureCollection',
                  features: group.map((z) => ({
                    type: 'Feature',
                    id: z.id,
                    geometry: z.geom,
                    properties: {},
                  })),
                }}
              >
                <FillLayer id={`zonefill-${def.key}`} style={{ fillColor: tint, fillOpacity: 0.14 }} />
                <LineLayer
                  id={`zoneline-${def.key}`}
                  style={{
                    lineColor: tint,
                    lineWidth: 2.5,
                    ...(def.dashed ? { lineDasharray: [2, 2] } : {}),
                  }}
                />
              </ShapeSource>
            );
          })
        : heatGroups.map((bucket) => {
            const cells = heat.filter((h) => bucketOf(h) === bucket);
            if (cells.length === 0) return null;
            return (
              <ShapeSource
                key={bucket}
                id={`heat-${bucket}`}
                shape={{
                  type: 'FeatureCollection',
                  features: cells.map((h, i) => ({
                    type: 'Feature',
                    id: `${bucket}-${i}`,
                    geometry: { type: 'Polygon', coordinates: [hexRing(h.center, HEX_RADIUS_M)] },
                    properties: {},
                  })),
                }}
              >
                <FillLayer
                  id={`heatfill-${bucket}`}
                  style={{ fillColor: heatColor(bucket, theme), fillOpacity: bucket === 'quiet' ? 0.22 : 0.4 }}
                />
                <LineLayer
                  id={`heatline-${bucket}`}
                  style={{ lineColor: heatColor(bucket, theme), lineWidth: 1.5, lineOpacity: 0.8 }}
                />
              </ShapeSource>
            );
          })}

      {/* Rebalance targets carry a number, and a number needs a label. Rendered
          as annotations rather than a SymbolLayer so no glyph font is required. */}
      {mode === 'place' && layers.rebalance && PointAnnotation
        ? zones
            .filter((z) => layerOf(z) === 'rebalance')
            .map((z) => {
              const gap = z.target_count - z.current_count;
              return (
                <PointAnnotation key={z.id} id={`target-${z.id}`} coordinate={zoneCenter(z)}>
                  <View style={[st.target, gap > 0 && { borderColor: c.warning }]}>
                    <Text style={st.targetText}>
                      {z.current_count}/{z.target_count}
                    </Text>
                    <Text style={[st.targetGap, { color: gap > 0 ? c.warning : c.success }]}>
                      {gap > 0 ? `need ${gap}` : 'ok'}
                    </Text>
                  </View>
                </PointAnnotation>
              );
            })
        : null}
    </MapView>
  );
}

// --- Fallback canvas (no token / Expo Go) -----------------------------------
// Not a blank screen and not just a list: the same geometry, projected into an
// SVG plot, so the spatial relationship between zones and pile-ups survives.
function FallbackCanvas({
  mode,
  zones,
  heat,
}: {
  mode: 'place' | 'heatmap';
  zones: MirrorZone[];
  heat: HeatCell[];
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }),
    [],
  );

  const shown = useMemo(() => {
    const pts: LngLat[] = mode === 'place' ? zones.flatMap(zonePoints) : heat.map((h) => h.center);
    return boundsOf(pts.length > 0 ? pts : [ATHENS_CENTER]);
  }, [mode, zones, heat]);

  const project = useMemo(() => {
    if (!shown || box.w === 0 || box.h === 0) return null;
    // A single point has zero span; pad it out so the projector stays sane.
    const b: Bounds =
      shown.maxLng - shown.minLng < 1e-5 || shown.maxLat - shown.minLat < 1e-5
        ? {
            minLng: shown.minLng - 0.01,
            maxLng: shown.maxLng + 0.01,
            minLat: shown.minLat - 0.01,
            maxLat: shown.maxLat + 0.01,
          }
        : shown;
    return makeProjector(b, box.w, box.h, 28);
  }, [shown, box]);

  return (
    <View style={st.fill} onLayout={onLayout}>
      <View style={st.fallbackBanner}>
        <Icon name="info" size={16} color={theme.c.textMuted} />
        <Text style={st.fallbackText} numberOfLines={2}>
          Schematic view — no Mapbox token. Shapes and positions are to scale; streets are not drawn.
        </Text>
      </View>

      {project && box.w > 0 ? (
        <Svg width={box.w} height={box.h} style={st.plot}>
          {mode === 'place'
            ? zones.map((z) => {
                const def = LAYER_DEFS.find((d) => d.key === layerOf(z)) ?? LAYER_DEFS[3]!;
                const tint = def.color(theme);
                return z.geom.coordinates.map((ring, ri) => (
                  <SvgPolygon
                    key={`${z.id}-${ri}`}
                    points={ring.map((p) => project(p).join(',')).join(' ')}
                    fill={withAlpha(tint, 0.16)}
                    stroke={tint}
                    strokeWidth={2}
                    strokeDasharray={def.dashed ? '6,5' : undefined}
                  />
                ));
              })
            : heat.map((h, i) => {
                const bucket = bucketOf(h);
                const tint = heatColor(bucket, theme);
                return (
                  <SvgPolygon
                    key={i}
                    points={hexRing(h.center, HEX_RADIUS_M)
                      .map((p) => project(p).join(','))
                      .join(' ')}
                    fill={withAlpha(tint, bucket === 'quiet' ? 0.25 : 0.45)}
                    stroke={tint}
                    strokeWidth={1.5}
                  />
                );
              })}
          {mode === 'place'
            ? zones
                .filter((z) => layerOf(z) === 'rebalance')
                .map((z) => {
                  const [x, y] = project(zoneCenter(z));
                  return (
                    <SvgCircle
                      key={`dot-${z.id}`}
                      cx={x}
                      cy={y}
                      r={4}
                      fill={z.target_count > z.current_count ? theme.c.warning : theme.c.success}
                    />
                  );
                })
            : null}
        </Svg>
      ) : null}
    </View>
  );
}

// --- Chrome pieces ----------------------------------------------------------
function RoundButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [st.round, active && { borderColor: theme.c.primary }, pressed && { opacity: 0.7 }]}
    >
      <Icon name={icon} size={24} color={active ? theme.c.primary : theme.c.text} />
    </Pressable>
  );
}

function Legend({ mode, layers }: { mode: 'place' | 'heatmap'; layers: ZoneLayers }) {
  const theme = useTheme();
  const st = useStyles(theme);
  const items =
    mode === 'heatmap'
      ? HEAT_LEGEND.map((h) => ({ key: h.bucket, color: heatColor(h.bucket, theme), label: h.label, dashed: false }))
      : LAYER_DEFS.filter((d) => layers[d.key]).map((d) => ({
          key: d.key,
          color: d.color(theme),
          label: d.label,
          dashed: d.dashed,
        }));

  return (
    <View style={st.legend}>
      <Text style={st.legendTitle}>
        {mode === 'heatmap' ? 'Idle scooters per cell — more is worse' : 'Zone boundaries'}
      </Text>
      <View style={st.legendRow}>
        {items.map((it) => (
          <View key={it.key} style={st.legendItem}>
            <View
              style={[
                st.legendSwatch,
                { backgroundColor: withAlpha(it.color, 0.3), borderColor: it.color },
                it.dashed && { borderStyle: 'dashed' },
              ]}
            />
            <Text style={st.legendLabel} numberOfLines={1}>
              {it.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ZoneSummary({ zones, deficits }: { zones: MirrorZone[]; deficits: { zone: MirrorZone; gap: number }[] }) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  return (
    <>
      <Muted>
        {zones.length} zone{zones.length === 1 ? '' : 's'} drawn.{' '}
        {deficits.length === 0
          ? 'Every rebalancing zone is at or above target.'
          : 'Zones below target, biggest shortfall first.'}
      </Muted>

      {deficits.map(({ zone, gap }) => (
        <View key={zone.id} style={st.summaryRow}>
          <View style={[st.swatch, { backgroundColor: withAlpha(c.warning, 0.3), borderColor: c.warning }]} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{zone.name}</Body>
            <Muted>
              {zone.current_count} of {zone.target_count} parked · {zone.demand} demand
            </Muted>
          </View>
          <Badge label={`need ${gap}`} color={c.warning} textColor={c.onWarning} />
        </View>
      ))}

      {deficits.length > 0 ? <Divider /> : null}

      {LAYER_DEFS.map((def) => {
        const n = zones.filter((z) => layerOf(z) === def.key).length;
        if (n === 0) return null;
        return (
          <View key={def.key} style={st.summaryRow}>
            <View style={[st.swatch, swatchStyle(def, theme)]} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '700' }}>
                {def.label} · {n}
              </Body>
              <Muted>{def.hint}</Muted>
            </View>
          </View>
        );
      })}
    </>
  );
}

function HeatSummary({
  hot,
  busiest,
  totalIdle,
  cellCount,
}: {
  hot: HeatCell[];
  busiest: HeatCell[];
  totalIdle: number;
  cellCount: number;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  return (
    <>
      <Muted>
        {totalIdle} idle scooter{totalIdle === 1 ? '' : 's'} across {cellCount} cell
        {cellCount === 1 ? '' : 's'}.{' '}
        {hot.length === 0
          ? `Nothing has reached the ${HOT_MIN}-per-cell pile-up threshold — the busiest cells are listed anyway.`
          : `${hot.length} cell${hot.length === 1 ? '' : 's'} at or above ${HOT_MIN}.`}
      </Muted>

      {HEAT_LEGEND.map((h) => (
        <View key={h.bucket} style={st.summaryRow}>
          <View
            style={[
              st.swatch,
              {
                backgroundColor: withAlpha(heatColor(h.bucket, theme), 0.3),
                borderColor: heatColor(h.bucket, theme),
              },
            ]}
          />
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{h.label}</Body>
            <Muted>{h.hint}</Muted>
          </View>
        </View>
      ))}

      <Divider />

      {busiest.map((h, i) => {
        const bucket = bucketOf(h);
        return (
          <View key={i} style={st.summaryRow}>
            <View
              style={[
                st.swatch,
                { backgroundColor: withAlpha(heatColor(bucket, theme), 0.3), borderColor: heatColor(bucket, theme) },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '700' }}>
                {h.idle_count} idle · {h.center[1].toFixed(4)}, {h.center[0].toFixed(4)}
              </Body>
              <Muted>{Math.round(h.weight * 100)}% of the busiest cell</Muted>
            </View>
          </View>
        );
      })}
    </>
  );
}

function swatchStyle(def: LayerDef, theme: OpsTheme) {
  const tint = def.color(theme);
  return {
    backgroundColor: withAlpha(tint, 0.3),
    borderColor: tint,
    borderStyle: def.dashed ? ('dashed' as const) : ('solid' as const),
  };
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  plot: { position: 'absolute', top: 0, left: 0 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: t.space.lg },
  segmented: { alignSelf: 'center', minWidth: 240, maxWidth: 380, width: '100%' },
  rail: { position: 'absolute', right: t.space.lg, gap: t.space.sm },
  round: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: t.space.lg, gap: t.space.sm },
  legend: {
    backgroundColor: withAlpha(t.c.surface, 0.94),
    borderWidth: 1,
    borderColor: t.c.border,
    borderRadius: t.radius.lg,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    gap: 6,
  },
  legendTitle: { color: t.c.textMuted, fontSize: t.font.size.xs, fontWeight: '700' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 2 },
  legendLabel: { color: t.c.text, fontSize: t.font.size.xs, fontWeight: '600' },
  summaryBar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    paddingHorizontal: t.space.lg,
    borderRadius: t.radius.lg,
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  summaryText: { flex: 1, color: t.c.text, fontSize: t.font.size.md, fontWeight: '700' },
  sheetBody: { padding: t.space.lg, gap: t.space.md, paddingBottom: t.space.xxxl },
  layerRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 44 },
  swatch: { width: 22, height: 22, borderRadius: 6, borderWidth: 2 },
  target: {
    backgroundColor: t.c.surface,
    borderWidth: 2,
    borderColor: t.c.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.sm,
    paddingVertical: 3,
    alignItems: 'center',
  },
  targetText: { color: t.c.text, fontSize: t.font.size.xs, fontWeight: '700' },
  targetGap: { fontSize: t.font.size.xs, fontWeight: '700' },
  fallbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    backgroundColor: t.c.surfaceAlt,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    marginTop: 0,
  },
  fallbackText: { flex: 1, color: t.c.textMuted, fontSize: t.font.size.xs },
}));
