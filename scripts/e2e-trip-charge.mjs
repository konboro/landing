// scripts/e2e-trip-charge.mjs
//
// Headless end-to-end proof of the money path against the LIVE edge functions:
//
//   trips-start  →  (simulated device unlock ACK)  →  trips-end  →  Stripe card capture
//
// This is the first "charged trip" harness. It drives the real deployed edge
// functions as an authenticated rider, simulates the one thing a rider cannot do
// itself — the gateway's DOUT unlock ACK — by calling the same SECURITY DEFINER
// RPC the gateway calls (public.trip_unlock_confirmed), and verifies the charge,
// the ledger balance, and the trip status afterwards.
//
// SAFE BY CONSTRUCTION:
//   - Stripe stays in whatever mode the project key is (expected: TEST).
//   - myDATA stays in dry_run (receipts enqueue, nothing is transmitted).
//   - The fixture rider's wallet is parked to €0 before the charge so the fare
//     lands on the CARD (the path we want to prove), then restored afterwards.
//   - Any half-finished trip from a previous run is cleaned up first.
//
// USAGE (all via env):
//   SUPABASE_URL   = https://<ref>.supabase.co
//   ANON_KEY       = sb_publishable_... (or eyJ... anon)
//   EDGE_BASE      = https://<ref>.supabase.co/functions/v1
//   PROJECT_REF    = <ref>
//   MGMT_TOKEN     = sbp_... (Supabase management API PAT — used ONLY for the
//                    sim-ACK RPC, the wallet park/restore, and verification SQL)
//   VEHICLE_CODE   = PNY-1001
//   LNG, LAT       = start/end coordinates (inside an operating zone)
//   RIDER_ID       = auth user id of the fixture rider
//   Auth — ONE of:
//     RIDER_JWT               = a rider access_token (from the app or a sign-in), OR
//     RIDER_EMAIL + RIDER_PASSWORD  = email/password for a GoTrue password grant
//
// Nothing is hardcoded; run with `node scripts/e2e-trip-charge.mjs`.

const {
  SUPABASE_URL, ANON_KEY, EDGE_BASE, PROJECT_REF, MGMT_TOKEN,
  VEHICLE_CODE, LNG, LAT, RIDER_ID, RIDER_JWT, RIDER_EMAIL, RIDER_PASSWORD,
} = process.env;

function need(name, v) { if (!v) { console.error(`missing env ${name}`); process.exit(2); } return v; }
need('SUPABASE_URL', SUPABASE_URL); need('ANON_KEY', ANON_KEY); need('EDGE_BASE', EDGE_BASE);
need('PROJECT_REF', PROJECT_REF); need('MGMT_TOKEN', MGMT_TOKEN);
need('VEHICLE_CODE', VEHICLE_CODE); need('LNG', LNG); need('LAT', LAT); need('RIDER_ID', RIDER_ID);

const lng = Number(LNG), lat = Number(LAT);
const log = (...a) => console.log(...a);
const money = (c) => `€${(c / 100).toFixed(2)}`;

/** Run read/write SQL through the Supabase management API. */
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

