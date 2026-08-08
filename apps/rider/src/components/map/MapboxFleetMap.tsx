// Native Mapbox implementation. Imported ONLY when EXPO_PUBLIC_MAPBOX_TOKEN is
// set (see FleetMap.tsx), so @rnmapbox/maps native code never loads in Expo Go.
import React, { useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { useTheme, makeStyles } from '../../brand';
import type { RiderTheme } from '../../brand';
import { T } from '../ui';
import { Icon } from '../ui/Icon';
import { buildIndex, clustersFor } from './cluster';
import type { FleetMapProps } from './types';

const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (token) {
  try {
    Mapbox.setAccessToken(token);
  } catch {
    /* ignore */
  }
}

function zoneFill(theme: RiderTheme, kind: string): string {
  const c = theme.color;
  const map: Record<string, string> = {
    parking: c.zoneParking,
    parking_station: c.zoneParking,
    no_parking: c.zoneNoParking,
    no_go: c.zoneNoGo,
    bonus: c.zoneBonus,
    paid_parking: c.zonePaidParking,
    speed_limit: c.zoneSpeedLimit,
    operating: c.zoneOperating,
  };
  return map[kind] ?? 'transparent';
}

export function MapboxFleetMap(props: FleetMapProps) {
  const theme = useTheme();
  const styles = useStyles(theme);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [zoom, setZoom] = useState(props.night ? 13.5 : 14.5);
  const [bbox, setBbox] = useState<[number, number, number, number]>([23.68, 37.94, 23.78, 38.02]);

  const index = useMemo(() => buildIndex(props.vehicles), [props.vehicles]);
  const clusters = useMemo(() => clustersFor(index, bbox, zoom), [index, bbox, zoom]);

  const zoneFeatures = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (props.showZones === false ? [] : props.zones).map((z) => ({
        type: 'Feature' as const,
        properties: { kind: z.kind, color: zoneFill(theme, z.kind) },
        geometry: z.geom,
      })),
    }),
    [props.zones, props.showZones, theme],
  );

  return (
    <Mapbox.MapView
      style={StyleSheet.absoluteFill}
      styleURL={props.night ?? theme.mode === 'dark' ? theme.map.night : theme.map.day}
      onPress={props.onMapPress}
      onCameraChanged={(e: any) => {
        const b = e?.properties?.bounds;
        if (b?.sw && b?.ne) setBbox([b.sw[0], b.sw[1], b.ne[0], b.ne[1]]);
        if (typeof e?.properties?.zoom === 'number') setZoom(e.properties.zoom);
      }}
      scaleBarEnabled={false}
      compassEnabled
    >
      <Mapbox.Camera
        ref={cameraRef}
        defaultSettings={{ centerCoordinate: props.center, zoomLevel: zoom }}
        centerCoordinate={props.focus ?? undefined}
        animationMode="flyTo"
        animationDuration={600}
      />
      {props.userPos ? <Mapbox.UserLocation visible /> : null}

      {props.route && props.route.length > 1 ? (
        <Mapbox.ShapeSource
          id="trip-route"
          shape={{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: props.route },
          } as any}
        >
          <Mapbox.LineLayer
            id="trip-route-line"
            style={{
              lineColor: theme.color.primary,
              lineWidth: 4,
              lineCap: 'round',
              lineJoin: 'round',
            } as any}
          />
        </Mapbox.ShapeSource>
      ) : null}

      <Mapbox.ShapeSource id="zones" shape={zoneFeatures as any}>
        <Mapbox.FillLayer id="zones-fill" style={{ fillColor: ['get', 'color'], fillOpacity: 0.6 } as any} />
        <Mapbox.LineLayer id="zones-line" style={{ lineColor: ['get', 'color'], lineWidth: 1.5 } as any} />
      </Mapbox.ShapeSource>

      {clusters.map((c) =>
        c.count > 1 ? (
          <Mapbox.MarkerView key={c.id} coordinate={[c.lng, c.lat]} allowOverlap>
            <Pressable
              style={styles.cluster}
              onPress={() => cameraRef.current?.setCamera({ centerCoordinate: [c.lng, c.lat], zoomLevel: zoom + 2, animationDuration: 400 })}
            >
              <T variant="body" color={theme.color.onPrimary} style={{ fontWeight: '700' }}>{c.count}</T>
            </Pressable>
          </Mapbox.MarkerView>
        ) : (
          <Mapbox.MarkerView key={c.id} coordinate={[c.lng, c.lat]} allowOverlap>
            <Pressable
              onPress={() => c.code && props.onSelectVehicle(c.code)}
              style={[styles.pin, c.code === props.selectedCode && { backgroundColor: theme.color.primary, borderColor: theme.color.primary }]}
            >
              <Icon name="scooter" size={18} color={c.code === props.selectedCode ? theme.color.onPrimary : theme.color.text} />
            </Pressable>
          </Mapbox.MarkerView>
        ),
      )}
    </Mapbox.MapView>
  );
}

const useStyles = makeStyles((t) => ({
  cluster: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: t.color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.color.surface,
  },
  pin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.color.surface,
    ...t.shadow.card,
  },
}));
