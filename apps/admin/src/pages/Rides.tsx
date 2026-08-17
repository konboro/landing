import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useDS } from '@/context/DataContext';
import { DataTable, type Column, type SavedView } from '@/components/ui/DataTable';
import { useTableState } from '@/hooks/useTableState';
import { useReceiptsForTrips } from '@/hooks/useMydata';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/primitives';
import { TripStatusBadge, Badge } from '@/components/ui/Badge';
import { ReceiptBadge } from '@/components/mydata/ReceiptBadge';
import { formatMoney, formatDistance, formatDuration, formatDateTime, shortId } from '@/lib/format';
import type { PaymentReceipt, RideRow } from '@/types/domain';

const STATUSES = ['active', 'ended', 'charged', 'disputed', 'aborted'];

export function RidesPage() {
  const ds = useDS();
  const nav = useNavigate();
  const state = useTableState({ sort: [{ field: 'started_at', dir: 'desc' }] });
  const { data, isLoading } = useQuery({ queryKey: ['rides', state.params], queryFn: () => ds.listRides(state.params) });

  // Receipt state for the page on screen, fetched alongside rather than folded
  // into v_admin_rides — the rides view is shared with other screens and this
  // keeps the tax column from becoming everyone's problem.
  const tripIds = useMemo(() => (data?.rows ?? []).map((r) => r.id), [data]);
  const receipts = useReceiptsForTrips(tripIds);
  const byTrip = useMemo(() => {
    const map = new Map<string, PaymentReceipt>();
    for (const r of receipts.data ?? []) if (r.trip_id) map.set(r.trip_id, r);
    return map;
  }, [receipts.data]);

  const columns: Column<RideRow>[] = [
    { key: 'id', header: 'Trip', sortable: true, render: (r) => <span className="mono">{shortId(r.id)}</span>, csv: (r) => r.id },
    { key: 'user_name', header: 'Rider', sortable: true, render: (r) => <div><div>{r.user_name}</div><div className="muted" style={{ fontSize: 12 }}>{r.user_phone}</div></div>, csv: (r) => r.user_name },
    { key: 'vehicle_code', header: 'Vehicle', sortable: true, render: (r) => <span className="mono">{r.vehicle_code}</span> },
    { key: 'city_name', header: 'City', sortable: true, render: (r) => r.city_name },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <TripStatusBadge status={r.status} /> },
    { key: 'started_at', header: 'Started', sortable: true, render: (r) => formatDateTime(r.started_at), csv: (r) => r.started_at ?? '' },
    { key: 'duration_s', header: 'Duration', sortable: true, align: 'right', render: (r) => formatDuration(r.duration_s), csv: (r) => r.duration_s },
    { key: 'distance_m', header: 'Distance', sortable: true, align: 'right', render: (r) => formatDistance(r.distance_m), csv: (r) => r.distance_m },
    { key: 'cost_cents', header: 'Cost', sortable: true, align: 'right', render: (r) => formatMoney(r.cost_cents), csv: (r) => r.cost_cents },
    {
      key: 'receipt',
      header: 'Receipt',
      hideable: true,
      render: (r) => {
        const rec = byTrip.get(r.id);
        // Undefined means the lookup has not answered yet (or the caller lacks
        // mydata.read). Rendering "No receipt" then would accuse the system of
        // losing a filing that may well exist.
        if (!rec) return <span className="muted" style={{ fontSize: 12 }}>{receipts.isLoading ? '…' : '—'}</span>;
        return (
          <ReceiptBadge
            state={rec.receipt_state}
            aa={rec.aa}
            filedManually={rec.filed_manually}
            submissionId={rec.submission_id}
            compact
          />
        );
      },
      csv: (r) => byTrip.get(r.id)?.receipt_state ?? '',
    },
    { key: 'flags', header: 'Flags', hideable: true, render: (r) => (
      <div style={{ display: 'flex', gap: 4 }}>
        {r.has_dispute ? <Badge tone="warning" dot={false}>Dispute</Badge> : null}
        {r.has_penalty ? <Badge tone="danger" dot={false}>Penalty</Badge> : null}
      </div>
    ), csv: (r) => [r.has_dispute ? 'dispute' : '', r.has_penalty ? 'penalty' : ''].filter(Boolean).join('|') },
  ];

  const savedViews: SavedView[] = [
    { name: 'Disputed', view: { filters: { has_dispute: true }, sort: [{ field: 'started_at', dir: 'desc' }] } },
    { name: 'With penalty', view: { filters: { has_penalty: true } } },
    { name: 'Active now', view: { filters: { status: 'active' } } },
    { name: 'Highest cost', view: { sort: [{ field: 'cost_cents', dir: 'desc' }] } },
  ];

  return (
    <div>
      <PageHeader title="Rides" sub="Full ride history with server-style sort, filter and export" />
      <DataTable
        columns={columns}
        data={data}
        state={state}
        loading={isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => nav(`/rides/${r.id}`)}
        searchPlaceholder="Search trip id, rider, phone, vehicle…"
        csvName="rides"
        savedViews={savedViews}
        filtersSlot={
          <>
            <Select style={{ width: 'auto' }} value={String(state.filters.status ?? 'all')} onChange={(e) => state.setFilter('status', e.target.value)}>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select style={{ width: 'auto' }} value={String(state.filters.city_name ?? 'all')} onChange={(e) => state.setFilter('city_name', e.target.value)}>
              <option value="all">All cities</option>
              <option value="Athens">Athens</option>
              <option value="Thessaloniki">Thessaloniki</option>
            </Select>
            <Select style={{ width: 'auto' }} value={String(state.filters.has_dispute ?? 'all')} onChange={(e) => state.setFilter('has_dispute', e.target.value === 'all' ? undefined : e.target.value === 'true')}>
              <option value="all">Dispute: any</option>
              <option value="true">Has dispute</option>
            </Select>
            <Select style={{ width: 'auto' }} value={String(state.filters.has_penalty ?? 'all')} onChange={(e) => state.setFilter('has_penalty', e.target.value === 'all' ? undefined : e.target.value === 'true')}>
              <option value="all">Penalty: any</option>
              <option value="true">Has penalty</option>
            </Select>
          </>
        }
      />
    </div>
  );
}
