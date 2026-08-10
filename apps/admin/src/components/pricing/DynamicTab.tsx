// Dynamic pricing, read off the selected plan's own `dynamic` JSON.
//
// This grid used to be generated from a hardcoded formula — invented peaks, an
// invented happy hour — so it showed confident multipliers for a fleet that was
// priced flat. Anything on this page now comes from the row, and a plan with no
// windows says so.

import { useState } from 'react';
import { Card, CardHeader, Button, Field, Select } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/feedback';
import { useBrand } from '@/context/BrandContext';
import type { PricingPlan } from '@/types/domain';
import { useCatalogue } from './useCatalogue';
import { PlanForm, DOWS, normaliseDynamic, happyHourMultiplier } from './PlanForm';

const META = { table: 'pricing_plans', noun: 'pricing plan', hardDelete: true } as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 0–255 alpha as the two hex digits an #RRGGBBAA colour needs. */
const alpha = (a: number) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

export function DynamicTab({
  plans,
  cityName,
  modelName,
}: {
  plans: PricingPlan[];
  cityName: (id: string) => string;
  modelName: (id: string) => string;
}) {
  const { colors } = useBrand();
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [editing, setEditing] = useState<PricingPlan | null>(null);
  const cat = useCatalogue(META, () => setEditing(null));

  const plan = plans.find((p) => p.id === planId) ?? plans[0];

  if (!plan) {
    return (
      <Card>
        <CardHeader title="Dynamic pricing" />
        <EmptyState
          emoji="📈"
          title="No plan to show multipliers for"
          hint="Dynamic pricing lives on a pricing plan — happy-hour windows that discount or surcharge the per-minute rate, plus an optional demand surge. Create a plan on the Plans tab first."
        />
      </Card>
    );
  }

  const dyn = normaliseDynamic(plan.dynamic);
  const flat = dyn.happy_hours.length === 0;

  const cellStyle = (m: number) => {
    if (m === 1) return undefined;
    const c = m < 1 ? colors.success : colors.danger;
    // Further from 1× → stronger tint, clamped so an extreme value stays legible.
    return { background: `${c}${alpha(Math.min(0.55, Math.abs(m - 1) * 1.2 + 0.12))}`, fontSize: 11 };
  };

  return (
    <Card>
      <CardHeader
        title="Dynamic pricing"
        sub="Multiplier on the per-minute rate, by day × hour. Always shown to the rider before they unlock."
        actions={cat.canEdit ? <Button variant="primary" onClick={() => setEditing(plan)}>Edit this plan</Button> : null}
      />
      <div className="card-pad">
        <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Plan">
            <Select value={plan.id} onChange={(e) => setPlanId(e.target.value)} style={{ minWidth: 260 }}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{cityName(p.city_id)} · {modelName(p.model_id)}</option>
              ))}
            </Select>
          </Field>
          <div className="row-wrap" style={{ paddingBottom: 'var(--space-md)' }}>
            {dyn.demand.enabled
              ? <Badge tone="info">Demand surge on · capped {dyn.demand.cap}× · {dyn.demand.cell_size_m} m cells</Badge>
              : <Badge>Demand surge off</Badge>}
          </div>
        </div>

        {flat ? (
          <EmptyState
            emoji="➖"
            title="This plan is priced flat"
            hint={
              dyn.demand.enabled
                ? `No happy-hour windows, so the rate is the same every hour of the week. Demand surge can still raise it up to ${dyn.demand.cap}× when an area runs short.`
                : 'No happy-hour windows and no demand surge — every ride on this plan costs the same whenever it happens.'
            }
            action={cat.canEdit ? <Button onClick={() => setEditing(plan)}>Add a happy hour</Button> : undefined}
          />
        ) : (
          <>
            <div className="scroll-x">
              <table className="matrix">
                <thead>
                  <tr><th className="rowhead" />{HOURS.map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {DOWS.map((d, dow) => (
                    <tr key={d}>
                      <td className="rowhead">{d}</td>
                      {HOURS.map((h) => {
                        const m = happyHourMultiplier(dyn, dow, h);
                        return (
                          <td key={h} style={cellStyle(m)} title={`${d} ${String(h).padStart(2, '0')}:00 — ${m}×`}>
                            {m !== 1 ? m : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-wrap" style={{ marginTop: 12, fontSize: 'var(--fs-sm)' }}>
              <span>
                <span style={{ display: 'inline-block', width: 12, height: 12, background: `${colors.success}99`, borderRadius: 3, marginRight: 4 }} />
                Discounted (&lt;1×)
              </span>
              <span>
                <span style={{ display: 'inline-block', width: 12, height: 12, background: `${colors.danger}99`, borderRadius: 3, marginRight: 4 }} />
                Surcharged (&gt;1×)
              </span>
              <span className="muted">Blank = 1×, the plan's base rate.</span>
            </div>
          </>
        )}
      </div>

      {editing ? (
        <PlanForm
          key={editing.id}
          row={editing}
          cat={cat}
          onClose={() => { cat.clearFormError(); setEditing(null); }}
        />
      ) : null}
    </Card>
  );
}
