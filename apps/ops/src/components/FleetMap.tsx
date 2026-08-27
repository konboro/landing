// Fleet map with the SAME graceful fallback pattern the rider app uses: guard
// the @rnmapbox/maps native import and, when there's no Mapbox token (Expo Go /
// standalone demo), render a styled fallback panel + scrollable vehicle list so
// the app is fully usable without native maps.
//
// Renders the FULL fleet (not just available) with status colors, an alarms
// layer, rebalancing zones with target counts, an idle-heatmap overlay, and
// greys hidden (visible=false) vehicles with a "hidden" badge.
import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { hasMapboxToken, env } from '../lib/env';
import { useTheme, makeStyles, withAlpha } from '../brand';
import type { OpsTheme } from '../brand';
import { StatusDot, Badge } from './ui';
import { formatSoc } from '@penny/ui';
import type { OpsVehicle, RebalanceZone, HeatCell } from '../lib/types';
import type { LngLat } from '@penny/db-types';
import { OPERATING_CITY } from '@penny/geo';
import { sortZonesForDrawing, zoneLayerOf, type ZoneLayerKey } from '../lib/zones';

/** Fallback camera target. Was `ATHENS_CENTER` from the mock data module —
 *  literally Athens, 300 km from the live fleet in Thessaloniki, so the map
 *  opened on an empty patch of the wrong city. */
const CITY_FALLBACK: LngLat = [...OPERATING_CITY.center] as LngLat;

/**
 * What each field bucket looks like here.
 *
 * Every zone used to be `fillColor: c.primary, fillOpacity: 0.12` with no
 * outline, so on the map an operator works from, a no-go area and an approved
 * parking bay were the same flat blue smudge. Buckets and draw order come from
 * `lib/zones`, shared with the Place screen, so the two maps agree.
 */
const ZONE_TINT: Record<ZoneLayerKey, (t: OpsTheme) => string> = {
  operating: (t) => t.c.primary,
  parking: (t) => t.c.success,
  nogo: (t) => t.c.danger,
  rebalance: (t) => t.c.warning,
};

const ZONE_LABEL: Record<ZoneLayerKey, string> = {
  operating: 'Operating',
  parking: 'Parking',
  nogo: 'No-go',
  rebalance: 'Rebalance',
};

let Mapbox: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Mapbox = require('@rnmapbox/maps').default ?? require('@rnmapbox/maps');
  if (Mapbox?.setAccessToken && env.mapboxToken) Mapbox.setAccessToken(env.mapboxToken);
} catch {
  Mapbox = null;
}

export interface MapLayers {
  showAlarms: boolean;
  showZones: boolean;
  showHeatmap: boolean;
  showHidden: boolean;
}

export function FleetMap({
  vehicles,
  zones,
  heat,
  layers,
  onSelect,
  center,
  contentInsetTop,
}: {
  vehicles: OpsVehicle[];
  zones: RebalanceZone[];
  heat: HeatCell[];
  layers: MapLayers;
  onSelect: (v: OpsVehicle) => void;
  /** Optional camera target (locate-me). Omitted = stay on the city centre. */
  center?: LngLat | null;
  /**
   * Space to keep clear at the top. The caller may float controls over the map;
   * the native map does not care (it draws under them by design) but the
   * no-token fallback renders a real list that must not start underneath them.
   */
  contentInsetTop?: number;
}) {
  const nativeAvailable = !!Mapbox?.MapView && hasMapboxToken;

  const visibleVehicles = useMemo(
    () => vehicles.filter((v) => (layers.showHidden ? true : v.visible || v.status !== 'available')),
    [vehicles, layers.showHidden],
  );

  if (nativeAvailable) {
    return (
      <NativeMap vehicles={visibleVehicles} zones={zones} heat={heat} layers={layers} onSelect={onSelect} center={center} />
    );
  }
  return (
    <FallbackMap
      vehicles={visibleVehicles}
      zones={zones}
      heat={heat}
      layers={layers}
      onSelect={onSelect}
      contentInsetTop={contentInsetTop}
    />
  );
}

