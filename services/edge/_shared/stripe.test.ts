// Signature verification, tested against signatures built the way Stripe builds
// them. Written the day 12 live deliveries were rejected as `bad_signature`, to
// settle whether the fault was ours or the configured secret.
//
// Runs under `node --test`: it touches only Web Crypto, which Node 22 and Deno
// both provide. Nothing here imports a Deno API.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { verifyStripeSignature } from './stripe-signature.ts';

const SECRET = 'whsec_TpiPPvPm0F4rL9BoPngERiEF92yubhbe';
const PAYLOAD = '{"id":"evt_1","type":"charge.succeeded","data":{"object":{"id":"ch_1"}}}';

/** Exactly what Stripe does: HMAC-SHA256 over `{timestamp}.{payload}`, hex. */
async function sign(payload: string, secret: string, t: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const now = () => Math.floor(Date.now() / 1000);

test('accepts a signature built the way Stripe builds it', async () => {
  const t = now();
  const header = `t=${t},v1=${await sign(PAYLOAD, SECRET, t)}`;
  assert.deepEqual(await verifyStripeSignature(PAYLOAD, header, SECRET), { ok: true });
});

test('a secret pasted with a trailing newline still works', async () => {
  // The failure mode this exists to prevent: invisible whitespace from a copy
  // and paste, breaking every delivery forever with nothing to see.
  const t = now();
  const header = `t=${t},v1=${await sign(PAYLOAD, SECRET, t)}`;
  assert.equal((await verifyStripeSignature(PAYLOAD, header, `${SECRET}\n`)).ok, true);
  assert.equal((await verifyStripeSignature(PAYLOAD, header, `  ${SECRET}  `)).ok, true);
});

test('accepts when the header carries several v1s, as during a secret rotation', async () => {
  const t = now();
  const mine = await sign(PAYLOAD, SECRET, t);
  const other = await sign(PAYLOAD, 'whsec_someOtherEndpointSecret', t);
  // Ours first, then last — neither position may be dropped.
  assert.equal((await verifyStripeSignature(PAYLOAD, `t=${t},v1=${mine},v1=${other}`, SECRET)).ok, true);
  assert.equal((await verifyStripeSignature(PAYLOAD, `t=${t},v1=${other},v1=${mine}`, SECRET)).ok, true);
});

test('the wrong secret is reported as a digest mismatch, not something vague', async () => {
  const t = now();
  const header = `t=${t},v1=${await sign(PAYLOAD, SECRET, t)}`;
  const r = await verifyStripeSignature(PAYLOAD, header, 'whsec_aDifferentEndpointEntirely');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'digest_mismatch');
  assert.match(r.detail ?? '', /does not match/);
});

test('a stale retry is distinguished from a bad secret', async () => {
  // Stripe retries for days. Once a delivery is older than the tolerance it
  // fails legitimately, and calling that "bad secret" sends people hunting for
  // a problem that is not there.
  const t = now() - 3600;
  const header = `t=${t},v1=${await sign(PAYLOAD, SECRET, t)}`;
  const r = await verifyStripeSignature(PAYLOAD, header, SECRET);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timestamp_outside_tolerance');
  assert.match(r.detail ?? '', /retry of an old event/);
});

test('a secret that is not a whsec_ is called out on its own', async () => {
  const t = now();
  const header = `t=${t},v1=${await sign(PAYLOAD, SECRET, t)}`;
  // e.g. an API key pasted into the webhook secret field.
  const r = await verifyStripeSignature(PAYLOAD, header, 'sk_live_notASigningSecret');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'secret_not_whsec');
});

test('rejects a tampered payload signed for a different body', async () => {
  const t = now();
  const header = `t=${t},v1=${await sign(PAYLOAD, SECRET, t)}`;
  const r = await verifyStripeSignature(`${PAYLOAD} `, header, SECRET);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'digest_mismatch');
});

test('rejects missing and malformed headers distinctly', async () => {
  assert.equal((await verifyStripeSignature(PAYLOAD, null, SECRET)).reason, 'no_header');
  assert.equal((await verifyStripeSignature(PAYLOAD, 'garbage', SECRET)).reason, 'malformed_header');
  assert.equal((await verifyStripeSignature(PAYLOAD, `t=${now()}`, SECRET)).reason, 'malformed_header');
  assert.equal((await verifyStripeSignature(PAYLOAD, 'v1=abc', SECRET)).reason, 'malformed_header');
  assert.equal((await verifyStripeSignature(PAYLOAD, `t=${now()},v1=x`, '')).reason, 'secret_missing');
});
