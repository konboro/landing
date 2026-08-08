// payments-webhook — Stripe + Sumsub. Signature-verified, idempotent by event id.
// Handles: payment_intent.succeeded/payment_failed, charge.dispute.created,
// setup_intent.succeeded, and Sumsub applicantReviewed.
//
// NOTE: trip captures are confirmed synchronously in trips-end (which already posts the
// ledger and sets the payment 'succeeded'). The webhook therefore no-ops on payments that
// are already 'succeeded', so a trip is never double-posted.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient } from '../../_shared/admin.ts';
import { stripe, verifyStripeSignature } from '../../_shared/stripe.ts';
import { accountId, postLedger } from '../../_shared/ledger.ts';
import { notifyUser } from '../../_shared/audit.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const raw = await req.text();
  const stripeSig = req.headers.get('stripe-signature');

  // ---------- Sumsub branch (no stripe-signature header) ----------
  if (!stripeSig) {
    return await handleSumsub(admin, req, raw);
  }

  // ---------- Stripe branch ----------
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (secret) {
    const ok = await verifyStripeSignature(raw, stripeSig, secret);
    if (!ok) throw new EdgeError('bad_signature', 'invalid Stripe signature', 400);
  } else {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification (dev only)');
  }

  const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };

  // Idempotency: first writer wins.
  const { error: dupe } = await admin.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dupe) {
    if (dupe.code === '23505') return json({ received: true, duplicate: true });
    throw new EdgeError('db_error', dupe.message, 500);
  }

  const obj = event.data.object;
  switch (event.type) {
    case 'payment_intent.succeeded':
      await onPaymentSucceeded(admin, obj);
      break;
    case 'payment_intent.payment_failed':
      await onPaymentFailed(admin, obj);
      break;
    case 'charge.dispute.created':
      await onDispute(admin, obj);
      break;
    case 'setup_intent.succeeded':
      await onSetupIntent(admin, obj);
      break;
    default:
      // Acknowledge unhandled events so Stripe stops retrying.
      break;
  }

  return json({ received: true });
});

async function onPaymentSucceeded(admin: SupabaseClient, pi: Record<string, unknown>) {
  const piId = pi.id as string;
  const amount = Number(pi.amount ?? pi.amount_received ?? 0);
  const { data: payment } = await admin
    .from('payments').select('id, user_id, kind, status').eq('stripe_pi_id', piId).maybeSingle();
  if (!payment) return;                       // not one of ours
  if (payment.status === 'succeeded') return; // already settled synchronously

  await admin.from('payments').update({ status: 'succeeded' }).eq('id', payment.id);
  const userId = payment.user_id as string;
  const clearing = await accountId(admin, 'stripe_clearing', null);
  const meta = (pi.metadata ?? {}) as Record<string, string>;

  if (payment.kind === 'package') {
    const packageId = meta.package_id;
    const { data: pkg } = await admin
      .from('packages').select('minutes, validity_days').eq('id', packageId).single();
    if (pkg) {
      await admin.from('package_purchases').insert({
        user_id: userId, package_id: packageId, minutes_left: pkg.minutes,
        expires_at: new Date(Date.now() + pkg.validity_days * 86400 * 1000).toISOString(),
        stripe_pi_id: piId,
      });
      const bonus = await accountId(admin, 'bonus', null); // prepaid minutes held as deferred value
      await postLedger(admin, payment.id, [
        { account_id: clearing, delta_cents: amount, memo: 'package purchase' },
        { account_id: bonus, delta_cents: -amount, memo: 'package deferred value' },
      ]);
    }
  } else if (payment.kind === 'debt') {
    const debtId = meta.debt_id;
    if (debtId) {
      await admin.from('debts').update({ status: 'paid' }).eq('id', debtId);
      const debtAcc = await accountId(admin, 'debt', userId);
      await postLedger(admin, payment.id, [
        { account_id: clearing, delta_cents: amount, memo: 'debt payment' },
        { account_id: debtAcc, delta_cents: -amount, memo: 'debt cleared' },
      ]);
    }
  } else if (payment.kind === 'topup') {
    const wallet = await accountId(admin, 'user_wallet', userId);
    // Cash in (+) funds the wallet liability (-) — available balance (=-sum) rises.
    await postLedger(admin, payment.id, [
      { account_id: clearing, delta_cents: amount, memo: 'wallet top-up' },
      { account_id: wallet, delta_cents: -amount, memo: 'wallet credit' },
    ]);
  } else {
    const revenue = await accountId(admin, 'penny_revenue', null);
    await postLedger(admin, payment.id, [
      { account_id: clearing, delta_cents: amount, memo: 'card capture' },
      { account_id: revenue, delta_cents: -amount, memo: 'revenue' },
    ]);
  }

  await notifyUser(admin, userId, 'payment_succeeded', 'Payment received',
    `We received ${(amount / 100).toFixed(2)} €.`);
}

