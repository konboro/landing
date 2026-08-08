// admin-charge — staff manually charges a user off-session. Hard Rule #8: reason is
// MANDATORY. Flow: permission check -> off-session PI -> balanced ledger -> audit_log ->
// user notification with breakdown + appeal link.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num, strArray } from '../../_shared/validate.ts';
import { stripe } from '../../_shared/stripe.ts';
import { ensureStripeCustomer } from '../../_shared/customers.ts';
import { accountId, postLedger } from '../../_shared/ledger.ts';
import { writeAudit, notifyUser } from '../../_shared/audit.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'payments.charge');

  const body = await readJson(req);
  const targetUser = str(body, 'user_id')!;
  const amount = num(body, 'amount_cents')!;
  const kindInput = str(body, 'kind')!;                 // penalty | damage | other
  const reason = str(body, 'reason')!;                  // MANDATORY (Hard Rule #8)
  const evidence = strArray(body, 'evidence_urls') ?? [];
  if (amount <= 0) throw new EdgeError('bad_request', 'amount_cents must be > 0', 400);
  if (reason.trim().length < 3) throw new EdgeError('reason_required', 'a reason is required', 400);

  const paymentKind = kindInput === 'penalty' ? 'penalty' : 'manual';

  const { data: pm } = await admin
    .from('payment_methods').select('stripe_pm_id').eq('user_id', targetUser).eq('status', 'active')
    .order('is_default', { ascending: false }).limit(1).maybeSingle();
  if (!pm) throw new EdgeError('no_card', 'user has no card on file', 402);
  const customer = await ensureStripeCustomer(admin, targetUser);

  const { data: payment } = await admin.from('payments').insert({
    user_id: targetUser, amount_cents: amount, currency: 'EUR', kind: paymentKind,
    status: 'processing', initiated_by: 'admin', admin_reason: reason,
  }).select('id').single();
  const paymentId = payment!.id as string;

  let status = 'succeeded';
  try {
    const pi = await stripe<{ id: string; status: string }>('POST', '/payment_intents', {
      amount, currency: 'eur', customer, payment_method: pm.stripe_pm_id,
      off_session: true, confirm: true,
      metadata: { payment_id: paymentId, user_id: targetUser, admin_charge: 'true' },
    }, `admincharge-${paymentId}`);
    await admin.from('payments').update({ stripe_pi_id: pi.id }).eq('id', paymentId);
    if (pi.status !== 'succeeded') throw new EdgeError('authentication_required', pi.status, 402);

    await admin.from('payments').update({ status: 'succeeded' }).eq('id', paymentId);
    const clearing = await accountId(admin, 'stripe_clearing', null);
    const revenue = await accountId(admin, 'penny_revenue', null);
    await postLedger(admin, paymentId, [
      { account_id: clearing, delta_cents: amount, memo: `manual charge: ${kindInput}` },
      { account_id: revenue, delta_cents: -amount, memo: 'manual charge revenue' },
    ]);
  } catch (e) {
    status = 'failed';
    const code = e instanceof EdgeError ? e.code : 'charge_failed';
    await admin.from('payments').update({ status: 'failed', failure_code: code }).eq('id', paymentId);
    await admin.from('debts').insert({
      user_id: targetUser, amount_cents: amount, source: 'penalty', status: 'open',
    });
  }

  await writeAudit(admin, {
    staff_id: staff.staff_id, action: 'payments.charge', entity: 'payments', entity_id: paymentId,
    after: { amount_cents: amount, kind: kindInput, status, evidence }, reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  await notifyUser(admin, targetUser, 'manual_charge', 'A charge was applied',
    `A ${(amount / 100).toFixed(2)} € ${kindInput} charge was applied. Reason: ${reason}. You may appeal.`,
    'penny://wallet/appeal');

  return json({ payment_id: paymentId, status });
});

Deno.serve(handler);
