import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePanelData } from '@/hooks/usePanelData';
import { useDS } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button, Input, Select, Field, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/feedback';
import { useTableState } from '@/hooks/useTableState';
import {
  EntityModal, RemoveConfirm, RowActions, UnavailableNote, useConfigResource, type ConfigRow,
} from '@/components/config';
import { titleCase, relativeTime, formatDateTime, shortId } from '@/lib/format';
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
      {tab === 'matrix' ? <Matrix /> : null}
      {tab === 'activity' ? <Activity /> : null}
      {tab === 'corporate' ? <Corporate /> : null}
      {tab === 'feeds' ? <Feeds /> : null}
      {tab === 'staff' ? (isLoading || !db ? <Card pad>Loading…</Card> : <Staff db={db} />) : null}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

/* ═══════════════════════ Staff ═══════════════════════ */

interface StaffRow extends ConfigRow {
  id: string;
  user_id: string;
  role: StaffRole;
  /** NULL means every city — not "no cities". */
  city_scope: string[] | null;
  active: boolean;
  created_at?: string;
}

function Staff({ db }: { db: DB }) {
  const ds = useDS();
  const { can, cities } = useAuth();
  const mayManage = can('team.manage');
  // `admin-list` gates the staff table on team.manage, so a viewer without it
  // falls back to the copy in the bulk panel payload.
  const staff = useConfigResource<StaffRow>('staff', { label: 'staff member', enabled: mayManage });
  const rows = mayManage ? staff.rows : (db.staff as unknown as StaffRow[]);

  // The staff table holds only user_id — names and emails live on `users`.
  const { data: people } = useQuery({
    queryKey: ['staff-people'],
    queryFn: () => ds.listCustomers({ pageSize: 500 }),
  });
  const personById = useMemo(() => {
    const m = new Map<string, { name: string; email: string | null; phone: string | null }>();
    for (const c of people?.rows ?? []) {
      m.set(c.id, { name: c.full_name ?? '—', email: c.email ?? null, phone: c.phone ?? null });
    }
    return m;
  }, [people]);

  const cityName = (id: string) => cities.find((c) => c.id === id)?.name ?? shortId(id);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [removing, setRemoving] = useState<StaffRow | null>(null);

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader
          title="Staff"
          sub="Who can sign in to the panel and the ops app"
          actions={
            <Button variant="primary" disabled={!mayManage || staff.busy} onClick={() => setAdding(true)}>
              + Add staff member
            </Button>
          }
        />
        {/* Deliberately NOT called "Invite": nothing in this system sends an
            invitation email. Granting staff means attaching a role to an account
            that already exists, and the button now says exactly that. */}
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Adding staff grants an <strong>existing</strong> Penny account access to the panel.
            No invitation email is sent — there is no invite flow in this system — so the person
            must already have signed up in the rider app.
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>City scope</th><th>Active</th><th>Added</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => {
                const p = personById.get(s.user_id);
                return (
                  <tr key={s.id}>
                    <td>{p?.name ?? <span className="mono muted">{shortId(s.user_id)}</span>}</td>
                    <td>{p?.email ?? p?.phone ?? <span className="muted">—</span>}</td>
                    <td><Badge tone="info">{s.role}</Badge></td>
                    {/* `staff.city_scope` is nullable and NULL is the common case —
                        the schema uses it to mean "every city". Indexing it blanked
                        the whole page the moment one unrestricted staff row existed. */}
                    <td>
                      {s.city_scope === null || s.city_scope.length === 0
                        ? <span className="muted">All cities</span>
                        : s.city_scope.map(cityName).join(', ')}
                    </td>
                    <td>{s.active ? <Badge tone="success">Active</Badge> : <Badge>Disabled</Badge>}</td>
                    <td>{s.created_at ? relativeTime(s.created_at) : '—'}</td>
                    <td>
                      <RowActions
                        disabled={!mayManage || staff.busy}
                        onEdit={() => setEditing(s)}
                        onRemove={() => setRemoving(s)}
                        removeLabel="Deactivate"
                        removeDisabledReason={s.active ? undefined : 'Already deactivated'}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <div className="card-pad muted">No staff rows.</div> : null}
      </Card>

      <AddStaffModal
        open={adding}
        onClose={() => setAdding(false)}
        cities={cities}
        existing={rows.map((s) => s.user_id)}
        busy={staff.busy}
        onSubmit={(values) => staff.create.mutate({ values }, { onSuccess: () => setAdding(false) })}
      />

      <EditStaffModal
        row={editing}
        onClose={() => setEditing(null)}
        cities={cities}
        busy={staff.busy}
        name={editing ? personById.get(editing.user_id)?.name ?? shortId(editing.user_id) : ''}
        onSubmit={(id, values) => staff.update.mutate({ key: id, values }, { onSuccess: () => setEditing(null) })}
      />

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        mode="deactivate"
        label="staff member"
        name={removing ? personById.get(removing.user_id)?.name ?? shortId(removing.user_id) : ''}
        busy={staff.busy}
        onConfirm={(reason) => {
          if (!removing) return;
          staff.remove.mutate({ key: removing.id, reason: reason || undefined }, { onSuccess: () => setRemoving(null) });
        }}
      />
    </div>
  );
}

