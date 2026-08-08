// Mini route map — draws a trip's polyline in a compact card using SVG.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { theme } from '../lib/theme';
import { boundsOf, makeProjector } from './map/projection';
import type { LngLat } from '../services/types';

export function MiniRoute({ route, width = 92, height = 92 }: { route: LngLat[]; width?: number; height?: number }) {
  if (route.length < 2) {
    return <View style={[styles.box, { width, height }]} />;
  }
  const b = boundsOf(route, 0.2);
  const project = makeProjector(b, width, height);
  const pts = route.map(project);
  const str = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const start = pts[0]!;
  const end = pts[pts.length - 1]!;
  return (
    <View style={[styles.box, { width, height }]}>
      <Svg width={width} height={height}>
        <Polyline points={str} fill="none" stroke={theme.color.primary} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={start.x} cy={start.y} r={4} fill={theme.color.success} />
        <Circle cx={end.x} cy={end.y} r={4} fill={theme.color.danger} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
});
