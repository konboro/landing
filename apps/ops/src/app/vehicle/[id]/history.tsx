import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { formatMoney, formatDistance, formatDuration, relativeTime, formatDateTime } from '@penny/ui';
import { useBrand, useTheme } from '../../../brand';
import * as repo from '../../../offline/repo';
import { useOps } from '../../../lib/store';
import type {
  OpsVehicle,
  VehicleRide,
  StatusLogEntry,
  BatterySwap,
  MaintenanceEntry,
} from '../../../lib/types';
import type { DamageReport } from '@penny/db-types';
import { Screen, H1, H2, Muted, Body, Card, Row, Badge, Pill, Divider, Empty } from '../../../components/ui';

type Tab = 'rides' | 'timeline';

interface Event {
  id: string;
  at: string;
  kind: 'ride' | 'status' | 'damage' | 'battery_swap' | 'maintenance';
  icon: string;
  title: string;
  detail: string;
}

const KIND_LABEL: Record<Event['kind'], string> = {
  ride: 'Rides',
  status: 'Status',
  damage: 'Damage',
  battery_swap: 'Swaps',
  maintenance: 'Service',
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { space, font } = useTheme();
  return (
    <View style={{ flexBasis: '31%', flexGrow: 1, minWidth: 100, marginBottom: space.sm }}>
      <Muted>{label}</Muted>
      <Body style={{ fontSize: font.size.lg, fontWeight: '700' }}>{value}</Body>
      {sub ? <Muted>{sub}</Muted> : null}
    </View>
  );
}

function ReviewBadge({ review }: { review: string | null }) {
  const { c } = useTheme();
  if (!review) return null;
  if (review === 'rejected') return <Badge label="Photo rejected" color={c.danger} textColor={c.onDanger} />;
  if (review === 'pending') return <Badge label="In review" color={c.warning} textColor={c.onWarning} />;
  return <Badge label="Photo OK" color={c.success} textColor={c.onSuccess} />;
}

