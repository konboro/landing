import { useState } from 'react';
import { Card, CardHeader, Button, Field, Input, Textarea, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney } from '@/lib/format';
import type { Subscription } from '@/types/domain';
import { useCatalogue } from './useCatalogue';
import { EditorModal, RemoveConfirm, RemoveCell, Notice } from './EditorModal';

const META = { table: 'subscriptions', noun: 'subscription', hardDelete: false } as const;

// Stripe price ids are `price_` + an opaque id. Checked here only to catch a
// pasted product id (`prod_…`) or a plain name before it becomes a plan nobody
// can be billed for. Hard Rule #10 — stored exactly as typed, never reformatted.
const STRIPE_PRICE_RE = /^price_[A-Za-z0-9]+$/;

export function SubscriptionsTab({ rows }: { rows: Subscription[] }) {
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null);
  const [removing, setRemoving] = useState<Subscription | null>(null);
  const cat = useCatalogue(META, () => setEditing(null));

  return (
    <Card>
      <CardHeader
        title="Subscriptions"
        sub="Recurring plans billed by Stripe — the price lives on the Stripe price, not here"
        actions={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New subscription</Button> : null}
      />
      {rows.length === 0 ? (
        <EmptyState
          emoji="🔁"
          title="No subscriptions offered"
          hint="A subscription bills monthly through Stripe and carries perks — free unlocks, a discounted per-minute rate. Create the price in Stripe first, then point a plan at it."
          action={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New subscription</Button> : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Price</th><th>Stripe price</th><th>Perks</th><th>Active subs</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  className={cat.canEdit ? 'clickable' : undefined}
                  onClick={cat.canEdit ? () => setEditing(s) : undefined}
                >
                  <td>{s.name}</td>
                  <td>{formatMoney(s.price_cents)}/mo</td>
                  <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.stripe_price_id || '—'}</td>
                  <td>{s.perks.length ? s.perks.map((p) => <span key={p} className="pill-tag">{p}</span>) : <span className="muted">—</span>}</td>
                  <td>{s.active_subs}</td>
                  <td>{s.active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {cat.canEdit && s.active ? <RemoveCell hardDelete={false} onRemove={() => setRemoving(s)} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <SubscriptionForm
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
        noun="subscription"
        label={removing?.name ?? ''}
        hardDelete={false}
        busy={cat.removing}
      />
    </Card>
  );
}

function SubscriptionForm({ row, cat, onClose }: { row: Subscription | null; cat: ReturnType<typeof useCatalogue>; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? '');
  const [priceId, setPriceId] = useState(row?.stripe_price_id ?? '');
  const [perks, setPerks] = useState((row?.perks ?? []).join('\n'));
  const [active, setActive] = useState(row?.active ?? true);

  const perkList = perks.split('\n').map((p) => p.trim()).filter((p) => p.length > 0);

  const issues: string[] = [];
  if (!name.trim()) issues.push('Name is required.');
  if (!priceId.trim()) issues.push('Stripe price id is required — without it nobody can be billed.');
  else if (!STRIPE_PRICE_RE.test(priceId.trim())) issues.push('Stripe price id looks wrong — it starts with “price_”, not “prod_”.');

  const submit = () => {
    cat.submit(row?.id ?? null, {
      name: name.trim(),
      stripe_price_id: priceId.trim(),
      perks: perkList,
      active,
    });
  };

  return (
    <EditorModal
      open
      onClose={onClose}
      title={row ? `Edit “${row.name}”` : 'New subscription'}
      issues={issues}
      serverError={cat.formError}
      busy={cat.saving}
      onSubmit={submit}
    >
      <Notice tone="muted" title="The amount is set in Stripe">
        {row ? <>This plan currently bills <strong>{formatMoney(row.price_cents)}/month</strong>. </> : null}
        Changing what a subscriber pays means creating a new price in Stripe and pasting its id here — the panel deliberately cannot rewrite a live recurring amount.
      </Notice>
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Penny Plus" autoFocus />
      </Field>
      <Field label="Stripe price id" required hint="Copied from Stripe → Products → Pricing. Stored exactly as pasted.">
        <Input className="mono" value={priceId} onChange={(e) => setPriceId(e.target.value)} placeholder="price_1AbCdEf…" />
      </Field>
      <Field label="Perks" hint="One per line. Shown to riders on the subscription card.">
        <Textarea rows={4} value={perks} onChange={(e) => setPerks(e.target.value)} placeholder={'Free unlocks\n20% off per minute'} />
      </Field>
      <Checkbox label="Offered to riders" checked={active} onChange={(e) => setActive(e.target.checked)} />
    </EditorModal>
  );
}
