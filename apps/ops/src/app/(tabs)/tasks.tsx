// Task manager — the screen a mechanic lives in between stops.
//
// Three lenses on one list rather than six filter chips: the only questions in
// the van are "what can I pick up", "what am I holding" and "what did I finish".
// Kind is a secondary filter on top of that, and everything else (priority,
// lateness, distance) is expressed by the sort so nobody has to configure it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SyncPill } from '../../components/SyncPill';
import { TaskCard, TASK_KINDS, KIND_LABEL, KIND_ICON, isOverdue, isClosed } from '../../components/TaskCard';
import { Empty, Muted, SegmentedControl, Chip, type SegmentOption } from '../../components/ui';
import { useMirror } from '../../lib/useMirror';
import { getTasks, getVehicles } from '../../offline/repo';
import { claimTask, releaseTask } from '../../offline/actions';
import { pullOnce } from '../../offline/sync';
import { getCurrentPos } from '../../lib/geoloc';
import { useOps } from '../../lib/store';
import { useTheme, makeStyles } from '../../brand';
import { haversine } from '@penny/geo';
import { OpsTaskStatus } from '@penny/db-types';
import type { LngLat, OpsTask, OpsTaskKind as Kind, UUID } from '@penny/db-types';
import type { OpsVehicle } from '../../lib/types';

type TabKey = 'todo' | 'mine' | 'done';

const TABS: SegmentOption[] = [
  { key: 'todo', label: 'To do', icon: 'list' },
  { key: 'mine', label: 'Mine', icon: 'user' },
  { key: 'done', label: 'Done', icon: 'check' },
];

const EMPTY_TEXT: Record<TabKey, string> = {
  todo: 'Nothing waiting — every open task is already claimed.',
  mine: 'You are not holding any task. Claim one from “To do”.',
  done: 'Nothing completed yet. Finished tasks land here.',
};

