// One Stripe Customer per user (docs/05), memoized in stripe_customers.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { stripe } from './stripe.ts';

export async function ensureStripeCustomer(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: existing } = await admin
    .from('stripe_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (existing) return existing.stripe_customer_id as string;

  const { data: user } = await admin.from('users').select('email, phone').eq('id', userId).single();
  const cust = await stripe<{ id: string }>('POST', '/customers', {
    email: user?.email ?? undefined,
    phone: user?.phone ?? undefined,
    metadata: { user_id: userId },
  });
  await admin.from('stripe_customers').insert({ user_id: userId, stripe_customer_id: cust.id });
  return cust.id;
}
