// Minimal Stripe REST client via fetch + form encoding — NO stripe npm dependency.
// Calls https://api.stripe.com/v1 directly. Also verifies webhook signatures.
import { EdgeError } from './responses.ts';

const STRIPE_BASE = 'https://api.stripe.com/v1';

function secretKey(): string {
  const k = Deno.env.get('STRIPE_SECRET_KEY');
  if (!k) throw new EdgeError('config_error', 'STRIPE_SECRET_KEY not set', 500);
  return k;
}

/** Encode a nested object into Stripe's bracketed form syntax. */
export function toForm(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) {
      parts.push(toForm(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(toForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

export async function stripe<T = Record<string, unknown>>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const url = method === 'GET' && body
    ? `${STRIPE_BASE}${path}?${toForm(body)}`
    : `${STRIPE_BASE}${path}`;

  const res = await fetch(url, {
    method,
    headers,
    body: method === 'POST' && body ? toForm(body) : undefined,
  });
  const jsonBody = await res.json();
  if (!res.ok) {
    const msg = jsonBody?.error?.message ?? `stripe ${res.status}`;
    const code = jsonBody?.error?.code ?? 'stripe_error';
    throw new EdgeError(code, msg, res.status === 402 ? 402 : 502);
  }
  return jsonBody as T;
}

// Signature verification lives in ./stripe-signature.ts — it is pure Web
// Crypto with no Deno dependency, so it can be unit tested under node.
export { verifyStripeSignature } from './stripe-signature.ts';
export type { SignatureFailure, SignatureResult } from './stripe-signature.ts';

