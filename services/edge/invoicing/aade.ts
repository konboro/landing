// AADE myDATA transport.
//
// Replaces invoice_sender.py. Behavioural differences that matter:
//   * dry_run cannot transmit — enforced here, not only by the caller.
//   * A non-200 reads the RESPONSE for errors. The legacy code read its own
//     request document, which is why all 40 recorded failures said "Unkown Error".
//   * Failures are classified retryable / permanent instead of being dropped.
//   * A network timeout is a distinct, retryable outcome rather than an
//     unhandled exception that returned 500 to Stripe and burned an AA number.

import { buildInvoicesDoc } from './xml.ts';
import { isRetryable, parseAadeResponse } from './parse.ts';
import { AADE_ENDPOINTS } from './types.ts';
import type { AadeCredentials, InvoicingAdapter, ReceiptInput, SendMode, SendOutcome } from './types.ts';

export interface AadeAdapterOptions {
  mode: SendMode;
  credentials: AadeCredentials;
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class AadeAdapter implements InvoicingAdapter {
  private readonly mode: SendMode;
  private readonly creds: AadeCredentials;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: AadeAdapterOptions) {
    this.mode = opts.mode;
    this.creds = opts.credentials;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  render(input: ReceiptInput): string {
    return buildInvoicesDoc(input);
  }

  async send(input: ReceiptInput): Promise<SendOutcome> {
    const xml = this.render(input);

    // Control, not an assertion: a dry-run row must be incapable of reaching
    // AADE even if a worker bug routes it here.
    if (this.mode === 'dry_run') {
      return {
        ok: false,
        error: 'dry_run: document rendered, not transmitted',
        retryable: false,
        raw: xml,
      };
    }

    if (!this.creds.userId || !this.creds.subscriptionKey) {
      return { ok: false, error: 'AADE credentials are not configured', retryable: true, raw: '' };
    }

    const url = AADE_ENDPOINTS[this.mode];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

    try {
      const res = await this.doFetch(url, {
        method: 'POST',
        headers: {
          'aade-user-id': this.creds.userId,
          'ocp-apim-subscription-key': this.creds.subscriptionKey,
          'content-type': 'application/xml',
        },
        body: xml,
        signal: ctrl.signal,
      });

      const body = await res.text();
      const parsed = parseAadeResponse(body);

      if (res.ok && parsed.ok && parsed.mark) {
        return { ok: true, mark: parsed.mark, uid: parsed.uid, authCode: parsed.authCode, raw: body };
      }

      const detail = parsed.errorMessage ?? `HTTP ${res.status}`;
      return {
        ok: false,
        error: parsed.errorCode ? `${parsed.errorCode}: ${detail}` : detail,
        retryable: isRetryable(res.status, parsed),
        raw: body,
        httpStatus: res.status,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        error: aborted ? `AADE timed out after ${this.timeoutMs}ms` : `transport error: ${msg}`,
        retryable: true, // never reached AADE, or we cannot tell — safe to retry
        raw: '',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
