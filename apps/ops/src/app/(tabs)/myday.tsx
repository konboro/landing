// My day — the shift, then the work the shift produced.
//
// The reference app buries this in a bottom sheet; here it is a real screen so
// the timer, the counters and the day's output are one scroll rather than three
// taps. `ShiftSheet` exports the same control for the map screen, so a crew
// member can clock in from either place and see identical numbers.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SyncPill } from '../../components/SyncPill';
import { TaskCard, kindLabel, isClosed } from '../../components/TaskCard';
import { ShiftControl } from '../../components/ShiftSheet';
import { Card, H2, Muted, Body, Button, Row, Empty, Divider, Icon } from '../../components/ui';
import { useMirror } from '../../lib/useMirror';
import { getMyTasks, getShifts, getVehicles } from '../../offline/repo';
import { pullOnce } from '../../offline/sync';
import { getCurrentPos } from '../../lib/geoloc';
import { nearestNeighborRoute } from '../../lib/route';
import { navigateTo } from '../../lib/nav';
import { useOps } from '../../lib/store';
import { useTheme, makeStyles } from '../../brand';
import { formatDistance, formatDuration } from '@penny/ui';
import { OpsTaskStatus } from '@penny/db-types';
import type { LngLat, OpsTask } from '@penny/db-types';
import type { OpsShift, OpsVehicle } from '../../lib/types';

/** How many ordered stops are worth showing before the list stops being a plan. */
const ROUTE_PREVIEW = 5;

