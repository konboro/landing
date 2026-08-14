// Pre-transmission controls.
//
// A receipt sent to AADE cannot be un-sent — correcting one means issuing a
// credit note and explaining yourself. So every cheap check that could catch a
// bad document happens here, before the POST, and a violation parks the row for
// a human instead of transmitting.
//
// This is the layer the legacy pipeline had none of: it would have filed a
// EUR 40,000 receipt, a receipt dated in 2027, or a receipt numbered below the
// series floor without hesitating.

import type { ReceiptInput } from './types.ts';

export interface GuardContext {
  maxGrossCents: number;
  /** Numbers below this belong to the legacy system and must never be reissued. */
  floorAa: number;
  /** Reject receipts dated further ahead than this (clock skew tolerance). */
  maxFutureDays?: number;
  /** Reject receipts older than this — myDATA has transmission deadlines. */
  maxAgeDays?: number;
  /** Injectable for tests. */
  now?: Date;
}

export interface GuardResult {
  ok: boolean;
  violations: string[];
}

const DAY_MS = 86_400_000;

export function checkReceipt(r: ReceiptInput, ctx: GuardContext): GuardResult {
  const v: string[] = [];
  const now = ctx.now ?? new Date();

  if (r.grossCents <= 0) v.push(`gross must be positive, got ${r.grossCents}`);
  if (r.netCents + r.vatCents !== r.grossCents) {
    v.push(`summary does not reconcile: ${r.netCents} + ${r.vatCents} != ${r.grossCents}`);
  }
  if (r.grossCents > ctx.maxGrossCents) {
    v.push(
      `gross ${(r.grossCents / 100).toFixed(2)} exceeds the ceiling ` +
        `${(ctx.maxGrossCents / 100).toFixed(2)} — file it by hand after checking it is real`,
    );
  }
  if (r.currency !== 'EUR') v.push(`currency must be EUR for a myDATA series, got ${r.currency}`);
  if (r.aa < ctx.floorAa) {
    v.push(`aa ${r.aa} is below the series floor ${ctx.floorAa} — that number was already issued`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.issueDate)) {
    v.push(`issueDate must be YYYY-MM-DD, got ${r.issueDate}`);
  } else {
    const issued = new Date(`${r.issueDate}T00:00:00Z`);
    const ageDays = (now.getTime() - issued.getTime()) / DAY_MS;
    const maxFuture = ctx.maxFutureDays ?? 1;
    const maxAge = ctx.maxAgeDays ?? 90;
    if (ageDays < -maxFuture) v.push(`issueDate ${r.issueDate} is in the future`);
    if (ageDays > maxAge) v.push(`issueDate ${r.issueDate} is ${Math.floor(ageDays)} days old`);
  }

  const t = r.tax;
  if (!t.issuer_vat || !/^\d{9}$/.test(t.issuer_vat)) {
    v.push(`issuer VAT must be 9 digits, got ${JSON.stringify(t.issuer_vat)}`);
  }
  if (!t.invoice_type) v.push('invoice_type is required');
  if (!t.classification_type) v.push('classification_type is required');
  if (!(t.vat_rate > 0 && t.vat_rate < 1)) v.push(`vat_rate out of range: ${t.vat_rate}`);

  return { ok: v.length === 0, violations: v };
}
