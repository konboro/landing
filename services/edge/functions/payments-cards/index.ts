// payments-cards — the rider's saved cards: reconcile with Stripe, change the
// default, remove one. Every action answers with the resulting list so the app
// has a single contract and never has to guess what changed.
//
// Why a server function rather than direct table writes: `payment_methods` is
// what decides which card actually gets charged (trips-end reads
// status='active' AND is_default=true, admin-charge and payments-pay-debt order
// by is_default), so it must stay consistent with Stripe and must never hold two
// defaults at once — trips-end uses maybeSingle() and a second default would
// break ending a trip, not just the display.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { stripe } from '../../_shared/stripe.ts';
import { ensureStripeCustomer } from '../../_shared/customers.ts';

type Admin = ReturnType<typeof adminClient>;

type StripeCard = {
  id: string;
  card?: { brand: string; last4: string; exp_month: number; exp_year: number };
};

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);
  const action = str(body, 'action')!;

  switch (action) {
    case 'sync':
      await syncFromStripe(admin, userId);
      break;
    case 'set_default':
      await setDefault(admin, userId, str(body, 'card_id')!);
      break;
    case 'remove':
      await removeCard(admin, userId, str(body, 'card_id')!);
      break;
    default:
      throw new EdgeError('bad_request', `unknown action ${action}`, 400);
  }

  return json({ cards: await listCards(admin, userId) });
});

/**
 * Pull the customer's cards from Stripe and reconcile the local table.
 *
 * This exists so adding a card does not race the webhook: `setup_intent.succeeded`
 * is what normally persists a new card, and it usually lands within a second, but
 * the app would otherwise have to poll and hope. Calling sync right after the
 * sheet closes makes the new card appear deterministically. It is also the repair
 * path if a webhook was ever missed.
 */
async function syncFromStripe(admin: Admin, userId: string): Promise<void> {
  const customer = await ensureStripeCustomer(admin, userId);
  const res = await stripe<{ data: StripeCard[] }>('GET', '/payment_methods', {
    customer,
    type: 'card',
    limit: 100,
  });
  const live = res.data ?? [];

  const { data: rows } = await admin
    .from('payment_methods').select('id, stripe_pm_id, is_default, status').eq('user_id', userId);
  const existing = rows ?? [];
  const hadDefault = existing.some((r) => r.status === 'active' && r.is_default);

  for (const [i, pm] of live.entries()) {
    const card = pm.card;
    const known = existing.find((r) => r.stripe_pm_id === pm.id);
    await admin.from('payment_methods').upsert({
      user_id: userId,
      stripe_pm_id: pm.id,
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      exp: card ? `${String(card.exp_month).padStart(2, '0')}/${card.exp_year}` : null,
      status: 'active',
      // Keep whatever the rider already chose; only pick one when nothing is set,
      // so a sync never silently moves which card gets charged.
      is_default: known ? known.is_default : !hadDefault && i === 0,
    }, { onConflict: 'user_id,stripe_pm_id' });
  }

  // Detached in Stripe (elsewhere, or by an earlier failed removal) — retire the
  // row rather than deleting it, so payments still reference a readable card.
  const liveIds = new Set(live.map((p) => p.id));
  const stale = existing.filter((r) => r.status === 'active' && !liveIds.has(r.stripe_pm_id));
  for (const r of stale) {
    await admin.from('payment_methods')
      .update({ status: 'removed', is_default: false }).eq('id', r.id);
  }

  await ensureExactlyOneDefault(admin, userId);
}

async function setDefault(admin: Admin, userId: string, cardId: string): Promise<void> {
  const target = await ownedCard(admin, userId, cardId);

  // Two writes, narrowest first: clear the old default, then set the new one.
  await admin.from('payment_methods')
    .update({ is_default: false }).eq('user_id', userId).neq('id', target.id);
  await admin.from('payment_methods').update({ is_default: true }).eq('id', target.id);

  // Mirror it onto the Stripe customer. Nothing we run reads this back today —
  // every charge names the payment_method explicitly — but leaving it stale means
  // anything driven from the Stripe dashboard would use a different card than the
  // rider sees as default.
  const customer = await ensureStripeCustomer(admin, userId);
  await stripe('POST', `/customers/${customer}`, {
    invoice_settings: { default_payment_method: target.stripe_pm_id },
  }).catch(() => {/* cosmetic on Stripe's side — never fail the request for it */});
}

async function removeCard(admin: Admin, userId: string, cardId: string): Promise<void> {
  const target = await ownedCard(admin, userId, cardId);

  // Detach first: if Stripe rejects it the card is still usable and the local row
  // still matches reality. Doing it the other way round can leave a card that the
  // rider cannot see but that off-session charges would still hit.
  await stripe('POST', `/payment_methods/${target.stripe_pm_id}/detach`);

  await admin.from('payment_methods')
    .update({ status: 'removed', is_default: false }).eq('id', target.id);

  await ensureExactlyOneDefault(admin, userId);
}

/** Look the card up by OUR row id and confirm it belongs to the caller. */
async function ownedCard(
  admin: Admin,
  userId: string,
  cardId: string,
): Promise<{ id: string; stripe_pm_id: string }> {
  const { data } = await admin
    .from('payment_methods').select('id, stripe_pm_id, status')
    .eq('id', cardId).eq('user_id', userId).maybeSingle();
  if (!data) throw new EdgeError('not_found', 'card not found', 404);
  if (data.status !== 'active') throw new EdgeError('not_found', 'card is no longer active', 404);
  return { id: data.id as string, stripe_pm_id: data.stripe_pm_id as string };
}

/**
 * Exactly one active card must be the default: zero means trips-end finds no
 * payment method, more than one makes its maybeSingle() fail outright.
 */
async function ensureExactlyOneDefault(admin: Admin, userId: string): Promise<void> {
  const { data } = await admin
    .from('payment_methods').select('id, is_default')
    .eq('user_id', userId).eq('status', 'active')
    .order('created_at', { ascending: true });
  const active = data ?? [];
  if (active.length === 0) return;

  const defaults = active.filter((r) => r.is_default);
  if (defaults.length === 1) return;

  const keep = defaults[0]?.id ?? active[0].id;
  for (const r of active) {
    if ((r.is_default === true) !== (r.id === keep)) {
      await admin.from('payment_methods').update({ is_default: r.id === keep }).eq('id', r.id);
    }
  }
}

async function listCards(admin: Admin, userId: string) {
  const { data } = await admin
    .from('payment_methods').select('id, brand, last4, exp, is_default')
    .eq('user_id', userId).eq('status', 'active')
    .order('created_at', { ascending: true });
  return data ?? [];
}

Deno.serve(handler);
