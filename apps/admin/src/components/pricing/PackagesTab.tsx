import { useState } from 'react';
import { Card, CardHeader, Button, Field, Input, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney } from '@/lib/format';
import type { Package } from '@/types/domain';
import { useCatalogue } from './useCatalogue';
import { EditorModal, RemoveConfirm, RemoveCell } from './EditorModal';
import { centsToEuros, eurosToCents, parseCount } from './money';

const META = { table: 'packages', noun: 'package', hardDelete: false } as const;

export function PackagesTab({ rows }: { rows: Package[] }) {
  const [editing, setEditing] = useState<Package | 'new' | null>(null);
  const [removing, setRemoving] = useState<Package | null>(null);
  const cat = useCatalogue(META, () => setEditing(null));

  return (
    <Card>
      <CardHeader
        title="Packages"
        sub="Prepaid minute bundles a rider buys once and spends across rides"
        actions={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New package</Button> : null}
      />
      {rows.length === 0 ? (
        <EmptyState
          emoji="🎟️"
          title="No packages on sale"
          hint="A package sells a block of riding minutes up front — “60 minutes for €9.99, valid 30 days”. Riders spend them before their card is charged."
          action={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New package</Button> : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th><th>Minutes</th><th>Price</th><th>Per minute</th><th>Validity</th><th>Sold</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={cat.canEdit ? 'clickable' : undefined}
                  onClick={cat.canEdit ? () => setEditing(p) : undefined}
                >
                  <td>{p.name}</td>
                  <td>{p.minutes}</td>
                  <td>{formatMoney(p.price_cents)}</td>
                  {/* The number an operator actually compares plans on. */}
                  <td className="muted">{p.minutes > 0 ? `${formatMoney(Math.round(p.price_cents / p.minutes))}/min` : '—'}</td>
                  <td>{p.validity_days}d</td>
                  <td>{p.sold}</td>
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
        <PackageForm
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
        noun="package"
        label={removing?.name ?? ''}
        hardDelete={false}
        busy={cat.removing}
      />
    </Card>
  );
}

function PackageForm({ row, cat, onClose }: { row: Package | null; cat: ReturnType<typeof useCatalogue>; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? '');
  const [minutes, setMinutes] = useState(row ? String(row.minutes) : '');
  const [price, setPrice] = useState(centsToEuros(row?.price_cents));
  const [validity, setValidity] = useState(row ? String(row.validity_days) : '30');
  const [active, setActive] = useState(row?.active ?? true);

  const parsedMinutes = parseCount(minutes, 1);
  const parsedPrice = eurosToCents(price);
  const parsedValidity = parseCount(validity, 1);

  const issues: string[] = [];
  if (!name.trim()) issues.push('Name is required.');
  if (!parsedMinutes.ok) issues.push(`Minutes ${parsedMinutes.error}.`);
  if (!parsedPrice.ok) issues.push(`Price ${parsedPrice.error}.`);
  if (!parsedValidity.ok) issues.push(`Validity ${parsedValidity.error}.`);

  const submit = () => {
    if (!parsedMinutes.ok || !parsedPrice.ok || !parsedValidity.ok) return;
    cat.submit(row?.id ?? null, {
      name: name.trim(),
      minutes: parsedMinutes.value,
      price_cents: parsedPrice.value,
      validity_days: parsedValidity.value,
      active,
    });
  };

  return (
    <EditorModal
      open
      onClose={onClose}
      title={row ? `Edit “${row.name}”` : 'New package'}
      sub="Riders buy this once; the minutes are drawn down before their card is charged."
      issues={issues}
      serverError={cat.formError}
      busy={cat.saving}
      onSubmit={submit}
    >
      <Field label="Name" required hint="Shown in the rider app exactly as typed.">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="60 minutes" autoFocus />
      </Field>
      <div className="grid grid-2">
        <Field label="Minutes" required>
          <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" placeholder="60" />
        </Field>
        <Field label="Price (€)" required hint={parsedPrice.ok && parsedMinutes.ok && parsedMinutes.value > 0 ? `${formatMoney(Math.round(parsedPrice.value / parsedMinutes.value))} per minute` : 'Stored in cents.'}>
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="9.99" />
        </Field>
      </div>
      <Field label="Validity (days)" required hint="Days from purchase before unused minutes expire.">
        <Input value={validity} onChange={(e) => setValidity(e.target.value)} inputMode="numeric" placeholder="30" />
      </Field>
      <Checkbox
        label="On sale"
        checked={active}
        onChange={(e) => setActive(e.target.checked)}
      />
    </EditorModal>
  );
}
