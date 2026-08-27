// Stripe webhook signature verification.
//
// Deliberately separate from stripe.ts: that file is a REST client and reads
// STRIPE_SECRET_KEY from Deno.env, which makes it untestable outside Deno. This
// is pure Web Crypto over strings — no environment, no network — so it runs
// under `node --test` alongside the rest of the workspace.
//
// That mattered the day 12 live deliveries came back `bad_signature`: without a
// test, "is it our HMAC or their secret?" is a guess.

/**
 * Why a signature check failed. "invalid signature" on its own is unactionable —
 * a wrong secret, a pasted newline, a stale retry and a malformed header all
 * look identical from the outside, and each has a different fix.
 */
export type SignatureFailure =
  | 'no_header'
  | 'malformed_header'
  | 'secret_missing'
  | 'secret_not_whsec'
  | 'timestamp_outside_tolerance'
  | 'digest_mismatch';

export interface SignatureResult {
  ok: boolean;
  reason?: SignatureFailure;
  /** Safe to log: never contains the secret or a usable signature. */
  detail?: string;
}

/**
 * Verify a Stripe webhook signature (t + v1 scheme) using Web Crypto HMAC-SHA256.
 * Mirrors stripe.webhooks.constructEvent without the npm package.
 */
export async function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  toleranceSec = 300,
): Promise<SignatureResult> {
  if (!sigHeader) return { ok: false, reason: 'no_header' };

  // A pasted secret picks up trailing whitespace or a newline distressingly
  // often, and the result is a permanently failing endpoint with nothing
  // visibly wrong. The HMAC is over the secret's bytes, so one stray \n breaks
  // every delivery forever.
  const key64 = secret?.trim() ?? '';
  if (!key64) return { ok: false, reason: 'secret_missing' };
  if (!key64.startsWith('whsec_')) {
    // Not fatal in principle, but overwhelmingly this means the wrong value was
    // pasted — an API key, or another endpoint's secret.
    return {
      ok: false,
      reason: 'secret_not_whsec',
      detail: `configured secret is ${key64.length} chars and does not start with whsec_`,
    };
  }

  // Stripe sends `t=...,v1=...`, and MORE THAN ONE v1 during a secret rotation.
  // Taking only the last would reject a valid delivery signed with the other key.
  let t = '';
  const v1s: string[] = [];
  for (const kv of sigHeader.split(',')) {
    const idx = kv.indexOf('=');
    if (idx < 0) continue;
    const k = kv.slice(0, idx).trim();
    const v = kv.slice(idx + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1s.push(v);
  }
  if (!t || v1s.length === 0) return { ok: false, reason: 'malformed_header' };

  // Replay protection. Stripe retries a failed delivery for days, so a retry of
  // an old event legitimately fails this — worth saying out loud rather than
  // reporting as a bad secret and sending someone hunting.
  const now = Math.floor(Date.now() / 1000);
  const skew = now - Number(t);
  if (Math.abs(skew) > toleranceSec) {
    return {
      ok: false,
      reason: 'timestamp_outside_tolerance',
      detail: `event signed ${skew}s ago, tolerance ${toleranceSec}s — a retry of an old event, not a bad secret`,
    };
  }

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  if (v1s.some((v1) => timingSafeEqual(expected, v1))) return { ok: true };

  return {
    ok: false,
    reason: 'digest_mismatch',
    // First 8 hex chars only: enough to tell "completely different" from
    // "suspiciously close", useless for forging anything.
    detail:
      `computed ${expected.slice(0, 8)}… vs ${v1s.map((v) => v.slice(0, 8)).join('/')}… ` +
      `— the endpoint's signing secret does not match this one`,
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
