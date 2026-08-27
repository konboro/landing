// Native Mapbox implementation. Imported ONLY when EXPO_PUBLIC_MAPBOX_TOKEN is
// set (see FleetMap.tsx), so @rnmapbox/maps native code never loads in Expo Go.
import React, { useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { OPERATING_BBOX } from '@penny/geo';
import { useTheme, makeStyles } from '../../brand';
import { T } from '../ui';
import { Icon } from '../ui/Icon';
import { buildIndex, clustersFor } from './cluster';
import { sortForDrawing, zoneStyle } from './zoneStyle';
import type { FleetMapProps } from './types';

const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (token) {
  try {
    Mapbox.setAccessToken(token);
  } catch {
    /* ignore */
  }
}

export function MapboxFleetMap(props: FleetMapProps) {
  const theme = useTheme();
  const styles = useStyles(theme);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [zoom, setZoom] = useState(props.night ? 13.5 : 14.5);
  const [bbox, setBbox] = useState<[number, number, number, number]>([OPERATING_BBOX.minLng, OPERATING_BBOX.minLat, OPERATING_BBOX.maxLng, OPERATING_BBOX.maxLat]);

  const index = useMemo(() => buildIndex(props.vehicles), [props.vehicles]);
  const clusters = useMemo(() => clustersFor(index, bbox, zoom), [index, bbox, zoom]);

  /**
   * One source per kind, emitted in draw order.
   *
   * The old code put every zone in a single source with one fill layer and one
   * line layer above it. Mapbox then drew all fills first and all outlines
   * after, so the city-wide `operating` outline was painted OVER a no-go zone's
   * fill, and any zone whose kind had no colour became `'transparent'` — fetched
   * and then invisible. Splitting by kind lets each get its real paint, and
   * `sortForDrawing` guarantees restrictions land on top of what contains them.
   */
  const zoneGroups = useMemo(() => {
    const zones = props.showZones === false ? [] : props.zones;
    const order: string[] = [];
    const byKind = new Map<string, typeof zones>();
    for (const z of sortForDrawing(theme, zones)) {
      const group = byKind.get(z.kind);
      if (group) group.push(z);
      else {
        byKind.set(z.kind, [z]);
        order.push(z.kind);
      }
    }
    return order.map((kind) => ({
      kind,
      style: zoneStyle(theme, kind),
      shape: {
        type: 'FeatureCollection' as const,
        features: byKind.get(kind)!.map((z) => ({
          type: 'Feature' as const,
          id: z.id,
          properties: { kind: z.kind, name: z.name ?? '' },
          geometry: z.geom,
        })),
      },
    }));
  }, [props.zones, props.showZones, theme]);

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
      // Compass off: it sat in the top-right under the messages button, and a
      // rider never rotates the map away from north in normal use.
      compassEnabled={false}
    >
      <Mapbox.Camera
        ref={cameraRef}
        defaultSettings={{ centerCoordinate: props.center, zoomLevel: zoom }}
        centerCoordinate={props.focus ?? undefined}
        animationMode="flyTo"
        animationDuration={600}
      />
      {props.userPos ? <Mapbox.UserLocation visible /> : null}

      {/* Zones first: later children paint on top, and the rider's own route
          must not end up buried under a zone fill. */}
      {zoneGroups.map((g) => (
        <Mapbox.ShapeSource key={g.kind} id={`zones-${g.kind}`} shape={g.shape as any}>
          {[
            // `operating` is outline-only, so it contributes no fill layer at
            // all rather than a transparent one. Built as an array because
            // ShapeSource's children are typed as elements, not `null`.
            ...(g.style.fill === 'transparent'
              ? []
              : [
                  <Mapbox.FillLayer
                    key="fill"
                    id={`zones-fill-${g.kind}`}
                    style={{ fillColor: g.style.fill, fillOpacity: 1 } as any}
                  />,
                ]),
            <Mapbox.LineLayer
              key="line"
              id={`zones-line-${g.kind}`}
              style={
                {
                  lineColor: g.style.stroke,
                  lineWidth: g.style.strokeWidth,
                  lineOpacity: 0.9,
                  ...(g.style.dashed ? { lineDasharray: [3, 2] } : {}),
                } as any
              }
            />,
          ]}
        </Mapbox.ShapeSource>
      ))}

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
