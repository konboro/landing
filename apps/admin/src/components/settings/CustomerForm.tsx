import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, Field, Input, Select, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/Modal';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { useBrand } from '@/context/BrandContext';
import { edgeMessage } from './edge';

/* --------------------------------------------------------------------------
   Customer form — the extra questions asked during signup (docs/12 §D step 4,
   docs/06 §7).

   `customer_forms(id, fields jsonb, active, created_at)` through
   admin-list/admin-write. Deactivate-only: an answer references the form
   version it was given against, so an edited form must never rewrite what a
   rider was actually asked.

   The model is "one active form at a time":
     - no rows at all      → the first save creates the first form
     - fixing a typo       → update the active row in place
     - a material change   → publish a NEW row and deactivate the old one, so
                             answers already collected still resolve against
                             the wording they were given

   `fields` is free-form jsonb; the shape written here is
   { key, label, kind, required, options? } and is validated before it is sent.
   The key is stamped once from the label and never rewritten, so an answer
   stays attached to its question through a typo fix or a translation. Nothing
   reads these answers yet — the rider app's signup fields are still hardcoded
   — which is why the key is set now: free today, a migration later.
   -------------------------------------------------------------------------- */

export interface CustomerFormRow {
  id: string;
  fields: unknown;
  active: boolean;
  created_at?: string | null;
}

export interface FormField {
  /** Immutable identifier an answer is filed under. Derived from the label the
   *  first time a question is written and never rewritten afterwards, so fixing
   *  a typo or translating the wording does not orphan answers already
   *  collected. Nothing consumes these answers yet, which is exactly why the
   *  key is being set now — it is free today and a migration later. */
  key: string;
  label: string;
  kind: string;
  required: boolean;
  options?: string[];
}

/** `How did you hear about us?` → `how_did_you_hear_about_us`. */
function slugify(label: string): string {
  return label.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** Keeps a key unique within one form without ever changing an existing one. */
function ensureKey(field: FormField, taken: Set<string>, index: number): string {
  if (field.key) return field.key;
  const base = slugify(field.label) || `question_${index + 1}`;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

const KINDS = ['text', 'email', 'tel', 'number', 'date', 'select', 'checkbox'] as const;
/** Only these offer a fixed answer list. */
const HAS_OPTIONS = new Set(['select']);

/** jsonb can hold anything, so never assume the array shape — read it. */
function readFields(v: unknown): FormField[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
    const o = raw as Record<string, unknown>;
    const kind = typeof o.kind === 'string' && (KINDS as readonly string[]).includes(o.kind) ? o.kind : 'text';
    const options = Array.isArray(o.options) ? o.options.map(String) : undefined;
    return [{
      // Forms written before keys existed have none; they keep resolving by
      // label until the next save, which stamps one.
      key: typeof o.key === 'string' ? o.key : '',
      label: typeof o.label === 'string' ? o.label : '',
      kind,
      required: o.required === true,
      ...(options ? { options } : {}),
    }];
  });
}

