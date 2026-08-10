import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useTableState } from '@/hooks/useTableState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Card, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/feedback';
import { useBrand } from '@/context/BrandContext';
import { JsonField } from './JsonField';
import { edgeMessage } from './edge';

/* --------------------------------------------------------------------------
   `app_content(key, lang, value jsonb)` — the rider app's editable content:
   the main and short tutorials, onboarding value slides, parking school and
   the map icon config (docs/02, docs/06 §8, docs/12 §E).

   Primary key is (key, lang) — there is no id column at all, so every write
   addresses the row with the composite key object. Hard-deletable.

   Empty on this deployment. The rider app therefore shows whatever it ships
   with; the empty state says so instead of implying content exists.
   -------------------------------------------------------------------------- */

export interface AppContentRow {
  key: string;
  lang: string;
  value: unknown;
  updated_at?: string | null;
}

interface Slide { title: string; body: string }

const LANGS = ['pl', 'en', 'el'] as const;
const LANG_LABEL: Record<string, string> = { pl: 'Polish', en: 'English', el: 'Greek' };

/** Keys the apps read, from docs/06 §8 and docs/12 §E. Suggestions, not a
 *  constraint — the column is free-form text. */
const SUGGESTED_KEYS = [
  'tutorial_main', 'tutorial_short', 'onboarding_slides',
  'parking_school', 'safety_card', 'map_icons',
];

const rowId = (r: AppContentRow) => `${r.key}/${r.lang}`;

function asSlides(value: unknown): Slide[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((s) => s && typeof s === 'object' && !Array.isArray(s))) return null;
  return value.map((s) => {
    const o = s as Record<string, unknown>;
    return { title: typeof o.title === 'string' ? o.title : '', body: typeof o.body === 'string' ? o.body : '' };
  });
}

function summarise(value: unknown): string {
  const slides = asSlides(value);
  if (slides) return `${slides.length} slide${slides.length === 1 ? '' : 's'}`;
  if (value && typeof value === 'object') return `${Object.keys(value as object).length} field(s)`;
  return JSON.stringify(value ?? null).slice(0, 60);
}

export function AppContent() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('settings.edit');

  const state = useTableState({ pageSize: 50, sort: [{ field: 'key', dir: 'asc' }] });
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'app_content', state.params],
    queryFn: () => ds.configList<AppContentRow>('app_content', state.params),
  });

  const [editing, setEditing] = useState<AppContentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<AppContentRow | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'app_content'] });

  const remove = useMutation({
    mutationFn: ({ row, reason }: { row: AppContentRow; reason: string }) =>
      ds.configRemove('app_content', { key: row.key, lang: row.lang }, reason),
    onSuccess: (res, { row }) => {
      toast.push(res.deactivated ? `“${row.key}” deactivated` : `“${row.key}” (${row.lang}) deleted`, 'success');
      setRemoving(null);
      void refresh();
    },
    onError: async (e) => { toast.push(await edgeMessage(e, 'Could not delete the entry.'), 'error'); setRemoving(null); },
  });

  const columns: Column<AppContentRow>[] = [
    { key: 'key', header: 'Content key', sortable: true, csv: (r) => r.key, render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.key}</span> },
    { key: 'lang', header: 'Language', render: (r) => <Badge tone="info">{LANG_LABEL[r.lang] ?? r.lang}</Badge>, csv: (r) => r.lang },
    { key: 'summary', header: 'Contents', render: (r) => summarise(r.value), csv: (r) => JSON.stringify(r.value) },
    {
      key: 'updated_at', header: 'Updated', sortable: true, csv: (r) => r.updated_at ?? '',
      render: (r) => <span className="muted">{r.updated_at?.slice(0, 16).replace('T', ' ') ?? '—'}</span>,
    },
    {
      key: 'actions', header: '', hideable: false,
      render: (r) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>{editable ? 'Edit' : 'View'}</Button>
          {editable ? <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>Delete</Button> : null}
        </span>
      ),
      csv: () => '',
    },
  ];

  const empty = !isLoading && (data?.total ?? 0) === 0 && !state.search;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card pad>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Tutorials &amp; app content</h3>
            <div className="muted" style={{ marginTop: 2, fontSize: 13 }}>
              One entry per content key and language. The rider app reads the main tutorial, the onboarding slides and the
              parking school from here (docs/06 §8, docs/12 §E) — a key with no row falls back to what the app ships with.
            </div>
          </div>
          {!editable ? <Badge tone="neutral">read-only — needs settings.edit</Badge> : null}
        </div>
      </Card>

      {empty ? (
        <Card>
          <EmptyState
            emoji="📘"
            title="No content entries yet"
            hint="Nothing is overriding the app's built-in tutorials. Add an entry to take a screen's copy under panel control."
            action={editable ? <Button variant="primary" onClick={() => setCreating(true)}>+ Add content</Button> : undefined}
          />
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          state={state}
          loading={isLoading}
          rowKey={rowId}
          searchPlaceholder="Search content key…"
          csvName="app-content"
          emptyTitle="No entries match"
          toolbarActions={editable ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>+ Add content</Button> : undefined}
        />
      )}

      {creating ? (
        <ContentEditor key="new" row={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void refresh(); }} />
      ) : null}

      {editing ? (
        <ContentEditor
          key={rowId(editing)}
          row={editing}
          readOnly={!editable}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      ) : null}

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={(reason) => { if (removing) remove.mutate({ row: removing, reason }); }}
        title="Delete this entry?"
        message={removing ? `“${removing.key}” (${removing.lang}) is removed and the app falls back to its built-in copy.` : ''}
        confirmLabel="Delete"
        danger
        requireReason
        busy={remove.isPending}
      />
    </div>
  );
}