export default function MyDayTab() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;

  const staffName = useOps((s) => s.session?.name ?? null);
  const myTasks = useMirror(getMyTasks, [] as OpsTask[]);
  const vehicles = useMirror(getVehicles, [] as OpsVehicle[]);
  const shifts = useMirror(() => getShifts(10), [] as OpsShift[]);

  const [pos, setPos] = useState<LngLat | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void getCurrentPos().then(({ pos: p }) => {
      // Unlike the task list, the route needs *a* start point even without a
      // fix — the city fallback still orders the stops sensibly relative to
      // each other, which is the whole value of the ordering.
      if (alive.current) setPos(p);
    });
  }, []);

  const vmap = useMemo(() => new Map(vehicles.data.map((v) => [v.id, v])), [vehicles.data]);

  const openTasks = useMemo(() => myTasks.data.filter((t) => !isClosed(t)), [myTasks.data]);

  const completedToday = useMemo(() => {
    const today = new Date().toDateString();
    return myTasks.data
      .filter((t) => t.status === OpsTaskStatus.done && !!t.completed_at)
      .filter((t) => new Date(t.completed_at!).toDateString() === today)
      .sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!));
  }, [myTasks.data]);

  // docs/07 feature 7 keeps the nearest-neighbour ordering on this screen; it
  // is the cheapest thing that stops a crew crossing the city twice.
  const route = useMemo(() => {
    if (!pos) return null;
    const stops = openTasks
      .map((t) => {
        const v = t.vehicle_id ? vmap.get(t.vehicle_id) : undefined;
        return v?.pos ? { item: t, pos: v.pos } : null;
      })
      .filter((x): x is { item: OpsTask; pos: LngLat } => x !== null);
    return stops.length > 0 ? nearestNeighborRoute(pos, stops) : null;
  }, [pos, openTasks, vmap]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await pullOnce();
    myTasks.reload();
    vehicles.reload();
    shifts.reload();
    if (alive.current) setRefreshing(false);
  }, [myTasks, vehicles, shifts]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={st.header}>
        <SyncPill />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />
        }
      >
        <ShiftControl />

        <H2>Next stops</H2>
        {!route || route.ordered.length === 0 ? (
          <Empty text="No routable task on your plate. Claim one from the Tasks tab." />
        ) : (
          <>
            <Muted>
              {route.ordered.length} stop{route.ordered.length === 1 ? '' : 's'} ·{' '}
              {formatDistance(route.totalMeters)} in nearest-first order
            </Muted>
            {route.ordered.slice(0, ROUTE_PREVIEW).map((stop, i) => {
              const v = stop.item.vehicle_id ? vmap.get(stop.item.vehicle_id) : undefined;
              return (
                <View key={stop.item.id} style={st.stop}>
                  <View style={st.stopIndex}>
                    <Text style={st.stopIndexText}>{i + 1}</Text>
                    <Text style={st.stopLeg}>{formatDistance(stop.legMeters)}</Text>
                  </View>
                  <View style={st.stopBody}>
                    <TaskCard
                      task={stop.item}
                      vehicleCode={v?.code}
                      distanceMeters={stop.legMeters}
                      assigneeName={staffName}
                      mine
                      onPress={() => router.push(`/task/${stop.item.id}`)}
                    />
                    <Button
                      title="Navigate"
                      variant="secondary"
                      onPress={() => void navigateTo(stop.pos, v?.code)}
                    />
                  </View>
                </View>
              );
            })}
            {route.ordered.length > ROUTE_PREVIEW ? (
              <Muted>+{route.ordered.length - ROUTE_PREVIEW} more on the Tasks tab.</Muted>
            ) : null}
          </>
        )}

        <H2>Completed today</H2>
        {completedToday.length === 0 ? (
          <Empty text="Nothing finished yet today." />
        ) : (
          completedToday.map((t) => (
            <Card key={t.id} onPress={() => router.push(`/task/${t.id}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={space.sm}>
                  <Icon name="check" size={20} color={c.success} strokeWidth={2.4} />
                  <View>
                    <Body>{kindLabel(t.kind)}</Body>
                    <Muted>
                      {t.vehicle_id ? (vmap.get(t.vehicle_id)?.code ?? 'Vehicle') : 'No vehicle'} ·{' '}
                      {timeOfDay(t.completed_at)}
                    </Muted>
                  </View>
                </Row>
                <Icon name="chevron" size={18} color={c.textFaint} />
              </Row>
            </Card>
          ))
        )}

        <H2>Recent shifts</H2>
        {shifts.data.length === 0 ? (
          <Empty text="No shift history on this device yet." />
        ) : (
          <Card>
            {shifts.data.map((s, i) => (
              <View key={s.id}>
                {i > 0 ? <Divider /> : null}
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Body>{dayLabel(s.started_at)}</Body>
                    <Muted>
                      {timeOfDay(s.started_at)} – {s.ended_at ? timeOfDay(s.ended_at) : 'now'}
                      {s.note ? ` · ${s.note}` : ''}
                    </Muted>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={st.shiftDuration}>{shiftLength(s)}</Text>
                    <Muted>
                      {s.tasks_completed} task{s.tasks_completed === 1 ? '' : 's'}
                    </Muted>
                  </View>
                </Row>
              </View>
            ))}
          </Card>
        )}

        {/* Dispatch sits above settings on purpose: it is the thing a crew
            member reaches for mid-shift, standing next to a scooter that will
            not do what the manual says. */}
        <Card onPress={() => router.push('/chat')}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={space.sm}>
              <Icon name="chat" size={22} color={c.primary} />
              <View>
                <Body>Message dispatch</Body>
                <Muted>They can see your vehicle and your shift</Muted>
              </View>
            </Row>
            <Icon name="chevron" size={18} color={c.textFaint} />
          </Row>
        </Card>

        {/* `more` lost its tab slot when the bar went to five fixed destinations,
            and it is the only way to reach damage reports, deploy mode, the dev
            tools and sign-out. This row is now that route's sole entry point. */}
        <Card onPress={() => router.push('/more')}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={space.sm}>
              <Icon name="settings" size={22} color={c.textMuted} />
              <View>
                <Body>Settings &amp; tools</Body>
                <Muted>Damage reports, deploy mode, sync tools, sign out</Muted>
              </View>
            </Row>
            <Icon name="chevron" size={18} color={c.textFaint} />
          </Row>
        </Card>
      </ScrollView>
    </View>
  );
}

function timeOfDay(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

/** An open shift is still accruing, so it is measured against now, not its end. */
function shiftLength(s: OpsShift): string {
  const from = Date.parse(s.started_at);
  if (Number.isNaN(from)) return '—';
  const to = s.ended_at ? Date.parse(s.ended_at) : Date.now();
  if (Number.isNaN(to)) return '—';
  return formatDuration(Math.max(0, to - from) / 1000);
}

const useStyles = makeStyles((t) => ({
  header: { padding: t.space.md, backgroundColor: t.c.surface },
  stop: { flexDirection: 'row', gap: t.space.sm, alignItems: 'flex-start' },
  stopIndex: { width: 44, alignItems: 'center', gap: 2, paddingTop: t.space.md },
  stopIndexText: {
    color: t.c.onPrimary,
    backgroundColor: t.c.primary,
    width: 32,
    height: 32,
    borderRadius: 16,
    textAlign: 'center',
    lineHeight: 32,
    fontWeight: '800',
    overflow: 'hidden',
  },
  stopLeg: { color: t.c.textFaint, fontSize: t.font.size.xs },
  stopBody: { flex: 1, gap: 6 },
  shiftDuration: { color: t.c.text, fontSize: t.font.size.md, fontWeight: '800' },
}));
