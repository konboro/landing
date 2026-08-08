// payments-pay-debt — rider pays down an open debt (full amount) off-session.
// On success: mark debt paid + balanced ledger (debt account cleared). On SCA needed:
// return requires_action so the app can complete 3DS.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { stripe } from '../../_shared/stripe.ts';
import { ensureStripeCustomer } from '../../_shared/customers.ts';
import { accountId, postLedger } from '../../_shared/ledger.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);
  const debtId = str(body, 'debt_id')!;

  const { data: debt } = await admin
    .from('debts').select('id, user_id, amount_cents, status').eq('id', debtId).single();
  if (!debt) throw new EdgeError('not_found', 'debt not found', 404);
  if (debt.user_id !== userId) throw new EdgeError('forbidden', 'not your debt', 403);
  if (!['open', 'retrying'].includes(debt.status)) throw new EdgeError('bad_state', `debt is ${debt.status}`, 409);

  const { data: pm } = await admin
    .from('payment_methods').select('stripe_pm_id').eq('user_id', userId).eq('status', 'active')
    .order('is_default', { ascending: false }).limit(1).maybeSingle();
  if (!pm) throw new EdgeError('no_card', 'add a card to pay your debt', 402);

  const customer = await ensureStripeCustomer(admin, userId);

  const { data: payment } = await admin.from('payments').insert({
    user_id: userId, amount_cents: debt.amount_cents, currency: 'EUR',
    kind: 'debt', status: 'processing', initiated_by: 'user',
  }).select('id').single();
  const paymentId = payment!.id as string;

  const pi = await stripe<{ id: string; status: string }>('POST', '/payment_intents', {
    amount: debt.amount_cents, currency: 'eur', customer, payment_method: pm.stripe_pm_id,
    off_session: true, confirm: true, metadata: { payment_id: paymentId, debt_id: debtId, user_id: userId },
  }, `debt-${debtId}`);

  await admin.from('payments').update({ stripe_pi_id: pi.id }).eq('id', paymentId);

  if (pi.status === 'succeeded') {
    await admin.from('payments').update({ status: 'succeeded' }).eq('id', paymentId);
    await admin.from('debts').update({ status: 'paid' }).eq('id', debtId);
    // Clear the debt: stripe_clearing +N (cash in), debt account -N (obligation cleared).
    const clearing = await accountId(admin, 'stripe_clearing', null);
    const debtAcc = await accountId(admin, 'debt', userId);
    await postLedger(admin, paymentId, [
      { account_id: clearing, delta_cents: debt.amount_cents, memo: 'debt payment' },
      { account_id: debtAcc, delta_cents: -debt.amount_cents, memo: 'debt cleared' },
    ]);
    return json({ status: 'succeeded' });
  }

  await admin.from('payments').update({ status: 'requires_action' }).eq('id', paymentId);
  return json({ status: pi.status });
});

Deno.serve(handler);
