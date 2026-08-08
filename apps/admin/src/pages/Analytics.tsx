import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePanelData } from '@/hooks/usePanelData';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, Checkbox, Select, Input } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { MapView, type HeatPoint, type MapZone } from '@/components/map/MapView';
import { Bars, TrendLine, chartPalette } from '@/components/charts/Charts';
import { zoneMapStyle } from '@/lib/zoneStyle';
import { formatMoney, formatNumber } from '@/lib/format';
import { colors } from '@penny/ui';

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AnalyticsPage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('heatmaps');

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Analytics" sub="Heatmaps, revenue, cohorts, ops utilization, funnel and a report builder" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'heatmaps', label: 'Heatmaps' },
        { key: 'demand', label: 'Demand vs supply' },
        { key: 'revenue', label: 'Revenue' },
        { key: 'cohorts', label: 'ARPU / LTV cohorts' },
        { key: 'ops', label: 'Ops utilization' },
        { key: 'funnel', label: 'Funnel' },
        { key: 'reports', label: 'Report builder' },
      ]} />
      {isLoading || !db ? <Card pad>Loading…</Card> : (
        <>
          {tab === 'heatmaps' ? <Heatmaps db={db} /> : null}
          {tab === 'demand' ? <Demand db={db} /> : null}
          {tab === 'revenue' ? <Revenue db={db} /> : null}
          {tab === 'cohorts' ? <Cohorts db={db} /> : null}
          {tab === 'ops' ? <OpsUtil db={db} /> : null}
          {tab === 'funnel' ? <Funnel db={db} /> : null}
          {tab === 'reports' ? <ReportBuilder /> : null}
        </>
      )}
    </div>
  );
}

function Heatmaps({ db }: { db: NonNullable<ReturnType<typeof usePanelData>['data']> }) {
  const [kind, setKind] = useState<'start' | 'end' | 'idle'>('start');
  const [hour, setHour] = useState(18);
  const [dow, setDow] = useState<number | 'all'>('all');
  const [allHours, setAllHours] = useState(true);
  const [zoneOverlay, setZoneOverlay] = useState(true);

  const heat: HeatPoint[] = useMemo(() => db.heatCells
    .filter((c) => c.kind === kind)
    .filter((c) => allHours || c.hour === hour)
    .filter((c) => dow === 'all' || c.dow === dow)
    .map((c) => ({ lng: c.lng, lat: c.lat, weight: c.weight })), [db, kind, hour, dow, allHours]);

  const zones: MapZone[] = zoneOverlay ? db.zones.map((z) => ({ id: z.id, coordinates: z.geom.coordinates, ...zoneMapStyle(z.kind), label: z.name ?? z.kind })) : [];

  return (
    <Card>
      <CardHeader title={`Heatmap — trip ${kind}`} sub="Mapbox heatmap layer (falls back to schematic scatter without a token)" />
      <div className="card-pad">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <Select style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as 'start' | 'end' | 'idle')}>
            <option value="start">Trip starts</option>
            <option value="end">Trip ends</option>
            <option value="idle">Idle time</option>
          </Select>
          <Select style={{ width: 'auto' }} value={String(dow)} onChange={(e) => setDow(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All days</option>
            {DOWS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </Select>
          <Checkbox label="All hours" checked={allHours} onChange={(e) => setAllHours(e.target.checked)} />
          {!allHours ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              Hour {String(hour).padStart(2, '0')}:00
              <input type="range" min={0} max={23} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
            </label>
          ) : null}
          <Checkbox label="Zone overlay" checked={zoneOverlay} onChange={(e) => setZoneOverlay(e.target.checked)} />
        </div>
        <MapView height={420} heat={heat} zones={zones} center={[23.7275, 37.9838]} zoom={12} />
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{heat.length} aggregated cells shown.</div>
      </div>
    </Card>
  );
}

