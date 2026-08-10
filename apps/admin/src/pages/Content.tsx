import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button, Input, Textarea, Select, Field, Checkbox } from '@/components/ui/primitives';
import { Badge, PaymentStatusBadge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/feedback';
import {
  EntityModal, RemoveConfirm, RowActions, UnavailableNote, useConfigResource, type ConfigRow,
} from '@/components/config';
import { formatMoney, titleCase, relativeTime } from '@/lib/format';

const LANGS = ['en', 'el', 'pl'] as const;
type Lang = (typeof LANGS)[number];

export function ContentPage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('products');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Subscriptions & Add-ons content" sub="Products, purchase history, FAQ editor" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'products', label: 'Products' },
        { key: 'purchases', label: 'Purchase history' },
        { key: 'faq', label: 'FAQ editor' },
        { key: 'appcontent', label: 'App content' },
      ]} />
      {tab === 'faq' ? <Faq /> : null}
      {tab === 'appcontent' ? <AppContent /> : null}
      {tab === 'products' || tab === 'purchases' ? (
        isLoading || !db ? <Card pad>Loading…</Card> : (
          <>
            {tab === 'products' ? <Products db={db} /> : null}
            {tab === 'purchases' ? <Purchases db={db} /> : null}
          </>
        )
      ) : null}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

