// The pricing_plans form. Bigger than the other four because a plan carries the
// per-minute economics of every ride in a city AND the `dynamic` JSON that moves
// them — so both are edited in one place, with the whole shape validated before
// anything is sent.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { Button, Field, Input, Select, Checkbox, Divider } from '@/components/ui/primitives';
import { formatMoney } from '@/lib/format';
import type { PricingPlan } from '@/types/domain';
import { EditorModal, Notice } from './EditorModal';
import type { useCatalogue } from './useCatalogue';
import { centsToEuros, eurosToCents, optionalEurosToCents, parseCount, parseMultiplier } from './money';

export const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type Dynamic = PricingPlan['dynamic'];
export type HappyHour = Dynamic['happy_hours'][number];

/** Rows predate the current `dynamic` shape or arrive with nulls; the editor and
 *  the preview grid both need a complete object to reason about. */
export function normaliseDynamic(d: Partial<Dynamic> | null | undefined): Dynamic {
  return {
    happy_hours: Array.isArray(d?.happy_hours) ? d!.happy_hours : [],
    demand: {
      enabled: d?.demand?.enabled ?? false,
      cell_size_m: d?.demand?.cell_size_m ?? 500,
      cap: d?.demand?.cap ?? 1.5,
    },
  };
}

/** Multiplier a rider would be quoted at this day/hour from the happy hours
 *  alone. Demand surge is computed server-side per ride and is not knowable here. */
export function happyHourMultiplier(d: Dynamic, dow: number, hour: number): number {
  let m = 1;
  for (const hh of d.happy_hours) {
    if (hh.dow !== dow) continue;
    const from = Number(String(hh.from).slice(0, 2));
    const to = Number(String(hh.to).slice(0, 2));
    if (Number.isNaN(from) || Number.isNaN(to)) continue;
    if (hour >= from && hour < to) m = hh.multiplier;
  }
  return m;
}

/** `timestamptz` → the value an <input type="date"> accepts. */
const isoToDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
/** Back again. Midnight UTC, stated in the field hint so it is not a surprise. */
const dateToIso = (d: string) => (d ? `${d}T00:00:00Z` : null);

