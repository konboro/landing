import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { usePanelData } from '@/hooks/usePanelData';
import { useTableState } from '@/hooks/useTableState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Card, CardHeader, Button, Field, Input, Select, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/feedback';
import { useBrand } from '@/context/BrandContext';
import { titleCase } from '@/lib/format';
import { JsonField } from './JsonField';
import { edgeMessage } from './edge';

/* --------------------------------------------------------------------------
   `notification_rules` — which event pages whom, on which channel, how often.

   Read through `admin-list`, written through `admin-write`; both demand
   `settings.edit`, so the two directions cannot drift. Deactivate-only: the
   rows are referenced by `notification_log.rule_id`, so the server flips
   `active` instead of deleting and says `deactivated: true` — the UI must
   repeat that word rather than claim a delete.

   Column shapes are the table's, not the panel's wishful ones: `recipients` is
   a jsonb OBJECT ({"roles":["ops"],"nearest":true}), not an array of strings,
   and there is no `label` or `audience` column at all.
   -------------------------------------------------------------------------- */

/**
 * The row as it really arrives. The jsonb and array columns are typed
 * `unknown` on purpose: declaring them as the shape we hope for is exactly how
 * this tab came to call `.join()` on an object and white-screen. `unknown`
 * makes the compiler insist on a check at every point of use.
 */
export interface NotificationRuleRow {
  id: string;
  event_kind: string;
  condition: unknown;
  channels: unknown;
  recipients: unknown;
  throttle_s: number;
  digest: 'none' | 'hourly' | 'daily';
  quiet_hours: unknown;
  active: boolean;
  updated_at?: string | null;
}

/** notification_channel enum (migration 00020). */
const CHANNELS = ['email', 'push', 'sms', 'telegram', 'panel', 'inbox'] as const;
/** staff_role enum (migration 00020) — what `recipients.roles` holds. */
const ROLES = ['owner', 'admin', 'support', 'ops_manager', 'ops', 'accountant', 'readonly'] as const;
const DIGESTS = ['none', 'hourly', 'daily'] as const;

const BLANK: NotificationRuleRow = {
  id: '',
  event_kind: '',
  condition: {},
  channels: [],
  recipients: { roles: [] },
  throttle_s: 0,
  digest: 'none',
  quiet_hours: null,
  active: true,
};

/**
 * `recipients` is jsonb, so the server can hand back anything. The panel used
 * to call `.join()` on it — assuming an array of strings — and every one of the
 * 23 live rows is an OBJECT, which white-screened the whole tab. Nothing below
 * touches the value without first checking what it actually is: an unexpected
 * shape has to render as a dash, never blank the page.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rolesOf(recipients: unknown): string[] {
  if (!isPlainObject(recipients)) return [];
  const r = recipients.roles;
  return Array.isArray(r) ? r.map(String) : [];
}

/** Behaviour flags the alert engine reads alongside the role list. */
const FLAGS: Array<{ key: string; label: string; help: string }> = [
  { key: 'nearest', label: 'Also page whoever is nearest', help: 'Notifies the operator closest to the vehicle on top of the roles above.' },
  { key: 'auto_task', label: 'Open an ops task automatically', help: 'Creates a task in the ops app when this rule fires.' },
];

function flagOf(recipients: unknown, key: string): boolean {
  return isPlainObject(recipients) && recipients[key] === true;
}

/** Everything in `recipients` that is neither `roles` nor a known flag —
 *  e.g. `auto_flag: "maintenance"`. Preserved verbatim on save so an edit here
 *  never silently drops a setting this UI does not model. */
function extrasOf(recipients: unknown): Record<string, unknown> {
  if (!isPlainObject(recipients)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(recipients)) {
    if (k === 'roles' || FLAGS.some((f) => f.key === k)) continue;
    out[k] = v;
  }
  return out;
}

/** `{from,to}` when the row really carries a quiet window, else null. */
function quietOf(v: unknown): { from: string; to: string } | null {
  if (!isPlainObject(v)) return null;
  const from = typeof v.from === 'string' ? v.from : '';
  const to = typeof v.to === 'string' ? v.to : '';
  return from || to ? { from, to } : null;
}

