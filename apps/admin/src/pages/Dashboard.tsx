import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useDS } from '@/context/DataContext';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader } from '@/components/ui/primitives';
import { Donut, DonutLegend, Gauge, type DonutSlice } from '@/components/charts/Charts';
import { MapView, type MapMarker } from '@/components/map/MapView';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney, formatNumber, relativeTime, titleCase } from '@/lib/format';
import { useBrand } from '@/context/BrandContext';

const deltaUp = (n: number) => ({ value: `${n}%`, up: true });

export function DashboardPage() {
  const ds = useDS();
  const { colors, statusColor } = useBrand();
  const kpis = useQuery({ queryKey: ['kpis'], queryFn: () => ds.getKpis() });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => ds.getAlerts() });
  const vehicles = useQuery({ queryKey: ['live-vehicles'], queryFn: () => ds.getLiveVehicles() });

  const k = kpis.data;
  const donut: DonutSlice[] = k
    ? Object.entries(k.fleet_by_status).map(([status, count]) => ({ label: titleCase(status), value: count, color: statusColor(status) }))
    : [];
  const markers: MapMarker[] = (vehicles.data ?? []).map((v) => ({
    id: v.id, lng: v.lng, lat: v.lat, color: statusColor(v.status), label: `${v.code} · ${v.status}`,
  }));

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Operations dashboard" sub="Live snapshot of the Thessaloniki fleet" />

      {/* Column counts come from the stylesheet, never from an inline style: an
          inline gridTemplateColumns cannot be overridden by a media query, which
          is precisely why this page ignored screen width before. */}
      <div className="grid grid-kpi">
        <StatCard label="Active rides" value={k ? formatNumber(k.active_rides) : '—'} icon="🛴" spark={k?.spark_rides} sparkColor={colors.primary} />
        <StatCard label="Today revenue" value={k ? formatMoney(k.today_revenue_cents) : '—'} delta={deltaUp(8)} spark={k?.spark_revenue} sparkColor={colors.success} />
        <StatCard label="Today rides" value={k ? formatNumber(k.today_rides) : '—'} delta={deltaUp(4)} spark={k?.spark_rides} sparkColor={colors.primary} />
        <StatCard label="New users today" value={k ? formatNumber(k.new_users_today) : '—'} delta={deltaUp(12)} spark={k?.spark_users} sparkColor="#8a5cf6" />
        <StatCard label="Open debts" value={k ? formatMoney(k.open_debts_cents) : '—'} delta={k ? { value: `${k.open_debts_count} open`, up: false } : null} icon="🧾" />
      </div>

      <div className="grid grid-main">
        <Card>
          <CardHeader title="Live fleet map" sub={`${markers.length} online`} actions={<Link className="btn btn-sm" to="/vehicles">All vehicles</Link>} />
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
          <div className="card-pad" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Donut data={donut} size={150} centerLabel="vehicles" />
            <div style={{ flex: 1 }}><DonutLegend data={donut} /></div>
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

      <Card>
        <CardHeader title="Alerts feed" sub="vehicle_alerts · newest first" actions={<Link className="btn btn-sm" to="/fleet">Fleet maintenance</Link>} />
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {alerts.isLoading ? <div className="card-pad">Loading…</div> : null}
          {alerts.data && alerts.data.length === 0 ? <EmptyState emoji="✅" title="No alerts" hint="All vehicles nominal." /> : null}
          {alerts.data?.map((a) => (
            <div key={a.id} className="between" style={{ padding: '11px var(--space-lg)', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <AlertBadge kind={a.kind} />
                <div>
                  <div style={{ fontWeight: 600 }}>{titleCase(a.kind)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Vehicle {a.vehicle_id} {a.payload && Object.keys(a.payload).length ? `· ${JSON.stringify(a.payload)}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {a.ack_at ? <Badge tone="neutral">Acked</Badge> : <Badge tone="warning">Unacked</Badge>}
                <span className="muted" style={{ fontSize: 12 }}>{relativeTime(a.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AlertBadge({ kind }: { kind: string }) {
  const danger = ['fall', 'power_cut', 'moved_locked', 'stolen'];
  const warn = ['geofence_exit', 'low_batt', 'error'];
  const tone = danger.includes(kind) ? 'danger' : warn.includes(kind) ? 'warning' : 'info';
  const emoji: Record<string, string> = { fall: '🚨', power_cut: '🔌', moved_locked: '🚚', geofence_exit: '📍', offline: '📴', low_batt: '🪫', error: '⚠️' };
  return <span style={{ fontSize: 18 }} title={tone}>{emoji[kind] ?? '•'}</span>;
}