async function onPaymentFailed(admin: SupabaseClient, pi: Record<string, unknown>) {
  const piId = pi.id as string;
  const failure = (pi.last_payment_error ?? {}) as Record<string, string>;
  const { data: payment } = await admin
    .from('payments').select('id, user_id, kind, amount_cents, status').eq('stripe_pi_id', piId).maybeSingle();
  if (!payment || payment.status === 'succeeded') return;

  await admin.from('payments').update({ status: 'failed', failure_code: failure.code ?? 'card_declined' })
    .eq('id', payment.id);

  if (['trip', 'debt', 'penalty', 'manual'].includes(payment.kind)) {
    await admin.from('debts').insert({
      user_id: payment.user_id, amount_cents: payment.amount_cents,
      source: payment.kind === 'trip' ? 'failed_trip_payment' : 'penalty', status: 'open',
      next_retry_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    });
    await notifyUser(admin, payment.user_id as string, 'payment_failed_debt', 'Payment failed',
      'Your payment failed and a debt was created. Please update your card.', 'penny://wallet/debt');
  }
}

async function onDispute(admin: SupabaseClient, dispute: Record<string, unknown>) {
  const piId = (dispute.payment_intent ?? '') as string;
  const amount = Number(dispute.amount ?? 0);
  const { data: payment } = await admin
    .from('payments').select('id, user_id').eq('stripe_pi_id', piId).maybeSingle();
  if (!payment) return;

  // Chargeback: debt + block user pending review (docs/05). Evidence pack assembled by ops.
  await admin.from('debts').insert({
    user_id: payment.user_id, amount_cents: amount, source: 'chargeback', status: 'open',
  });
  await admin.from('users').update({ status: 'blocked', blocked_reason: 'chargeback under review' })
    .eq('id', payment.user_id);
  await notifyUser(admin, payment.user_id as string, 'chargeback', 'Account on hold',
    'A chargeback was received. Your account is on hold pending review.');
}

async function onSetupIntent(admin: SupabaseClient, si: Record<string, unknown>) {
  const pmId = si.payment_method as string | undefined;
  const customerId = si.customer as string | undefined;
  if (!pmId || !customerId) return;

  const { data: map } = await admin
    .from('stripe_customers').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
  if (!map) return;

  const pm = await stripe<{ card?: { brand: string; last4: string; exp_month: number; exp_year: number } }>(
    'GET', `/payment_methods/${pmId}`,
  );
  const card = pm.card;

  // First card becomes default.
  const { data: existing } = await admin
    .from('payment_methods').select('id').eq('user_id', map.user_id).limit(1);
  const isDefault = !existing || existing.length === 0;

  await admin.from('payment_methods').upsert({
    user_id: map.user_id, stripe_pm_id: pmId,
    brand: card?.brand ?? null, last4: card?.last4 ?? null,
    exp: card ? `${String(card.exp_month).padStart(2, '0')}/${card.exp_year}` : null,
    status: 'active', is_default: isDefault,
  }, { onConflict: 'user_id,stripe_pm_id' });
}

async function handleSumsub(admin: SupabaseClient, req: Request, raw: string): Promise<Response> {
  const secret = Deno.env.get('SUMSUB_WEBHOOK_SECRET');
  if (secret) {
    const digest = req.headers.get('x-payload-digest');
    const ok = digest ? await verifySumsub(raw, digest, secret) : false;
    if (!ok) throw new EdgeError('bad_signature', 'invalid Sumsub signature', 400);
  } else {
    console.warn('SUMSUB_WEBHOOK_SECRET not set — skipping Sumsub verification (dev only)');
  }

  const body = JSON.parse(raw) as {
    type?: string; applicantId?: string; externalUserId?: string;
    reviewResult?: { reviewAnswer?: string };
  };
  if (body.type !== 'applicantReviewed') return json({ received: true });

  const approved = body.reviewResult?.reviewAnswer === 'GREEN';
  const kyc = approved ? 'approved' : 'rejected';

  // Map by externalUserId (our user id) or by stored applicant id.
  let userId = body.externalUserId ?? null;
  if (!userId && body.applicantId) {
    const { data: u } = await admin
      .from('users').select('id').eq('sumsub_applicant_id', body.applicantId).maybeSingle();
    userId = u?.id ?? null;
  }
  if (!userId) return json({ received: true });

  await admin.from('users').update({ kyc_status: kyc, sumsub_applicant_id: body.applicantId ?? null })
    .eq('id', userId);
  await notifyUser(admin, userId, 'kyc_result', approved ? 'Identity verified' : 'Verification failed',
    approved ? 'You can now start riding.' : 'Please retry identity verification.', 'penny://kyc');

  return json({ received: true });
}

async function verifySumsub(payload: string, digest: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return expected === digest.toLowerCase();
}

Deno.serve(handler);