// --- Native Mapbox path -----------------------------------------------------
function NativeMap({ vehicles, zones, heat, layers, onSelect, center }: {
  vehicles: OpsVehicle[]; zones: RebalanceZone[]; heat: HeatCell[]; layers: MapLayers;
  onSelect: (v: OpsVehicle) => void; center?: LngLat | null;
}) {
  const theme = useTheme();
  const mapStyles = useStyles(theme);
  const { c, colorForStatus } = theme;
  const { MapView, Camera, PointAnnotation, ShapeSource, FillLayer, LineLayer, CircleLayer } = Mapbox;
  // Restrictions painted last, so a no-go inside the operating zone stays legible.
  const drawnZones = sortZonesForDrawing(zones);
  return (
    <View style={{ flex: 1 }}>
      <MapView style={{ flex: 1 }} styleURL={theme.mode === 'dark' ? theme.map.night : theme.map.day} scaleBarEnabled={false}>
        {/* A changed `center` re-targets the camera; zoom tightens to street
            level because "centre on me" is asked while standing somewhere. */}
        <Camera
          zoomLevel={center ? 15.5 : 12.5}
          centerCoordinate={center ?? CITY_FALLBACK}
          animationDuration={center ? 700 : 0}
        />

        {layers.showZones &&
          drawnZones.map((z) => {
            const tint = ZONE_TINT[zoneLayerOf(z)](theme);
            return (
              <ShapeSource key={z.id} id={`zone-${z.id}`} shape={{ type: 'Feature', geometry: z.geom, properties: {} }}>
                <FillLayer id={`zonefill-${z.id}`} style={{ fillColor: tint, fillOpacity: 0.14 }} />
                {/* An outline as well as a fill: at 0.14 opacity over a dark map
                    style the boundary was the only part actually visible, and it
                    was not being drawn at all. */}
                <LineLayer id={`zoneline-${z.id}`} style={{ lineColor: tint, lineWidth: 2 }} />
              </ShapeSource>
            );
          })}

        {layers.showHeatmap && heat.length > 0 && (
          <ShapeSource
            id="heat"
            shape={{
              type: 'FeatureCollection',
              features: heat.map((h) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: h.center },
                properties: { weight: h.weight },
              })),
            }}
          >
            <CircleLayer id="heatcircles" style={{ circleRadius: 26, circleColor: c.warning, circleOpacity: 0.18 }} />
          </ShapeSource>
        )}

        {vehicles.map((v) =>
          v.pos ? (
            <PointAnnotation key={v.id} id={v.id} coordinate={v.pos} onSelected={() => onSelect(v)}>
              <View
                style={[
                  mapStyles.marker,
                  { backgroundColor: colorForStatus(v.status) },
                  !v.visible && mapStyles.hiddenMarker,
                  layers.showAlarms && hasAlarm(v) && mapStyles.alarmRing,
                ]}
              />
            </PointAnnotation>
          ) : null,
        )}
      </MapView>
    </View>
  );
}