function CityScopePicker({
  cities, value, onChange,
}: {
  cities: Array<{ id: string; name: string }>;
  /** null = all cities. */
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const all = value === null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Checkbox
        label="All cities"
        checked={all}
        onChange={(e) => onChange(e.target.checked ? null : [])}
      />
      {!all ? (
        <div className="row-wrap" style={{ gap: 8 }}>
          {cities.map((c) => (
            <Checkbox
              key={c.id}
              label={c.name}
              checked={(value ?? []).includes(c.id)}
              onChange={(e) => {
                const set = new Set(value ?? []);
                if (e.target.checked) set.add(c.id); else set.delete(c.id);
                onChange([...set]);
              }}
            />
          ))}
        </div>
      ) : null}
      {!all && (value ?? []).length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>Pick at least one city, or switch back to all cities.</div>
      ) : null}
    </div>
  );
}

function AddStaffModal({
  open, onClose, cities, existing, busy, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  cities: Array<{ id: string; name: string }>;
  existing: string[];
  busy?: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const ds = useDS();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [role, setRole] = useState<StaffRole>('support');
  const [scope, setScope] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) { setSearch(''); setPicked(null); setRole('support'); setScope(null); }
  }, [open]);

  const { data: results, isFetching } = useQuery({
    queryKey: ['staff-search', search],
    queryFn: () => ds.listCustomers({ search, pageSize: 8 }),
    enabled: open && search.trim().length >= 2,
  });

  const scopeOk = scope === null || scope.length > 0;

  return (
    <EntityModal
      open={open}
      onClose={onClose}
      title="Add staff member"
      saveLabel="Grant access"
      busy={busy}
      canSave={!!picked && scopeOk}
      onSave={() => picked && onSubmit({
        user_id: picked.id,
        role,
        // NULL is "every city"; an empty array would mean "no cities at all".
        city_scope: scope,
        active: true,
      })}
    >
      <div className="muted" style={{ fontSize: 13 }}>
        Search for an account that already exists, then choose what it may do. This sends no
        email — the person simply gains access the next time they sign in.
      </div>
      <Field label="Find a user" required hint="Search by name, phone or email (min. 2 characters).">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPicked(null); }} placeholder="maria / +3069… / maria@…" />
      </Field>
      {search.trim().length >= 2 ? (
        <div className="stack" style={{ gap: 4, maxHeight: 200, overflowY: 'auto' }}>
          {isFetching ? <div className="muted" style={{ fontSize: 13 }}>Searching…</div> : null}
          {(results?.rows ?? []).map((c) => {
            const already = existing.includes(c.id);
            const isPicked = picked?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className={`chip ${isPicked ? 'active' : ''}`}
                style={{ justifyContent: 'flex-start', textAlign: 'left', opacity: already ? 0.5 : 1 }}
                disabled={already}
                title={already ? 'Already a staff member' : undefined}
                onClick={() => setPicked({ id: c.id, name: c.full_name ?? c.id })}
              >
                {c.full_name ?? '—'} · <span className="muted">{c.email ?? c.phone ?? shortId(c.id)}</span>
                {already ? ' · already staff' : ''}
              </button>
            );
          })}
          {!isFetching && (results?.rows ?? []).length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No accounts match. They must sign up in the rider app first.</div>
          ) : null}
        </div>
      ) : null}
      <Field label="Role" required hint="Permissions come from role_permissions, checked in the edge functions.">
        <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Field>
      <Field label="City scope">
        <CityScopePicker cities={cities} value={scope} onChange={setScope} />
      </Field>
    </EntityModal>
  );
}

