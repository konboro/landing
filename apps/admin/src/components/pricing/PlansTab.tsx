import { useState } from 'react';
import { Card, CardHeader, Button } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney, formatDate } from '@/lib/format';
import type { PricingPlan } from '@/types/domain';
import { useCatalogue } from './useCatalogue';
import { RemoveConfirm, RemoveCell } from './EditorModal';
import { PlanForm, normaliseDynamic } from './PlanForm';

// The only pricing catalogue the server will really DELETE: a ride keeps the
// price it was charged in its own row, so removing the plan cannot rewrite
// anybody's receipt.
const META = { table: 'pricing_plans', noun: 'pricing plan', hardDelete: true } as const;

export function PlansTab({
  plans,
  cityName,
  modelName,
}: {
  plans: PricingPlan[];
  cityName: (id: string) => string;
  modelName: (id: string) => string;
}) {
  const [editing, setEditing] = useState<PricingPlan | 'new' | null>(null);
  const [removing, setRemoving] = useState<PricingPlan | null>(null);
  const cat = useCatalogue(META, () => setEditing(null));

  return (
    <Card>
      <CardHeader
        title="Pricing plans"
        sub="One per city × vehicle model — what a ride actually costs"
        actions={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New plan</Button> : null}
      />
      {plans.length === 0 ? (
        <EmptyState
          emoji="🏷️"
          title="No pricing plans yet"
          hint="A plan is the fare for one vehicle model in one city: the unlock fee, the per-minute rate, what a pause costs and an optional daily cap. Without one, that model cannot be priced."
          action={cat.canEdit ? <Button variant="primary" onClick={() => setEditing('new')}>+ New plan</Button> : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>City</th><th>Model</th><th>Unlock</th><th>Per min</th><th>Pause/min</th>
                <th>Day cap</th><th>Valid</th><th>Dynamic</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const dyn = normaliseDynamic(p.dynamic);
                return (
                  <tr
                    key={p.id}
                    className={cat.canEdit ? 'clickable' : undefined}
                    onClick={cat.canEdit ? () => setEditing(p) : undefined}
                  >
                    <td>{cityName(p.city_id)}</td>
                    <td>{modelName(p.model_id)}</td>
                    <td>{formatMoney(p.unlock_cents)}</td>
                    <td>{formatMoney(p.per_min_cents)}</td>
                    <td>{formatMoney(p.pause_per_min_cents)}</td>
                    <td>{p.day_cap_cents != null ? formatMoney(p.day_cap_cents) : <span className="muted">none</span>}</td>
                    <td className="nowrap muted" style={{ fontSize: 'var(--fs-xs)' }}>
                      {p.valid_from || p.valid_to
                        ? `${p.valid_from ? formatDate(p.valid_from) : '—'} → ${p.valid_to ? formatDate(p.valid_to) : 'open'}`
                        : 'Always'}
                    </td>
                    <td className="nowrap">
                      {dyn.demand.enabled ? <Badge tone="info">surge ≤{dyn.demand.cap}×</Badge> : null}
                      {dyn.happy_hours.length ? <Badge tone="success">{dyn.happy_hours.length} happy hour{dyn.happy_hours.length === 1 ? '' : 's'}</Badge> : null}
                      {!dyn.demand.enabled && dyn.happy_hours.length === 0 ? <span className="muted">flat</span> : null}
                    </td>
                    <td>{p.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {cat.canEdit ? <RemoveCell hardDelete onRemove={() => setRemoving(p)} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <PlanForm
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
        noun="pricing plan"
        label={removing ? `${cityName(removing.city_id)} · ${modelName(removing.model_id)}` : ''}
        hardDelete
        busy={cat.removing}
      />
    </Card>
  );
}