export default function TasksTab() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;

  const session = useOps((s) => s.session);
  const staffId: UUID | null = session?.staff_id ?? null;
  const staffName = session?.name ?? null;

  const tasks = useMirror(getTasks, [] as OpsTask[]);
  const vehicles = useMirror(getVehicles, [] as OpsVehicle[]);

  const [tab, setTab] = useState<TabKey>('todo');
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [pos, setPos] = useState<LngLat | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<UUID | null>(null);

  // One shared guard for every async setState on this screen: the tab can be
  // swapped away mid-flight and RN warns (or leaks) on a late update.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void getCurrentPos().then(({ pos: p, real }) => {
      // Only a real fix earns a distance: the Athens/Thessaloniki fallback would
      // sort the whole list by a coordinate nobody is standing on.
      if (alive.current && real) setPos(p);
    });
  }, []);

  const vmap = useMemo(() => new Map(vehicles.data.map((v) => [v.id, v])), [vehicles.data]);

  const distanceOf = useCallback(
    (t: OpsTask): number | null => {
      if (!pos || !t.vehicle_id) return null;
      const v = vmap.get(t.vehicle_id);
      return v?.pos ? haversine(pos, v.pos) : null;
    },
    [pos, vmap],
  );

  const isMine = useCallback((t: OpsTask) => !!staffId && t.assignee === staffId, [staffId]);

  /** The tab's population, before the kind chips narrow it. Counts come from here. */
  const scope = useMemo(() => {
    switch (tab) {
      case 'mine':
        return tasks.data.filter((t) => !isClosed(t) && isMine(t));
      case 'done':
        return tasks.data.filter((t) => t.status === OpsTaskStatus.done);
      default:
        return tasks.data.filter((t) => !isClosed(t) && !isMine(t));
    }
  }, [tasks.data, tab, isMine]);

  const counts = useMemo(() => {
    const m = new Map<Kind, number>();
    for (const t of scope) m.set(t.kind, (m.get(t.kind) ?? 0) + 1);
    return m;
  }, [scope]);

  const visible = useMemo(() => {
    const now = Date.now();
    const rows = kinds.length === 0 ? scope : scope.filter((t) => kinds.includes(t.kind));
    return [...rows].sort((a, b) => {
      // Done is a log, not a queue: newest first, nothing else matters.
      if (tab === 'done') return (Date.parse(b.completed_at ?? '') || 0) - (Date.parse(a.completed_at ?? '') || 0);
      const lateDelta = Number(isOverdue(b, now)) - Number(isOverdue(a, now));
      if (lateDelta !== 0) return lateDelta;
      if (b.priority !== a.priority) return b.priority - a.priority;
      const da = distanceOf(a) ?? Number.POSITIVE_INFINITY;
      const db = distanceOf(b) ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      // Last resort so the order never jitters between renders.
      return (Date.parse(a.due_at ?? '') || Number.MAX_SAFE_INTEGER) - (Date.parse(b.due_at ?? '') || Number.MAX_SAFE_INTEGER);
    });
  }, [scope, kinds, tab, distanceOf]);

  const overdueCount = useMemo(() => {
    const now = Date.now();
    return tasks.data.filter((t) => isOverdue(t, now)).length;
  }, [tasks.data]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Pull is best-effort: offline it returns immediately and the mirror reload
    // below still repaints, so the gesture never hangs on a dead network.
    await pullOnce();
    tasks.reload();
    vehicles.reload();
    if (alive.current) setRefreshing(false);
  }, [tasks, vehicles]);

  const assign = useCallback(async (id: UUID, action: 'claim' | 'release') => {
    setBusyId(id);
    try {
      await (action === 'claim' ? claimTask(id) : releaseTask(id));
    } finally {
      if (alive.current) setBusyId(null);
    }
  }, []);

  const toggleKind = useCallback((k: Kind) => {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={st.chrome}>
        <View style={st.headerRow}>
          <SyncPill />
          <Text style={[st.summary, overdueCount > 0 && { color: c.danger }]}>
            {overdueCount > 0 ? `${overdueCount} overdue` : `${visible.length} shown`}
          </Text>
        </View>

        <SegmentedControl options={TABS} value={tab} onChange={(k) => setTab(k as TabKey)} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          <Chip label="All" selected={kinds.length === 0} tone="primary" onPress={() => setKinds([])} />
          {TASK_KINDS.map((k) => (
            <Chip
              key={k}
              label={`${KIND_LABEL[k]} ${counts.get(k) ?? 0}`}
              icon={KIND_ICON[k]}
              tone="primary"
              selected={kinds.includes(k)}
              onPress={() => toggleKind(k)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />
        }
        ListEmptyComponent={
          <View style={{ gap: space.sm }}>
            <Empty text={EMPTY_TEXT[tab]} />
            {kinds.length > 0 ? <Muted style={{ textAlign: 'center' }}>Kind filters are active.</Muted> : null}
          </View>
        }
        renderItem={({ item }) => {
          const mine = isMine(item);
          return (
            <TaskCard
              task={item}
              vehicleCode={item.vehicle_id ? vmap.get(item.vehicle_id)?.code : undefined}
              distanceMeters={distanceOf(item)}
              assigneeName={staffName}
              mine={mine}
              busy={busyId === item.id}
              onPress={() => router.push(`/task/${item.id}`)}
              onClaim={!item.assignee ? () => void assign(item.id, 'claim') : undefined}
              onRelease={mine ? () => void assign(item.id, 'release') : undefined}
            />
          );
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  chrome: {
    backgroundColor: t.c.surface,
    paddingHorizontal: t.space.md,
    paddingBottom: t.space.sm,
    gap: t.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.c.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: t.space.sm },
  summary: { color: t.c.textMuted, fontSize: t.font.size.xs, fontWeight: '700' },
  chipRow: { gap: t.space.sm, paddingRight: t.space.md },
}));