function Products({ db }: { db: DB }) {
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <UnavailableNote title="Products are edited on the Pricing screen">
        Subscriptions, packages and add-ons are priced catalogues — they sit behind the
        <span className="mono"> pricing.edit </span> permission and are managed under Pricing,
        so they are read-only here.
      </UnavailableNote>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <CardHeader title="Subscriptions" />
          <div className="card-pad stack">
            {db.subscriptions.length === 0 ? <div className="muted">No subscriptions.</div> : db.subscriptions.map((s) => (
              <div key={s.id} className="between" style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                <div><div style={{ fontWeight: 600 }}>{s.name}</div><div className="muted" style={{ fontSize: 13 }}>{(s.perks ?? []).join(' · ')}</div></div>
                <div style={{ textAlign: 'right' }}><div>{formatMoney(s.price_cents)}/mo</div><div className="muted" style={{ fontSize: 12 }}>{s.active_subs} active</div></div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Packages & add-ons" />
          <div className="card-pad stack">
            {db.packages.map((p) => <div key={p.id} className="between" style={{ fontSize: 14 }}><span>{p.name} <span className="muted">({p.minutes} min)</span></span><span>{formatMoney(p.price_cents)}</span></div>)}
            <div className="divider" />
            {db.addons.map((a) => <div key={a.id} className="between" style={{ fontSize: 14 }}><span>{a.name} <Badge tone="neutral" dot={false}>{a.per}</Badge></span><span>{formatMoney(a.price_cents)}</span></div>)}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Purchases({ db }: { db: DB }) {
  const rows = db.payments.filter((p) => ['package', 'subscription', 'addon'].includes(p.kind));
  const custName = (id: string) => db.customers.find((c) => c.id === id)?.full_name ?? id;
  return (
    <Card>
      <CardHeader title="Purchase history" sub={`${rows.length} product purchases`} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}><td className="mono">{p.id}</td><td>{custName(p.user_id)}</td><td>{titleCase(p.kind)}</td><td>{formatMoney(p.amount_cents)}</td><td><PaymentStatusBadge status={p.status} /></td><td>{relativeTime(p.created_at)}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}

/* ═══════════════════════════ FAQ ═══════════════════════════ */

interface FaqRow extends ConfigRow {
  id: string;
  lang: Lang;
  question: string;
  answer: string;
  sort: number;
  active: boolean;
}

const EMPTY_FAQ = { lang: 'en' as Lang, question: '', answer: '', sort: 0, active: true };

function Faq() {
  const { can } = useAuth();
  const mayEdit = can('settings.edit');
  const [lang, setLang] = useState<Lang>('en');
  const faq = useConfigResource<FaqRow>('faq_items', { label: 'FAQ entry' });

  const [editing, setEditing] = useState<FaqRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FAQ);
  const [removing, setRemoving] = useState<FaqRow | null>(null);

  const shown = faq.rows.filter((f) => f.lang === lang).sort((a, b) => a.sort - b.sort);

  const openCreate = () => {
    setForm({ ...EMPTY_FAQ, lang, sort: (shown.at(-1)?.sort ?? 0) + 1 });
    setCreating(true);
  };
  const openEdit = (f: FaqRow) => {
    setForm({ lang: f.lang, question: f.question, answer: f.answer, sort: f.sort, active: f.active });
    setEditing(f);
  };
  const close = () => { setCreating(false); setEditing(null); };

  const save = () => {
    const values = {
      lang: form.lang,
      question: form.question.trim(),
      answer: form.answer.trim(),
      sort: form.sort,
      active: form.active,
    };
    if (editing) faq.update.mutate({ key: editing.id, values }, { onSuccess: close });
    else faq.create.mutate({ values }, { onSuccess: close });
  };

  // `sort` is the only thing controlling FAQ order in the rider app, so it is
  // reorderable in place rather than only inside the edit dialog.
  const move = (f: FaqRow, dir: -1 | 1) => {
    const i = shown.findIndex((x) => x.id === f.id);
    const swap = shown[i + dir];
    if (!swap) return;
    faq.update.mutate({ key: f.id, values: { sort: swap.sort } });
    faq.update.mutate({ key: swap.id, values: { sort: f.sort } });
  };

  return (
    <Card>
      <CardHeader
        title="FAQ editor"
        sub="Shown in the rider app, per language"
        actions={
          <>
            <Select style={{ width: 'auto' }} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
            <Button size="sm" variant="primary" disabled={!mayEdit} onClick={openCreate}>+ New entry</Button>
          </>
        }
      />
      <div className="card-pad stack">
        {!mayEdit ? (
          <div className="muted">You need <span className="mono">settings.edit</span> to change FAQ entries.</div>
        ) : null}
        {faq.error ? <div className="muted">Could not load the FAQ: {faq.error}</div> : null}
        {faq.isLoading ? <div className="muted">Loading…</div> : null}
        {!faq.isLoading && shown.length === 0 ? (
          <EmptyState
            emoji="❓"
            title={`No FAQ entries for ${lang}`}
            hint="Riders see this list in the app's help section."
            action={mayEdit ? <Button variant="primary" onClick={openCreate}>+ New entry</Button> : undefined}
          />
        ) : null}
        {shown.map((f, i) => (
          <div key={f.id} className="card" style={{ padding: 12 }}>
            <div className="between" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  <span className="muted mono" style={{ fontSize: 12, marginRight: 8 }}>#{f.sort}</span>
                  {f.question || <span className="muted">(no question)</span>}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{f.answer}</div>
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                {f.active ? <Badge tone="success">Live</Badge> : <Badge>Hidden</Badge>}
                <Button size="sm" variant="ghost" title="Move up" disabled={!mayEdit || faq.busy || i === 0} onClick={() => move(f, -1)}>↑</Button>
                <Button size="sm" variant="ghost" title="Move down" disabled={!mayEdit || faq.busy || i === shown.length - 1} onClick={() => move(f, 1)}>↓</Button>
                <RowActions
                  disabled={!mayEdit || faq.busy}
                  onEdit={() => openEdit(f)}
                  onRemove={() => setRemoving(f)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <EntityModal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? 'Edit FAQ entry' : 'New FAQ entry'}
        busy={faq.busy}
        canSave={form.question.trim().length > 2 && form.answer.trim().length > 2}
        onSave={save}
      >
        <div className="row" style={{ gap: 8 }}>
          <Field label="Language" required>
            <Select value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value as Lang })}>
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Sort" hint="Ascending — lowest first.">
            <Input type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Question" required>
          <Input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
        </Field>
        <Field label="Answer" required>
          <Textarea rows={5} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
        </Field>
        <Checkbox
          label="Visible in the app"
          checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.target.checked })}
        />
      </EntityModal>

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        // faq_items carries no history references, so admin-write really deletes it.
        mode="delete"
        label="FAQ entry"
        name={removing?.question ?? ''}
        busy={faq.busy}
        onConfirm={(reason) => {
          if (!removing) return;
          faq.remove.mutate({ key: removing.id, reason: reason || undefined }, { onSuccess: () => setRemoving(null) });
        }}
      />
    </Card>
  );
}

/* ═══════════════════════ App content ═══════════════════════ */

interface AppContentRow extends ConfigRow {
  key: string;
  lang: Lang;
  value: unknown;
}

