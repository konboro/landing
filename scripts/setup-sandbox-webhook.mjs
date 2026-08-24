// scripts/setup-sandbox-webhook.mjs
//
// Wires the Stripe SANDBOX webhook to the deployed payments-webhook function and
// verifies it end-to-end. Run it yourself (secret key stays in your own env).
//
// It:
//   1. Guards the key is a test/sandbox key.
//   2. Deletes any existing endpoint pointing at our payments-webhook URL, then
//      creates a fresh one subscribed to exactly the events the function handles.
//   3. Sets the Supabase project secret STRIPE_WEBHOOK_SECRET = the endpoint's
//      signing secret (so signature verification matches).
//   4. VERIFIES live: fires a real setup_intent.succeeded and confirms the event
//      lands in stripe_events (i.e. Stripe delivered it AND the signature passed).
//
// USAGE (env):
//   STRIPE_SECRET_KEY = sk_test_...        (your sandbox secret key)
//   MGMT_TOKEN        = sbp_...
//   PROJECT_REF       = pyferakmgtafifffqjat
//   WEBHOOK_URL       = https://pyferakmgtafifffqjat.supabase.co/functions/v1/payments-webhook
//   RIDER_ID          = b160cc4f-2a0b-4290-8e1f-051a556f37ab   (for the verify SetupIntent)
//   VERIFY            = 1                    (default 1; set 0 to skip the live test)
//
//   node scripts/setup-sandbox-webhook.mjs

const {
  STRIPE_SECRET_KEY, MGMT_TOKEN, PROJECT_REF, WEBHOOK_URL, RIDER_ID, VERIFY = '1',
} = process.env;
function need(n, v) { if (!v) { console.error(`missing env ${n}`); process.exit(2); } return v; }
need('STRIPE_SECRET_KEY', STRIPE_SECRET_KEY); need('MGMT_TOKEN', MGMT_TOKEN);
need('PROJECT_REF', PROJECT_REF); need('WEBHOOK_URL', WEBHOOK_URL);
if (!/^(sk|rk)_test_/.test(STRIPE_SECRET_KEY)) {
  console.error('REFUSING: not a test/sandbox key.'); process.exit(2);
}

const EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.dispute.created',
  'setup_intent.succeeded',
];
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = (r) => (Array.isArray(r) ? r[0] : r);

function toForm(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`));
    else if (typeof v === 'object') parts.push(toForm(v, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join('&');
}
async function stripe(method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' && body ? toForm(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`stripe ${path} ${res.status}: ${j?.error?.message ?? JSON.stringify(j)}`);
  return j;
}
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${t}`);
  return JSON.parse(t);
}
async function setProjectSecret(name, value) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name, value }]),
  });
  if (!res.ok) throw new Error(`set secret ${name} failed ${res.status}: ${await res.text()}`);
}

async function main() {
  log('══ sandbox webhook setup ══\n');

  // 1. Remove stale endpoints with the same URL (their secrets are unrecoverable).
  const existing = await stripe('GET', '/webhook_endpoints?limit=100');
  for (const ep of existing.data ?? []) {
    if (ep.url === WEBHOOK_URL) { await stripe('POST', `/webhook_endpoints/${ep.id}/`, { disabled: true }).catch(() => {});
      await fetch(`https://api.stripe.com/v1/webhook_endpoints/${ep.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } });
      log(`• removed stale endpoint ${ep.id}`);
    }
  }

  // 2. Create the endpoint.
  const ep = await stripe('POST', '/webhook_endpoints', {
    url: WEBHOOK_URL, enabled_events: EVENTS, description: 'Penny payments-webhook (sandbox)',
  });
  log(`• created endpoint ${ep.id}  events=[${EVENTS.join(', ')}]`);

  // 3. Store the signing secret so the function can verify.
  await setProjectSecret('STRIPE_WEBHOOK_SECRET', ep.secret);
  log('• project secret STRIPE_WEBHOOK_SECRET set to the endpoint signing secret');

  if (VERIFY !== '1') { log('\n✅ endpoint wired (verification skipped).'); return; }

  // 4. Live verification: fire setup_intent.succeeded, confirm it lands + verifies.
  need('RIDER_ID', RIDER_ID);
  const cust = one(await sql(`select stripe_customer_id from stripe_customers where user_id='${RIDER_ID}'`));
  if (!cust) throw new Error('no stripe customer for RIDER_ID — run setup-sandbox-test.mjs first');
  const before = Number(one(await sql(`select count(*) c from stripe_events where type='setup_intent.succeeded'`)).c);

  log('• firing a test SetupIntent (secret propagation ~a few seconds)…');
  await sleep(4000); // let the new secret propagate to the edge runtime
  const si = await stripe('POST', '/setup_intents', {
    customer: cust.stripe_customer_id, payment_method: 'pm_card_visa',
    confirm: true, usage: 'off_session', payment_method_types: ['card'],
  });
  log(`• setup_intent ${si.id} status=${si.status}`);

  let seen = false;
  for (let i = 0; i < 12 && !seen; i++) {
    await sleep(2500);
    const now = Number(one(await sql(`select count(*) c from stripe_events where type='setup_intent.succeeded'`)).c);
    if (now > before) seen = true;
  }

  if (seen) {
    log('\n✅ VERIFIED — Stripe delivered setup_intent.succeeded and the signature passed (event stored).');
    log('   The async flows are now live: card-add from the app, failed-payment→debt, disputes.');
  } else {
    log('\n⚠️  Endpoint created & secret set, but the test event did not appear in stripe_events within ~30s.');
    log('   Check the endpoint\'s recent deliveries in the Stripe dashboard (Developers → Webhooks).');
    process.exit(1);
  }
}
main().catch((e) => { console.error('\n❌ webhook setup ERROR:', e.message); process.exit(1); });