function conditionOf(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

function channelsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function throttleLabel(s: number): string {
  if (!s) return 'none';
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

export function NotificationRules() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('settings.edit');

  const state = useTableState({ pageSize: 50, sort: [{ field: 'event_kind', dir: 'asc' }] });
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'notification_rules', state.params],
    queryFn: () => ds.configList<NotificationRuleRow>('notification_rules', state.params),
  });

  const [editing, setEditing] = useState<NotificationRuleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState<NotificationRuleRow | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'notification_rules'] });

  const toggleOn = useMutation({
    mutationFn: (row: NotificationRuleRow) =>
      ds.configUpdate<NotificationRuleRow>('notification_rules', row.id, { active: true }),
    onSuccess: (_r, row) => { toast.push(`“${row.event_kind}” re-activated`, 'success'); void refresh(); },
    onError: async (e) => toast.push(await edgeMessage(e, 'Could not re-activate the rule.'), 'error'),
  });

  const deactivate = useMutation({
    mutationFn: ({ row, reason }: { row: NotificationRuleRow; reason: string }) =>
      ds.configRemove('notification_rules', row.id, reason),
    onSuccess: (res, { row }) => {
      // The server decides whether this was a delete or a deactivation; say
      // whichever it actually did.
      toast.push(
        res.deactivated
          ? `“${row.event_kind}” deactivated — the rule stays on file because the notification log references it`
          : `“${row.event_kind}” deleted`,
        'success',
      );
      setDeactivating(null);
      void refresh();
    },
    onError: async (e) => { toast.push(await edgeMessage(e, 'Could not deactivate the rule.'), 'error'); setDeactivating(null); },
  });

  const columns: Column<NotificationRuleRow>[] = [
    {
      key: 'event_kind', header: 'Event', sortable: true,
      render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.event_kind}</span>,
      csv: (r) => r.event_kind,
    },
    {
      key: 'condition', header: 'Condition',
      render: (r) => (Object.keys(conditionOf(r.condition)).length
        ? <span className="mono" style={{ fontSize: 11 }}>{JSON.stringify(r.condition)}</span>
        : <span className="muted">any</span>),
      csv: (r) => JSON.stringify(r.condition ?? {}),
    },
    {
      key: 'channels', header: 'Channels',
      render: (r) => {
        if (!Array.isArray(r.channels)) return <span className="muted" title={JSON.stringify(r.channels)}>—</span>;
        return r.channels.length
          ? <span>{r.channels.map((c) => <span key={String(c)} className="pill-tag">{String(c)}</span>)}</span>
          : <span className="muted">none — this rule notifies nobody</span>;
      },
      csv: (r) => (Array.isArray(r.channels) ? r.channels.join('+') : ''),
    },
    {
      key: 'recipients', header: 'Recipients',
      render: (r) => {
        if (r.recipients != null && !isPlainObject(r.recipients)) {
          return <span className="muted" title={JSON.stringify(r.recipients)}>—</span>;
        }
        const roles = rolesOf(r.recipients);
        const flags = FLAGS.filter((f) => flagOf(r.recipients, f.key)).map((f) => f.key);
        const extras = Object.keys(extrasOf(r.recipients));
        const notes = [...flags, ...extras];
        return (
          <span>
            {roles.length ? roles.map((x) => <span key={x} className="pill-tag">{x}</span>) : <span className="muted">nobody</span>}
            {notes.length ? <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>+{notes.join(', ')}</span> : null}
          </span>
        );
      },
      csv: (r) => JSON.stringify(r.recipients ?? {}),
    },
    { key: 'throttle_s', header: 'Throttle', align: 'right', sortable: true, render: (r) => throttleLabel(r.throttle_s) },
    {
      key: 'digest', header: 'Digest', csv: (r) => r.digest,
      render: (r) => <Badge tone={r.digest === 'none' ? 'neutral' : 'info'}>{r.digest}</Badge>,
    },
    {
      key: 'quiet_hours', header: 'Quiet hours', defaultHidden: true,
      render: (r) => {
        const q = quietOf(r.quiet_hours);
        return q ? `${q.from || '—'} → ${q.to || '—'}` : <span className="muted">—</span>;
      },
      csv: (r) => { const q = quietOf(r.quiet_hours); return q ? `${q.from}-${q.to}` : ''; },
    },
    {
      key: 'active', header: 'Status',
      render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Active' : 'Off'}</Badge>,
      csv: (r) => (r.active ? 'active' : 'off'),
    },
    {
      key: 'actions', header: '', hideable: false,
      render: (r) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>{editable ? 'Edit' : 'View'}</Button>
          {editable ? (
            r.active
              ? <Button size="sm" variant="ghost" onClick={() => setDeactivating(r)}>Turn off</Button>
              : <Button size="sm" variant="ghost" disabled={toggleOn.isPending} onClick={() => toggleOn.mutate(r)}>Turn on</Button>
          ) : null}
        </span>
      ),
      csv: () => '',
    },
  ];

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card pad>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Alerts &amp; notification rules</h3>
            <div className="muted" style={{ marginTop: 2, fontSize: 13 }}>
              event → condition → channels → recipients. Edits are live: the alert engine reads these rows directly, and every
              change is written to the audit log with its before/after.
            </div>
          </div>
          {!editable ? <Badge tone="neutral">read-only — needs settings.edit</Badge> : null}
        </div>
      </Card>

      <DataTable
        columns={columns}
        data={data}
        state={state}
        loading={isLoading}
        rowKey={(r) => r.id}
        searchPlaceholder="Search event kind…"
        csvName="notification-rules"
        emptyTitle="No rules match"
        filtersSlot={
          <Select
            style={{ width: 'auto' }}
            value={String(state.filters.active ?? 'all')}
            onChange={(e) => state.setFilter('active', e.target.value === 'all' ? undefined : e.target.value === 'true')}
          >
            <option value="all">All rules</option>
            <option value="true">Active only</option>
            <option value="false">Turned off</option>
          </Select>
        }
        toolbarActions={editable ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>+ Add rule</Button> : undefined}
      />

      <NotificationLog />

      {/* Suggestions for the editor's event-kind box. Global by id, so it only
          has to exist somewhere in the document while a modal is open. */}
      <datalist id="penny-event-kinds">
        {Array.from(new Set((data?.rows ?? []).map((r) => r.event_kind))).map((k) => <option key={k} value={k} />)}
      </datalist>

      {editing ? (
        <RuleEditor
          key={editing.id}
          rule={editing}
          readOnly={!editable}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      ) : null}

      {creating ? (
        <RuleEditor
          key="new"
          rule={BLANK}
          readOnly={false}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void refresh(); }}
        />
      ) : null}

      <ConfirmModal
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        onConfirm={(reason) => { if (deactivating) deactivate.mutate({ row: deactivating, reason }); }}
        title="Turn this rule off?"
        message={
          deactivating
            ? `“${deactivating.event_kind}” stops notifying ${rolesOf(deactivating.recipients).join(', ') || 'anyone'} until it is turned back on. The rule is kept (the notification log points at it), not deleted.`
            : ''
        }
        confirmLabel="Turn off"
        danger
        requireReason
        busy={deactivate.isPending}
      />
    </div>
  );
}

