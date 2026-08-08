import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { SyncPill } from '../../components/SyncPill';
import { TaskCard } from '../../components/TaskCard';
import { Empty } from '../../components/ui';
import { useMirror } from '../../lib/useMirror';
import { getTasks, getVehicles } from '../../offline/repo';
import { useOps } from '../../lib/store';
import { c, space, radius, font } from '../../lib/theme';
import type { OpsTask } from '@penny/db-types';
import type { OpsVehicle } from '../../lib/types';

type Filter = 'all' | 'mine' | 'unassigned' | 'open' | 'in_progress' | 'auto';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'auto', label: 'Auto' },
];
const KINDS = ['battery_swap', 'rebalance', 'repair', 'inspect', 'pickup', 'deploy'];

export default function TasksTab() {
  const router = useRouter();
  const staffId = useOps((s) => s.session?.staff_id);
  const tasks = useMirror(getTasks, [] as OpsTask[]);
  const vehicles = useMirror(getVehicles, [] as OpsVehicle[]);
  const [filter, setFilter] = useState<Filter>('all');
  const [kind, setKind] = useState<string | null>(null);

  const vmap = useMemo(() => new Map(vehicles.data.map((v) => [v.id, v])), [vehicles.data]);

  const filtered = useMemo(() => {
    return tasks.data
      .filter((t) => t.status !== 'cancelled')
      .filter((t) => (kind ? t.kind === kind : true))
      .filter((t) => {
        switch (filter) {
          case 'mine': return t.assignee === staffId;
          case 'unassigned': return !t.assignee;
          case 'open': return t.status === 'open';
          case 'in_progress': return t.status === 'in_progress';
          case 'auto': return t.created_by === 'system_rule';
          default: return true;
        }
      })
      .sort((a, b) => (b.priority - a.priority) || (a.status === 'done' ? 1 : -1));
  }, [tasks.data, filter, kind, staffId]);

  const counts = useMemo(() => ({
    open: tasks.data.filter((t) => t.status === 'open').length,
    inProgress: tasks.data.filter((t) => t.status === 'in_progress').length,
    done: tasks.data.filter((t) => t.status === 'done').length,
  }), [tasks.data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={st.header}>
        <SyncPill />
        <Text style={st.counts}>
          {counts.open} open · {counts.inProgress} active · {counts.done} done
        </Text>
      </View>

      <View style={st.filterRow}>
        <FlatList
          horizontal
          data={FILTERS}
          keyExtractor={(f) => f.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.md, gap: space.sm }}
          renderItem={({ item }) => (
            <Pressable onPress={() => setFilter(item.key)} style={[st.chip, filter === item.key && st.chipOn]}>
              <Text style={[st.chipText, filter === item.key && st.chipTextOn]}>{item.label}</Text>
            </Pressable>
          )}
        />
      </View>
      <View style={st.filterRow}>
        <FlatList
          horizontal
          data={[{ id: 'all' }, ...KINDS.map((k) => ({ id: k }))]}
          keyExtractor={(k) => k.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.md, gap: space.sm }}
          renderItem={({ item }) => {
            const active = item.id === 'all' ? kind === null : kind === item.id;
            return (
              <Pressable onPress={() => setKind(item.id === 'all' ? null : item.id)} style={[st.chipSm, active && st.chipOn]}>
                <Text style={[st.chipText, active && st.chipTextOn]}>{item.id.replace('_', ' ')}</Text>
              </Pressable>
            );
          }}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxxl }}
        ListEmptyComponent={<Empty text="No tasks match this filter." />}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            vehicleCode={item.vehicle_id ? vmap.get(item.vehicle_id)?.code : undefined}
            onPress={() => router.push(`/task/${item.id}`)}
          />
        )}
      />
    </View>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.md, backgroundColor: c.surface },
  counts: { color: c.textMuted, fontSize: font.size.xs, fontWeight: '600' },
  filterRow: { paddingVertical: space.xs, backgroundColor: c.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  chip: { paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  chipSm: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { color: c.textMuted, fontSize: font.size.sm, fontWeight: '700', textTransform: 'capitalize' },
  chipTextOn: { color: c.onPrimary },
});