export default function VehicleHistoryScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { c: color, space, radius } = theme;
  const { brand } = useBrand();
  const online = useOps((s) => s.online);
  const lastSyncAt = useOps((s) => s.lastSyncAt);

  const [tab, setTab] = useState<Tab>('rides');
  const [vehicle, setVehicle] = useState<OpsVehicle | null>(null);
  const [rides, setRides] = useState<VehicleRide[]>([]);
  const [statusLog, setStatusLog] = useState<StatusLogEntry[]>([]);
  const [swaps, setSwaps] = useState<BatterySwap[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceEntry[]>([]);
  const [damage, setDamage] = useState<DamageReport[]>([]);
  const [kinds, setKinds] = useState<Event['kind'][]>([]);

  // Everything reads from the local SQLite mirror, so this screen works with no
  // signal. The sync worker refreshes the mirror when connectivity returns.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [v, r, s, b, m, d] = await Promise.all([
          repo.getVehicle(id),
          repo.getVehicleRides(id),
          repo.getStatusLog(id),
          repo.getBatterySwaps(id),
          repo.getMaintenance(id),
          repo.getDamageReports(),
        ]);
        if (!alive) return;
        setVehicle(v);
        setRides(r);
        setStatusLog(s);
        setSwaps(b);
        setMaintenance(m);
        setDamage(d.filter((x) => x.vehicle_id === id));
      })();
      return () => {
        alive = false;
      };
    }, [id]),
  );

  const stats = useMemo(() => {
    const now = Date.now();
    const since = (days: number) =>
      rides.filter((r) => r.started_at && now - new Date(r.started_at).getTime() < days * 86400000).length;
    const distance = rides.reduce((s, r) => s + r.distance_m, 0);
    const revenue = rides.reduce((s, r) => s + r.cost_cents, 0);
    const duration = rides.reduce((s, r) => s + r.duration_s, 0);
    const last = rides[0]?.started_at ?? null;
    const idleH = last ? Math.round((now - new Date(last).getTime()) / 3600000) : null;
    return {
      total: rides.length,
      d7: since(7),
      d30: since(30),
      distance,
      revenue,
      avgDistance: rides.length ? Math.round(distance / rides.length) : 0,
      avgDuration: rides.length ? Math.round(duration / rides.length) : 0,
      perDay: rides.length ? +(since(30) / 30).toFixed(1) : 0,
      last,
      idleH,
    };
  }, [rides]);

  const events = useMemo<Event[]>(() => {
    const out: Event[] = [
      ...rides.map((r) => ({
        id: r.id,
        at: r.started_at ?? '',
        kind: 'ride' as const,
        icon: '🛴',
        title: `Ride · ${formatDistance(r.distance_m)}`,
        detail: `${formatDuration(r.duration_s)} · ${formatMoney(r.cost_cents, r.currency)} · ${r.rider_masked}${r.end_zone_name ? ` · ends ${r.end_zone_name}` : ''}`,
      })),
      ...statusLog.map((s) => ({
        id: s.id,
        at: s.at,
        kind: 'status' as const,
        icon: '🔄',
        title: `Status → ${s.to_status}`,
        detail: `${s.reason ?? 'no reason'} · by ${s.role}${s.photos.length ? ` · ${s.photos.length} photo(s)` : ''}`,
      })),
      ...swaps.map((b) => ({
        id: b.id,
        at: b.at,
        kind: 'battery_swap' as const,
        icon: '🔋',
        title: 'Battery swap',
        detail:
          b.voltage_before != null && b.voltage_after != null
            ? `${(b.voltage_before / 1000).toFixed(1)} V → ${(b.voltage_after / 1000).toFixed(1)} V`
            : 'voltages not recorded',
      })),
      ...maintenance.map((m) => ({
        id: m.id,
        at: m.at,
        kind: 'maintenance' as const,
        icon: '🔧',
        title: `Service · ${m.kind}`,
        detail: `${formatMoney(m.cost_cents, brand.currency)}${m.notes ? ` · ${m.notes}` : ''}`,
      })),
      ...damage.map((d) => ({
        id: d.id,
        at: d.created_at,
        kind: 'damage' as const,
        icon: '⚠',
        title: `Damage · ${d.severity}`,
        detail: `${d.status} · ${d.description}`,
      })),
    ];
    const filtered = kinds.length ? out.filter((e) => kinds.includes(e.kind)) : out;
    return filtered.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  }, [rides, statusLog, swaps, maintenance, damage, kinds]);

  const counts = useMemo(() => {
    return {
      ride: rides.length,
      status: statusLog.length,
      battery_swap: swaps.length,
      maintenance: maintenance.length,
      damage: damage.length,
    } as Record<string, number>;
  }, [rides, statusLog, swaps, maintenance, damage]);

  const toggle = (k: Event['kind']) =>
    setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <Screen scroll>
      <H1>{vehicle?.code ?? 'Vehicle'} · history</H1>
      <Muted>
        {online ? 'Live mirror' : 'Offline · cached'}
        {lastSyncAt ? ` · synced ${relativeTime(lastSyncAt)}` : ' · never synced'}
      </Muted>

      <Row style={{ marginTop: space.md, marginBottom: space.sm }}>
        {(['rides', 'timeline'] as Tab[]).map((k) => (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            style={{
              flex: 1,
              paddingVertical: space.md,
              borderRadius: radius.md,
              alignItems: 'center',
              backgroundColor: tab === k ? color.primary : color.surfaceAlt,
            }}
            accessibilityRole="button"
          >
            <Body style={{ color: tab === k ? color.onPrimary : color.text, fontWeight: '700' }}>
              {k === 'rides' ? `Rides (${stats.total})` : `Timeline (${events.length})`}
            </Body>
          </Pressable>
        ))}
      </Row>

      {tab === 'rides' ? (
        <>
          <Card>
            <H2>Summary</H2>
            <Row style={{ flexWrap: 'wrap', marginTop: space.sm }}>
              <Tile label="Total rides" value={String(stats.total)} />
              <Tile label="7d / 30d" value={`${stats.d7} / ${stats.d30}`} />
              <Tile label="Revenue" value={formatMoney(stats.revenue, brand.currency)} />
              <Tile label="Distance" value={formatDistance(stats.distance)} />
              <Tile
                label="Avg ride"
                value={formatDistance(stats.avgDistance)}
                sub={formatDuration(stats.avgDuration)}
              />
              <Tile label="Utilization" value={`${stats.perDay}/day`} />
              <Tile label="Idle" value={stats.idleH != null ? `${stats.idleH} h` : '—'} />
              <Tile label="Damage" value={String(damage.length)} sub={`${swaps.length} swaps`} />
            </Row>
          </Card>

          {rides.length === 0 ? (
            <Empty text="No rides recorded for this vehicle yet" />
          ) : (
            rides.map((r) => (
              <Card key={r.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Body style={{ fontWeight: '700' }}>{formatDateTime(r.started_at)}</Body>
                  <Body style={{ fontWeight: '700' }}>{formatMoney(r.cost_cents, r.currency)}</Body>
                </Row>
                <Muted>
                  {formatDistance(r.distance_m)} · {formatDuration(r.duration_s)} · {r.rider_masked}
                </Muted>
                <Row style={{ marginTop: space.xs, flexWrap: 'wrap' }}>
                  <ReviewBadge review={r.photo_review} />
                  {r.end_zone_name ? <Pill label={r.end_zone_name} /> : null}
                  {r.status === 'disputed' ? (
                    <Badge label="Disputed" color={color.warning} textColor={color.onWarning} />
                  ) : null}
                </Row>
              </Card>
            ))
          )}
        </>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space.sm }}>
            <Row>
              {(Object.keys(KIND_LABEL) as Event['kind'][]).map((k) => (
                <Pressable key={k} onPress={() => toggle(k)} accessibilityRole="button">
                  <Pill
                    label={`${KIND_LABEL[k]} (${counts[k] ?? 0})`}
                    color={kinds.includes(k) ? color.primary : undefined}
                    textColor={kinds.includes(k) ? color.onPrimary : undefined}
                  />
                </Pressable>
              ))}
              {kinds.length ? (
                <Pressable onPress={() => setKinds([])} accessibilityRole="button">
                  <Pill label="Clear" />
                </Pressable>
              ) : null}
            </Row>
          </ScrollView>

          {events.length === 0 ? (
            <Empty text="Nothing recorded for this vehicle yet" />
          ) : (
            <Card>
              {events.map((e, i) => (
                <View key={`${e.kind}-${e.id}`}>
                  <Row style={{ alignItems: 'flex-start' }}>
                    <Body style={{ fontSize: 20, width: 28 }}>{e.icon}</Body>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: '700' }}>{e.title}</Body>
                      <Muted>{e.detail}</Muted>
                    </View>
                    <Muted>{e.at ? relativeTime(e.at) : '—'}</Muted>
                  </Row>
                  {i < events.length - 1 ? <Divider /> : null}
                </View>
              ))}
            </Card>
          )}
        </>
      )}

      <Pressable onPress={() => router.back()} style={{ marginTop: space.lg }} accessibilityRole="button">
        <Body style={{ color: color.primary, textAlign: 'center' }}>← Back to vehicle</Body>
      </Pressable>
    </Screen>
  );
}
