import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePanelData } from '@/hooks/usePanelData';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button, Field, Input, Select, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/feedback';
import { MapView, type MapMarker } from '@/components/map/MapView';
import {
  EntityModal, RemoveConfirm, RowActions, StringListEditor, UnavailableNote,
  useConfigResource, type ConfigRow,
} from '@/components/config';
import { formatMoney, formatDate, titleCase, relativeTime } from '@/lib/format';
import { colors } from '@penny/ui';

export function MarketingPage() {
  const [tab, setTab] = useState('promos');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Marketing" sub="Promos, groups, campaigns, loyalty, POIs, referrals" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'promos', label: 'Promo codes' },
        { key: 'groups', label: 'Customer groups' },
        { key: 'campaigns', label: 'Campaigns' },
        { key: 'loyalty', label: 'Loyalty' },
        { key: 'pois', label: 'POIs' },
        { key: 'referrals', label: 'Referral program' },
      ]} />
      {tab === 'promos' ? <Promos /> : null}
      {tab === 'groups' ? <Groups /> : null}
      {tab === 'campaigns' ? <Campaigns /> : null}
      {tab === 'loyalty' ? <Loyalty /> : null}
      {tab === 'pois' ? <Pois /> : null}
      {tab === 'referrals' ? <Referrals /> : null}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

/* ═══════════════════════ Promo codes ═══════════════════════ */

type PromoKind = 'percent' | 'fixed' | 'free_minutes';
const PROMO_KINDS: PromoKind[] = ['percent', 'fixed', 'free_minutes'];

interface PromoRow extends ConfigRow {
  id: string;
  code: string;
  kind: PromoKind;
  /** One column, three readings — see `promoUnit`. */
  value: number;
  max_uses: number | null;
  per_user_limit: number;
  valid_from: string | null;
  valid_to: string | null;
  new_users_only: boolean;
  city_id: string | null;
  active: boolean;
}

/**
 * `value` is stored as a single integer whose unit depends on `kind`: percent
 * points, cents, or minutes. Only the money case is scaled for the operator —
 * typing "5" into a euro field must not create a 5-cent discount.
 */
const promoUnit: Record<PromoKind, { suffix: string; label: string; hint: string }> = {
  percent: { suffix: '%', label: 'Discount (%)', hint: 'Percent off the ride total, e.g. 15 for 15%.' },
  fixed: { suffix: '€', label: 'Discount (EUR)', hint: 'Euros off the ride total — stored as cents.' },
  free_minutes: { suffix: 'min', label: 'Free minutes', hint: 'Riding minutes granted, e.g. 30.' },
};

function promoValueLabel(kind: PromoKind, value: number): string {
  if (kind === 'percent') return `${value}%`;
  if (kind === 'free_minutes') return `${value} min`;
  return formatMoney(value);
}

/** Form value (as typed) → the integer the column stores. */
function toStoredValue(kind: PromoKind, input: string): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return NaN;
  return kind === 'fixed' ? Math.round(n * 100) : Math.round(n);
}

/** Stored integer → the value shown in the form. */
function fromStoredValue(kind: PromoKind, stored: number): string {
  return kind === 'fixed' ? (stored / 100).toFixed(2) : String(stored);
}

const EMPTY_PROMO = {
  code: '', kind: 'percent' as PromoKind, value: '10', max_uses: '', per_user_limit: '1',
  valid_from: '', valid_to: '', new_users_only: false, city_id: '', active: true,
};

