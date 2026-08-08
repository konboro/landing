// payments-buy-package — start a package purchase. Returns a PaymentIntent client_secret;
// the app confirms it (PaymentSheet). package_purchases + ledger are written on
// payment_intent.succeeded (payments-webhook), keeping money on the ledger only after capture.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { stripe } from '../../_shared/stripe.ts';
import { ensureStripeCustomer } from '../../_shared/customers.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);
  const packageId = str(body, 'package_id')!;

  const { data: pkg } = await admin
    .from('packages').select('id, name, price_cents, active').eq('id', packageId).single();
  if (!pkg || !pkg.active) throw new EdgeError('not_found', 'package not available', 404);

  const customer = await ensureStripeCustomer(admin, userId);

  const { data: payment } = await admin.from('payments').insert({
    user_id: userId, amount_cents: pkg.price_cents, currency: 'EUR',
    kind: 'package', status: 'processing', initiated_by: 'user',
  }).select('id').single();
  const paymentId = payment!.id as string;

  const pi = await stripe<{ id: string; client_secret: string }>('POST', '/payment_intents', {
    amount: pkg.price_cents, currency: 'eur', customer,
    metadata: { payment_id: paymentId, package_id: packageId, user_id: userId, kind: 'package' },
  }, `package-${paymentId}`);

  await admin.from('payments').update({ stripe_pi_id: pi.id }).eq('id', paymentId);
  return json({ client_secret: pi.client_secret });
});

Deno.serve(handler);
