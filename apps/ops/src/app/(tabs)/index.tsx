import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { FleetMap, type MapLayers } from '../../components/FleetMap';
import { SyncPill } from '../../components/SyncPill';
import { useMirror } from '../../lib/useMirror';
import { getVehicles, getZones, getHeatCells } from '../../offline/repo';
import { useTheme, makeStyles } from '../../brand';
import type { OpsVehicle } from '../../lib/types';

const LAYER_DEFS: { key: keyof MapLayers; label: string }[] = [
  { key: 'showAlarms', label: 'Alarms' },
  { key: 'showZones', label: 'Zones' },
  { key: 'showHeatmap', label: 'Idle heat' },
  { key: 'showHidden', label: 'Hidden' },
];

export default function MapTab() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const vehicles = useMirror(getVehicles, [] as OpsVehicle[]);
  const zones = useMirror(getZones, []);
  const heat = useMirror(getHeatCells, []);
  const [layers, setLayers] = useState<MapLayers>({ showAlarms: true, showZones: true, showHeatmap: false, showHidden: true });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={st.topbar}>
        <SyncPill />
        <Pressable style={st.legendBtn} onPress={() => router.push('/more')}>
          <Text style={st.legendText}>Legend</Text>
        </Pressable>
      </View>

      <View style={st.layerBar}>
        {LAYER_DEFS.map((l) => {
          const on = layers[l.key];
          return (
            <Pressable
              key={l.key}
              onPress={() => setLayers((prev) => ({ ...prev, [l.key]: !prev[l.key] }))}
              style={[st.chip, on && st.chipOn]}
            >
              <Text style={[st.chipText, on && st.chipTextOn]}>{l.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <FleetMap
        vehicles={vehicles.data}
        zones={zones.data}
        heat={heat.data}
        layers={layers}
        onSelect={(v) => router.push(`/vehicle/${v.id}`)}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.space.md, paddingTop: t.space.sm, paddingBottom: t.space.xs, backgroundColor: t.c.surface },
  legendBtn: { paddingHorizontal: t.space.md, paddingVertical: 6, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.c.border },
  legendText: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '600' },
  layerBar: { flexDirection: 'row', gap: t.space.sm, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, backgroundColor: t.c.surface, borderBottomWidth: 1, borderColor: t.c.border },
  chip: { paddingHorizontal: t.space.md, paddingVertical: 6, borderRadius: t.radius.pill, backgroundColor: t.c.surfaceAlt, borderWidth: 1, borderColor: t.c.border },
  chipOn: { backgroundColor: t.c.primary, borderColor: t.c.primary },
  chipText: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '700' },
  chipTextOn: { color: t.c.onPrimary },
}));