function ContentEditor({
  row, readOnly, onClose, onSaved,
}: {
  row: AppContentRow | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ds = useDS();
  const toast = useToast();
  const { colors } = useBrand();
  const isNew = row === null;

  const [key, setKey] = useState(row?.key ?? '');
  const [lang, setLang] = useState(row?.lang ?? 'en');
  const [value, setValue] = useState<unknown>(row?.value ?? [{ title: '', body: '' }]);
  const [mode, setMode] = useState<'slides' | 'json'>(asSlides(row?.value ?? []) ? 'slides' : 'json');
  const [jsonValid, setJsonValid] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const slides = asSlides(value);

  const save = useMutation({
    mutationFn: () => (isNew
      ? ds.configCreate<AppContentRow>('app_content', { key: key.trim(), lang, value })
      // (key, lang) identify the row; only the payload changes.
      : ds.configUpdate<AppContentRow>('app_content', { key: row.key, lang: row.lang }, { value })),
    onSuccess: () => {
      toast.push(isNew ? 'Content added — recorded in the audit log' : 'Content saved — recorded in the audit log', 'success');
      onSaved();
    },
    onError: async (e) => setFormError(await edgeMessage(e, 'Could not save the content.')),
  });

  const setSlide = (i: number, patch: Partial<Slide>) =>
    setValue((slides ?? []).map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const problems: string[] = [];
  if (isNew && !key.trim()) problems.push('A content key is required.');
  if (!jsonValid) problems.push('The JSON is not valid.');
  if (value === undefined) problems.push('The value is empty.');

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? 'Add app content' : `${row.key} · ${LANG_LABEL[row.lang] ?? row.lang}`}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly ? (
            <Button variant="primary" disabled={problems.length > 0 || save.isPending} onClick={() => { setFormError(null); save.mutate(); }}>
              {save.isPending ? 'Saving…' : isNew ? 'Add content' : 'Save'}
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

        {isNew ? (
          <div className="row-wrap" style={{ gap: 'var(--space-md)' }}>
            <Field label="Content key" required hint="What the app asks for, verbatim.">
              <Input className="mono" list="penny-content-keys" value={key} onChange={(e) => setKey(e.target.value)} placeholder="tutorial_main" />
              <datalist id="penny-content-keys">{SUGGESTED_KEYS.map((k) => <option key={k} value={k} />)}</datalist>
            </Field>
            <Field label="Language" required>
              <Select style={{ width: 160 }} value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
              </Select>
            </Field>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Key and language identify this row and cannot be changed here — a different key or language is a different entry.
          </div>
        )}

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="section-label" style={{ margin: 0 }}>Value</span>
          <div className="topbar-spacer" style={{ flex: 1 }} />
          <button
            type="button" className={`chip ${mode === 'slides' ? 'active' : ''}`}
            disabled={!slides}
            title={slides ? undefined : 'This entry is not a list of slides — edit it as JSON.'}
            onClick={() => setMode('slides')}
          >
            Slides
          </button>
          <button type="button" className={`chip ${mode === 'json' ? 'active' : ''}`} onClick={() => setMode('json')}>JSON</button>
        </div>

        {mode === 'slides' && slides ? (
          <div className="stack" style={{ gap: 'var(--space-md)' }}>
            {slides.map((s, i) => (
              <div key={i} className="card" style={{ padding: 12 }}>
                <div className="between" style={{ marginBottom: 6 }}>
                  <span className="section-label" style={{ margin: 0 }}>Slide {i + 1}</span>
                  {!readOnly ? (
                    <Button size="sm" variant="ghost" onClick={() => setValue(slides.filter((_, j) => j !== i))}>Remove</Button>
                  ) : null}
                </div>
                <Field label="Title">
                  <Input value={s.title} disabled={readOnly} onChange={(e) => setSlide(i, { title: e.target.value })} />
                </Field>
                <Field label="Body">
                  <Textarea rows={3} value={s.body} disabled={readOnly} onChange={(e) => setSlide(i, { body: e.target.value })} />
                </Field>
              </div>
            ))}
            {!readOnly ? (
              <div><Button size="sm" onClick={() => setValue([...slides, { title: '', body: '' }])}>+ Add slide</Button></div>
            ) : null}
          </div>
        ) : (
          <JsonField
            label="Raw value (jsonb)"
            hint="Free-form per content key. A list of {title, body} objects can also be edited as slides."
            value={value}
            rows={12}
            disabled={readOnly}
            onChange={setValue}
            onValidityChange={setJsonValid}
          />
        )}

        {problems.length ? (
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
