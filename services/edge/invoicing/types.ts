// Adapter seam for e-invoicing. docs/05 asked for this interface; the
// implementation behind it is AADE-direct (see docs/18-mydata.md for why).
//
// Nothing in this directory may import Deno APIs — these modules are unit
// tested under `node --test`, and the transport takes `fetch` by injection.

/** The tax treatment applied to a receipt, snapshotted per row. */
export interface TaxProfile {
  vat_rate: number; // 0.24
  issuer_vat: string; // '802160515'
  branch: number; // 1
  invoice_type: string; // '11.2' — retail receipt for services
  vat_category: number; // 1 — 24%
  payment_method_type: number; // 6
  classification_type: string; // 'E3_561_003'
  classification_category: string; // 'category1_3'
}

export interface ReceiptInput {
  series: string; // 'ΑΠΥ'
  aa: number;
  issueDate: string; // YYYY-MM-DD
  grossCents: number;
  netCents: number;
  vatCents: number;
  currency: string; // 'EUR'
  tax: TaxProfile;
  paymentMethodInfo?: string; // 'Card'
}

export type SendOutcome =
  | { ok: true; mark: string; uid?: string; authCode?: string; raw: string }
  | { ok: false; error: string; retryable: boolean; raw: string; httpStatus?: number };

export interface InvoicingAdapter {
  /** Build the document that would be transmitted, without transmitting it. */
  render(input: ReceiptInput): string;
  /** Transmit and interpret the response. */
  send(input: ReceiptInput): Promise<SendOutcome>;
}

export interface AadeCredentials {
  userId: string; // aade-user-id
  subscriptionKey: string; // ocp-apim-subscription-key
}

/** Which AADE endpoint a given mode talks to. `dry_run` talks to none. */
export const AADE_ENDPOINTS = {
  live: 'https://mydatapi.aade.gr/myDATA/SendInvoices',
  sandbox: 'https://mydataapidev.aade.gr/myDataProvider/SendInvoices',
} as const;

export type SendMode = 'dry_run' | 'sandbox' | 'live';
