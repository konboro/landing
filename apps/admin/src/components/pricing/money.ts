// Money crosses the pricing forms exactly twice: cents come out of the database
// and become euros in an input, then euros go back to cents on save.
//
// Both directions work on the decimal STRING, never through a float. The obvious
// `Math.round(parseFloat(s) * 100)` is right for most inputs and quietly wrong
// for others — `8.115 * 100` is 811.4999999999999 — and a cent lost here is a
// cent lost on every unlock for the life of the plan. Anything that is not an
// exact, non-negative amount is REFUSED rather than rounded into a price nobody
// typed.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** cents → the string an operator edits. `null` (no day cap) → empty. */
export function centsToEuros(cents: number | null | undefined): string {
  if (cents == null) return '';
  const abs = Math.abs(Math.trunc(cents));
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Parses "1", "1.5", "1,50" (Greek keyboards type a comma) into cents.
 * Rejects negatives outright: there is no such thing as a negative unlock fee,
 * and a minus sign that reached the DB would be a credit granted on every ride.
 */
export function eurosToCents(raw: string): Parsed<number> {
  const s = raw.trim().replace(',', '.');
  if (!s) return { ok: false, error: 'is required' };
  if (s.startsWith('-')) return { ok: false, error: 'cannot be negative' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return { ok: false, error: 'must be an amount in euros with at most 2 decimals, e.g. 1.50' };
  }
  const [whole, frac] = s.split('.');
  return { ok: true, value: Number(whole) * 100 + Number((frac ?? '').padEnd(2, '0')) };
}

/** Same as `eurosToCents` but an empty string means "not set" (optional caps). */
export function optionalEurosToCents(raw: string): Parsed<number | null> {
  if (!raw.trim()) return { ok: true, value: null };
  const r = eurosToCents(raw);
  return r.ok ? { ok: true, value: r.value } : r;
}

/** Whole counts — minutes, days, metres. `min` is inclusive. */
export function parseCount(raw: string, min: number): Parsed<number> {
  const s = raw.trim();
  if (!s) return { ok: false, error: 'is required' };
  if (!/^\d+$/.test(s)) return { ok: false, error: 'must be a whole number' };
  const n = Number(s);
  if (n < min) return { ok: false, error: `must be at least ${min}` };
  return { ok: true, value: n };
}

/** Multipliers ("1.4×"). Bounded because a typo'd 14 would be a 14× surge. */
export function parseMultiplier(raw: string, min: number, max: number): Parsed<number> {
  const s = raw.trim().replace(',', '.');
  if (!s) return { ok: false, error: 'is required' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'must be a number like 1.4' };
  const n = Number(s);
  if (n < min || n > max) return { ok: false, error: `must be between ${min} and ${max}` };
  return { ok: true, value: n };
}

/**
 * Penalty escalation tiers, entered as "10, 20, 40" euros.
 *
 * Ascending is not cosmetic: the tiers are indexed by how many times the rider
 * has already offended, so a descending pair means the second offence costs less
 * than the first.
 */
export function parseTiers(raw: string): Parsed<number[]> {
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return { ok: false, error: 'needs at least one tier' };
  const cents: number[] = [];
  for (const part of parts) {
    const r = eurosToCents(part);
    if (!r.ok) return { ok: false, error: `tier “${part}” ${r.error}` };
    cents.push(r.value);
  }
  for (let i = 1; i < cents.length; i++) {
    if (cents[i]! <= cents[i - 1]!) {
      return { ok: false, error: 'must ascend — each offence has to cost more than the one before' };
    }
  }
  return { ok: true, value: cents };
}

/** cents[] → "10.00, 20.00, 40.00" for the tiers input. */
export function tiersToEuros(tiers: number[] | null | undefined): string {
  return (tiers ?? []).map((t) => centsToEuros(t)).join(', ');
}
