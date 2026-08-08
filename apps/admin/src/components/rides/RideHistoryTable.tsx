import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type Column, type SavedView } from '@/components/ui/DataTable';
import { TripStatusBadge, Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/primitives';
import type { TableState } from '@/hooks/useTableState';
import type { Page } from '@/data/query';
import { formatMoney, formatDistance, formatDuration, formatDateTime, titleCase } from '@/lib/format';
import { colors } from '@penny/ui';
import type { RideHistoryBase, UserRideHistoryRow, VehicleRideHistoryRow } from '@/types/domain';

export function PhotoReviewBadge({ value }: { value: string | null }) {
  if (!value) return <span className="muted">—</span>;
  const tone = value === 'rejected' ? 'danger' : value === 'pending' ? 'warning' : 'success';
  return <Badge tone={tone}>{titleCase(value)}</Badge>;
}

export function Stars({ rating, tags }: { rating: number | null; tags: string[] }) {
  if (rating == null) return <span className="muted">—</span>;
  return (
    <span title={tags.join(', ')} style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color: colors.warning }}>{'★'.repeat(rating)}</span>
      <span style={{ color: colors.border }}>{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

/** Total with the itemised breakdown underneath — the "cost breakdown" column. */
export function CostCell({ row }: { row: RideHistoryBase }) {
  const c = row.cost;
  const bits: string[] = [];
  if (c.unlock_cents) bits.push(`unlock ${(c.unlock_cents / 100).toFixed(2)}`);
  if (c.minutes_cents) bits.push(`min ${(c.minutes_cents / 100).toFixed(2)}`);
  if (c.pause_cents) bits.push(`pause ${(c.pause_cents / 100).toFixed(2)}`);
  if (c.paid_parking_cents) bits.push(`parking ${(c.paid_parking_cents / 100).toFixed(2)}`);
  if (c.penalty_cents) bits.push(`penalty ${(c.penalty_cents / 100).toFixed(2)}`);
  if (c.discount_cents) bits.push(`−disc ${(c.discount_cents / 100).toFixed(2)}`);
  if (c.bonus_cents) bits.push(`−bonus ${(c.bonus_cents / 100).toFixed(2)}`);
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontWeight: 600 }}>{formatMoney(c.total_cents, c.currency)}</div>
      <div className="muted" style={{ fontSize: 11 }}>{bits.length ? bits.join(' · ') : 'no charge'}</div>
    </div>
  );
}

function commonColumns<T extends RideHistoryBase>(): Column<T>[] {
  return [
    {
      key: 'started_at', header: 'Date', sortable: true, width: 150,
      render: (r) => (
        <div>
          <div>{formatDateTime(r.started_at)}</div>
          <div className="muted mono" style={{ fontSize: 11 }}>{r.id}</div>
        </div>
      ),
      csv: (r) => r.started_at ?? '',
    },
    { key: 'duration_s', header: 'Duration', sortable: true, align: 'right', render: (r) => (
      <span>{formatDuration(r.duration_s)}{r.pause_s ? <span className="muted" style={{ fontSize: 11 }}> +{formatDuration(r.pause_s)} paused</span> : null}</span>
    ), csv: (r) => r.duration_s },
    { key: 'distance_m', header: 'Distance', sortable: true, align: 'right', render: (r) => formatDistance(r.distance_m), csv: (r) => r.distance_m },
    { key: 'avg_speed_kmh', header: 'Avg speed', sortable: true, align: 'right', defaultHidden: true, render: (r) => `${r.avg_speed_kmh} km/h`, csv: (r) => r.avg_speed_kmh },
    { key: 'cost', header: 'Cost breakdown', sortable: true, sortField: 'cost_cents', align: 'right', width: 210, render: (r) => <CostCell row={r} />, csv: (r) => r.cost.total_cents },
    { key: 'unlock_cents', header: 'Unlock', defaultHidden: true, align: 'right', render: (r) => formatMoney(r.cost.unlock_cents), csv: (r) => r.cost.unlock_cents },
    { key: 'minutes_cents', header: 'Minutes', defaultHidden: true, align: 'right', render: (r) => formatMoney(r.cost.minutes_cents), csv: (r) => r.cost.minutes_cents },
    { key: 'pause_cents', header: 'Pause fee', defaultHidden: true, align: 'right', render: (r) => formatMoney(r.cost.pause_cents), csv: (r) => r.cost.pause_cents },
    { key: 'paid_parking_cents', header: 'Paid parking', defaultHidden: true, align: 'right', render: (r) => formatMoney(r.cost.paid_parking_cents), csv: (r) => r.cost.paid_parking_cents },
    { key: 'penalty_cents', header: 'Penalty', defaultHidden: true, align: 'right', render: (r) => formatMoney(r.cost.penalty_cents), csv: (r) => r.cost.penalty_cents },
    { key: 'discount_cents', header: 'Discount', defaultHidden: true, align: 'right', render: (r) => formatMoney(r.cost.discount_cents), csv: (r) => r.cost.discount_cents },
    { key: 'bonus_cents', header: 'Bonus', defaultHidden: true, align: 'right', render: (r) => formatMoney(r.cost.bonus_cents), csv: (r) => r.cost.bonus_cents },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <TripStatusBadge status={r.status} /> },
    { key: 'payment_status', header: 'Payment', sortable: true, render: (r) => (r.payment_status ? <Badge tone={r.payment_status === 'failed' ? 'danger' : 'success'}>{titleCase(r.payment_status)}</Badge> : <span className="muted">—</span>) },
    { key: 'photo_review', header: 'Photo', sortable: true, render: (r) => <PhotoReviewBadge value={r.photo_review} /> },
    { key: 'rating', header: 'Rating', sortable: true, render: (r) => <Stars rating={r.rating} tags={r.rating_tags} />, csv: (r) => r.rating ?? '' },
    { key: 'rating_tags', header: 'Rating tags', defaultHidden: true, render: (r) => (r.rating_tags.length ? r.rating_tags.join(', ') : '—'), csv: (r) => r.rating_tags.join(' | ') },
    { key: 'start_zone_name', header: 'Start zone', sortable: true, defaultHidden: true, render: (r) => r.start_zone_name ?? '—' },
    { key: 'end_zone_name', header: 'End zone', sortable: true, render: (r) => r.end_zone_name ?? <span className="muted">in progress</span> },
    {
      key: 'flags', header: 'Flags', hideable: true, render: (r) => (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {r.has_dispute ? <Badge tone="warning">Dispute</Badge> : null}
          {r.has_penalty ? <Badge tone="danger">Penalty</Badge> : null}
          {!r.has_dispute && !r.has_penalty ? <span className="muted">—</span> : null}
        </span>
      ),
      csv: (r) => [r.has_dispute ? 'dispute' : '', r.has_penalty ? 'penalty' : ''].filter(Boolean).join(' '),
    },
  ];
}