function Demand({ db }: { db: NonNullable<ReturnType<typeof usePanelData>['data']> }) {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const cells = [...db.demandCells].sort((a, b) => (b.demand - b.supply) - (a.demand - a.supply));
  const createTasks = async () => {
    const short = cells.filter((c) => c.demand - c.supply > 5);
    for (const c of short) await ds.logAudit({ action: 'create_rebalance_task', entity: 'zone', entity_id: c.id, reason: `Demand ${c.demand} vs supply ${c.supply}` });
    toast.push(`Created ${short.length} rebalance tasks`, 'success');
    qc.invalidateQueries({ queryKey: ['panel-data'] });
  };
  return (
    <Card>
      <CardHeader title="Demand vs supply per cell" actions={<Button variant="primary" onClick={createTasks}>⚡ Create rebalance tasks</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Cell</th><th>Demand</th><th>Supply</th><th>Gap</th><th>Recommendation</th></tr></thead>
          <tbody>
            {cells.map((c) => {
              const gap = c.demand - c.supply;
              return (
                <tr key={c.id}>
                  <td>{c.label}</td><td>{c.demand}</td><td>{c.supply}</td>
                  <td style={{ color: gap > 5 ? colors.danger : gap > 0 ? colors.warning : colors.success, fontWeight: 600 }}>{gap > 0 ? `+${gap}` : gap}</td>
                  <td>{gap > 5 ? 'Move vehicles here' : gap < -3 ? 'Over-supplied — pull out' : 'Balanced'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Revenue({ db }: { db: NonNullable<ReturnType<typeof usePanelData>['data']> }) {
  const data = db.revenueByDay.map((d) => ({ date: d.date.slice(5), Trips: d.trips_cents / 100, Packages: d.packages_cents / 100, Subs: d.subs_cents / 100, Penalties: d.penalties_cents / 100 }));
  const totals = db.revenueByDay.reduce((s, d) => s + d.trips_cents + d.packages_cents + d.subs_cents + d.penalties_cents, 0);
  const rides = db.revenueByDay.reduce((s, d) => s + d.rides, 0);
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <div className="row-wrap">
        <MiniStat label="30-day revenue" value={formatMoney(totals)} />
        <MiniStat label="30-day rides" value={formatNumber(rides)} />
        <MiniStat label="ARPU (30d)" value={formatMoney(Math.round(totals / 60))} />
        <MiniStat label="Avg / ride" value={formatMoney(Math.round(totals / rides))} />
      </div>
      <Card>
        <CardHeader title="Revenue by day & product (€)" />
        <div className="card-pad"><Bars data={data} xKey="date" stacked series={[
          { key: 'Trips', name: 'Trips', color: chartPalette[0]! },
          { key: 'Packages', name: 'Packages', color: chartPalette[1]! },
          { key: 'Subs', name: 'Subscriptions', color: chartPalette[2]! },
          { key: 'Penalties', name: 'Penalties', color: chartPalette[5]! },
        ]} /></div>
      </Card>
    </div>
  );
}

function Cohorts({ db }: { db: NonNullable<ReturnType<typeof usePanelData>['data']> }) {
  return (
    <Card>
      <CardHeader title="ARPU / LTV cohorts" sub="Retention by signup month" />
      <div className="card-pad scroll-x">
        <table className="matrix">
          <thead><tr><th className="rowhead">Cohort</th><th>Users</th><th>LTV</th>{Array.from({ length: 6 }).map((_, w) => <th key={w}>W{w}</th>)}</tr></thead>
          <tbody>
            {db.cohorts.map((c) => (
              <tr key={c.cohort}>
                <td className="rowhead">{c.cohort}</td><td>{c.size}</td><td>{formatMoney(c.ltv_cents)}</td>
                {Array.from({ length: 6 }).map((_, w) => {
                  const v = c.retention[w];
                  return <td key={w} style={{ background: v != null ? `rgba(47,91,224,${(v / 100) * 0.6})` : 'transparent', color: v != null && v > 60 ? '#fff' : undefined }}>{v != null ? `${v}%` : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function OpsUtil({ db }: { db: NonNullable<ReturnType<typeof usePanelData>['data']> }) {
  const util = db.revenueByDay.map((d) => ({ date: d.date.slice(5), 'Rides/vehicle': +(d.rides / db.vehicles.length).toFixed(2) }));
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <div className="row-wrap">
        <MiniStat label="Rides / vehicle / day" value={(db.kpis.today_rides / db.vehicles.length).toFixed(1)} />
        <MiniStat label="Offline fleet" value={`${Math.round((db.vehicles.filter((v) => !v.session_online).length / db.vehicles.length) * 100)}%`} />
        <MiniStat label="Unlock success" value={`${db.kpis.unlock_success_pct}%`} />
        <MiniStat label="Battery swaps (20d)" value={String(db.batterySwaps.length)} />
        <MiniStat label="Task completion" value={`${Math.round((db.opsTasks.filter((t) => t.status === 'done').length / db.opsTasks.length) * 100)}%`} />
      </div>
      <Card><CardHeader title="Utilization (rides per vehicle)" /><div className="card-pad"><TrendLine data={util} xKey="date" series={[{ key: 'Rides/vehicle', name: 'Rides / vehicle', color: chartPalette[0]! }]} /></div></Card>
    </div>
  );
}

function Funnel({ db }: { db: NonNullable<ReturnType<typeof usePanelData>['data']> }) {
  const max = db.funnel[0]?.count ?? 1;
  return (
    <Card>
      <CardHeader title="Onboarding funnel" sub="install → signup → KYC → card → first ride" />
      <div className="card-pad stack" style={{ gap: 12 }}>
        {db.funnel.map((s, i) => {
          const pct = Math.round((s.count / max) * 100);
          const prev = db.funnel[i - 1]?.count;
          const drop = prev ? Math.round((1 - s.count / prev) * 100) : 0;
          return (
            <div key={s.step}>
              <div className="between" style={{ fontSize: 13, marginBottom: 4 }}>
                <span>{s.step}</span>
                <span className="muted">{formatNumber(s.count)} · {pct}%{i > 0 ? ` · −${drop}% drop` : ''}</span>
              </div>
              <div style={{ height: 26, background: colors.surfaceAlt, borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: chartPalette[i % chartPalette.length], borderRadius: 6 }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ReportBuilder() {
  const toast = useToast();
  const [entity, setEntity] = useState('rides');
  const [metric, setMetric] = useState('count');
  const [group, setGroup] = useState('city');
  const [email, setEmail] = useState('');
  return (
    <Card>
      <CardHeader title="Custom report builder" sub="Saved filters + scheduled CSV email (stub)" />
      <div className="card-pad">
        <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
          <label style={{ fontSize: 13 }}>Entity<Select value={entity} onChange={(e) => setEntity(e.target.value)}>{['rides', 'payments', 'vehicles', 'customers'].map((x) => <option key={x}>{x}</option>)}</Select></label>
          <label style={{ fontSize: 13 }}>Metric<Select value={metric} onChange={(e) => setMetric(e.target.value)}>{['count', 'revenue', 'avg duration', 'avg distance'].map((x) => <option key={x}>{x}</option>)}</Select></label>
          <label style={{ fontSize: 13 }}>Group by<Select value={group} onChange={(e) => setGroup(e.target.value)}>{['city', 'model', 'day', 'status'].map((x) => <option key={x}>{x}</option>)}</Select></label>
          <Button onClick={() => toast.push('Report saved to your views', 'success')}>Save report</Button>
        </div>
        <div className="divider" />
        <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
          <label style={{ fontSize: 13, flex: 1 }}>Schedule CSV email to<Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@penny.rent" /></label>
          <Select style={{ width: 'auto' }}><option>Daily 08:00</option><option>Weekly Mon 08:00</option><option>Monthly 1st</option></Select>
          <Button variant="primary" onClick={() => toast.push(`Scheduled — ${entity}/${metric} by ${group} → ${email || 'owner'}`, 'success')}>Schedule</Button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Reports run server-side and email a CSV. This is a UI stub wired to the report edge function on integration.</p>
      </div>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="card stat-card" style={{ minWidth: 160, flex: 1 }}><span className="stat-label">{label}</span><span style={{ fontSize: 20, fontWeight: 700 }}>{value}</span></div>;
}
