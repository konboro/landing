import { useState } from 'react';
import { Card, CardHeader, Button, Field, Input, Select, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney, titleCase } from '@/lib/format';
import type { Addon } from '@/types/domain';
import { useCatalogue } from './useCatalogue';
import { EditorModal, RemoveConfirm, RemoveCell } from './EditorModal';
import { centsToEuros, eurosToCents } from './money';

const META = { table: 'addons', noun: 'add-on', hardDelete: false } as const;

const KINDS: Array<Addon['kind']> = ['insurance', 'helmet', 'other'];
const PERIODS: Array<Addon['per']> = ['trip', 'month'];

export function AddonsTab({ rows }: { rows: Addon[] }) {
  const [editing, setEditing] = useState<Addon | 'new' | null>(null);
  const [removing, setRemoving] = useState<Addon | null>(null);
  const cat = useCatalogue(META, () => setEditing(null));

  return (
    <Card>
      <CardHeader
        title="Add-ons"
        sub="Optional extras a rider can attach to a trip or carry monthly"
        actions={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New add-on</Button> : null}
      />
      {rows.length === 0 ? (
        <EmptyState
          emoji="🧩"
          title="No add-ons offered"
          hint="Add-ons are the optional extras charged alongside a ride — damage waiver, helmet rental — billed either per trip or per month."
          action={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New add-on</Button> : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Kind</th><th>Price</th><th>Billed</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.id}
                  className={cat.canEdit ? 'clickable' : undefined}
                  onClick={cat.canEdit ? () => setEditing(a) : undefined}
                >
                  <td>{a.name}</td>
                  <td>{titleCase(a.kind)}</td>
                  <td>{formatMoney(a.price_cents)}</td>
                  <td>per {a.per}</td>
                  <td>{a.active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {cat.canEdit && a.active ? <RemoveCell hardDelete={false} onRemove={() => setRemoving(a)} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <AddonForm
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
        noun="add-on"
        label={removing?.name ?? ''}
        hardDelete={false}
        busy={cat.removing}
      />
    </Card>
  );
}

function AddonForm({ row, cat, onClose }: { row: Addon | null; cat: ReturnType<typeof useCatalogue>; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? '');
  const [kind, setKind] = useState<Addon['kind']>(row?.kind ?? 'insurance');
  const [price, setPrice] = useState(centsToEuros(row?.price_cents));
  const [per, setPer] = useState<Addon['per']>(row?.per ?? 'trip');
  const [active, setActive] = useState(row?.active ?? true);

  const parsedPrice = eurosToCents(price);

  const issues: string[] = [];
  if (!name.trim()) issues.push('Name is required.');
  if (!parsedPrice.ok) issues.push(`Price ${parsedPrice.error}.`);

  const submit = () => {
    if (!parsedPrice.ok) return;
    cat.submit(row?.id ?? null, {
      name: name.trim(),
      kind,
      price_cents: parsedPrice.value,
      per,
      active,
    });
  };

  return (
    <EditorModal
      open
      onClose={onClose}
      title={row ? `Edit “${row.name}”` : 'New add-on'}
      issues={issues}
      serverError={cat.formError}
      busy={cat.saving}
      onSubmit={submit}
    >
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Damage waiver" autoFocus />
      </Field>
      <div className="grid grid-2">
        <Field label="Kind" required>
          <Select value={kind} onChange={(e) => setKind(e.target.value as Addon['kind'])}>
            {KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
          </Select>
        </Field>
        <Field label="Billed" required hint="Per trip is charged with each ride; per month rides along with the subscription cycle.">
          <Select value={per} onChange={(e) => setPer(e.target.value as Addon['per'])}>
            {PERIODS.map((p) => <option key={p} value={p}>Per {p}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Price (€)" required hint="Stored in cents. 0 is allowed — a free add-on the rider still has to opt into.">
        <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.99" />
      </Field>
      <Checkbox label="Offered to riders" checked={active} onChange={(e) => setActive(e.target.checked)} />
    </EditorModal>
  );
}
