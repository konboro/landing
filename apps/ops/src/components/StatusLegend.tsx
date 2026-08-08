// Status color legend for the ops maps (glove-friendly, always available).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { STATUS_LEGEND, c, space, font } from '../lib/theme';

export function StatusLegend() {
  return (
    <View style={st.wrap}>
      {STATUS_LEGEND.map((l) => (
        <View key={l.status} style={st.item}>
          <View style={[st.dot, { backgroundColor: l.color }]} />
          <Text style={st.label}>{l.label}</Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, rowGap: space.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { color: c.textMuted, fontSize: font.size.xs, fontWeight: '600' },
});
