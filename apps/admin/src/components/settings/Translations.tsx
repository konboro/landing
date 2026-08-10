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
import { edgeMessage } from './edge';

/* --------------------------------------------------------------------------
   `translations(lang, ns, key, value)` — the rider/ops app string catalogue.

   Primary key is the triple (lang, ns, key): the same string in three
   languages is three rows, so `configUpdate`/`configRemove` take the composite
   key object rather than a uuid. Hard-deletable — nothing references a
   translation by id.

   The table is EMPTY on this deployment. That is shown as an empty state, not
   papered over with sample rows: the apps currently fall back to their bundled
   copy, and an operator needs to know that adding a row here is what starts
   overriding it.
   -------------------------------------------------------------------------- */

export interface TranslationRow {
  lang: string;
  ns: string;
  key: string;
  value: string;
}

const LANGS = ['pl', 'en', 'el'] as const;
const LANG_LABEL: Record<string, string> = { pl: 'Polish', en: 'English', el: 'Greek' };

const rowId = (r: TranslationRow) => `${r.lang}/${r.ns}/${r.key}`;

export function Translations() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('settings.edit');

  const state = useTableState({ pageSize: 50, sort: [{ field: 'key', dir: 'asc' }] });
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'translations', state.params],
    queryFn: () => ds.configList<TranslationRow>('translations', state.params),
  });

  const [editing, setEditing] = useState<TranslationRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<TranslationRow | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'translations'] });

  const remove = useMutation({
    mutationFn: ({ row, reason }: { row: TranslationRow; reason: string }) =>
      ds.configRemove('translations', { lang: row.lang, ns: row.ns, key: row.key }, reason),
    onSuccess: (res, { row }) => {
      toast.push(
        res.deactivated ? `“${row.ns}.${row.key}” deactivated` : `“${row.ns}.${row.key}” (${row.lang}) deleted`,
        'success',
      );
      setRemoving(null);
      void refresh();
    },
    onError: async (e) => { toast.push(await edgeMessage(e, 'Could not delete the string.'), 'error'); setRemoving(null); },
  });

  const columns: Column<TranslationRow>[] = [
    { key: 'lang', header: 'Language', render: (r) => <Badge tone="info">{LANG_LABEL[r.lang] ?? r.lang}</Badge>, csv: (r) => r.lang },
    { key: 'ns', header: 'Namespace', sortable: true, csv: (r) => r.ns, render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.ns}</span> },
    { key: 'key', header: 'Key', sortable: true, csv: (r) => r.key, render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.key}</span> },
    { key: 'value', header: 'Value', render: (r) => r.value },
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

  const untouched = !state.search && state.filters.lang == null;
  const empty = !isLoading && (data?.total ?? 0) === 0 && untouched;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card pad>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>App localization</h3>
            <div className="muted" style={{ marginTop: 2, fontSize: 13 }}>
              Overrides for the rider and ops apps, per language (PL / EN / EL). A string is identified by
              language + namespace + key; a key with no row here falls back to the copy bundled in the app.
            </div>
          </div>
          {!editable ? <Badge tone="neutral">read-only — needs settings.edit</Badge> : null}
        </div>
      </Card>

      {empty ? (
        <Card>
          <EmptyState
            emoji="🌍"
            title="No translation overrides yet"
            hint="The apps are running entirely on their bundled strings. Add one here to override a single key without an app release."
            action={editable ? <Button variant="primary" onClick={() => setCreating(true)}>+ Add string</Button> : undefined}
          />
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          state={state}
          loading={isLoading}
          rowKey={rowId}
          searchPlaceholder="Search key or value…"
          csvName="translations"
          emptyTitle="No strings match"
          filtersSlot={
            <Select
              style={{ width: 'auto' }}
              value={String(state.filters.lang ?? 'all')}
              onChange={(e) => state.setFilter('lang', e.target.value === 'all' ? undefined : e.target.value)}
            >
              <option value="all">All languages</option>
              {LANGS.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
            </Select>
          }
          toolbarActions={editable ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>+ Add string</Button> : undefined}
        />
      )}

      {creating ? (
        <StringEditor key="new" row={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void refresh(); }} />
      ) : null}

      {editing ? (
        <StringEditor
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
        title="Delete this string?"
        message={removing ? `“${removing.ns}.${removing.key}” (${removing.lang}) goes away and the app falls back to its bundled copy.` : ''}
        confirmLabel="Delete"
        danger
        requireReason
        busy={remove.isPending}
      />
    </div>
  );
}

function StringEditor({
  row, readOnly, onClose, onSaved,
}: {
  row: TranslationRow | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ds = useDS();
  const toast = useToast();
  const { colors } = useBrand();
  const isNew = row === null;

  const [lang, setLang] = useState(row?.lang ?? 'en');
  const [ns, setNs] = useState(row?.ns ?? '');
  const [key, setKey] = useState(row?.key ?? '');
  const [value, setValue] = useState(row?.value ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => (isNew
      // The key columns are part of the insert; on update they identify the row
      // instead, and only `value` changes — renaming a key is deleting one
      // string and adding another, not an edit.
      ? ds.configCreate<TranslationRow>('translations', { lang, ns: ns.trim(), key: key.trim(), value })
      : ds.configUpdate<TranslationRow>('translations', { lang: row.lang, ns: row.ns, key: row.key }, { value })),
    onSuccess: () => {
      toast.push(isNew ? 'String added — recorded in the audit log' : 'String saved — recorded in the audit log', 'success');
      onSaved();
    },
    onError: async (e) => setFormError(await edgeMessage(e, 'Could not save the string.')),
  });

  const problems: string[] = [];
  if (isNew && !ns.trim()) problems.push('A namespace is required (e.g. rider, ops, errors).');
  if (isNew && !key.trim()) problems.push('A key is required.');
  if (!value.trim()) problems.push('The value is empty.');

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Add a string' : `${row.ns}.${row.key} · ${LANG_LABEL[row.lang] ?? row.lang}`}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly ? (
            <Button variant="primary" disabled={problems.length > 0 || save.isPending} onClick={() => { setFormError(null); save.mutate(); }}>
              {save.isPending ? 'Saving…' : isNew ? 'Add string' : 'Save'}
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
          <>
            <Field label="Language" required>
              <Select value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
              </Select>
            </Field>
            <Field label="Namespace" required hint="Groups keys by screen or area, e.g. rider, wallet, errors.">
              <Input className="mono" value={ns} onChange={(e) => setNs(e.target.value)} placeholder="rider" />
            </Field>
            <Field label="Key" required hint="Exactly as the app asks for it — it is matched verbatim.">
              <Input className="mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="unlock.button" />
            </Field>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Language, namespace and key identify this row and cannot be changed here — a different key is a different string.
          </div>
        )}

        <Field label="Value" required>
          <Textarea rows={4} value={value} disabled={readOnly} onChange={(e) => setValue(e.target.value)} />
        </Field>

        {problems.length ? (
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
