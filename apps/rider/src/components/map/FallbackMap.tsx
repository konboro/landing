// Graceful, dependency-light map used when native Mapbox isn't available
// (Expo Go / no token). Projects the real fleet + zones into a styled canvas
// with tappable vehicle pins and a zone legend — fully interactive.
//
// Every colour comes from the active brand (zone fills, pins, route), so the
// fallback map re-themes with the rest of the app.
import React, { useState } from 'react';
import { View, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Polygon as SvgPolygon, Circle, Line, Polyline } from 'react-native-svg';
import { useTheme, makeStyles } from '../../brand';
import type { RiderTheme } from '../../brand';
import { Badge } from '../ui';
import { Icon } from '../ui/Icon';
import { boundsOf, makeProjector } from './projection';
import type { FleetMapProps, LngLat } from './types';

function zoneStyle(theme: RiderTheme, kind: string): { fill: string; stroke: string } {
  const c = theme.color;
  switch (kind) {
    case 'operating': return { fill: 'transparent', stroke: c.primary };
    case 'parking':
    case 'parking_station': return { fill: c.zoneParking, stroke: c.success };
    case 'no_parking': return { fill: c.zoneNoParking, stroke: c.danger };
    case 'no_go': return { fill: c.zoneNoGo, stroke: c.text };
    case 'bonus': return { fill: c.zoneBonus, stroke: c.success };
    case 'paid_parking': return { fill: c.zonePaidParking, stroke: c.warning };
    case 'speed_limit': return { fill: c.zoneSpeedLimit, stroke: c.warning };
    default: return { fill: c.zoneParking, stroke: c.success };
  }
}

