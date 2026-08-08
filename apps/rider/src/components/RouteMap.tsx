// A read-only map card that draws a finished trip's route. Uses the same
// FleetMap abstraction as the home map, so it renders with native Mapbox when a
// token is present and falls back to the styled SVG canvas otherwise — the
// ride-detail screen never needs a token or a network connection.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, makeStyles } from '../brand';
import { FleetMap } from './map/FleetMap';
import type { LngLat } from '../services/types';
import { T, Row } from './ui/primitives';
import { Icon } from './ui/Icon';

export function RouteMap({
  route,
  height = 220,
  emptyLabel,
}: {
  route: LngLat[];
  height?: number;
  emptyLabel: string;
}) {
  const theme = useTheme();
  const styles = useStyles(theme);
  if (route.length < 2) {
    return (
      <View style={[styles.box, styles.empty, { height }]}>
        <Row gap={8}>
          <Icon name="map" size={18} color={theme.color.textMuted} />
          <T variant="caption">{emptyLabel}</T>
        </Row>
      </View>
    );
  }

  const center = route[Math.floor(route.length / 2)]!;
  return (
    <View style={[styles.box, { height }]}>
      <FleetMap
        vehicles={[]}
        zones={[]}
        pois={[]}
        userPos={null}
        center={center}
        selectedCode={null}
        showZones={false}
        showPois={false}
        route={route}
        static
        onSelectVehicle={() => {}}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  box: {
    borderRadius: t.radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  empty: { alignItems: 'center', justifyContent: 'center' },
}));
