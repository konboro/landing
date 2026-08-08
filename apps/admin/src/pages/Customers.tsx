import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useDS } from '@/context/DataContext';
import { DataTable, type Column, type SavedView } from '@/components/ui/DataTable';
import { useTableState } from '@/hooks/useTableState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/primitives';
import { KycBadge, Badge } from '@/components/ui/Badge';
import { formatMoney, formatDate, initials, titleCase } from '@/lib/format';
import { colors } from '@penny/ui';
import type { CustomerRow } from '@/types/domain';

export function CustomersPage() {
  const ds = useDS();
  const nav = useNavigate();
  const state = useTableState({ sort: [{ field: 'created_at', dir: 'desc' }] });
  const { data, isLoading } = useQuery({ queryKey: ['customers', state.params], queryFn: () => ds.listCustomers(state.params) });

  const columns: Column<CustomerRow>[] = [
    { key: 'full_name', header: 'Customer', sortable: true, render: (c) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: colors.primarySoft, color: colors.primaryDark, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12, textTransform: 'uppercase' }}>{initials(c.full_name)}</span>
        <div><div>{c.full_name}</div><div className="muted" style={{ fontSize: 12 }}>{c.phone}</div></div>
      </div>
    ), csv: (c) => c.full_name ?? '' },
    { key: 'email', header: 'Email', sortable: true, render: (c) => c.email ?? '—' },
    { key: 'kyc_status', header: 'KYC', sortable: true, render: (c) => <KycBadge status={c.kyc_status} /> },
    { key: 'status', header: 'Status', sortable: true, render: (c) => <Badge tone={c.status === 'active' ? 'success' : c.status === 'blocked' ? 'danger' : 'warning'}>{titleCase(c.status)}</Badge> },
    { key: 'rides', header: 'Rides', sortable: true, align: 'right', render: (c) => c.rides },
    { key: 'spend_cents', header: 'Spend', sortable: true, align: 'right', render: (c) => formatMoney(c.spend_cents), csv: (c) => c.spend_cents },
    { key: 'debt_cents', header: 'Debt', sortable: true, align: 'right', render: (c) => c.debt_cents > 0 ? <span style={{ color: colors.danger, fontWeight: 600 }}>{formatMoney(c.debt_cents)}</span> : '—', csv: (c) => c.debt_cents },
    { key: 'score', header: 'Score', sortable: true, align: 'right', render: (c) => c.score },
    { key: 'created_at', header: 'Signup', sortable: true, render: (c) => formatDate(c.created_at), csv: (c) => c.created_at },
    { key: 'legacy_atom_user_id', header: 'Legacy ID', sortable: true, defaultHidden: true, render: (c) => c.legacy_atom_user_id ?? '—' },
  ];

  const savedViews: SavedView[] = [
    { name: 'Has debt', view: { sort: [{ field: 'debt_cents', dir: 'desc' }] } },
    { name: 'Top spenders', view: { sort: [{ field: 'spend_cents', dir: 'desc' }] } },
    { name: 'KYC pending', view: { filters: { kyc_status: 'pending' } } },
    { name: 'Blocked', view: { filters: { status: 'blocked' } } },
    { name: 'Low score', view: { sort: [{ field: 'score', dir: 'asc' }] } },
  ];

  return (
    <div>
      <PageHeader title="Customers" sub="Search by phone, email, name or legacy Atom id" />
      <DataTable
        columns={columns}
        data={data}
        state={state}
        loading={isLoading}
        rowKey={(c) => c.id}
        onRowClick={(c) => nav(`/customers/${c.id}`)}
        searchPlaceholder="Search phone, email, name, legacy id…"
        csvName="customers"
        savedViews={savedViews}
        filtersSlot={
          <>
            <Select style={{ width: 'auto' }} value={String(state.filters.kyc_status ?? 'all')} onChange={(e) => state.setFilter('kyc_status', e.target.value)}>
              <option value="all">All KYC</option>
              {['approved', 'pending', 'rejected', 'none'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select style={{ width: 'auto' }} value={String(state.filters.status ?? 'all')} onChange={(e) => state.setFilter('status', e.target.value)}>
              <option value="all">All statuses</option>
              {['active', 'blocked', 'shadow_banned'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </>
        }
      />
    </div>
  );
}
