import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useDS } from '@/context/DataContext';
import { usePanelData } from '@/hooks/usePanelData';
import { Card, CardHeader } from '@/components/ui/primitives';
import { Donut, DonutLegend, Gauge, type DonutSlice } from '@/components/charts/Charts';
import { MapView, type MapMarker } from '@/components/map/MapView';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/feedback';
import { MydataHealthCard } from '@/components/mydata/MydataHealthCard';
import { formatMoney, formatNumber, relativeTime, titleCase } from '@/lib/format';
import { useBrand } from '@/context/BrandContext';

/* ---------------------------------------------------------------------------
   Layout: a section header, then a grid of plain tiles — the shape an operator
   already reads on a phone. Every number below is computed from real rows
   (rides, payments, customers, vehicles, tasks, damage reports). Metrics we do
   not collect are absent rather than filled with a placeholder: `trips` has no
   rating column, so there is no "average ride rating" tile.
   --------------------------------------------------------------------------- */

function Section({
  icon, title, tint, to,
}: { icon: string; title: string; tint: string; to?: string }) {
  const body = (
    <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span
        aria-hidden
        style={{
          width: 40, height: 40, borderRadius: '50%', background: tint,
          display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <strong style={{ fontSize: 'var(--fs-lg)' }}>{title}</strong>
      {to ? <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>›</span> : null}
    </div>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : body;
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="card stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/**
 * Every state a vehicle can be in, in the order an operator scans them: what is
 * earning, what is blocked, what is lost. Keys are the `vehicle_status` enum
 * (migration 00020); labels are the words ops actually use — `in_trip` reads as
 * "In use", `low_battery` as "Discharged".
 */
const VEHICLE_STATUSES: Array<{ key: string; label: string }> = [
  { key: 'available', label: 'Available' },
  { key: 'in_trip', label: 'In use' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'low_battery', label: 'Discharged' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'transport', label: 'Transport' },
  { key: 'offline', label: 'Offline' },
  { key: 'stolen', label: 'Stolen' },
  { key: 'decommissioned', label: 'Decommissioned' },
];

/** Local YYYY-MM-DD — the operator's day, not UTC's. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoDay(iso: string | null | undefined): string | null {
  return iso ? dayKey(new Date(iso)) : null;
}

export function DashboardPage() {
  const ds = useDS();
  const { colors, statusColor } = useBrand();
  const kpis = useQuery({ queryKey: ['kpis'], queryFn: () => ds.getKpis() });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => ds.getAlerts() });
  const liveVehicles = useQuery({ queryKey: ['live-vehicles'], queryFn: () => ds.getLiveVehicles() });
  const panel = usePanelData();

  const k = kpis.data;
  const p = panel.data;

  const m = useMemo(() => {
    const today = dayKey(new Date());
    const yesterday = dayKey(new Date(Date.now() - 86_400_000));

    const rides = p?.rides ?? [];
    const payments = p?.payments ?? [];
    const customers = p?.customers ?? [];
    const vehicles = p?.vehicles ?? [];
    const tasks = p?.opsTasks ?? [];
    const damages = p?.damageReports ?? [];

    const countOn = <T,>(xs: T[], pick: (x: T) => string | null, day: string) =>
      xs.filter((x) => pick(x) === day).length;

    /** Mean per day over the days that actually have data — not over a fixed 30. */
    const perDay = <T,>(xs: T[], pick: (x: T) => string | null) => {
      const days = new Set<string>();
      for (const x of xs) { const d = pick(x); if (d) days.add(d); }
      return days.size ? Math.round(xs.filter((x) => pick(x)).length / days.size) : 0;
    };

    const rideDay = (r: { started_at?: string | null }) => isoDay(r.started_at);
    const payDay = (x: { created_at?: string | null }) => isoDay(x.created_at);

    const sumOn = (kind: string, day: string) =>
      payments
        .filter((x) => (x as { kind?: string }).kind === kind
          && (x as { status?: string }).status === 'succeeded'
          && payDay(x as { created_at?: string | null }) === day)
        .reduce((s, x) => s + Number((x as { amount_cents?: number }).amount_cents ?? 0), 0);

    // Count every status the fleet CAN be in, not only the ones that happen to
    // occur today. A missing "Stolen" tile reads as "not tracked"; a tile
    // showing 0 reads as "none right now", which is the useful answer.
    const counted = new Map<string, number>();
    for (const v of vehicles) {
      const s = String((v as { status?: string }).status ?? '');
      counted.set(s, (counted.get(s) ?? 0) + 1);
    }
    const byStatus = VEHICLE_STATUSES.map((s) => [s.label, counted.get(s.key) ?? 0] as const);

    // "Disconnected" is not a status — a vehicle can be `available` and still
    // have no live GPRS session. The view exposes session_online, so this is a
    // real count rather than a guess.
    const disconnected = vehicles.filter(
      (v) => (v as { session_online?: boolean }).session_online === false,
    ).length;

    // "No rides in 72 h" — a rebalancing candidate. Computed from the real ride
    // history, so it is empty when there is no history rather than invented.
    const lastRide = new Map<string, number>();
    for (const r of rides) {
      const id = String((r as { vehicle_id?: string }).vehicle_id ?? '');
      const t = (r as { started_at?: string | null }).started_at;
      if (!id || !t) continue;
      const ms = new Date(t).getTime();
      if (ms > (lastRide.get(id) ?? 0)) lastRide.set(id, ms);
    }
    const cutoff = Date.now() - 72 * 3600_000;
    const idle = vehicles.filter((v) => {
      const id = String((v as { id?: string }).id ?? '');
      return (lastRide.get(id) ?? 0) < cutoff;
    }).length;

    return {
      ridesToday: countOn(rides, rideDay, today),
      ridesYesterday: countOn(rides, rideDay, yesterday),
      ridesAvg: perDay(rides, rideDay),

      revRidesToday: sumOn('trip', today),
      revRidesYesterday: sumOn('trip', yesterday),
      topupToday: sumOn('topup', today),
      topupYesterday: sumOn('topup', yesterday),
      subsToday: sumOn('subscription', today),
      subsYesterday: sumOn('subscription', yesterday),

      newToday: countOn(customers, (c) => isoDay((c as { created_at?: string | null }).created_at), today),
      newYesterday: countOn(customers, (c) => isoDay((c as { created_at?: string | null }).created_at), yesterday),
      newAvg: perDay(customers, (c) => isoDay((c as { created_at?: string | null }).created_at)),

      byStatus,
      disconnected,
      fleetTotal: vehicles.length,

      tasksToday: countOn(tasks, (t) => isoDay((t as { created_at?: string | null }).created_at), today),
      tasksYesterday: countOn(tasks, (t) => isoDay((t as { created_at?: string | null }).created_at), yesterday),
      tasksOpen: tasks.filter((t) => ['open', 'assigned', 'in_progress'].includes(String((t as { status?: string }).status))).length,
      damagesToday: countOn(damages, (d) => isoDay((d as { created_at?: string | null }).created_at), today),
      damagesYesterday: countOn(damages, (d) => isoDay((d as { created_at?: string | null }).created_at), yesterday),
      damagesOpen: damages.filter((d) => ['new', 'confirmed'].includes(String((d as { status?: string }).status))).length,

      idle,
    };
  }, [p]);

  const donut: DonutSlice[] = k
    ? Object.entries(k.fleet_by_status).map(([status, count]) => ({ label: titleCase(status), value: count, color: statusColor(status) }))
    : [];
  const markers: MapMarker[] = (liveVehicles.data ?? []).map((v) => ({
    id: v.id, lng: v.lng, lat: v.lat, color: statusColor(v.status), label: `${v.code} · ${v.status}`,
  }));

  const money = (c: number) => formatMoney(c);
  const loading = panel.isLoading;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Dashboard" sub="Live snapshot of the Thessaloniki fleet" />

      {/* ── Rides ─────────────────────────────────────────────────────────── */}
      <Section icon="🛴" title="Rides" tint="rgba(53,174,247,.15)" to="/rides" />
      <div className="grid grid-kpi">
        <Tile value={loading ? '—' : formatNumber(m.ridesToday)} label="Today" />
        <Tile value={loading ? '—' : formatNumber(m.ridesYesterday)} label="Yesterday" />
        <Tile value={loading ? '—' : formatNumber(m.ridesAvg)} label="Daily average" />
        <Tile value={k ? formatNumber(k.active_rides) : '—'} label="Active right now" />
      </div>

      {/* ── Revenue ───────────────────────────────────────────────────────── */}
      <Section icon="💶" title="Revenue" tint="rgba(255,138,76,.18)" to="/finance" />
      <div className="grid grid-kpi">
        <Tile value={loading ? '—' : money(m.revRidesToday)} label="Rides today" />
        <Tile value={loading ? '—' : money(m.revRidesYesterday)} label="Rides yesterday" />
        <Tile value={loading ? '—' : money(m.topupToday)} label="Top-up today" />
        <Tile value={loading ? '—' : money(m.topupYesterday)} label="Top-up yesterday" />
        <Tile value={loading ? '—' : money(m.subsToday)} label="Subscriptions today" />
        <Tile value={loading ? '—' : money(m.subsYesterday)} label="Subscriptions yesterday" />
      </div>

      {/* ── Customers ─────────────────────────────────────────────────────── */}
      <Section icon="👤" title="Customers" tint="rgba(138,92,246,.16)" to="/customers" />
      <div className="grid grid-kpi">
        <Tile value={loading ? '—' : formatNumber(m.newToday)} label="New today" />
        <Tile value={loading ? '—' : formatNumber(m.newYesterday)} label="New yesterday" />
        <Tile value={loading ? '—' : formatNumber(m.newAvg)} label="Daily average" />
        <Tile value={k ? money(k.open_debts_cents) : '—'} label={`Open debts${k ? ` · ${k.open_debts_count}` : ''}`} />
      </div>

      {/* ── Vehicles ──────────────────────────────────────────────────────── */}
      <Section icon="🛵" title="Vehicles" tint="rgba(255,138,76,.18)" to="/vehicles" />
      <div className="grid grid-kpi">
        <Tile value={loading ? '—' : formatNumber(m.fleetTotal)} label="Fleet total" />
        {m.byStatus.map(([label, count]) => (
          <Tile key={label} value={loading ? '—' : formatNumber(count)} label={label} />
        ))}
        <Tile value={loading ? '—' : formatNumber(m.disconnected)} label="Disconnected" />
      </div>

      {/* ── Tasks & damages ───────────────────────────────────────────────── */}
      <Section icon="🧰" title="Tasks & damages" tint="rgba(31,170,89,.16)" to="/fleet" />
      <div className="grid grid-kpi">
        <Tile value={loading ? '—' : formatNumber(m.tasksToday)} label="Tasks created today" />
        <Tile value={loading ? '—' : formatNumber(m.damagesToday)} label="Damages reported today" />
        <Tile value={loading ? '—' : formatNumber(m.tasksYesterday)} label="Tasks created yesterday" />
        <Tile value={loading ? '—' : formatNumber(m.damagesYesterday)} label="Damages reported yesterday" />
        <Tile value={loading ? '—' : formatNumber(m.tasksOpen)} label="Open tasks" />
        <Tile value={loading ? '—' : formatNumber(m.damagesOpen)} label="Open damages" />
      </div>

      {/* ── Insights ──────────────────────────────────────────────────────── */}
      <Section icon="💡" title="Insights" tint="rgba(232,163,23,.18)" />
      <div className="stack" style={{ gap: 'var(--space-md)' }}>
        <div className="card card-pad">
          Vehicles that may need rebalancing (no rides for more than 72 h):{' '}
          <strong>{loading ? '—' : m.idle}</strong>
        </div>
        <div className="card card-pad">
          Unlock success in the last 24 h: <strong>{k ? `${k.unlock_success_pct}%` : '—'}</strong>
          {' · '}
          <span className="muted">no charge without a confirmed ACK</span>
        </div>
      </div>

      {/* ── Live map + gauge ──────────────────────────────────────────────── */}
      <div className="grid grid-main">
        <Card>
          <CardHeader
            title="Live fleet map"
            sub={`${markers.length} online`}
            actions={<Link className="btn btn-sm" to="/vehicles">All vehicles</Link>}
          />
          <div style={{ padding: 'var(--space-md)' }}>
            <MapView height={300} markers={markers} legend={[
              { color: colors.statusAvailable, label: 'Available' },
              { color: colors.statusInTrip, label: 'In trip' },
              { color: colors.statusLowBattery, label: 'Low battery' },
              { color: colors.statusOffline, label: 'Offline' },
            ]} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Fleet by status" />
          <div className="card-pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Donut data={donut} size={150} centerLabel="vehicles" />
            <div style={{ flex: 1, minWidth: 140 }}><DonutLegend data={donut} /></div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Unlock success (24h)" />
          <div className="card-pad" style={{ display: 'grid', placeItems: 'center' }}>
            <Gauge value={k?.unlock_success_pct ?? 0} label="ACK within 8s" size={170} />
            <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>
              Target ≥ 95%. No charge without confirmed unlock ACK.
            </div>
          </div>
        </Card>
      </div>

      {/* ── Tax receipts ──────────────────────────────────────────────────────
          Money and its receipt belong on the same screen: the question "did
          yesterday's takings get declared?" should not require remembering to
          open a tab. Hides itself for roles without mydata.read. */}
      <MydataHealthCard />

      {/* ── Alerts ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Alerts feed"
          sub="vehicle_alerts · newest first"
          actions={<Link className="btn btn-sm" to="/fleet">Fleet maintenance</Link>}
        />
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {alerts.isLoading ? <div className="card-pad">Loading…</div> : null}
          {!alerts.isLoading && (alerts.data ?? []).length === 0
            ? <EmptyState title="No alerts" hint="Nothing needs attention right now." />
            : null}
          {(alerts.data ?? []).map((a) => (
            <div key={a.id} className="between" style={{ padding: '11px var(--space-lg)', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{titleCase(a.kind)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{a.vehicle_id}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* An alert is closed when someone acknowledged it — there is
                    no resolved_at column, only ack_at. */}
                <Badge tone={a.ack_at ? 'success' : 'warning'}>{a.ack_at ? 'acknowledged' : 'open'}</Badge>
                <span className="muted" style={{ fontSize: 12 }}>{relativeTime(a.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