// --- Fallback path (no token / Expo Go) -------------------------------------
function FallbackMap({ vehicles, zones, heat, layers, onSelect, contentInsetTop }: {
  vehicles: OpsVehicle[]; zones: RebalanceZone[]; heat: HeatCell[]; layers: MapLayers;
  onSelect: (v: OpsVehicle) => void; contentInsetTop?: number;
}) {
  const theme = useTheme();
  const mapStyles = useStyles(theme);
  const { c, space } = theme;
  const alarms = vehicles.filter(hasAlarm);
  return (
    <View style={{ flex: 1, paddingTop: contentInsetTop ?? 0 }}>
      <View style={mapStyles.banner}>
        <Text style={mapStyles.bannerTitle}>Map fallback</Text>
        <Text style={mapStyles.bannerText}>
          No Mapbox token set — showing the fleet as a list. Set EXPO_PUBLIC_MAPBOX_TOKEN and run a dev
          client for the live map.
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxxl }}>
        {layers.showZones && zones.length > 0 && (
          <View style={mapStyles.section}>
            {/* Was headed "Rebalancing zones" and showed a target-vs-current
                count for every row — including the operating zone and the no-go
                areas, which have no target, so they all read "0/0 ✓" as though
                they were fully stocked. Each row now says which kind of zone it
                is, and the count appears only where a target was actually set. */}
            <Text style={mapStyles.sectionTitle}>Zones ({zones.length})</Text>
            {sortZonesForDrawing(zones)
              .slice()
              .reverse()
              .map((z) => {
                const layer = zoneLayerOf(z);
                const tint = ZONE_TINT[layer](theme);
                const gap = z.target_count - z.current_count;
                return (
                  <View key={z.id} style={mapStyles.zoneRow}>
                    <View style={[mapStyles.zoneSwatch, { backgroundColor: withAlpha(tint, 0.3), borderColor: tint }]} />
                    <Text style={mapStyles.zoneName} numberOfLines={1}>{z.name}</Text>
                    <Badge label={ZONE_LABEL[layer]} color={withAlpha(tint, 0.18)} textColor={c.text} />
                    {z.target_count > 0 ? (
                      <Text style={mapStyles.zoneCount}>
                        {z.current_count}/{z.target_count}
                        <Text style={{ color: gap > 0 ? c.warning : c.success }}>{gap > 0 ? `  (need ${gap})` : '  ✓'}</Text>
                      </Text>
                    ) : null}
                  </View>
                );
              })}
          </View>
        )}

        {layers.showHeatmap && heat.length > 0 && (
          <View style={mapStyles.section}>
            <Text style={mapStyles.sectionTitle}>Idle heatmap ({heat.length} clusters)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {heat.map((h, i) => (
                <View key={i} style={[mapStyles.heatChip, { opacity: 0.35 + h.weight * 0.65 }]}>
                  <Text style={mapStyles.heatText}>{h.idle_count} idle</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {layers.showAlarms && alarms.length > 0 && (
          <View style={[mapStyles.section, { borderColor: c.danger }]}>
            <Text style={[mapStyles.sectionTitle, { color: c.danger }]}>⚠ Alarms ({alarms.length})</Text>
            {alarms.map((v) => (
              <VehicleListRow key={v.id} v={v} onSelect={onSelect} />
            ))}
          </View>
        )}

        <View style={mapStyles.section}>
          <Text style={mapStyles.sectionTitle}>Fleet ({vehicles.length})</Text>
          {vehicles.map((v) => (
            <VehicleListRow key={v.id} v={v} onSelect={onSelect} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export function VehicleListRow({ v, onSelect }: { v: OpsVehicle; onSelect: (v: OpsVehicle) => void }) {
  const theme = useTheme();
  const mapStyles = useStyles(theme);
  const { c } = theme;
  return (
    <Pressable
      onPress={() => onSelect(v)}
      style={({ pressed }) => [mapStyles.vrow, !v.visible && { opacity: 0.55 }, pressed && { opacity: 0.7 }]}
    >
      <StatusDot status={v.status} size={14} />
      <View style={{ flex: 1 }}>
        <Text style={mapStyles.vcode}>{v.code}</Text>
        <Text style={mapStyles.vmeta}>
          {v.status.replace('_', ' ')} · {formatSoc(v.soc_pct)} · {v.online ? 'online' : 'offline'}
        </Text>
      </View>
      {hasAlarm(v) && <Badge label="alarm" color={c.danger} textColor={c.textInverse} />}
      {!v.visible && <Badge label="hidden" color={c.surfaceAlt} />}
    </Pressable>
  );
}

export function hasAlarm(v: OpsVehicle): boolean {
  return v.fall || v.power_cut || v.moved_while_locked || v.status === 'stolen';
}

const useStyles = makeStyles((t) => ({
  marker: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: t.c.bg },
  hiddenMarker: { opacity: 0.4, borderStyle: 'dashed' },
  alarmRing: { borderColor: t.c.danger, borderWidth: 3, width: 22, height: 22, borderRadius: 11 },
  banner: { backgroundColor: t.c.surfaceAlt, padding: t.space.md, gap: 2, borderBottomWidth: 1, borderColor: t.c.border },
  bannerTitle: { color: t.c.text, fontWeight: '700', fontSize: t.font.size.sm },
  bannerText: { color: t.c.textMuted, fontSize: t.font.size.xs },
  section: { backgroundColor: t.c.surface, borderRadius: t.radius.lg, padding: t.space.md, gap: t.space.sm, borderWidth: 1, borderColor: t.c.border },
  sectionTitle: { color: t.c.text, fontWeight: '700', fontSize: t.font.size.md },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  zoneSwatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 2 },
  zoneName: { color: t.c.text, fontWeight: '600', flex: 1 },
  zoneCount: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '600' },
  heatChip: { backgroundColor: t.c.warning, borderRadius: t.radius.sm, paddingHorizontal: t.space.sm, paddingVertical: 4 },
  heatText: { color: t.c.onWarning, fontSize: t.font.size.xs, fontWeight: '700' },
  vrow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.c.border },
  vcode: { color: t.c.text, fontWeight: '700', fontSize: t.font.size.md },
  vmeta: { color: t.c.textMuted, fontSize: t.font.size.sm, textTransform: 'capitalize' },
}));
