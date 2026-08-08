import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePanelData } from '@/hooks/usePanelData';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, Input, Select } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useTableState } from '@/hooks/useTableState';
import { formatMoney, titleCase, relativeTime, formatDateTime, shortId } from '@/lib/format';
import type { StaffRole } from '@penny/db-types';
import type { AuditLogEntry } from '@/types/domain';

const ROLES: StaffRole[] = ['owner', 'admin', 'support', 'ops_manager', 'ops', 'accountant', 'readonly'];
const PERMS = ['payments.charge', 'payments.refund', 'users.block', 'zones.edit', 'vehicles.command', 'debts.writeoff', 'tasks.manage', 'settings.edit', 'team.manage', 'verification.review'];
const DEFAULT_MATRIX: Record<StaffRole, string[]> = {
  owner: PERMS, admin: PERMS,
  support: ['users.block', 'payments.refund', 'verification.review', 'debts.writeoff'],
  ops_manager: ['vehicles.command', 'tasks.manage', 'zones.edit'],
  ops: ['vehicles.command', 'tasks.manage'],
  accountant: ['payments.charge', 'payments.refund', 'debts.writeoff'],
  readonly: [],
};

export function TeamPage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('staff');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Team & accounts" sub="Staff, permissions, activity log, corporate accounts, feeds" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'staff', label: 'Staff' },
        { key: 'matrix', label: 'Permission matrix' },
        { key: 'activity', label: 'Activity log' },
        { key: 'corporate', label: 'Corporate accounts' },
        { key: 'feeds', label: 'MDS / GBFS' },
      ]} />
      {isLoading || !db ? <Card pad>Loading…</Card> : (
        <>
          {tab === 'staff' ? <Staff db={db} /> : null}
          {tab === 'matrix' ? <Matrix /> : null}
          {tab === 'activity' ? <Activity /> : null}
          {tab === 'corporate' ? <Corporate db={db} /> : null}
          {tab === 'feeds' ? <Feeds /> : null}
        </>
      )}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

function Staff({ db }: { db: DB }) {
  return (
    <Card>
      <CardHeader title="Staff" actions={<Button variant="primary">+ Invite</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>City scope</th><th>Active</th><th>Last active</th></tr></thead>
          <tbody>
            {db.staff.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.email}</td><td><Badge tone="info">{s.role}</Badge></td>
                <td>{s.city_scope.length ? s.city_scope.join(', ') : <span className="muted">All cities</span>}</td>
                <td>{s.active ? <Badge tone="success">Active</Badge> : <Badge>Disabled</Badge>}</td>
                <td>{relativeTime(s.last_active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Matrix() {
  const toast = useToast();
  const [matrix, setMatrix] = useState(DEFAULT_MATRIX);
  const toggle = (role: StaffRole, perm: string) => setMatrix((m) => ({ ...m, [role]: m[role].includes(perm) ? m[role].filter((p) => p !== perm) : [...m[role], perm] }));
  return (
    <Card>
      <CardHeader title="Role → permission matrix" sub="Checked in edge functions, not the client" actions={<Button size="sm" variant="primary" onClick={() => toast.push('Permission matrix saved (audited)', 'success')}>Save</Button>} />
      <div className="card-pad scroll-x">
        <table className="matrix">
          <thead><tr><th className="rowhead">Permission</th>{ROLES.map((r) => <th key={r}>{r}</th>)}</tr></thead>
          <tbody>
            {PERMS.map((perm) => (
              <tr key={perm}>
                <td className="rowhead mono" style={{ fontSize: 12 }}>{perm}</td>
                {ROLES.map((r) => {
                  const locked = r === 'owner';
                  return <td key={r}><input type="checkbox" disabled={locked} checked={matrix[r].includes(perm)} onChange={() => toggle(r, perm)} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Activity() {
  const ds = useDS();
  const state = useTableState({ sort: [{ field: 'at', dir: 'desc' }] });
  const { data, isLoading } = useQuery({ queryKey: ['audit', state.params], queryFn: () => ds.listAudit(state.params) });
  const columns: Column<AuditLogEntry>[] = [
    { key: 'at', header: 'When', sortable: true, render: (a) => formatDateTime(a.at), csv: (a) => a.at },
    { key: 'staff_id', header: 'Staff', sortable: true, render: (a) => a.staff_id ?? '—' },
    { key: 'action', header: 'Action', sortable: true, render: (a) => <Badge tone="info" dot={false}>{titleCase(a.action)}</Badge>, csv: (a) => a.action },
    { key: 'entity', header: 'Entity', sortable: true, render: (a) => a.entity },
    { key: 'entity_id', header: 'Entity ID', render: (a) => <span className="mono">{shortId(a.entity_id)}</span> },
    { key: 'reason', header: 'Reason', render: (a) => a.reason ?? '—' },
    { key: 'ip', header: 'IP', defaultHidden: true, render: (a) => a.ip ?? '—' },
  ];
  return (
    <DataTable
      columns={columns} data={data} state={state} loading={isLoading} rowKey={(a) => a.id}
      searchPlaceholder="Search action, entity, reason…" csvName="audit-log"
      filtersSlot={
        <Select style={{ width: 'auto' }} value={String(state.filters.entity ?? 'all')} onChange={(e) => state.setFilter('entity', e.target.value)}>
          <option value="all">All entities</option>
          {['user', 'payment', 'vehicle', 'zone', 'trip', 'debt', 'pricing_plan'].map((x) => <option key={x}>{x}</option>)}
        </Select>
      }
    />
  );
}

function Corporate({ db }: { db: DB }) {
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Corporate accounts" actions={<Button variant="primary">+ New account</Button>} />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Billing email</th><th>Members</th><th>MTD spend</th><th>Monthly invoicing</th></tr></thead>
            <tbody>{db.corporate.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.billing_email}</td><td>{c.member_count}</td><td>{formatMoney(c.mtd_spend_cents)}</td><td>{c.monthly_invoicing ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Subaccounts (city operators)" />
        <div className="card-pad muted">City-scoped operator subaccounts inherit a parent account's billing and are limited to their assigned cities. Manage members and monthly limits per city.</div>
      </Card>
    </div>
  );
}

function Feeds() {
  const toast = useToast();
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Card>
        <CardHeader title="GBFS feed" sub="General Bikeshare Feed Specification" />
        <div className="card-pad stack">
          <div className="between"><span>Status</span><Badge tone="success">Published</Badge></div>
          <label className="field-label">Public URL</label>
          <Input readOnly value="https://gbfs.penny.rent/gbfs.json" />
          <label className="field-label">Refresh (s)</label>
          <Input defaultValue="60" />
          <Button variant="primary" onClick={() => toast.push('GBFS config saved', 'success')}>Save</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="MDS provider feed" sub="Mobility Data Specification (city regulator)" />
        <div className="card-pad stack">
          <div className="between"><span>Status</span><Badge tone="warning">Sandbox</Badge></div>
          <label className="field-label">Agency API key</label>
          <Input type="password" defaultValue="mds_sk_live_xxx" />
          <label className="field-label">Provider ID</label>
          <Input defaultValue="penny-athens" />
          <Button variant="primary" onClick={() => toast.push('MDS config saved', 'success')}>Save</Button>
        </div>
      </Card>
    </div>
  );
}