function Promos() {
  const { can, cities } = useAuth();
  const mayEdit = can('settings.edit');
  const promos = useConfigResource<PromoRow>('promo_codes', { label: 'promo code', enabled: mayEdit });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PromoRow | null>(null);
  const [removing, setRemoving] = useState<PromoRow | null>(null);
  const [form, setForm] = useState(EMPTY_PROMO);

  const cityName = (id: string | null) => (id ? cities.find((c) => c.id === id)?.name ?? '—' : null);

  const openCreate = () => { setForm(EMPTY_PROMO); setCreating(true); };
  const openEdit = (p: PromoRow) => {
    setForm({
      code: p.code,
      kind: p.kind,
      value: fromStoredValue(p.kind, p.value),
      max_uses: p.max_uses === null ? '' : String(p.max_uses),
      per_user_limit: String(p.per_user_limit),
      valid_from: isoToLocal(p.valid_from),
      valid_to: isoToLocal(p.valid_to),
      new_users_only: p.new_users_only,
      city_id: p.city_id ?? '',
      active: p.active,
    });
    setEditing(p);
  };
  const close = () => { setCreating(false); setEditing(null); };

  // Switching kind re-reads the same number in a new unit, so convert rather
  // than silently reinterpreting "5" as 5 cents.
  const changeKind = (next: PromoKind) => {
    const stored = toStoredValue(form.kind, form.value);
    setForm({ ...form, kind: next, value: Number.isFinite(stored) ? fromStoredValue(next, stored) : form.value });
  };

  const storedValue = toStoredValue(form.kind, form.value);
  const valueOk = Number.isFinite(storedValue) && storedValue > 0 && (form.kind !== 'percent' || storedValue <= 100);
  const canSave = form.code.trim().length > 1 && valueOk;

  const save = () => {
    const values = {
      code: form.code.trim(),
      kind: form.kind,
      value: storedValue,
      max_uses: form.max_uses.trim() === '' ? null : Number(form.max_uses),
      per_user_limit: Number(form.per_user_limit) || 1,
      valid_from: localToIso(form.valid_from),
      valid_to: localToIso(form.valid_to),
      new_users_only: form.new_users_only,
      // NULL scopes the code to every city.
      city_id: form.city_id || null,
      active: form.active,
    };
    if (editing) promos.update.mutate({ key: editing.id, values }, { onSuccess: close });
    else promos.create.mutate({ values }, { onSuccess: close });
  };

  const unit = promoUnit[form.kind];

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader
          title="Promo codes"
          sub={`${promos.total} code${promos.total === 1 ? '' : 's'}`}
          actions={<Button variant="primary" disabled={!mayEdit || promos.busy} onClick={openCreate}>+ New code</Button>}
        />
        {!mayEdit ? <div className="card-pad muted">You need <span className="mono">settings.edit</span> to manage promo codes.</div> : null}
        {promos.error ? <div className="card-pad muted">Could not load promo codes: {promos.error}</div> : null}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Max uses</th><th>Per user</th><th>Window</th><th>City</th><th>New only</th><th>Status</th><th /></tr></thead>
            <tbody>
              {promos.rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.code}</td>
                  <td>{titleCase(p.kind)}</td>
                  <td>{promoValueLabel(p.kind, p.value)}</td>
                  <td>{p.max_uses ?? <span className="muted">Unlimited</span>}</td>
                  <td>{p.per_user_limit}</td>
                  <td>{formatDate(p.valid_from)} → {formatDate(p.valid_to)}</td>
                  <td>{cityName(p.city_id) ?? <span className="muted">All</span>}</td>
                  <td>{p.new_users_only ? 'Yes' : '—'}</td>
                  <td>{p.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td>
                    <RowActions
                      disabled={!mayEdit || promos.busy}
                      onEdit={() => openEdit(p)}
                      onRemove={() => setRemoving(p)}
                      removeLabel="Deactivate"
                      removeDisabledReason={p.active ? undefined : 'Already inactive'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!promos.isLoading && promos.rows.length === 0 ? (
          <div className="card-pad">
            <EmptyState
              emoji="🎟️"
              title="No promo codes"
              hint="Codes discount a ride by a percentage, a fixed amount, or free minutes."
              action={mayEdit ? <Button variant="primary" onClick={openCreate}>+ New code</Button> : undefined}
            />
          </div>
        ) : null}
      </Card>

      <EntityModal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? `Edit ${editing.code}` : 'New promo code'}
        busy={promos.busy}
        canSave={canSave}
        onSave={save}
      >
        <div className="row" style={{ gap: 8 }}>
          <Field label="Code" required hint="What the rider types. Stored exactly as entered.">
            <Input className="mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="WELCOME10" />
          </Field>
          <Field label="Type" required hint="Decides the unit of the value below.">
            <Select value={form.kind} onChange={(e) => changeKind(e.target.value as PromoKind)}>
              {PROMO_KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
            </Select>
          </Field>
        </div>
        {/* The unit is the field most easily misread, so it is stated three
            ways: in the label, as a suffix, and in the hint under the input. */}
        <Field label={unit.label} required hint={unit.hint}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Input
              type="number"
              min={0}
              step={form.kind === 'fixed' ? '0.01' : '1'}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
            <span style={{ fontWeight: 600, minWidth: 34 }}>{unit.suffix}</span>
          </div>
        </Field>
        {form.kind === 'fixed' && valueOk ? (
          <div className="muted" style={{ fontSize: 13, marginTop: -8 }}>Stored as {storedValue} cents.</div>
        ) : null}
        {form.kind === 'percent' && Number.isFinite(storedValue) && storedValue > 100 ? (
          <div className="muted" style={{ fontSize: 13, marginTop: -8 }}>A percentage cannot exceed 100.</div>
        ) : null}
        <div className="row" style={{ gap: 8 }}>
          <Field label="Max uses" hint="Blank = unlimited.">
            <Input type="number" min={1} value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} placeholder="Unlimited" />
          </Field>
          <Field label="Per-user limit">
            <Input type="number" min={1} value={form.per_user_limit} onChange={(e) => setForm({ ...form, per_user_limit: e.target.value })} />
          </Field>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Valid from"><Input type="datetime-local" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
          <Field label="Valid to"><Input type="datetime-local" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></Field>
        </div>
        <Field label="City" hint="Blank applies the code in every city.">
          <Select value={form.city_id} onChange={(e) => setForm({ ...form, city_id: e.target.value })}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Checkbox label="New users only" checked={form.new_users_only} onChange={(e) => setForm({ ...form, new_users_only: e.target.checked })} />
        <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </EntityModal>

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        // Soft delete by design: a redeemed code is referenced by the discount
        // line on someone's receipt.
        mode="deactivate"
        label="promo code"
        name={removing?.code ?? ''}
        busy={promos.busy}
        onConfirm={(reason) => {
          if (!removing) return;
          promos.remove.mutate({ key: removing.id, reason: reason || undefined }, { onSuccess: () => setRemoving(null) });
        }}
      />
    </div>
  );
}