const SAVED_VIEWS: SavedView[] = [
  { name: 'Newest', view: { sort: [{ field: 'started_at', dir: 'desc' }] } },
  { name: 'Most expensive', view: { sort: [{ field: 'cost_cents', dir: 'desc' }] } },
  { name: 'Longest', view: { sort: [{ field: 'distance_m', dir: 'desc' }] } },
  { name: 'Disputes', view: { filters: { has_dispute: true } } },
  { name: 'Penalties', view: { filters: { has_penalty: true } } },
  { name: 'Photo rejected', view: { filters: { photo_review: 'rejected' } } },
];

function Filters({ state }: { state: TableState }): ReactNode {
  return (
    <>
      <Select style={{ width: 'auto' }} value={String(state.filters.status ?? 'all')} onChange={(e) => state.setFilter('status', e.target.value)}>
        <option value="all">All statuses</option>
        {['charged', 'ended', 'active', 'disputed', 'aborted'].map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>
      <Select style={{ width: 'auto' }} value={String(state.filters.photo_review ?? 'all')} onChange={(e) => state.setFilter('photo_review', e.target.value)}>
        <option value="all">All photo reviews</option>
        {['auto_ok', 'approved', 'pending', 'rejected', 'none'].map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>
      <Select style={{ width: 'auto' }} value={String(state.filters.rated ?? 'all')} onChange={(e) => state.setFilter('rated', e.target.value)}>
        <option value="all">Rated & unrated</option>
        <option value="true">Rated only</option>
        <option value="false">Unrated only</option>
      </Select>
    </>
  );
}

interface BaseProps<T> {
  data?: Page<T>;
  state: TableState;
  loading?: boolean;
  onRowClick: (row: T) => void;
  csvName: string;
  emptyTitle: string;
}

/** A user's ride history — the "other side" column is the vehicle. */
export function UserRideHistoryTable({ data, state, loading, onRowClick, csvName, emptyTitle }: BaseProps<UserRideHistoryRow>) {
  const columns: Column<UserRideHistoryRow>[] = [
    {
      key: 'vehicle_code', header: 'Vehicle', sortable: true, render: (r) => (
        <div>
          <Link className="mono" to={`/vehicles/${r.vehicle_id}`} onClick={(e) => e.stopPropagation()} style={{ color: colors.primary }}>{r.vehicle_code}</Link>
          <div className="muted" style={{ fontSize: 11 }}>{r.vehicle_model}</div>
        </div>
      ),
      csv: (r) => r.vehicle_code,
    },
    ...commonColumns<UserRideHistoryRow>(),
  ];
  const ordered = [columns[1]!, columns[0]!, ...columns.slice(2)];
  return (
    <DataTable
      columns={ordered}
      data={data}
      state={state}
      loading={loading}
      rowKey={(r) => r.id}
      onRowClick={onRowClick}
      searchPlaceholder="Search trip id, vehicle, zone…"
      csvName={csvName}
      savedViews={SAVED_VIEWS}
      filtersSlot={<Filters state={state} />}
      emptyTitle={emptyTitle}
    />
  );
}

/** A vehicle's ride history — the "other side" column is the rider. */
export function VehicleRideHistoryTable({ data, state, loading, onRowClick, csvName, emptyTitle }: BaseProps<VehicleRideHistoryRow>) {
  const columns: Column<VehicleRideHistoryRow>[] = [
    {
      key: 'user_name', header: 'Rider', sortable: true, render: (r) => (
        <div>
          <Link to={`/customers/${r.user_id}`} onClick={(e) => e.stopPropagation()} style={{ color: colors.primary }}>{r.user_name}</Link>
          <div className="muted mono" style={{ fontSize: 11 }}>{r.user_phone_masked}</div>
        </div>
      ),
      csv: (r) => r.user_name,
    },
    ...commonColumns<VehicleRideHistoryRow>(),
  ];
  const ordered = [columns[1]!, columns[0]!, ...columns.slice(2)];
  return (
    <DataTable
      columns={ordered}
      data={data}
      state={state}
      loading={loading}
      rowKey={(r) => r.id}
      onRowClick={onRowClick}
      searchPlaceholder="Search trip id, rider, zone…"
      csvName={csvName}
      savedViews={SAVED_VIEWS}
      filtersSlot={<Filters state={state} />}
      emptyTitle={emptyTitle}
    />
  );
}