/**
 * `app_content` has no `id` column — its primary key is (key, lang), one entry
 * per language of the same content key. Updates and deletes therefore address
 * the row with the composite key object rather than a uuid.
 */
function AppContent() {
  const { can } = useAuth();
  const mayEdit = can('settings.edit');
  const content = useConfigResource<AppContentRow>('app_content', {
    label: 'content entry',
    enabled: mayEdit,
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AppContentRow | null>(null);
  const [removing, setRemoving] = useState<AppContentRow | null>(null);
  const [form, setForm] = useState({ key: '', lang: 'en' as Lang, value: '{}' });

  const openCreate = () => { setForm({ key: '', lang: 'en', value: '{\n  \n}' }); setCreating(true); };
  const openEdit = (r: AppContentRow) => {
    setForm({ key: r.key, lang: r.lang, value: JSON.stringify(r.value, null, 2) });
    setEditing(r);
  };
  const close = () => { setCreating(false); setEditing(null); };

  // `value` is jsonb — anything that is not valid JSON must be caught here
  // rather than turning into a 400 from Postgres.
  let parsed: unknown = null;
  let jsonError: string | null = null;
  try {
    parsed = JSON.parse(form.value);
  } catch (e) {
    jsonError = e instanceof Error ? e.message : 'Invalid JSON';
  }

  const save = () => {
    if (jsonError) return;
    if (editing) {
      // Composite key: the columns themselves, not a uuid.
      content.update.mutate(
        { key: { key: editing.key, lang: editing.lang }, values: { value: parsed } },
        { onSuccess: close },
      );
    } else {
      content.create.mutate(
        { values: { key: form.key.trim(), lang: form.lang, value: parsed } },
        { onSuccess: close },
      );
    }
  };

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader
          title="App content"
          sub="Tutorials, onboarding slides, map icons — one row per key and language"
          actions={<Button variant="primary" disabled={!mayEdit || content.busy} onClick={openCreate}>+ New entry</Button>}
        />
        {!mayEdit ? <div className="card-pad muted">You need <span className="mono">settings.edit</span> to change app content.</div> : null}
        {content.error ? <div className="card-pad muted">Could not load app content: {content.error}</div> : null}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Key</th><th>Lang</th><th>Value</th><th /></tr></thead>
            <tbody>
              {content.rows.map((r) => (
                <tr key={`${r.key}:${r.lang}`}>
                  <td className="mono">{r.key}</td>
                  <td>{r.lang}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{JSON.stringify(r.value).slice(0, 90)}</td>
                  <td>
                    <RowActions
                      disabled={!mayEdit || content.busy}
                      onEdit={() => openEdit(r)}
                      onRemove={() => setRemoving(r)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!content.isLoading && content.rows.length === 0 ? (
          <div className="card-pad">
            <EmptyState
              emoji="📄"
              title="No app content"
              hint="Onboarding slides and tutorial copy the rider app reads at boot."
              action={mayEdit ? <Button variant="primary" onClick={openCreate}>+ New entry</Button> : undefined}
            />
          </div>
        ) : null}
      </Card>

      <EntityModal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? `Edit ${editing.key} (${editing.lang})` : 'New content entry'}
        busy={content.busy}
        canSave={!jsonError && (editing !== null || form.key.trim().length > 1)}
        onSave={save}
      >
        <div className="row" style={{ gap: 8 }}>
          <Field label="Key" required hint={editing ? 'The key and language identify the row and cannot be changed here.' : 'e.g. onboarding.slide1'}>
            <Input className="mono" value={form.key} disabled={editing !== null} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          </Field>
          <Field label="Language" required>
            <Select value={form.lang} disabled={editing !== null} onChange={(e) => setForm({ ...form, lang: e.target.value as Lang })}>
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Value (JSON)" required hint="Stored as jsonb — must parse.">
          <Textarea className="mono" rows={10} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        </Field>
        {jsonError ? <div className="muted" style={{ fontSize: 13 }}>Invalid JSON: {jsonError}</div> : null}
      </EntityModal>

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        mode="delete"
        label="content entry"
        name={removing ? `${removing.key} (${removing.lang})` : ''}
        busy={content.busy}
        onConfirm={(reason) => {
          if (!removing) return;
          content.remove.mutate(
            { key: { key: removing.key, lang: removing.lang }, reason: reason || undefined },
            { onSuccess: () => setRemoving(null) },
          );
        }}
      />
    </div>
  );
}
