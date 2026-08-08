// payments-setup-intent — on-session SetupIntent so the rider can add a card (SCA/3DS).
// The resulting PaymentMethod is persisted on setup_intent.succeeded (payments-webhook).
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { stripe } from '../../_shared/stripe.ts';
import { ensureStripeCustomer } from '../../_shared/customers.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const customer = await ensureStripeCustomer(admin, userId);

  const si = await stripe<{ client_secret: string }>('POST', '/setup_intents', {
    customer,
    usage: 'off_session', // future off-session trip captures ride on this PM
    payment_method_types: ['card'],
    metadata: { user_id: userId },
  });

  return json({ client_secret: si.client_secret });
});

Deno.serve(handler);
