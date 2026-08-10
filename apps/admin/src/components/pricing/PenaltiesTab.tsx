import { useState } from 'react';
import { Card, CardHeader, Button, Field, Input, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney } from '@/lib/format';
import type { PenaltyCatalogItem } from '@/types/domain';
import { useCatalogue } from './useCatalogue';
import { EditorModal, RemoveConfirm, RemoveCell } from './EditorModal';
import { parseTiers, tiersToEuros } from './money';

const META = { table: 'penalties', noun: 'penalty', hardDelete: false } as const;

// The code is what a charge, a dispute and an appeal all reference. Keeping it
// to snake_case ASCII means it stays greppable in the ledger and safe in a URL.
const CODE_RE = /^[a-z][a-z0-9_]*$/;

export function PenaltiesTab({ rows }: { rows: PenaltyCatalogItem[] }) {
  const [editing, setEditing] = useState<PenaltyCatalogItem | 'new' | null>(null);
  const [removing, setRemoving] = useState<PenaltyCatalogItem | null>(null);
  const cat = useCatalogue(META, () => setEditing(null));

  return (
    <Card>
      <CardHeader
        title="Penalties catalogue"
        sub="Escalating tiers charged for misuse, with photo evidence and an appeal route"
        actions={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New penalty</Button> : null}
      />
      {rows.length === 0 ? (
        <EmptyState
          emoji="⚖️"
          title="No penalties defined"
          hint="A penalty is what an operator can charge for bad parking, a missing helmet or a damaged scooter. Each has escalating tiers — the second offence costs more than the first."
          action={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New penalty</Button> : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Code</th><th>Label</th><th>Tiers</th><th>Photo</th><th>Appealable</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={cat.canEdit ? 'clickable' : undefined}
                  onClick={cat.canEdit ? () => setEditing(p) : undefined}
                >
                  <td className="mono">{p.code}</td>
                  <td>{p.label}</td>
                  <td className="nowrap">{p.tiers_cents.length ? p.tiers_cents.map((t) => formatMoney(t)).join(' → ') : <span className="muted">—</span>}</td>
                  <td>{p.requires_photo ? 'Required' : <span className="muted">—</span>}</td>
                  <td>{p.appealable ? 'Yes' : 'No'}</td>
                  <td>{p.active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {cat.canEdit && p.active ? <RemoveCell hardDelete={false} onRemove={() => setRemoving(p)} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <PenaltyForm
          key={editing === 'new' ? 'new' : editing.id}
          row={editing === 'new' ? null : editing}
          cat={cat}
          onClose={() => { cat.clearFormError(); setEditing(null); }}
        />
      ) : null}

      <RemoveConfirm
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={(reason) => { if (removing) cat.remove(removing.id, reason); setRemoving(null); }}
        noun="penalty"
        label={removing ? `${removing.label} (${removing.code})` : ''}
        hardDelete={false}
        busy={cat.removing}
      />
    </Card>
  );
}

function PenaltyForm({ row, cat, onClose }: { row: PenaltyCatalogItem | null; cat: ReturnType<typeof useCatalogue>; onClose: () => void }) {
  const [code, setCode] = useState(row?.code ?? '');
  const [label, setLabel] = useState(row?.label ?? '');
  const [tiers, setTiers] = useState(tiersToEuros(row?.tiers_cents));
  const [requiresPhoto, setRequiresPhoto] = useState(row?.requires_photo ?? true);
  const [appealable, setAppealable] = useState(row?.appealable ?? true);
  const [active, setActive] = useState(row?.active ?? true);

  const parsedTiers = parseTiers(tiers);

  const issues: string[] = [];
  if (!code.trim()) issues.push('Code is required.');
  else if (!CODE_RE.test(code.trim())) issues.push('Code must be lower-case snake_case, e.g. bad_parking.');
  if (!label.trim()) issues.push('Label is required — it is what the rider sees on the charge.');
  if (!parsedTiers.ok) issues.push(`Tiers ${parsedTiers.error}.`);

  const submit = () => {
    if (!parsedTiers.ok) return;
    cat.submit(row?.id ?? null, {
      code: code.trim(),
      label: label.trim(),
      tiers_cents: parsedTiers.value,
      requires_photo: requiresPhoto,
      appealable,
      active,
    });
  };

  return (
    <EditorModal
      open
      onClose={onClose}
      title={row ? `Edit “${row.label}”` : 'New penalty'}
      issues={issues}
      serverError={cat.formError}
      busy={cat.saving}
      onSubmit={submit}
    >
      <div className="grid grid-2">
        <Field label="Code" required hint="Referenced by every charge, dispute and appeal. Changing it on a live penalty breaks that trail.">
          <Input className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="bad_parking" autoFocus />
        </Field>
        <Field label="Label" required hint="Plain language — the rider reads this.">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Parked outside a permitted zone" />
        </Field>
      </div>
      <Field
        label="Escalation tiers (€)"
        required
        hint="Comma separated, first offence first, each higher than the last — e.g. 10, 20, 40. Riders past the last tier are charged the last tier."
      >
        <Input value={tiers} onChange={(e) => setTiers(e.target.value)} inputMode="decimal" placeholder="10, 20, 40" />
      </Field>
      {parsedTiers.ok ? (
        <p className="muted" style={{ marginTop: -8, fontSize: 'var(--fs-sm)' }}>
          {parsedTiers.value.map((t, i) => `${i + 1}${i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'} offence ${formatMoney(t)}`).join(' · ')}
        </p>
      ) : null}
      <Checkbox
        label="Photo evidence required before charging"
        checked={requiresPhoto}
        onChange={(e) => setRequiresPhoto(e.target.checked)}
      />
      <Checkbox
        label="Rider can appeal this charge"
        checked={appealable}
        onChange={(e) => setAppealable(e.target.checked)}
      />
      <Checkbox label="In force" checked={active} onChange={(e) => setActive(e.target.checked)} />
    </EditorModal>
  );
}
