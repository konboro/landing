// Connectivity — SIM / data-plan management for the IoT fleet.
//
// Backed by the `v_sim_*` views and the `sim-sync` / `sim-command` edge
// functions behind a swappable provider adapter (currently Truphone/1GLOBAL).
// docs/03: the MSISDN on each row is the number the gateway falls back to over
// SMS when a device has no GPRS session, so a suspended or silent SIM is an
// operational problem, not just a billing one.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { useBrand } from '@/context/BrandContext';
import { DataTable, type Column, type SavedView } from '@/components/ui/DataTable';
import { useTableState } from '@/hooks/useTableState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, Button, Select } from '@/components/ui/primitives';
import { Badge, SimHealthBadge, SimStatusBadge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import { Bars } from '@/components/charts/Charts';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { SimAlertsStrip, UsageBar } from '@/components/sim/SimBits';
import { SimDetailDrawer } from '@/components/sim/SimDetailDrawer';
import { SIM_PLANS } from '@/lib/simPlans';
import { formatMoney, formatNumber, relativeTime } from '@/lib/format';
import type { SimInventoryRow, SimStatus } from '@/types/domain';
import type { SimSyncResult } from '@/data/api';

const STATUSES: SimStatus[] = ['inventory', 'active', 'suspended', 'terminated', 'test'];
const HEALTHS = ['ok', 'near_limit', 'over_limit', 'no_usage', 'silent', 'unassigned'] as const;

/** docs/03 — the SMS budget alarm fires above this many outbound SMS per day. */
const SMS_BUDGET_PER_DAY = 500;

export function ConnectivityPage() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { can } = useAuth();
  const { colors } = useBrand();
  const { simId } = useParams();

  const state = useTableState({ pageSize: 25 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | 'suspend' | 'resume'>(null);

  const simsQ = useQuery({ queryKey: ['sims', state.params], queryFn: () => ds.getSims(state.params) });
  const alertsQ = useQuery({ queryKey: ['sim-alerts'], queryFn: () => ds.getSimAlerts() });
  const costQ = useQuery({ queryKey: ['sim-cost'], queryFn: () => ds.getSimCostSummary() });
  // The KPI tiles summarise the whole fleet, not the current table page.
  const allQ = useQuery({ queryKey: ['sims', 'all'], queryFn: () => ds.getSims({ page: 1, pageSize: 1000 }) });

  // Last provider sync is parked in the query cache (not component state) so
  // the live/cached chip survives navigating away and back.
  const lastSyncQ = useQuery<SimSyncResult | null>({
    queryKey: ['sim-sync'],
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  });

  const sync = useMutation({
    mutationFn: () => ds.syncSims(),
    onSuccess: (r) => {
      qc.setQueryData(['sim-sync'], r);
      toast.push(
        `Synced ${r.fetched} SIMs from ${r.provider} — ${r.updated} updated, ${r.discovered} new`,
        'success',
      );
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['sim-alerts'] });
      qc.invalidateQueries({ queryKey: ['sim-cost'] });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : 'Sync failed', 'error'),
  });

  const bulkCommand = useMutation({
    mutationFn: async ({ action, reason }: { action: 'suspend' | 'resume'; reason: string }) => {
      for (const id of selected) await ds.simCommand({ sim_id: id, action, reason });
    },
    onSuccess: (_r, v) => {
      toast.push(`${v.action === 'suspend' ? 'Suspended' : 'Resumed'} ${selected.size} SIM(s) (audited)`, 'success');
      setSelected(new Set());
      setBulk(null);
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['sim-alerts'] });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : 'Bulk command failed', 'error'),
  });

  const fleet = allQ.data?.rows ?? [];
  const kpis = useMemo(() => {
    const billable = fleet.filter((s) => s.status !== 'inventory');
    return {
      active: fleet.filter((s) => s.status === 'active').length,
      total: fleet.length,
      dataMb: billable.reduce((s, r) => s + r.data_used_mb_cycle, 0),
      costMtd: billable.reduce((s, r) => s + r.cost_mtd_cents, 0),
      attention: fleet.filter((s) => s.health !== 'ok').length,
    };
  }, [fleet]);

  const currentMonth = costQ.data?.[0];
  const smsThisMonth = currentMonth?.sms_total ?? 0;
  const smsBudgetMonth = SMS_BUDGET_PER_DAY * new Date().getUTCDate();

  const costChart = useMemo(
    () =>
      (costQ.data ?? [])
        .slice()
        .reverse()
        .map((m) => ({ month: m.month, cost: +(m.total_cost_cents / 100).toFixed(2), data_mb: Math.round(m.total_data_mb) })),
    [costQ.data],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const openSim = (id: string) => nav(`/connectivity/${id}`);
  const closeSim = () => nav('/connectivity');

  const columns: Column<SimInventoryRow>[] = [
    {
      key: 'sel',
      header: '',
      hideable: false,
      width: 32,
      render: (s) => (
        <input
          type="checkbox"
          checked={selected.has(s.id)}
          onChange={(e) => { e.stopPropagation(); toggle(s.id); }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${s.iccid}`}
        />
      ),
      csv: (s) => (selected.has(s.id) ? '1' : ''),
    },
    {
      key: 'iccid',
      header: 'ICCID',
      sortable: true,
      // Rendered verbatim — never grouped or truncated (Hard Rule #10).
      render: (s) => <span className="mono" style={{ fontSize: 12 }}>{s.iccid}</span>,
      csv: (s) => s.iccid,
    },
    { key: 'msisdn', header: 'MSISDN', sortable: true, render: (s) => <span className="mono" style={{ fontSize: 12 }}>{s.msisdn}</span>, csv: (s) => s.msisdn },
    { key: 'imsi', header: 'IMSI', sortable: true, defaultHidden: true, render: (s) => <span className="mono" style={{ fontSize: 12 }}>{s.imsi}</span>, csv: (s) => s.imsi },
    { key: 'provider', header: 'Provider', sortable: true, defaultHidden: true, render: (s) => s.provider, csv: (s) => s.provider },
    { key: 'status', header: 'Status', sortable: true, render: (s) => <SimStatusBadge status={s.status} />, csv: (s) => s.status },
    { key: 'health', header: 'Health', sortable: true, render: (s) => <SimHealthBadge health={s.health} />, csv: (s) => s.health },
    { key: 'plan_name', header: 'Plan', sortable: true, render: (s) => <span className="nowrap">{s.plan_name}</span>, csv: (s) => s.plan_name },
    {
      key: 'data_pct_used',
      header: 'Data used',
      sortable: true,
      width: 210,
      render: (s) => <UsageBar usedMb={s.data_used_mb_cycle} limitMb={s.plan_data_mb} pct={s.data_pct_used} />,
      csv: (s) => `${s.data_used_mb_cycle} MB / ${s.plan_data_mb} MB (${s.data_pct_used}%)`,
    },
    { key: 'cost_mtd_cents', header: 'Cost MTD', sortable: true, align: 'right', render: (s) => formatMoney(s.cost_mtd_cents), csv: (s) => s.cost_mtd_cents },
    {
      key: 'vehicle_code',
      header: 'Vehicle',
      sortable: true,
      render: (s) =>
        s.vehicle_id ? (
          <Link
            to={`/vehicles/${s.vehicle_id}`}
            className="mono"
            style={{ color: colors.primary }}
            onClick={(e) => e.stopPropagation()}
          >
            {s.vehicle_code}
          </Link>
        ) : (
          <span className="muted">—</span>
        ),
      csv: (s) => s.vehicle_code ?? '',
    },
    {
      key: 'device_imei',
      header: 'Device IMEI',
      sortable: true,
      render: (s) => <span className="mono" style={{ fontSize: 12 }}>{s.device_imei ?? '—'}</span>,
      csv: (s) => s.device_imei ?? '',
    },
    {
      key: 'last_seen_at',
      header: 'Last seen',
      sortable: true,
      render: (s) => (
        <span style={{ color: (s.days_since_seen ?? 0) >= 7 ? colors.danger : undefined }}>
          {s.last_seen_at ? relativeTime(s.last_seen_at) : '—'}
        </span>
      ),
      csv: (s) => s.last_seen_at ?? '',
    },
    {
      key: 'network',
      header: 'Network',
      sortable: true,
      render: (s) => <span className="nowrap">{s.network ?? '—'}{s.country ? ` · ${s.country}` : ''}</span>,
      csv: (s) => `${s.network ?? ''} ${s.country ?? ''}`.trim(),
    },
  ];

  const savedViews: SavedView[] = [
    { name: 'Over limit', view: { filters: { health: 'over_limit' }, sort: [{ field: 'data_pct_used', dir: 'desc' }] } },
    { name: 'Silent', view: { filters: { health: 'silent' }, sort: [{ field: 'last_seen_at', dir: 'asc' }] } },
    { name: 'Unassigned', view: { filters: { health: 'unassigned' } } },
    { name: 'Suspended', view: { filters: { status: 'suspended' } } },
    { name: 'Most expensive', view: { filters: {}, sort: [{ field: 'cost_mtd_cents', dir: 'desc' }] } },
  ];

  const lastSync = lastSyncQ.data?.synced_at ?? null;
  const canManage = can('settings.edit') || can('vehicles.status');

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title="Connectivity"
        sub="SIM inventory, data plans and cost across the IoT fleet"
        actions={
          <>
            <span className="muted nowrap" style={{ fontSize: 12, alignSelf: 'center' }}>
              {lastSync ? (
                <><Badge tone="success" dot={false}>Live</Badge> synced {relativeTime(lastSync)}</>
              ) : (
                <><Badge tone="neutral" dot={false}>Cached</Badge> not synced this session</>
              )}
            </span>
            <Button variant="primary" disabled={sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? 'Syncing…' : '⟳ Sync from Truphone'}
            </Button>
          </>
        }
      />

      {/* ---------- KPI tiles ---------- */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <StatCard
          label="Active SIMs"
          value={allQ.isLoading ? '—' : formatNumber(kpis.active)}
          icon="📶"
          delta={allQ.isLoading ? null : { value: `${kpis.total} total`, up: true }}
        />
        <StatCard
          label="Data used this cycle"
          value={allQ.isLoading ? '—' : `${kpis.dataMb.toFixed(1)} MB`}
          icon="📈"
        />
        <StatCard
          label="Cost MTD"
          value={allQ.isLoading ? '—' : formatMoney(kpis.costMtd)}
          icon="💶"
        />
        <StatCard
          label="SMS this month"
          value={costQ.isLoading ? '—' : formatNumber(smsThisMonth)}
          icon="✉️"
          delta={
            costQ.isLoading
              ? null
              : { value: `budget ${formatNumber(smsBudgetMonth)} (${SMS_BUDGET_PER_DAY}/day)`, up: smsThisMonth <= smsBudgetMonth }
          }
        />
        <StatCard
          label="SIMs needing attention"
          value={allQ.isLoading ? '—' : formatNumber(kpis.attention)}
          icon="⚠️"
          delta={allQ.isLoading ? null : { value: `${alertsQ.data?.length ?? 0} alerts`, up: kpis.attention === 0 }}
        />
      </div>

      {/* ---------- Alerts strip ---------- */}
      <Card>
        <CardHeader
          title="Needs attention"
          sub="Over/near limit · silent · unassigned · terminated but still fitted"
          actions={<Badge tone={alertsQ.data?.length ? 'warning' : 'success'}>{alertsQ.data?.length ?? 0}</Badge>}
        />
        <SimAlertsStrip alerts={alertsQ.data} loading={alertsQ.isLoading} error={alertsQ.error} onOpen={openSim} />
      </Card>

      {/* ---------- Inventory ---------- */}
      {simsQ.error ? (
        <Card><ErrorState message={simsQ.error instanceof Error ? simsQ.error.message : String(simsQ.error)} /></Card>
      ) : (
        <DataTable
          columns={columns}
          data={simsQ.data}
          state={state}
          loading={simsQ.isLoading}
          rowKey={(s) => s.id}
          onRowClick={(s) => openSim(s.id)}
          searchPlaceholder="Search ICCID / MSISDN / IMEI / vehicle…"
          csvName="sim-inventory"
          emptyTitle="No SIMs match"
          savedViews={savedViews}
          filtersSlot={
            <>
              <Select style={{ width: 'auto' }} value={String(state.filters.status ?? 'all')} onChange={(e) => state.setFilter('status', e.target.value)}>
                <option value="all">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select style={{ width: 'auto' }} value={String(state.filters.health ?? 'all')} onChange={(e) => state.setFilter('health', e.target.value)}>
                <option value="all">All health</option>
                {HEALTHS.map((h) => <option key={h} value={h}>{h}</option>)}
              </Select>
              <Select style={{ width: 'auto' }} value={String(state.filters.plan_name ?? 'all')} onChange={(e) => state.setFilter('plan_name', e.target.value)}>
                <option value="all">All plans</option>
                {SIM_PLANS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </Select>
              <Select style={{ width: 'auto' }} value={String(state.filters.linked ?? 'all')} onChange={(e) => state.setFilter('linked', e.target.value)}>
                <option value="all">Linked & spare</option>
                <option value="yes">Linked to a device</option>
                <option value="no">Not linked</option>
              </Select>
            </>
          }
          toolbarActions={
            selected.size ? (
              <>
                <span className="muted nowrap" style={{ fontSize: 12 }}>{selected.size} selected</span>
                <Button size="sm" disabled={!canManage || bulkCommand.isPending} onClick={() => setBulk('suspend')}>Suspend</Button>
                <Button size="sm" disabled={!canManage || bulkCommand.isPending} onClick={() => setBulk('resume')}>Resume</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </>
            ) : null
          }
        />
      )}

      {/* ---------- Cost trend ---------- */}
      <Card>
        <CardHeader title="Connectivity cost" sub="v_sim_cost_summary · last 6 months" />
        <div className="card-pad">
          {costQ.isLoading ? (
            <Skeleton height={200} />
          ) : costQ.error ? (
            <ErrorState message={costQ.error instanceof Error ? costQ.error.message : String(costQ.error)} />
          ) : (
            <>
              <Bars
                data={costChart}
                xKey="month"
                height={220}
                series={[{ key: 'cost', name: 'Cost (€)', color: colors.primary }]}
              />
              {currentMonth ? (
                <div className="row-wrap" style={{ fontSize: 12, marginTop: 6 }}>
                  <span className="muted">Avg per SIM <b>{formatMoney(currentMonth.avg_cost_cents)}</b></span>
                  <span className="muted">Active <b>{currentMonth.sims_active}</b></span>
                  <span className="muted">Data <b>{currentMonth.total_data_mb.toFixed(1)} MB</b></span>
                  <span className="muted">SMS <b>{currentMonth.sms_total}</b></span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>

      <SimDetailDrawer simId={simId ?? null} onClose={closeSim} />

      <ConfirmModal
        open={bulk !== null}
        onClose={() => setBulk(null)}
        busy={bulkCommand.isPending}
        onConfirm={(reason) => { if (bulk) bulkCommand.mutate({ action: bulk, reason }); }}
        title={`${bulk === 'suspend' ? 'Suspend' : 'Resume'} ${selected.size} SIM(s)`}
        message={
          bulk === 'suspend'
            ? 'Suspended SIMs lose data and SMS — any command needing the SMS fallback will fail until they are resumed.'
            : 'Resumes the selected SIMs with the provider.'
        }
        requireReason
        danger={bulk === 'suspend'}
        confirmLabel={bulk === 'suspend' ? 'Suspend' : 'Resume'}
      />
    </div>
  );
}