function EditStaffModal({
  row, onClose, cities, busy, name, onSubmit,
}: {
  row: StaffRow | null;
  onClose: () => void;
  cities: Array<{ id: string; name: string }>;
  busy?: boolean;
  name: string;
  onSubmit: (id: string, values: Record<string, unknown>) => void;
}) {
  const [role, setRole] = useState<StaffRole>('support');
  const [scope, setScope] = useState<string[] | null>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (row) {
      setRole(row.role);
      // Preserve the NULL/array distinction exactly as stored.
      setScope(row.city_scope === null ? null : [...row.city_scope]);
      setActive(row.active);
    }
  }, [row]);

  const scopeOk = scope === null || scope.length > 0;

  return (
    <EntityModal
      open={row !== null}
      onClose={onClose}
      title={`Edit ${name}`}
      busy={busy}
      canSave={scopeOk}
      onSave={() => row && onSubmit(row.id, { role, city_scope: scope, active })}
    >
      <Field label="Role" required>
        <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Field>
      <Field label="City scope" hint="All cities is stored as NULL, not an empty list.">
        <CityScopePicker cities={cities} value={scope} onChange={setScope} />
      </Field>
      <Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} />
    </EntityModal>
  );
}

/* ═══════════════════════ Permission matrix ═══════════════════════ */

/**
 * Read-only. The live mapping is `role_permissions`, which the panel receives
 * per session through `admin-me` and which `admin-write` cannot touch — it is
 * not in the table allowlist. The Save button that used to sit here raised a
 * "saved (audited)" toast and wrote nothing at all.
 */
