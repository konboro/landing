import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SyncPill } from '../../components/SyncPill';
import { TaskCard } from '../../components/TaskCard';
import { Card, H2, Muted, Button, Empty, Row } from '../../components/ui';
import { useMirror } from '../../lib/useMirror';
import { getTasks, getVehicles } from '../../offline/repo';
import { useOps } from '../../lib/store';
import { getCurrentPos } from '../../lib/geoloc';
import { nearestNeighborRoute } from '../../lib/route';
import { formatDistance } from '@penny/ui';
import { navigateTo } from '../../lib/nav';
import { c, space, font } from '../../lib/theme';
import type { OpsTask } from '@penny/db-types';
import type { OpsVehicle } from '../../lib/types';
import type { LngLat } from '@penny/db-types';

export default function MyDayTab() {
  const router = useRouter();
  const staffId = useOps((s) => s.session?.staff_id);
  const tasks = useMirror(getTasks, [] as OpsTask[]);
  const vehicles = useMirror(getVehicles, [] as OpsVehicle[]);
  const [start, setStart] = useState<LngLat | null>(null);
  const [realPos, setRealPos] = useState(false);

  useEffect(() => {
    getCurrentPos().then(({ pos, real }) => {
      setStart(pos);
      setRealPos(real);
    });
  }, []);

  const vmap = useMemo(() => new Map(vehicles.data.map((v) => [v.id, v])), [vehicles.data]);

  const myOpen = useMemo(
    () =>
      tasks.data.filter(
        (t) => (t.assignee === staffId || !t.assignee) && (t.status === 'assigned' || t.status === 'in_progress' || t.status === 'open'),
      ),
    [tasks.data, staffId],
  );

  const route = useMemo(() => {
    if (!start) return null;
    const stops = myOpen
      .map((t) => {
        const v = t.vehicle_id ? vmap.get(t.vehicle_id) : undefined;
        return v?.pos ? { item: t, pos: v.pos } : null;
      })
      .filter((x): x is { item: OpsTask; pos: LngLat } => !!x);
    return nearestNeighborRoute(start, stops);
  }, [start, myOpen, vmap]);

  const doneToday = useMemo(
    () => tasks.data.filter((t) => t.status === 'done' && t.assignee === staffId),
    [tasks.data, staffId],
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={st.header}>
        <SyncPill />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxxl }}>
        <Card>
          <H2>Shift summary</H2>
          <Row style={{ justifyContent: 'space-between', marginTop: space.xs }}>
            <Stat label="Tasks done" value={String(doneToday.length)} />
            <Stat label="Remaining" value={String(myOpen.length)} />
            <Stat label="Route" value={route ? formatDistance(route.totalMeters) : '—'} />
          </Row>
          <Muted>{realPos ? 'Route from your live location.' : 'Route from Athens center (no location permission).'}</Muted>
        </Card>

        <H2>Optimized route (nearest-neighbor)</H2>
        {!route || route.ordered.length === 0 ? (
          <Empty text="No routable tasks assigned. Claim tasks from the Tasks tab." />
        ) : (
          route.ordered.map((stop, i) => {
            const v = stop.item.vehicle_id ? vmap.get(stop.item.vehicle_id) : undefined;
            return (
              <View key={stop.item.id} style={st.stopWrap}>
                <View style={st.badge}>
                  <Text style={st.badgeText}>{i + 1}</Text>
                  <Text style={st.legText}>{formatDistance(stop.legMeters)}</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <TaskCard task={stop.item} vehicleCode={v?.code} onPress={() => router.push(`/task/${stop.item.id}`)} />
                  <Button title="Navigate" icon="🧭" variant="secondary" onPress={() => navigateTo(stop.pos, v?.code)} />
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={st.statValue}>{value}</Text>
      <Text style={st.statLabel}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  header: { padding: space.md, backgroundColor: c.surface },
  statValue: { color: c.text, fontSize: font.size.xl, fontWeight: '800' },
  statLabel: { color: c.textMuted, fontSize: font.size.xs, fontWeight: '600' },
  stopWrap: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  badge: { width: 44, alignItems: 'center', gap: 2, paddingTop: space.md },
  badgeText: { color: c.onPrimary, backgroundColor: c.primary, width: 32, height: 32, borderRadius: 16, textAlign: 'center', lineHeight: 32, fontWeight: '800', overflow: 'hidden' },
  legText: { color: c.textFaint, fontSize: font.size.xs },
});