export function FallbackMap(props: FleetMapProps) {
  const { vehicles, zones, pois, userPos, selectedCode, showZones = true, showPois = true } = props;
  const theme = useTheme();
  const styles = useStyles(theme);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const route = props.route ?? [];
  // Bounds from everything visible so the whole city (or the whole route) fits.
  // A route on its own gets tighter padding so the trip fills the card.
  const pts: LngLat[] =
    route.length > 1
      ? route
      : [
          props.center,
          ...vehicles.map((v) => [v.lng, v.lat] as LngLat),
          ...zones.flatMap((z) => z.geom.coordinates.flat() as LngLat[]),
        ];
  const b = boundsOf(pts, route.length > 1 ? 0.15 : 0.08);
  const project = makeProjector(b, size.w, size.h);

  const ready = size.w > 0 && size.h > 0;
  const night = props.night ?? theme.mode === 'dark';
  const gridStroke = night ? theme.color.surfaceAlt : theme.color.border;

  return (
    <Pressable style={[styles.canvas, night && styles.canvasNight]} onLayout={onLayout} onPress={props.onMapPress}>
      {/* faux street grid */}
      <View style={styles.grid} pointerEvents="none">
        {ready ? (
          <Svg width={size.w} height={size.h}>
            {Array.from({ length: 7 }).map((_, i) => (
              <Line
                key={`v${i}`}
                x1={(size.w / 7) * (i + 0.5)}
                y1={0}
                x2={(size.w / 7) * (i + 0.5)}
                y2={size.h}
                stroke={gridStroke}
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: 12 }).map((_, i) => (
              <Line
                key={`h${i}`}
                x1={0}
                y1={(size.h / 12) * (i + 0.5)}
                x2={size.w}
                y2={(size.h / 12) * (i + 0.5)}
                stroke={gridStroke}
                strokeWidth={1}
              />
            ))}
          </Svg>
        ) : null}
      </View>

      {/* zones */}
      {ready && showZones ? (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          {zones.map((z) => {
            const style = zoneStyle(theme, z.kind);
            const ring = z.geom.coordinates[0] ?? [];
            const pointsStr = ring.map((c) => { const p = project(c as LngLat); return `${p.x},${p.y}`; }).join(' ');
            return (
              <SvgPolygon
                key={z.id}
                points={pointsStr}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={z.kind === 'operating' ? 2 : 1.5}
                strokeDasharray={z.kind === 'operating' ? '8 6' : undefined}
                opacity={0.9}
              />
            );
          })}
        </Svg>
      ) : null}

      {/* trip route */}
      {ready && route.length > 1 ? (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Polyline
            points={route.map((c) => { const p = project(c); return `${p.x},${p.y}`; }).join(' ')}
            fill="none"
            stroke={theme.color.primary}
            strokeWidth={4}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {(() => {
            const a = project(route[0]!);
            const z = project(route[route.length - 1]!);
            return (
              <>
                <Circle cx={a.x} cy={a.y} r={6} fill={theme.color.success} stroke={theme.color.surface} strokeWidth={2} />
                <Circle cx={z.x} cy={z.y} r={6} fill={theme.color.danger} stroke={theme.color.surface} strokeWidth={2} />
              </>
            );
          })()}
        </Svg>
      ) : null}

      {/* POIs */}
      {ready && showPois
        ? pois.map((p) => {
            const s = project([p.lng, p.lat]);
            return (
              <View key={p.id} style={[styles.poi, { left: s.x - 12, top: s.y - 12 }]} pointerEvents="none">
                <Icon name={(p.icon as any) === 'transit' ? 'transit' : p.kind === 'charger' ? 'charge' : p.kind === 'station' ? 'station' : 'star'} size={16} />
              </View>
            );
          })
        : null}

      {/* user location */}
      {ready && userPos ? (() => {
        const s = project(userPos);
        return (
          <View style={[styles.userDot, { left: s.x - 9, top: s.y - 9 }]} pointerEvents="none">
            <View style={styles.userCore} />
          </View>
        );
      })() : null}

      {/* vehicles */}
      {ready
        ? vehicles.map((v) => {
            const s = project([v.lng, v.lat]);
            const selected = v.code === selectedCode;
            return (
              <Pressable
                key={v.vehicle_id}
                onPress={() => props.onSelectVehicle(v.code)}
                style={[
                  styles.pin,
                  { left: s.x - 18, top: s.y - 40 },
                  selected && styles.pinSelected,
                ]}
                hitSlop={8}
              >
                <View
                  style={[
                    styles.pinBubble,
                    // Rider-visible vehicles are available (or reserved by this
                    // rider) — colour the ring from the brand's status palette.
                    { borderColor: theme.statusColor(v.reserved_by_me ? 'reserved' : 'available') },
                    selected && { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
                  ]}
                >
                  <Icon name="scooter" size={18} color={selected ? theme.color.onPrimary : theme.color.text} />
                </View>
                <View style={[styles.pinTail, selected && { borderTopColor: theme.color.primary }]} />
                {v.reserved_by_me ? <View style={styles.reservedDot} /> : null}
              </Pressable>
            );
          })
        : null}

      {/* header hint */}
      {props.static ? null : (
        <View style={styles.hint} pointerEvents="none">
          <Badge label="Mock map" tone="primary" icon="map" />
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  canvas: { flex: 1, backgroundColor: t.color.surfaceAlt, overflow: 'hidden' },
  canvasNight: { backgroundColor: t.color.bg },
  grid: { ...StyleSheet.absoluteFillObject },
  hint: { position: 'absolute', top: 12, left: 12 },
  pin: { position: 'absolute', width: 36, alignItems: 'center' },
  pinSelected: { zIndex: 20 },
  pinBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.color.surface,
    ...t.shadow.card,
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: t.color.surface,
    marginTop: -1,
  },
  reservedDot: {
    position: 'absolute',
    top: 0,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: t.color.warning,
    borderWidth: 2,
    borderColor: t.color.surface,
  },
  poi: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...t.shadow.card,
  },
  userDot: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.color.primary,
    borderWidth: 2,
    borderColor: t.color.surface,
  },
}));
