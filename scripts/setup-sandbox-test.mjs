// scripts/setup-sandbox-test.mjs
//
// One-time setup so the e2e trip-charge harness can run against a FRESH Stripe
// sandbox. Run this yourself (your sandbox secret key stays in your own env — it
// is never printed and never leaves your machine except to Stripe/Supabase).
//
// It does four things, all idempotent:
//   1. Guards that the key is a TEST/sandbox key (aborts on sk_live_).
//   2. Sets the Supabase project secret STRIPE_SECRET_KEY = your sandbox key, so
//      the deployed edge functions charge inside the same sandbox as the card.
//   3. Seeds the fixture rider in the sandbox: creates a Stripe customer and
//      attaches the standard test card (pm_card_visa → 4242), replacing the stale
//      rows left from the previous Stripe environment.
//   4. Sets a known password on the fixture rider so the harness can sign in.
//
// USAGE (env):
//   STRIPE_SECRET_KEY = sk_test_...   (your NEW sandbox secret key)
//   MGMT_TOKEN        = sbp_...       (Supabase management PAT)
//   PROJECT_REF       = pyferakmgtafifffqjat
//   RIDER_ID          = b160cc4f-2a0b-4290-8e1f-051a556f37ab
//   RIDER_EMAIL       = test.rider@penny.rent
//   RIDER_PASSWORD    = PennyE2E!test123
//   SET_PROJECT_SECRET = 1            (default 1; set 0 to skip step 2)
//
//   node scripts/setup-sandbox-test.mjs

const {
  STRIPE_SECRET_KEY, MGMT_TOKEN, PROJECT_REF,
  RIDER_ID, RIDER_EMAIL, RIDER_PASSWORD, SET_PROJECT_SECRET = '1',
} = process.env;

function need(n, v) { if (!v) { console.error(`missing env ${n}`); process.exit(2); } return v; }
need('STRIPE_SECRET_KEY', STRIPE_SECRET_KEY); need('MGMT_TOKEN', MGMT_TOKEN);
need('PROJECT_REF', PROJECT_REF); need('RIDER_ID', RIDER_ID);
need('RIDER_EMAIL', RIDER_EMAIL); need('RIDER_PASSWORD', RIDER_PASSWORD);

// SAFETY: never operate a live key with this script.
if (!/^(sk|rk)_test_/.test(STRIPE_SECRET_KEY)) {
  console.error('REFUSING: STRIPE_SECRET_KEY is not a test/sandbox key (must start sk_test_ / rk_test_).');
  process.exit(2);
}

const log = (...a) => console.log(...a);
const one = (rows) => (Array.isArray(rows) ? rows[0] : rows);

/** Stripe REST call, form-encoded — same shape as services/edge/_shared/stripe.ts. */
function toForm(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') parts.push(toForm(v, key));
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

async function main() {
  log('══ sandbox setup for e2e ══\n');

  // 1. Sanity: confirm the key works and report the account.
  const acct = await stripe('GET', '/account');
  log(`• stripe: key OK — account ${acct.id} (test/sandbox key)`);

  // 2. Point the deployed edge functions at this sandbox key.
  if (SET_PROJECT_SECRET === '1') {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ name: 'STRIPE_SECRET_KEY', value: STRIPE_SECRET_KEY }]),
    });
    if (!res.ok) throw new Error(`set project secret failed ${res.status}: ${await res.text()}`);
    log('• supabase: project secret STRIPE_SECRET_KEY updated to the sandbox key');
  } else {
    log('• supabase: SKIPPED project secret update (SET_PROJECT_SECRET=0)');
  }

  // 3. Replace any stale customer / card rows for the fixture rider.
  await sql(`delete from payment_methods where user_id='${RIDER_ID}'`);
  await sql(`delete from stripe_customers where user_id='${RIDER_ID}'`);
  log('• db: cleared stale customer/card rows for the fixture rider');

  const cust = await stripe('POST', '/customers', {
    email: RIDER_EMAIL, phone: '306941000001', metadata: { user_id: RIDER_ID },
  });
  await sql(`insert into stripe_customers(user_id, stripe_customer_id) values('${RIDER_ID}','${cust.id}')`);
  log(`• stripe+db: customer ${cust.id} created & mapped`);

  // Attach the standard test card (4242). Charges succeed off-session.
  const pm = await stripe('POST', '/payment_methods/pm_card_visa/attach', { customer: cust.id });
  await stripe('POST', `/customers/${cust.id}`, { invoice_settings: { default_payment_method: pm.id } });
  const c = pm.card ?? {};
  await sql(`insert into payment_methods(user_id, stripe_pm_id, brand, last4, exp, status, is_default)
             values('${RIDER_ID}','${pm.id}','${c.brand ?? 'visa'}','${c.last4 ?? '4242'}',
                    '${String(c.exp_month ?? 12).padStart(2, '0')}/${c.exp_year ?? 2030}','active', true)`);
  log(`• stripe+db: card ${pm.id} (${c.brand ?? 'visa'} ••${c.last4 ?? '4242'}) attached & set default`);

  // 4. Password on the fixture rider so the harness can sign in.
  await sql(`create extension if not exists pgcrypto with schema extensions`);
  await sql(`update auth.users
               set email='${RIDER_EMAIL}',
                   email_confirmed_at=coalesce(email_confirmed_at, now()),
                   encrypted_password=extensions.crypt('${RIDER_PASSWORD}', extensions.gen_salt('bf')),
                   updated_at=now()
             where id='${RIDER_ID}'`);
  log('• auth: fixture rider password set & email confirmed');

  log('\n✅ setup complete — now run scripts/e2e-trip-charge.mjs');
}

main().catch((e) => { console.error('\n❌ setup ERROR:', e.message); process.exit(1); });