/** Call a deployed edge function as the rider. */
async function edge(fn, body, jwt) {
  const res = await fetch(`${EDGE_BASE}/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${fn} → ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

async function signIn() {
  if (RIDER_JWT) { log('• auth: using supplied RIDER_JWT'); return RIDER_JWT; }
  need('RIDER_EMAIL', RIDER_EMAIL); need('RIDER_PASSWORD', RIDER_PASSWORD);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: RIDER_EMAIL, password: RIDER_PASSWORD }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`sign-in failed: ${JSON.stringify(j)}`);
  log('• auth: signed in via password grant');
  return j.access_token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = (rows) => (Array.isArray(rows) ? rows[0] : rows);

async function main() {
  log('══ Penny e2e: reserve→unlock(sim)→end→charge ══\n');

  // 0. Sign in as the rider.
  const jwt = await signIn();

  // 1. Clean up any half-finished trip from a previous run, and make the vehicle
  //    look like a live, freshly-reporting device (the "sim device is online" part).
  await sql(`
    do $$
    declare t record;
    begin
      for t in select id, vehicle_id from trips
               where user_id = '${RIDER_ID}'
                 and status in ('reserved','unlocking','active','paused','ending')
      loop
        perform trip_transition(t.id, 'aborted', 'system', '{"reason":"e2e cleanup"}'::jsonb);
        update vehicles set status='available' where id = t.vehicle_id;
      end loop;
    end $$;`);
  await sql(`
    update vehicle_state vs
       set last_seen = now(), session_online = true, soc_pct = greatest(coalesce(soc_pct,85),85)
      from vehicles v
     where v.code = '${VEHICLE_CODE}' and v.id = vs.vehicle_id;`);
  await sql(`update vehicles set status='available' where code='${VEHICLE_CODE}' and status<>'available';`);
  log('• prep: cleaned stale trips, vehicle marked online & available');

  // 2. Park the rider's wallet to €0 so the fare is charged to the CARD, not the
  //    wallet. Recorded so we can restore it exactly afterwards. Balanced pair
  //    (Hard Rule #2) against the shared bonus account.
  const wRow = one(await sql(
    `select coalesce(balance_cents,0) as bal from v_user_wallet_balance where user_id='${RIDER_ID}'`,
  )) ?? { bal: 0 };
  const walletBefore = Number(wRow.bal);
  if (walletBefore > 0) {
    const walletAcc = one(await sql(
      `select id from ledger_accounts where kind='user_wallet' and owner_id='${RIDER_ID}'`,
    )).id;
    let bonusRow = one(await sql(`select id from ledger_accounts where kind='bonus' and owner_id is null`));
    if (!bonusRow) bonusRow = one(await sql(
      `insert into ledger_accounts(kind, owner_id) values('bonus', null) returning id`));
    const bonusAcc = bonusRow.id;
    const txn = crypto.randomUUID();
    await sql(`select post_ledger('${txn}'::uuid, '${JSON.stringify([
      { account_id: walletAcc, delta_cents: walletBefore, memo: 'e2e: park wallet' },
      { account_id: bonusAcc, delta_cents: -walletBefore, memo: 'e2e: park wallet' },
    ])}'::jsonb)`);
    log(`• wallet: parked ${money(walletBefore)} → €0.00 (will restore)`);
  } else {
    log('• wallet: already €0.00');
  }

  // 3. START — freezes pricing, creates trip(unlocking), enqueues unlock command.
  const clientCommandId = `e2e-${Date.now()}`;
  const started = await edge('trips-start', {
    vehicle_code: VEHICLE_CODE, client_command_id: clientCommandId,
    pos: [lng, lat], addon_insurance: false,
  }, jwt);
  const tripId = started.trip_id;
  log(`• trips-start → trip ${tripId} (${started.status}), pricing frozen:`, JSON.stringify(started.pricing_snapshot));

  // 4. SIM DEVICE UNLOCK ACK — exactly what the gateway does on a DOUT ACK.
  await sql(`select public.trip_unlock_confirmed('${tripId}'::uuid)`);
  const afterAck = one(await sql(`select status, started_at from trips where id='${tripId}'`));
  log(`• sim unlock ACK → trip is now '${afterAck.status}', started_at=${afterAck.started_at}`);
  if (afterAck.status !== 'active') throw new Error(`expected active, got ${afterAck.status}`);

  // 5. Ride a few seconds so at least one billable minute accrues.
  log('• riding ~6s…'); await sleep(6000);

  // 6. END — zone validation, price from frozen snapshot, settle (wallet→card),
  //    off-session PaymentIntent capture, ledger, myDATA enqueue (dry_run).
  const ended = await edge('trips-end', {
    trip_id: tripId, pos: [lng, lat],
    end_photo_url: 'https://example.com/e2e-end-photo.jpg', rating: 5, tags: [],
  }, jwt);
  log(`• trips-end → status='${ended.status}', cost=${money(ended.cost_cents)}`);

  // 7. VERIFY the money landed and the books balance.
  const pay = one(await sql(
    `select status, amount_cents, kind, stripe_pi_id, failure_code from payments where trip_id='${tripId}'`,
  ));
  const ledgerZero = one(await sql(`select coalesce(sum(delta_cents),0) as s from ledger_entries`)).s;
  const receipt = one(await sql(
    `select aa, status, mode from mydata_submissions where payment_id in
       (select id from payments where trip_id='${tripId}') order by created_at desc limit 1`,
  ));

  // 8. Restore the wallet to where we found it.
  if (walletBefore > 0) {
    const walletAcc = one(await sql(
      `select id from ledger_accounts where kind='user_wallet' and owner_id='${RIDER_ID}'`)).id;
    const bonusAcc = one(await sql(
      `select id from ledger_accounts where kind='bonus' and owner_id is null`)).id;
    const txn = crypto.randomUUID();
    await sql(`select post_ledger('${txn}'::uuid, '${JSON.stringify([
      { account_id: walletAcc, delta_cents: -walletBefore, memo: 'e2e: restore wallet' },
      { account_id: bonusAcc, delta_cents: walletBefore, memo: 'e2e: restore wallet' },
    ])}'::jsonb)`);
    log(`• wallet: restored ${money(walletBefore)}`);
  }

  log('\n══ RESULT ══');
  log(`trip          : ${tripId}`);
  log(`trip status   : ${ended.status}`);
  log(`fare          : ${money(ended.cost_cents)}`);
  log(`payment       : ${pay?.status}  kind=${pay?.kind}  pi=${pay?.stripe_pi_id ?? '—'}${pay?.failure_code ? `  fail=${pay.failure_code}` : ''}`);
  log(`ledger sum    : ${ledgerZero}  ${String(ledgerZero) === '0' ? '(balanced ✅)' : '(UNBALANCED ❌)'}`);
  log(`myDATA receipt: ${receipt ? `AA ${receipt.aa}  ${receipt.status}/${receipt.mode}` : '— (none enqueued)'}`);

  const ok = ended.status === 'charged' && pay?.status === 'succeeded' && pay?.stripe_pi_id && String(ledgerZero) === '0';
  log(`\n${ok ? '✅ PASS — first charged trip on the card, books balanced.' : '⚠️  Review above — charge did not complete as expected.'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('\n❌ ERROR:', e.message); process.exit(1); });