/* ---------- Editor ---------- */

function RuleEditor({
  rule, readOnly, onClose, onSaved,
}: {
  rule: NotificationRuleRow;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ds = useDS();
  const toast = useToast();
  const { colors } = useBrand();
  const isNew = rule.id === '';

  const [draft, setDraft] = useState<NotificationRuleRow>(rule);
  const [conditionValid, setConditionValid] = useState(true);
  const [quiet, setQuiet] = useState(quietOf(rule.quiet_hours) !== null);
  const [formError, setFormError] = useState<string | null>(null);
  const quietWindow = quietOf(draft.quiet_hours) ?? { from: '', to: '' };

  const set = <K extends keyof NotificationRuleRow>(key: K, value: NotificationRuleRow[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  // Rebuild `recipients` from the parts the form models, carrying anything it
  // does not model through untouched.
  const recipientsWith = (patch: { roles?: string[]; flags?: Record<string, boolean> }) => {
    const roles = patch.roles ?? rolesOf(draft.recipients);
    const next: Record<string, unknown> = { ...extrasOf(draft.recipients), roles };
    for (const f of FLAGS) {
      const on = patch.flags && f.key in patch.flags ? patch.flags[f.key] : flagOf(draft.recipients, f.key);
      // Absent rather than `false` — that is how the seeded rows express "off".
      if (on) next[f.key] = true;
    }
    return next;
  };
  const setRoles = (roles: string[]) => set('recipients', recipientsWith({ roles }));
  const setFlag = (key: string, on: boolean) => set('recipients', recipientsWith({ flags: { [key]: on } }));

  const values = () => ({
    event_kind: draft.event_kind.trim(),
    condition: conditionOf(draft.condition),
    channels: channelsOf(draft.channels),
    recipients: isPlainObject(draft.recipients) ? draft.recipients : { roles: [] },
    throttle_s: Number(draft.throttle_s) || 0,
    digest: draft.digest,
    quiet_hours: quiet ? quietWindow : null,
    active: draft.active,
  });

  const save = useMutation({
    mutationFn: () => (isNew
      ? ds.configCreate<NotificationRuleRow>('notification_rules', values())
      : ds.configUpdate<NotificationRuleRow>('notification_rules', rule.id, values())),
    onSuccess: () => {
      toast.push(isNew ? 'Rule created — recorded in the audit log' : 'Rule saved — recorded in the audit log', 'success');
      onSaved();
    },
    onError: async (e) => setFormError(await edgeMessage(e, 'Could not save the rule.')),
  });

  const problems: string[] = [];
  if (!draft.event_kind.trim()) problems.push('An event kind is required — it is what the alert engine matches on.');
  if (!conditionValid) problems.push('The condition is not valid JSON.');
  if (quiet && (!quietWindow.from || !quietWindow.to)) problems.push('Quiet hours need both a start and an end.');

  const extras = extrasOf(draft.recipients);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? 'New notification rule' : `Rule — ${rule.event_kind}`}
      footer={
        <>
          {/* docs/12 F asks for "send any template to yourself"; there is no
              endpoint for it, so this stays visibly disabled rather than
              pretending a send happened. */}
          <Button
            disabled
            title="Test sends are not implemented — there is no test-fire endpoint on the server yet (docs/12 F)."
            style={{ marginRight: 'auto' }}
          >
            Test-fire
          </Button>
          <Button onClick={onClose} disabled={save.isPending}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly ? (
            <Button variant="primary" disabled={problems.length > 0 || save.isPending} onClick={() => { setFormError(null); save.mutate(); }}>
              {save.isPending ? 'Saving…' : isNew ? 'Create rule' : 'Save rule'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-md)' }}>
        {formError ? (
          <div className="banner" style={{ borderColor: `${colors.danger}55`, background: `${colors.danger}12` }}>
            <div className="banner-bar" style={{ background: colors.danger }} />
            <div><div style={{ fontWeight: 600 }}>The server refused this</div><div className="muted">{formError}</div></div>
          </div>
        ) : null}

        <Field label="Event kind" required hint="Must match an event the alert engine emits. Existing kinds are suggested below.">
          <Input
            className="mono"
            list="penny-event-kinds"
            value={draft.event_kind}
            disabled={readOnly}
            onChange={(e) => set('event_kind', e.target.value)}
            placeholder="low_battery"
          />
        </Field>

        <Checkbox
          label="Rule is active"
          checked={draft.active}
          disabled={readOnly}
          onChange={(e) => set('active', e.target.checked)}
        />

        <div>
          <div className="field-label">Channels</div>
          <div className="row-wrap" style={{ gap: 12 }}>
            {CHANNELS.map((c) => (
              <Checkbox
                key={c} label={c}
                checked={channelsOf(draft.channels).includes(c)}
                disabled={readOnly}
                onChange={() => set('channels', toggleIn(channelsOf(draft.channels), c))}
              />
            ))}
          </div>
          {!channelsOf(draft.channels).length ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              With no channel this rule fires and reaches nobody.
            </div>
          ) : null}
        </div>

        <div>
          <div className="field-label">Recipient roles</div>
          <div className="row-wrap" style={{ gap: 12 }}>
            {ROLES.map((r) => (
              <Checkbox
                key={r} label={titleCase(r)}
                checked={rolesOf(draft.recipients).includes(r)}
                disabled={readOnly}
                onChange={() => setRoles(toggleIn(rolesOf(draft.recipients), r))}
              />
            ))}
          </div>
          {!rolesOf(draft.recipients).length ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              With no role selected this rule reaches nobody unless a flag below sends it somewhere.
            </div>
          ) : null}

          <div style={{ marginTop: 10 }}>
            {FLAGS.map((f) => (
              <div key={f.key}>
                <Checkbox
                  label={f.label}
                  checked={flagOf(draft.recipients, f.key)}
                  disabled={readOnly}
                  onChange={(e) => setFlag(f.key, e.target.checked)}
                />
                <div className="muted" style={{ fontSize: 12, marginLeft: 26 }}>{f.help}</div>
              </div>
            ))}
          </div>

          {Object.keys(extras).length ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Kept as-is on save: {Object.entries(extras).map(([k, v]) => (
                <span key={k} className="pill-tag mono">{k}={JSON.stringify(v)}</span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="row-wrap" style={{ gap: 'var(--space-md)' }}>
          <Field label="Throttle (seconds)" hint="0 = every occurrence. 3600 = at most once an hour per target.">
            <Input
              type="number" min={0} style={{ width: 160 }}
              value={String(draft.throttle_s ?? 0)}
              disabled={readOnly}
              onChange={(e) => set('throttle_s', Number(e.target.value))}
            />
          </Field>
          <Field label="Digest" hint="Batch matches into one message instead of sending each.">
            <Select
              style={{ width: 160 }}
              value={draft.digest}
              disabled={readOnly}
              onChange={(e) => set('digest', e.target.value as NotificationRuleRow['digest'])}
            >
              {DIGESTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
        </div>

        <div>
          <Checkbox
            label="Hold notifications during quiet hours"
            checked={quiet}
            disabled={readOnly}
            onChange={(e) => setQuiet(e.target.checked)}
          />
          {quiet ? (
            <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
              <Input
                type="time" style={{ width: 130 }} disabled={readOnly}
                value={quietWindow.from}
                onChange={(e) => set('quiet_hours', { ...quietWindow, from: e.target.value })}
              />
              <span className="muted">to</span>
              <Input
                type="time" style={{ width: 130 }} disabled={readOnly}
                value={quietWindow.to}
                onChange={(e) => set('quiet_hours', { ...quietWindow, to: e.target.value })}
              />
            </div>
          ) : null}
        </div>

        <JsonField
          label="Condition"
          hint="Free-form per event kind, e.g. {&quot;warn_pct&quot;:20,&quot;critical_pct&quot;:10}. Empty object = fires on every occurrence."
          value={conditionOf(draft.condition)}
          rows={5}
          disabled={readOnly}
          onChange={(v) => set('condition', conditionOf(v))}
          onValidityChange={setConditionValid}
        />

        {problems.length ? (
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}

/* ---------- Recent sends ---------- */

interface NotificationLogRow {
  id: string;
  channel: string;
  template_key: string;
  status: string;
  staff_target: string | null;
  user_id: string | null;
  error: string | null;
  created_at: string;
}

function NotificationLog() {
  const { data: db, isLoading } = usePanelData();
  // `admin-panel-data` returns notification_log rows verbatim; the panel's
  // older row type invented a `target` column the table does not have.
  const rows = ((db?.notificationLog ?? []) as unknown as NotificationLogRow[]).slice(0, 25);

  return (
    <Card>
      <CardHeader title="Recent sends" sub="What these rules actually produced — read-only" />
      {isLoading ? (
        <div className="card-pad muted">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="📭"
          title="Nothing sent yet"
          hint="No row in notification_log. Rules that have never matched, or a notifier that has not run."
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Template</th><th>Channel</th><th>Target</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="muted">{l.created_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{l.template_key}</td>
                  <td>{l.channel}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{l.staff_target ?? l.user_id ?? '—'}</td>
                  <td>
                    <Badge tone={l.status === 'sent' ? 'success' : l.status === 'failed' ? 'danger' : 'neutral'}>{l.status}</Badge>
                    {l.error ? <div className="muted" style={{ fontSize: 11 }}>{l.error}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
