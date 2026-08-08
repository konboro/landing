// admin-refund — staff refunds a payment (partial or full). Reason MANDATORY (Hard Rule #8).
// Stripe refund -> reversing ledger entry -> audit_log -> user notification.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num } from '../../_shared/validate.ts';
import { stripe } from '../../_shared/stripe.ts';
import { accountId, postLedger } from '../../_shared/ledger.ts';
import { writeAudit, notifyUser } from '../../_shared/audit.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'payments.refund');

  const body = await readJson(req);
  const paymentId = str(body, 'payment_id')!;
  const reason = str(body, 'reason')!;
  const partialAmount = num(body, 'amount_cents', false);
  if (reason.trim().length < 3) throw new EdgeError('reason_required', 'a reason is required', 400);

  const { data: payment } = await admin
    .from('payments').select('id, user_id, stripe_pi_id, amount_cents, status').eq('id', paymentId).single();
  if (!payment) throw new EdgeError('not_found', 'payment not found', 404);
  if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
    throw new EdgeError('bad_state', `cannot refund a ${payment.status} payment`, 409);
  }
  if (!payment.stripe_pi_id) throw new EdgeError('no_pi', 'payment has no Stripe PaymentIntent', 409);

  const amount = partialAmount ?? payment.amount_cents;
  if (amount <= 0 || amount > payment.amount_cents) {
    throw new EdgeError('bad_request', 'invalid refund amount', 400);
  }

  await stripe('POST', '/refunds', {
    payment_intent: payment.stripe_pi_id, amount,
    metadata: { payment_id: paymentId, reason },
  }, `refund-${paymentId}-${amount}`);

  const newStatus = amount === payment.amount_cents ? 'refunded' : 'partially_refunded';
  await admin.from('payments').update({ status: newStatus }).eq('id', paymentId);

  // Reverse the revenue: penny_revenue +amount, stripe_clearing -amount (cash back out).
  const clearing = await accountId(admin, 'stripe_clearing', null);
  const revenue = await accountId(admin, 'penny_revenue', null);
  await postLedger(admin, crypto.randomUUID(), [
    { account_id: revenue, delta_cents: amount, memo: `refund ${paymentId}` },
    { account_id: clearing, delta_cents: -amount, memo: 'refund payout' },
  ]);

  await writeAudit(admin, {
    staff_id: staff.staff_id, action: 'payments.refund', entity: 'payments', entity_id: paymentId,
    before: { status: payment.status }, after: { status: newStatus, refunded_cents: amount }, reason,
    ip: req.headers.get('x-forwarded-for'),
  });
  await notifyUser(admin, payment.user_id as string, 'refund', 'Refund issued',
    `We refunded ${(amount / 100).toFixed(2)} €. Reason: ${reason}.`);

  return json({ status: newStatus });
});

Deno.serve(handler);
