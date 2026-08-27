// Money for myDATA. Everything is integer cents until the moment it is
// serialised, and VAT is always the remainder.
//
// The legacy implementation rounded net and VAT independently, from a value that
// mixed cents and euros:
//
//     net = round(amount_cents / 1.24, 2)      // 2dp of *cents*
//     vat = amount_cents - net                 // cents minus that
//     ...both then divided by 100 and printed to 2dp
//
// It happened to reconcile for the amounts Penny actually charges, but nothing
// in it guaranteed that, and AADE rejects a document whose summary does not add
// up. Taking VAT as the remainder makes net + vat = gross an identity.

export interface VatSplit {
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/**
 * Split a gross amount into net + VAT at the given rate.
 * VAT is the remainder, so the three values always reconcile exactly.
 */
export function splitGross(grossCents: number, vatRate: number): VatSplit {
  if (!Number.isInteger(grossCents)) {
    throw new Error(`splitGross: grossCents must be an integer, got ${grossCents}`);
  }
  if (grossCents < 0) throw new Error(`splitGross: grossCents must be >= 0, got ${grossCents}`);
  if (!(vatRate >= 0) || vatRate >= 1) {
    throw new Error(`splitGross: vatRate must be in [0, 1), got ${vatRate}`);
  }
  const netCents = Math.round(grossCents / (1 + vatRate));
  return { netCents, vatCents: grossCents - netCents, grossCents };
}

/** Cents → the fixed 2dp decimal string myDATA expects ("24.19"). */
export function formatAmount(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatAmount: expected integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
