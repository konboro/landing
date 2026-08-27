// payments-topup — start a wallet top-up. Returns a PaymentIntent client_secret;
// the app confirms it (PaymentSheet). The wallet is credited on
// payment_intent.succeeded (payments-webhook, kind='topup'), so money only reaches
// the ledger after capture — same shape as payments-buy-package.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, num } from '../../_shared/validate.ts';
import { stripe } from '../../_shared/stripe.ts';
import { ensureStripeCustomer } from '../../_shared/customers.ts';

// The amount comes from the client, so the bounds are enforced here and not in
// the app. Without them a caller could open a PaymentIntent for one cent (card
// fees exceed it, so every such top-up loses money) or for an arbitrary sum.
// Overridable per deployment from app_config without a redeploy.
const DEFAULT_MIN_CENTS = 500;
const DEFAULT_MAX_CENTS = 50_000;

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);
  const amount = Math.round(num(body, 'amount_cents')!);

  const min = await configInt(admin, 'topup_min_cents', DEFAULT_MIN_CENTS);
  const max = await configInt(admin, 'topup_max_cents', DEFAULT_MAX_CENTS);
  if (!Number.isFinite(amount) || amount < min || amount > max) {
    throw new EdgeError(
      'invalid_amount',
      `top-up must be between ${(min / 100).toFixed(2)} and ${(max / 100).toFixed(2)} EUR`,
      400,
    );
  }

  const customer = await ensureStripeCustomer(admin, userId);

  const { data: payment, error } = await admin.from('payments').insert({
    user_id: userId, amount_cents: amount, currency: 'EUR',
    kind: 'topup', status: 'processing', initiated_by: 'user',
  }).select('id').single();
  if (error) throw new EdgeError('db_error', error.message, 500);
  const paymentId = payment!.id as string;

  const pi = await stripe<{ id: string; client_secret: string }>('POST', '/payment_intents', {
    amount, currency: 'eur', customer,
    metadata: { payment_id: paymentId, user_id: userId, kind: 'topup' },
  }, `topup-${paymentId}`);

  await admin.from('payments').update({ stripe_pi_id: pi.id }).eq('id', paymentId);
  return json({ client_secret: pi.client_secret, payment_id: paymentId });
});

async function configInt(
  admin: ReturnType<typeof adminClient>,
  key: string,
  fallback: number,
): Promise<number> {
  const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

Deno.serve(handler);