function Matrix() {
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <UnavailableNote title="This matrix is the documented default, and is read-only">
        Live permissions live in <span className="mono">role_permissions</span> and are enforced
        in the edge functions. That table is not in the <span className="mono">admin-write</span>
        allowlist, so it cannot be edited from the panel — changes go through a migration.
      </UnavailableNote>
      <Card>
        <CardHeader title="Role → permission matrix" sub="Checked in edge functions, not the client" />
        <div className="card-pad scroll-x">
          <table className="matrix">
            <thead><tr><th className="rowhead">Permission</th>{ROLES.map((r) => <th key={r}>{r}</th>)}</tr></thead>
            <tbody>
              {PERMS.map((perm) => (
                <tr key={perm}>
                  <td className="rowhead mono" style={{ fontSize: 12 }}>{perm}</td>
                  {ROLES.map((r) => (
                    <td key={r}>{DEFAULT_MATRIX[r].includes(perm) ? '✓' : <span className="muted">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════ Activity ═══════════════════════ */

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
          {['user', 'payment', 'vehicle', 'zone', 'trip', 'debt', 'pricing_plan', 'faq_item', 'loyalty_tier', 'poi', 'staff'].map((x) => <option key={x}>{x}</option>)}
        </Select>
      }
    />
  );
}

/* ═══════════════════════ Corporate accounts ═══════════════════════ */

interface CorporateRow extends ConfigRow {
  id: string;
  name: string;
  billing_email: string | null;
  stripe_customer_id: string | null;
  monthly_invoicing: boolean;
  active: boolean;
}

function Corporate() {
  const { can } = useAuth();
  const mayManage = can('team.manage');
  const corp = useConfigResource<CorporateRow>('corporate_accounts', {
    label: 'corporate account',
    enabled: mayManage,
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CorporateRow | null>(null);
  const [removing, setRemoving] = useState<CorporateRow | null>(null);
  const [form, setForm] = useState({ name: '', billing_email: '', stripe_customer_id: '', monthly_invoicing: false, active: true });

  const openCreate = () => {
    setForm({ name: '', billing_email: '', stripe_customer_id: '', monthly_invoicing: false, active: true });
    setCreating(true);
  };
  const openEdit = (c: CorporateRow) => {
    setForm({
      name: c.name,
      billing_email: c.billing_email ?? '',
      stripe_customer_id: c.stripe_customer_id ?? '',
      monthly_invoicing: c.monthly_invoicing,
      active: c.active,
    });
    setEditing(c);
  };
  const close = () => { setCreating(false); setEditing(null); };

  const save = () => {
    const values = {
      name: form.name.trim(),
      billing_email: form.billing_email.trim() || null,
      stripe_customer_id: form.stripe_customer_id.trim() || null,
      monthly_invoicing: form.monthly_invoicing,
      active: form.active,
    };
    if (editing) corp.update.mutate({ key: editing.id, values }, { onSuccess: close });
    else corp.create.mutate({ values }, { onSuccess: close });
  };

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader
          title="Corporate accounts"
          sub={`${corp.total} account${corp.total === 1 ? '' : 's'}`}
          actions={<Button variant="primary" disabled={!mayManage || corp.busy} onClick={openCreate}>+ New account</Button>}
        />
        {!mayManage ? <div className="card-pad muted">You need <span className="mono">team.manage</span> to manage corporate accounts.</div> : null}
        {corp.error ? <div className="card-pad muted">Could not load accounts: {corp.error}</div> : null}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Billing email</th><th>Monthly invoicing</th><th>Stripe customer</th><th>Status</th><th /></tr></thead>
            <tbody>
              {corp.rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.billing_email ?? <span className="muted">—</span>}</td>
                  <td>{c.monthly_invoicing ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</td>
                  <td className="mono">{c.stripe_customer_id ?? <span className="muted">—</span>}</td>
                  <td>{c.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td>
                    <RowActions
                      disabled={!mayManage || corp.busy}
                      onEdit={() => openEdit(c)}
                      onRemove={() => setRemoving(c)}
                      removeLabel="Deactivate"
                      removeDisabledReason={c.active ? undefined : 'Already inactive'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {corp.isLoading ? <div className="card-pad muted">Loading…</div> : null}
        {!corp.isLoading && corp.rows.length === 0 ? (
          <div className="card-pad">
            <EmptyState
              emoji="🏢"
              title="No corporate accounts"
              hint="Business customers billed monthly rather than per ride."
              action={mayManage ? <Button variant="primary" onClick={openCreate}>+ New account</Button> : undefined}
            />
          </div>
        ) : null}
      </Card>

      <EntityModal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? `Edit ${editing.name}` : 'New corporate account'}
        busy={corp.busy}
        canSave={form.name.trim().length > 1}
        onSave={save}
      >
        <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme AE" /></Field>
        <Field label="Billing email" hint="Where the monthly invoice goes.">
          <Input type="email" value={form.billing_email} onChange={(e) => setForm({ ...form, billing_email: e.target.value })} placeholder="billing@acme.gr" />
        </Field>
        <Field label="Stripe customer id" hint="Links the company to its Stripe record. Stored exactly as entered.">
          <Input className="mono" value={form.stripe_customer_id} onChange={(e) => setForm({ ...form, stripe_customer_id: e.target.value })} placeholder="cus_…" />
        </Field>
        <Checkbox label="Monthly invoicing" checked={form.monthly_invoicing} onChange={(e) => setForm({ ...form, monthly_invoicing: e.target.checked })} />
        <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </EntityModal>

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        // Never a real delete: invoices issued to a company are retained under
        // Greek myDATA rules (docs/05).
        mode="deactivate"
        label="corporate account"
        name={removing?.name ?? ''}
        busy={corp.busy}
        onConfirm={(reason) => {
          if (!removing) return;
          corp.remove.mutate({ key: removing.id, reason: reason || undefined }, { onSuccess: () => setRemoving(null) });
        }}
      />

      <Card>
        <CardHeader title="Subaccounts (city operators)" />
        <div className="card-pad muted">City-scoped operator subaccounts inherit a parent account's billing and are limited to their assigned cities. Members and per-city limits live on <span className="mono">corporate_members</span>, which has no panel editor yet.</div>
      </Card>
    </div>
  );
}

/* ═══════════════════════ Feeds ═══════════════════════ */

/**
 * Read-only. Both Save buttons used to raise a "config saved" toast without a
 * request behind them — there is no GBFS/MDS settings table in the
 * `admin-write` allowlist to save into.
 */
function Feeds() {
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <UnavailableNote title="Feed settings are read-only">
        These values are baked into the <span className="mono">gbfs</span> edge function and its
        deployment secrets. There is no feed-config table in the
        <span className="mono"> admin-write </span> allowlist, so the Save buttons that used to
        sit here reported success without writing anything.
      </UnavailableNote>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <CardHeader title="GBFS feed" sub="General Bikeshare Feed Specification" />
          <div className="card-pad stack">
            <div className="between"><span>Status</span><Badge tone="success">Published</Badge></div>
            <Field label="Public URL"><Input readOnly value="https://gbfs.penny.rent/gbfs.json" /></Field>
            <Field label="Refresh (s)"><Input readOnly value="60" /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="MDS provider feed" sub="Mobility Data Specification (city regulator)" />
          <div className="card-pad stack">
            <div className="between"><span>Status</span><Badge tone="warning">Sandbox</Badge></div>
            <Field label="Agency API key" hint="Held as a deployment secret, never shown here.">
              <Input readOnly value="••••••••" />
            </Field>
            <Field label="Provider ID"><Input readOnly value="penny-athens" /></Field>
          </div>
        </Card>
      </div>
    </div>
  );
}
