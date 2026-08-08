import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { FleetMap, type MapLayers } from '../../components/FleetMap';
import { SyncPill } from '../../components/SyncPill';
import { useMirror } from '../../lib/useMirror';
import { getVehicles, getZones, getHeatCells } from '../../offline/repo';
import { c, space, radius, font } from '../../lib/theme';
import type { OpsVehicle } from '../../lib/types';

const LAYER_DEFS: { key: keyof MapLayers; label: string }[] = [
  { key: 'showAlarms', label: 'Alarms' },
  { key: 'showZones', label: 'Zones' },
  { key: 'showHeatmap', label: 'Idle heat' },
  { key: 'showHidden', label: 'Hidden' },
];

export default function MapTab() {
  const router = useRouter();
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

const st = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xs, backgroundColor: c.surface },
  legendBtn: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  legendText: { color: c.textMuted, fontSize: font.size.sm, fontWeight: '600' },
  layerBar: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.border },
  chip: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { color: c.textMuted, fontSize: font.size.sm, fontWeight: '700' },
  chipTextOn: { color: c.onPrimary },
});