/** What actually goes to the server — options only where the kind uses them. */
function toPayload(fields: FormField[]): FormField[] {
  const taken = new Set(fields.map((f) => f.key).filter(Boolean));
  return fields.map((f, i) => {
    const key = ensureKey(f, taken, i);
    taken.add(key);
    return {
      key,
      label: f.label.trim(),
      kind: f.kind,
      required: f.required,
      ...(HAS_OPTIONS.has(f.kind) ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
    };
  });
}

function validate(fields: FormField[]): string[] {
  const problems: string[] = [];
  if (fields.length === 0) problems.push('Add at least one question, or deactivate the form instead of saving an empty one.');
  fields.forEach((f, i) => {
    if (!f.label.trim()) problems.push(`Question ${i + 1} has no label.`);
    if (HAS_OPTIONS.has(f.kind) && !(f.options ?? []).some((o) => o.trim())) {
      problems.push(`“${f.label.trim() || `Question ${i + 1}`}” is a dropdown with no options.`);
    }
  });
  // Keys are derived from labels, so two identical labels would collide.
  const seen = new Map<string, number>();
  fields.forEach((f) => {
    const k = f.label.trim().toLowerCase();
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  });
  for (const [label, n] of seen) if (n > 1) problems.push(`Two questions are both labelled “${label}”.`);
  return problems;
}

export function CustomerForm() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { colors } = useBrand();
  const editable = can('settings.edit');

  const { data, isLoading, error } = useQuery({
    queryKey: ['settings', 'customer_forms'],
    queryFn: () => ds.configList<CustomerFormRow>('customer_forms', {
      page: 1, pageSize: 100, sort: [{ field: 'created_at', dir: 'desc' }], filters: {}, search: '',
    }),
  });

  const rows = data?.rows ?? [];
  const active = rows.find((r) => r.active) ?? null;
  const previous = rows.filter((r) => !r.active);

  const [draft, setDraft] = useState<FormField[] | null>(null);
  const [reason, setReason] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const stored = useMemo(() => readFields(active?.fields), [active]);
  const fields = draft ?? stored;
  const dirty = draft !== null && JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(stored));
  const problems = validate(fields);
  const reasonTooShort = reason.trim().length < 3;

  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'customer_forms'] });
  const done = (message: string) => {
    toast.push(message, 'success');
    setDraft(null); setReason(''); setFormError(null);
    setConfirmPublish(false); setConfirmRetire(false);
    void refresh();
  };

  // Update in place: same form, corrected wording.
  const saveInPlace = useMutation({
    mutationFn: () => ds.configUpdate<CustomerFormRow>(
      'customer_forms', active!.id, { fields: toPayload(fields) }, reason.trim(),
    ),
    onSuccess: () => done('Signup form saved — recorded in the audit log'),
    onError: async (e) => setFormError(await edgeMessage(e, 'Could not save the form.')),
  });

  // New version: create the replacement first, then retire the old one. In that
  // order on purpose — if the create fails there is still exactly one active
  // form, whereas retiring first would leave signup with none.
  const publishNew = useMutation({
    mutationFn: async () => {
      const created = await ds.configCreate<CustomerFormRow>(
        'customer_forms', { fields: toPayload(fields), active: true }, reason.trim(),
      );
      if (active) await ds.configRemove('customer_forms', active.id, reason.trim());
      return created;
    },
    onSuccess: () => done(
      active
        ? 'New version published — the previous form is deactivated and kept for answers already collected'
        : 'Signup form created — recorded in the audit log',
    ),
    onError: async (e) => { setFormError(await edgeMessage(e, 'Could not publish the new version.')); setConfirmPublish(false); },
  });

  const retire = useMutation({
    mutationFn: (r: string) => ds.configRemove('customer_forms', active!.id, r),
    onSuccess: (res) => done(
      res.deactivated
        ? 'Form deactivated — signup asks nothing extra until a new one is published'
        : 'Form deleted',
    ),
    onError: async (e) => { toast.push(await edgeMessage(e, 'Could not deactivate the form.'), 'error'); setConfirmRetire(false); },
  });

  const busy = saveInPlace.isPending || publishNew.isPending || retire.isPending;

  const setField = (i: number, patch: Partial<FormField>) =>
    setDraft(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, delta: number) => {
    const next = [...fields];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setDraft(next);
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : 'Could not load customer_forms.'} />;
  if (isLoading) return <Card pad>Loading…</Card>;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader
          title="Customer form builder"
          sub="Extra questions asked after name and e-mail during signup. One form is live at a time."
          actions={
            <>
              {active ? <Badge tone="success">Live</Badge> : <Badge tone="warning">No form live</Badge>}
              {!editable ? <Badge tone="neutral">read-only</Badge> : null}
            </>
          }
        />
        <div className="card-pad stack" style={{ gap: 'var(--space-md)' }}>
          {formError ? (
            <div className="banner" style={{ borderColor: `${colors.danger}55`, background: `${colors.danger}12` }}>
              <div className="banner-bar" style={{ background: colors.danger }} />
              <div><div style={{ fontWeight: 600 }}>The server refused this</div><div className="muted">{formError}</div></div>
            </div>
          ) : null}

          {!active && !fields.length ? (
            <EmptyState
              emoji="📝"
              title="No signup form yet"
              hint="Riders are asked only for name and e-mail. Add a question to start collecting more."
              action={editable ? <Button variant="primary" onClick={() => setDraft([{ key: '', label: '', kind: 'text', required: false }])}>+ Add the first question</Button> : undefined}
            />
          ) : (
            <>
              {fields.map((f, i) => (
                <div key={i} className="card" style={{ padding: 12 }}>
                  <div className="row-wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
                    <Field label={`Question ${i + 1}`}>
                      <Input
                        style={{ minWidth: 260 }} value={f.label} disabled={!editable}
                        placeholder="How did you hear about us?"
                        onChange={(e) => setField(i, { label: e.target.value })}
                      />
                    </Field>
                    <Field label="Answer type">
                      <Select
                        style={{ width: 140 }} value={f.kind} disabled={!editable}
                        onChange={(e) => setField(i, { kind: e.target.value })}
                      >
                        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </Select>
                    </Field>
                    <div style={{ paddingBottom: 8 }}>
                      <Checkbox
                        label="Required" checked={f.required} disabled={!editable}
                        onChange={(e) => setField(i, { required: e.target.checked })}
                      />
                    </div>
                    {editable ? (
                      <div style={{ marginLeft: 'auto', paddingBottom: 4, whiteSpace: 'nowrap' }}>
                        <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</Button>
                        <Button size="sm" variant="ghost" disabled={i === fields.length - 1} onClick={() => move(i, 1)} title="Move down">↓</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDraft(fields.filter((_, j) => j !== i))}>Remove</Button>
                      </div>
                    ) : null}
                  </div>
                  {HAS_OPTIONS.has(f.kind) ? (
                    <Field label="Options" hint="One per line. These are the only answers the rider can pick.">
                      <Input
                        value={(f.options ?? []).join(', ')} disabled={!editable}
                        placeholder="Friend, Instagram, Saw a scooter"
                        onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trim()) })}
                      />
                    </Field>
                  ) : null}
                </div>
              ))}
              {editable ? (
                <div>
                  <Button size="sm" onClick={() => setDraft([...fields, { key: '', label: '', kind: 'text', required: false }])}>
                    + Add question
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {editable && (dirty || (!active && fields.length > 0)) ? (
        <Card>
          <CardHeader
            title="Save"
            sub={active
              ? 'Correct the live form in place, or publish a new version and retire this one'
              : 'This creates the first signup form'}
          />
          <div className="card-pad stack" style={{ gap: 'var(--space-md)', maxWidth: 700 }}>
            <Field label="Reason" required hint="Written to the audit log — this changes what every new rider is asked.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the signup questions change" />
            </Field>
            {problems.length ? (
              <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            ) : null}
            <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
              {active ? (
                <>
                  <Button
                    variant="primary"
                    disabled={problems.length > 0 || reasonTooShort || busy}
                    onClick={() => { setFormError(null); saveInPlace.mutate(); }}
                  >
                    {saveInPlace.isPending ? 'Saving…' : 'Save changes'}
                  </Button>
                  <Button
                    disabled={problems.length > 0 || reasonTooShort || busy}
                    onClick={() => { setFormError(null); setConfirmPublish(true); }}
                  >
                    Publish as a new version
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  disabled={problems.length > 0 || reasonTooShort || busy}
                  onClick={() => { setFormError(null); publishNew.mutate(); }}
                >
                  {publishNew.isPending ? 'Creating…' : 'Create the form'}
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => { setDraft(null); setFormError(null); }}>Discard</Button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              <b>Save changes</b> rewrites the live form, so answers already collected are read back against the new wording.
              <b> Publish as a new version</b> keeps the old form on file and starts a fresh one — use it when the meaning of a
              question changes, not for a typo.
            </div>
          </div>
        </Card>
      ) : null}

      {editable && active ? (
        <Card>
          <CardHeader title="Stop asking extra questions" sub="Deactivates the live form; signup falls back to name and e-mail only" />
          <div className="card-pad">
            <Button variant="danger" disabled={busy} onClick={() => setConfirmRetire(true)}>Deactivate the live form</Button>
          </div>
        </Card>
      ) : null}

      {previous.length ? (
        <Card>
          <CardHeader title="Previous versions" sub="Kept because answers reference the form they were given against" />
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Created</th><th>Questions</th><th>Status</th></tr></thead>
              <tbody>
                {previous.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{r.created_at?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                    <td>{readFields(r.fields).map((f) => f.label).filter(Boolean).join(', ') || <span className="muted">none</span>}</td>
                    <td><Badge tone="neutral">Retired</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <ConfirmModal
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={() => publishNew.mutate()}
        title="Publish a new version?"
        message="A new form goes live and the current one is deactivated. Answers already collected stay attached to the old version, which is why it is kept rather than deleted."
        confirmLabel="Publish"
        busy={publishNew.isPending}
      />

      <ConfirmModal
        open={confirmRetire}
        onClose={() => setConfirmRetire(false)}
        onConfirm={(r) => retire.mutate(r)}
        title="Deactivate the signup form?"
        message="New riders will be asked only for name and e-mail. The form is kept on file for answers already collected."
        confirmLabel="Deactivate"
        danger
        requireReason
        busy={retire.isPending}
      />
    </div>
  );
}