export function PlanForm({
  row,
  cat,
  onClose,
}: {
  row: PricingPlan | null;
  cat: ReturnType<typeof useCatalogue>;
  onClose: () => void;
}) {
  const ds = useDS();
  const { cities } = useAuth();
  const models = useQuery({ queryKey: ['vehicle-models'], queryFn: () => ds.listVehicleModels() });
  const modelList = models.data ?? [];

  const [cityId, setCityId] = useState(row?.city_id ?? '');
  const [modelId, setModelId] = useState(row?.model_id ?? '');
  const [unlock, setUnlock] = useState(centsToEuros(row?.unlock_cents));
  const [perMin, setPerMin] = useState(centsToEuros(row?.per_min_cents));
  const [pause, setPause] = useState(centsToEuros(row?.pause_per_min_cents));
  const [dayCap, setDayCap] = useState(centsToEuros(row?.day_cap_cents));
  const [validFrom, setValidFrom] = useState(isoToDate(row?.valid_from));
  const [validTo, setValidTo] = useState(isoToDate(row?.valid_to));

  const initial = normaliseDynamic(row?.dynamic);
  const [demandOn, setDemandOn] = useState(initial.demand.enabled);
  const [cellSize, setCellSize] = useState(String(initial.demand.cell_size_m));
  const [cap, setCap] = useState(String(initial.demand.cap));
  const [happy, setHappy] = useState<HappyHour[]>(initial.happy_hours);

  const pUnlock = eurosToCents(unlock);
  const pPerMin = eurosToCents(perMin);
  const pPause = eurosToCents(pause);
  const pDayCap = optionalEurosToCents(dayCap);
  const pCell = parseCount(cellSize, 50);
  const pCap = parseMultiplier(cap, 1, 3);

  const issues: string[] = [];
  if (!cityId) issues.push('City is required.');
  if (!modelId) issues.push('Vehicle model is required.');
  if (!pUnlock.ok) issues.push(`Unlock fee ${pUnlock.error}.`);
  if (!pPerMin.ok) issues.push(`Per-minute rate ${pPerMin.error}.`);
  if (!pPause.ok) issues.push(`Pause rate ${pPause.error}.`);
  if (!pDayCap.ok) issues.push(`Daily cap ${pDayCap.error}.`);
  if (validFrom && validTo && validTo <= validFrom) issues.push('Valid until must be after valid from.');
  // A cap below the unlock fee can never bind, so it is almost certainly a typo
  // for a much larger number — and it would silently discount every ride.
  if (pDayCap.ok && pDayCap.value !== null && pUnlock.ok && pDayCap.value < pUnlock.value) {
    issues.push('Daily cap is below the unlock fee — it would cap a ride below what it costs to start one.');
  }
  if (demandOn) {
    if (!pCell.ok) issues.push(`Demand cell size ${pCell.error}.`);
    if (!pCap.ok) issues.push(`Surge cap ${pCap.error}.`);
  }
  happy.forEach((h, i) => {
    if (!h.from || !h.to) issues.push(`Happy hour ${i + 1} needs a start and an end time.`);
    else if (h.to <= h.from) issues.push(`Happy hour ${i + 1} ends before it starts.`);
    if (!(h.multiplier > 0) || h.multiplier > 3) issues.push(`Happy hour ${i + 1} multiplier must be between 0.01 and 3.`);
  });

  const submit = () => {
    if (!pUnlock.ok || !pPerMin.ok || !pPause.ok || !pDayCap.ok) return;
    const dynamic: Dynamic = {
      happy_hours: happy,
      demand: {
        enabled: demandOn,
        cell_size_m: pCell.ok ? pCell.value : 500,
        cap: pCap.ok ? pCap.value : 1.5,
      },
    };
    cat.submit(row?.id ?? null, {
      city_id: cityId,
      model_id: modelId,
      unlock_cents: pUnlock.value,
      per_min_cents: pPerMin.value,
      pause_per_min_cents: pPause.value,
      day_cap_cents: pDayCap.value,
      valid_from: dateToIso(validFrom),
      valid_to: dateToIso(validTo),
      dynamic,
    });
  };

  const setHH = (i: number, patch: Partial<HappyHour>) =>
    setHappy(happy.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  // A 20-minute ride is the shape of the fare an operator has in their head, so
  // the form shows it rather than making them do the arithmetic on three fields.
  const example = pUnlock.ok && pPerMin.ok
    ? pUnlock.value + pPerMin.value * 20
    : null;

  return (
    <EditorModal
      open
      onClose={onClose}
      size="lg"
      title={row ? 'Edit pricing plan' : 'New pricing plan'}
      sub="One plan per city × vehicle model. It sets what every ride on that model in that city costs."
      issues={issues}
      serverError={cat.formError}
      busy={cat.saving}
      onSubmit={submit}
    >
      <div className="grid grid-2">
        <Field label="City" required>
          <Select value={cityId} onChange={(e) => setCityId(e.target.value)}>
            <option value="">Select a city…</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field
          label="Vehicle model"
          required
          hint={models.isError ? 'Could not load models — reopen the form to retry.' : undefined}
        >
          <Select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={models.isLoading}>
            <option value="">{models.isLoading ? 'Loading models…' : 'Select a model…'}</option>
            {modelList.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            {/* A plan can point at a model this deployment no longer lists; keep
                it selectable so opening the form does not silently re-target it. */}
            {modelId && !modelList.some((m) => m.id === modelId)
              ? <option value={modelId}>{row?.model_id === modelId ? 'Current model (not in the list)' : modelId}</option>
              : null}
          </Select>
        </Field>
      </div>

      <Divider />
      <div className="section-label">Fare</div>
      <div className="grid grid-2">
        <Field label="Unlock fee (€)" required>
          <Input value={unlock} onChange={(e) => setUnlock(e.target.value)} inputMode="decimal" placeholder="1.00" />
        </Field>
        <Field label="Per minute (€)" required>
          <Input value={perMin} onChange={(e) => setPerMin(e.target.value)} inputMode="decimal" placeholder="0.25" />
        </Field>
        <Field label="Pause per minute (€)" required hint="Charged while a rider has the trip on hold. 0 makes pausing free.">
          <Input value={pause} onChange={(e) => setPause(e.target.value)} inputMode="decimal" placeholder="0.10" />
        </Field>
        <Field label="Daily cap (€)" hint="Optional. Leave empty for no cap — a long ride then bills at the per-minute rate all day.">
          <Input value={dayCap} onChange={(e) => setDayCap(e.target.value)} inputMode="decimal" placeholder="no cap" />
        </Field>
      </div>
      {example !== null ? (
        <p className="muted" style={{ marginTop: -4, fontSize: 'var(--fs-sm)' }}>
          A 20-minute ride costs <strong>{formatMoney(example)}</strong> before any multiplier
          {pDayCap.ok && pDayCap.value !== null ? `, capped at ${formatMoney(pDayCap.value)} per day` : ''}.
        </p>
      ) : null}

      <Divider />
      <div className="section-label">Validity</div>
      <div className="grid grid-2">
        <Field label="Valid from" hint="Optional. Interpreted as 00:00 UTC.">
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label="Valid until" hint="Optional. Leave empty for open-ended.">
          <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
      </div>

      <Divider />
      <div className="section-label">Dynamic pricing</div>
      <Notice tone="muted">
        Multipliers are shown to the rider before they unlock. Happy hours are set here;
        demand surge is computed server-side per ride and never exceeds the cap below.
      </Notice>

      <Checkbox
        label="Apply demand surge when an area runs short of scooters"
        checked={demandOn}
        onChange={(e) => setDemandOn(e.target.checked)}
      />
      {demandOn ? (
        <div className="grid grid-2">
          <Field label="Cell size (m)" required hint="Grid the demand is measured on. Smaller reacts faster and is noisier.">
            <Input value={cellSize} onChange={(e) => setCellSize(e.target.value)} inputMode="numeric" placeholder="500" />
          </Field>
          <Field label="Surge cap (×)" required hint="Hard ceiling. A rider is never quoted more than this multiple.">
            <Input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" placeholder="1.5" />
          </Field>
        </div>
      ) : null}

      <Field label="Happy hours" hint="Windows where the per-minute rate is multiplied — below 1× to discount, above to surcharge.">
        <div className="stack" style={{ gap: 8 }}>
          {happy.length === 0 ? <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>None — the rate is flat all week.</span> : null}
          {happy.map((h, i) => (
            <div key={i} className="row-wrap" style={{ alignItems: 'center', gap: 8 }}>
              <Select value={String(h.dow)} onChange={(e) => setHH(i, { dow: Number(e.target.value) })} style={{ width: 100 }}>
                {DOWS.map((d, idx) => <option key={d} value={idx}>{d}</option>)}
              </Select>
              <Input type="time" value={h.from} onChange={(e) => setHH(i, { from: e.target.value })} style={{ width: 120 }} />
              <span className="muted">→</span>
              <Input type="time" value={h.to} onChange={(e) => setHH(i, { to: e.target.value })} style={{ width: 120 }} />
              <Input
                value={String(h.multiplier)}
                onChange={(e) => setHH(i, { multiplier: Number(e.target.value.replace(',', '.')) })}
                inputMode="decimal"
                style={{ width: 90 }}
                placeholder="0.8"
              />
              <span className="muted">×</span>
              <Button size="sm" variant="ghost" onClick={() => setHappy(happy.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              onClick={() => setHappy([...happy, { dow: 1, from: '10:00', to: '12:00', multiplier: 0.8 }])}
            >
              + Add happy hour
            </Button>
          </div>
        </div>
      </Field>
    </EditorModal>
  );
}
