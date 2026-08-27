// What the colours on the map mean.
//
// The map drew up to ten kinds of coloured polygon and never once said what any
// of them were, so a red wash was indistinguishable from a dark one and a rider
// had no way to tell "no parking" from "no riding" except by ending a trip and
// being refused. Entries are derived from the zones actually on screen (see
// `zoneLegend`), so the legend cannot advertise a colour that is not drawn or
// omit one that is.
import React from 'react';
import { View, ScrollView } from 'react-native';
import { useTheme, makeStyles } from '../../brand';
import { T } from '../ui';
import { zoneLegend } from './zoneStyle';
import type { MapZone } from '../../services/types';

export function ZoneLegend({ zones }: { zones: MapZone[] }) {
  const theme = useTheme();
  const styles = useStyles(theme);
  const items = zoneLegend(theme, zones);
  if (items.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {items.map((it) => (
        <View key={it.kind} style={styles.chip}>
          <View
            style={[
              styles.swatch,
              {
                backgroundColor: it.fill,
                borderColor: it.stroke,
                borderStyle: it.dashed ? 'dashed' : 'solid',
              },
            ]}
          />
          <T variant="caption" style={styles.label}>
            {it.label}
          </T>
        </View>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  // `flexGrow: 0` — a horizontal ScrollView otherwise claims the whole height
  // of the absolutely-positioned wrapper and swallows taps meant for the map.
  scroll: { flexGrow: 0 },
  row: { flexDirection: 'row', gap: t.space.xs, paddingRight: t.space.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: t.space.sm,
    paddingVertical: 5,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surface,
    ...t.shadow.card,
  },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 2 },
  label: { fontWeight: '600' },
}));
