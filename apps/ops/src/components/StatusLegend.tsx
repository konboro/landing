// Status color legend for the ops maps (glove-friendly, always available).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, makeStyles } from '../brand';

export function StatusLegend() {
  const theme = useTheme();
  const st = useStyles(theme);
  return (
    <View style={st.wrap}>
      {theme.legend.map((l) => (
        <View key={l.status} style={st.item}>
          <View style={[st.dot, { backgroundColor: l.color }]} />
          <Text style={st.label}>{l.label}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md, rowGap: t.space.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { color: t.c.textMuted, fontSize: t.font.size.xs, fontWeight: '600' },
}));