/* ═══════════════════════ Customer groups ═══════════════════════ */

type Rule = { field: string; op: string; value: string };

interface GroupRow extends ConfigRow {
  id: string;
  name: string;
  rules: Rule[] | Record<string, unknown> | null;
}

const RULE_FIELDS = ['rides', 'last_active_days', 'city', 'debt_cents', 'score'];
const RULE_OPS = ['>=', '<=', '=', '>', '<'];

/** `rules` is free-form jsonb; only an array of clauses is meaningful here. */
function asRules(v: GroupRow['rules']): Rule[] {
  return Array.isArray(v) ? (v as Rule[]) : [];
}

function Groups() {
  const { can } = useAuth();
  const { data: db } = usePanelData();
  const mayEdit = can('settings.edit');
  const groups = useConfigResource<GroupRow>('customer_groups', {
    label: 'customer group',
    enabled: mayEdit,
    list: { sort: [{ field: 'name', dir: 'asc' }] },
  });

  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<GroupRow | null>(null);
  const [name, setName] = useState('');
  const [rules, setRules] = useState<Rule[]>([]);

  const customers = db?.customers ?? [];
  const matches = (rs: Rule[]) =>
    rs.length === 0 ? customers.length : customers.filter((c) => rs.every((r) => matchRule(c, r))).length;

  const openCreate = () => { setName(''); setRules([{ field: 'rides', op: '>=', value: '50' }]); setCreating(true); };
  const openEdit = (g: GroupRow) => { setName(g.name); setRules(asRules(g.rules)); setEditing(g); };
  const close = () => { setCreating(false); setEditing(null); };

  const save = () => {
    const values = { name: name.trim(), rules };
    if (editing) groups.update.mutate({ key: editing.id, values }, { onSuccess: close });
    else groups.create.mutate({ values }, { onSuccess: close });
  };

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader
          title="Customer groups"
          sub="Reusable audiences — notifications and promos target them"
          actions={<Button variant="primary" disabled={!mayEdit || groups.busy} onClick={openCreate}>+ New group</Button>}
        />
        {groups.error ? <div className="card-pad muted">Could not load groups: {groups.error}</div> : null}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Type</th><th>Rules</th><th>Matches now</th><th /></tr></thead>
            <tbody>
              {groups.rows.map((g) => {
                const rs = asRules(g.rules);
                return (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td><Badge tone={rs.length ? 'info' : 'neutral'}>{rs.length ? 'rule' : 'manual'}</Badge></td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {rs.length ? rs.map((r) => `${r.field} ${r.op} ${r.value}`).join(' · ') : '—'}
                    </td>
                    {/* Counted client-side from the loaded customers — the table
                        stores no membership column. */}
                    <td>{matches(rs)}</td>
                    <td>
                      <RowActions
                        disabled={!mayEdit || groups.busy}
                        onEdit={() => openEdit(g)}
                        onRemove={() => setRemoving(g)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!groups.isLoading && groups.rows.length === 0 ? (
          <div className="card-pad">
            <EmptyState
              emoji="👥"
              title="No customer groups"
              hint="A group is a saved rule set, evaluated against the customer list."
              action={mayEdit ? <Button variant="primary" onClick={openCreate}>+ New group</Button> : undefined}
            />
          </div>
        ) : null}
      </Card>

      <EntityModal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? `Edit ${editing.name}` : 'New customer group'}
        busy={groups.busy}
        canSave={name.trim().length > 1}
        onSave={save}
      >
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Loyal riders" /></Field>
        <Field label="Rules" hint="All rules must match. No rules = every customer.">
          <div className="stack" style={{ gap: 6 }}>
            {rules.map((r, i) => (
              <div key={i} className="row" style={{ gap: 6 }}>
                <Select value={r.field} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>
                  {RULE_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                </Select>
                <Select style={{ width: 90 }} value={r.op} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}>
                  {RULE_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
                <Input value={r.value} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                <Button variant="ghost" onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
            <div><Button size="sm" onClick={() => setRules([...rules, { field: 'rides', op: '>=', value: '1' }])}>+ Add rule</Button></div>
          </div>
        </Field>
        <div className="muted" style={{ fontSize: 13 }}>Matches {matches(rules)} of {customers.length} customers right now.</div>
      </EntityModal>

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        mode="delete"
        label="customer group"
        name={removing?.name ?? ''}
        busy={groups.busy}
        onConfirm={(reason) => {
          if (!removing) return;
          groups.remove.mutate({ key: removing.id, reason: reason || undefined }, { onSuccess: () => setRemoving(null) });
        }}
      />
    </div>
  );
}

function matchRule(c: DB['customers'][number], r: Rule): boolean {
  const v = r.field === 'rides' ? c.rides : r.field === 'debt_cents' ? c.debt_cents : r.field === 'score' ? c.score : r.field === 'city' ? c.city_name : 0;
  const num = Number(r.value);
  if (r.field === 'city') return c.city_name === r.value;
  switch (r.op) { case '>=': return (v as number) >= num; case '<=': return (v as number) <= num; case '>': return (v as number) > num; case '<': return (v as number) < num; default: return (v as number) === num; }
}

/* ═══════════════════════ Campaigns ═══════════════════════ */

/**
 * The composer that used to live here wrote nothing: "Schedule" and "Send test"
 * only raised a success toast, so an operator could believe a campaign had gone
 * out. Broadcasting is implemented — in `admin-broadcast`, behind the
 * `notifications.send` permission, driven from the Notifications screen — so
 * this tab points at the real thing instead of imitating it.
 */
function Campaigns() {
  return (
    <Card>
      <CardHeader title="Campaigns" />
      <div className="card-pad stack" style={{ gap: 'var(--space-md)' }}>
        <UnavailableNote title="Campaigns are sent from the Notifications screen">
          This tab never sent anything — its buttons only showed a success message. Real
          sending (inbox, pop-up and push, with consent filtering and an audience preview)
          lives in <span className="mono">admin-broadcast</span> and is driven from Notifications.
        </UnavailableNote>
        <div>
          <Link to="/notifications"><Button variant="primary">Open Notifications</Button></Link>
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════ Loyalty ═══════════════════════ */

interface TierRow extends ConfigRow {
  id: string;
  name: string;
  min_points: number;
  perks: string[];
  active: boolean;
}

/**
 * Reads `loyalty_tiers` directly. The bulk panel payload exposes `loyalty`, but
 * `admin-panel-data` fills that from `loyalty_accounts` (per-rider balances) —
 * a different table with none of these columns, which is why this card rendered
 * empty while three tiers existed.
 */
function Loyalty() {
  const { can } = useAuth();
  const mayEdit = can('settings.edit');
  const tiers = useConfigResource<TierRow>('loyalty_tiers', {
    label: 'loyalty tier',
    list: { sort: [{ field: 'min_points', dir: 'asc' }] },
  });

  const [editing, setEditing] = useState<TierRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<TierRow | null>(null);
  const [form, setForm] = useState({ name: '', min_points: 0, perks: [] as string[], active: true });

  const openCreate = () => { setForm({ name: '', min_points: 0, perks: [''], active: true }); setCreating(true); };
  const openEdit = (t: TierRow) => {
    setForm({ name: t.name, min_points: t.min_points, perks: t.perks ?? [], active: t.active });
    setEditing(t);
  };
  const close = () => { setCreating(false); setEditing(null); };

  const save = () => {
    const values = {
      name: form.name.trim(),
      min_points: form.min_points,
      perks: form.perks.map((p) => p.trim()).filter(Boolean),
      active: form.active,
    };
    if (editing) tiers.update.mutate({ key: editing.id, values }, { onSuccess: close });
    else tiers.create.mutate({ values }, { onSuccess: close });
  };

  return (
    <Card>
      <CardHeader
        title="Loyalty tiers"
        sub="Thresholds in points, ascending"
        actions={<Button variant="primary" disabled={!mayEdit || tiers.busy} onClick={openCreate}>+ New tier</Button>}
      />
      <div className="card-pad">
        {tiers.error ? <div className="muted">Could not load tiers: {tiers.error}</div> : null}
        {tiers.isLoading ? <div className="muted">Loading…</div> : null}
        {!tiers.isLoading && tiers.rows.length === 0 ? (
          <EmptyState emoji="🏅" title="No loyalty tiers" hint="Riders earn points; tiers unlock the perks below." />
        ) : null}
        <div className="row-wrap">
          {tiers.rows.map((t) => (
            <div key={t.id} className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
              <div className="between">
                <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
                {t.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>≥ {t.min_points} pts</div>
              <div className="divider" />
              {(t.perks ?? []).map((p, i) => <div key={i} style={{ fontSize: 13 }}>✓ {p}</div>)}
              {(t.perks ?? []).length === 0 ? <div className="muted" style={{ fontSize: 13 }}>No perks listed.</div> : null}
              <div className="divider" />
              <RowActions
                disabled={!mayEdit || tiers.busy}
                onEdit={() => openEdit(t)}
                onRemove={() => setRemoving(t)}
              />
            </div>
          ))}
        </div>
      </div>

      <EntityModal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? `Edit ${editing.name}` : 'New loyalty tier'}
        busy={tiers.busy}
        canSave={form.name.trim().length > 1}
        onSave={save}
      >
        <div className="row" style={{ gap: 8 }}>
          <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Gold" /></Field>
          <Field label="Minimum points" required>
            <Input type="number" min={0} value={form.min_points} onChange={(e) => setForm({ ...form, min_points: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Perks" hint="One per line — shown to the rider on the tier card.">
          <StringListEditor value={form.perks} onChange={(perks) => setForm({ ...form, perks })} placeholder="10% off rides" />
        </Field>
        <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </EntityModal>

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        mode="delete"
        label="loyalty tier"
        name={removing?.name ?? ''}
        busy={tiers.busy}
        onConfirm={(reason) => {
          if (!removing) return;
          tiers.remove.mutate({ key: removing.id, reason: reason || undefined }, { onSuccess: () => setRemoving(null) });
        }}
      />
    </Card>
  );
}

/* ═══════════════════════ POIs ═══════════════════════ */

interface PoiRow extends ConfigRow {
  id: string;
  city_id: string;
  name: string;
  kind: string;
  pos: { type: 'Point'; coordinates: [number, number] } | null;
  icon: string | null;
  active: boolean;
}

const POI_KINDS = ['parking', 'charging', 'shop', 'landmark', 'service'];

function Pois() {
  const { can, cities } = useAuth();
  const mayEdit = can('settings.edit');
  const pois = useConfigResource<PoiRow>('pois', { label: 'POI', enabled: mayEdit });

  const [editing, setEditing] = useState<PoiRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<PoiRow | null>(null);
  const [form, setForm] = useState({ name: '', kind: POI_KINDS[0], city_id: '', lat: '', lng: '', icon: '', active: true });

  const markers: MapMarker[] = pois.rows
    .filter((p) => p.pos?.coordinates)
    .map((p) => ({ id: p.id, lng: p.pos!.coordinates[0], lat: p.pos!.coordinates[1], color: colors.primary, label: p.name }));

  const openCreate = () => {
    setForm({ name: '', kind: POI_KINDS[0], city_id: cities[0]?.id ?? '', lat: '', lng: '', icon: '', active: true });
    setCreating(true);
  };
  const openEdit = (p: PoiRow) => {
    setForm({
      name: p.name,
      kind: p.kind,
      city_id: p.city_id,
      lat: p.pos ? String(p.pos.coordinates[1]) : '',
      lng: p.pos ? String(p.pos.coordinates[0]) : '',
      icon: p.icon ?? '',
      active: p.active,
    });
    setEditing(p);
  };
  const close = () => { setCreating(false); setEditing(null); };

  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const posValid = form.lat !== '' && form.lng !== ''
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const save = () => {
    const values = {
      city_id: form.city_id,
      name: form.name.trim(),
      kind: form.kind,
      icon: form.icon.trim() || null,
      // PostGIS accepts a GeoJSON Point through PostgREST for a
      // geometry(Point,4326) column — verified against the live project.
      pos: { type: 'Point', coordinates: [lng, lat] },
      active: form.active,
    };
    if (editing) pois.update.mutate({ key: editing.id, values }, { onSuccess: close });
    else pois.create.mutate({ values }, { onSuccess: close });
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
      <Card><CardHeader title="POI map" /><div className="card-pad"><MapView height={360} markers={markers} /></div></Card>
      <Card>
        <CardHeader
          title="POIs"
          sub={`${pois.total} point${pois.total === 1 ? '' : 's'}`}
          actions={<Button variant="primary" size="sm" disabled={!mayEdit || pois.busy} onClick={openCreate}>+ Add</Button>}
        />
        {pois.error ? <div className="card-pad muted">Could not load POIs: {pois.error}</div> : null}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Kind</th><th>Active</th><th /></tr></thead>
            <tbody>
              {pois.rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.icon ? `${p.icon} ` : ''}{p.name}</td>
                  <td>{p.kind}</td>
                  <td>{p.active ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</td>
                  <td>
                    <RowActions
                      disabled={!mayEdit || pois.busy}
                      onEdit={() => openEdit(p)}
                      onRemove={() => setRemoving(p)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!pois.isLoading && pois.rows.length === 0 ? (
          <div className="card-pad">
            <EmptyState
              emoji="📍"
              title="No POIs"
              hint="Parking, charging and landmarks shown on the rider map."
              action={mayEdit ? <Button variant="primary" onClick={openCreate}>+ Add</Button> : undefined}
            />
          </div>
        ) : null}
      </Card>

      <EntityModal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? `Edit ${editing.name}` : 'New POI'}
        busy={pois.busy}
        canSave={form.name.trim().length > 1 && !!form.city_id && posValid}
        onSave={save}
      >
        <div className="row" style={{ gap: 8 }}>
          <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Kind" required>
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {POI_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </Field>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Field label="City" required>
            <Select value={form.city_id} onChange={(e) => setForm({ ...form, city_id: e.target.value })}>
              <option value="">—</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Icon" hint="One emoji, shown on the rider map.">
            <Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="🅿️" />
          </Field>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Latitude" required hint="Decimal degrees, e.g. 40.6401">
            <Input className="mono" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="40.6401" />
          </Field>
          <Field label="Longitude" required hint="Decimal degrees, e.g. 22.9444">
            <Input className="mono" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="22.9444" />
          </Field>
        </div>
        {!posValid && (form.lat !== '' || form.lng !== '') ? (
          <div className="muted" style={{ fontSize: 13 }}>Latitude must be within ±90 and longitude within ±180.</div>
        ) : null}
        <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </EntityModal>

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        mode="delete"
        label="POI"
        name={removing?.name ?? ''}
        busy={pois.busy}
        onConfirm={(reason) => {
          if (!removing) return;
          pois.remove.mutate({ key: removing.id, reason: reason || undefined }, { onSuccess: () => setRemoving(null) });
        }}
      />
    </div>
  );
}

/* ═══════════════════════ Referrals ═══════════════════════ */

function Referrals() {
  const { data: db, isLoading } = usePanelData();
  const referrals = db?.referrals ?? [];
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Referral program config" />
        <div className="card-pad stack" style={{ gap: 'var(--space-md)' }}>
          {/* The Save button here wrote to nothing: there is no referral config
              table in the admin-write allowlist, and the inputs were uncontrolled
              defaults. Showing the values without a fake Save is the honest half. */}
          <UnavailableNote title="Referral rewards are not editable from the panel">
            There is no referral-config table in the <span className="mono">admin-write</span>
            allowlist, so this form had nowhere to save to. Changing the reward amounts needs a
            migration plus an allowlist entry.
          </UnavailableNote>
          <div className="row-wrap">
            <Field label="Referrer reward (EUR)"><Input value="5.00" readOnly /></Field>
            <Field label="Referee reward (EUR)"><Input value="5.00" readOnly /></Field>
            <Field label="Qualify on"><Input value="First charged trip" readOnly /></Field>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Referrals" sub={`${referrals.length} total`} />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Referrer</th><th>Referee</th><th>Status</th><th>Reward</th><th>When</th></tr></thead>
            <tbody>{referrals.map((r) => <tr key={r.id}><td>{r.referrer_name}</td><td>{r.referee_name}</td><td><Badge tone={r.status === 'rewarded' ? 'success' : 'info'}>{titleCase(r.status)}</Badge></td><td>{formatMoney(r.reward_cents)}</td><td>{relativeTime(r.created_at)}</td></tr>)}</tbody>
          </table>
        </div>
        {!isLoading && referrals.length === 0 ? <div className="card-pad muted">No referrals yet.</div> : null}
      </Card>
    </div>
  );
}

/* ---------- helpers ---------- */

/** ISO → value for `<input type="datetime-local">`. */
function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
