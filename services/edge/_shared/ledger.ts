// Ledger helper. Hard Rule #2: all money moves through balanced double-entry.
// We call the DB post_ledger() so the balance check + the deferred constraint
// trigger both run server-side and inside one transaction.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { EdgeError } from './responses.ts';

export interface LedgerLeg {
  account_id: string;
  delta_cents: number;
  currency?: string;
  memo?: string;
}

/** Find or create the singleton/global or per-owner ledger account for a kind. */
export async function accountId(
  admin: SupabaseClient,
  kind: 'user_wallet' | 'penny_revenue' | 'stripe_clearing' | 'debt' | 'bonus' | 'corporate',
  ownerId: string | null,
): Promise<string> {
  const q = admin.from('ledger_accounts').select('id').eq('kind', kind);
  const { data: existing } = ownerId
    ? await q.eq('owner_id', ownerId).maybeSingle()
    : await q.is('owner_id', null).maybeSingle();
  if (existing) return existing.id as string;

  const { data: created, error } = await admin
    .from('ledger_accounts')
    .insert({ kind, owner_id: ownerId })
    .select('id')
    .single();
  if (error || !created) {
    throw new EdgeError('ledger_error', `cannot create ledger account ${kind}: ${error?.message}`, 500);
  }
  return created.id as string;
}

/** Post a balanced set of legs under txnId (convention: txnId == payment.id). */
export async function postLedger(
  admin: SupabaseClient,
  txnId: string,
  legs: LedgerLeg[],
): Promise<void> {
  const sum = legs.reduce((s, l) => s + l.delta_cents, 0);
  if (sum !== 0) {
    throw new EdgeError('ledger_unbalanced', `ledger legs net to ${sum}, must be 0 (Hard Rule #2)`, 500);
  }
  const { error } = await admin.rpc('post_ledger', { txn: txnId, entries: legs });
  if (error) throw new EdgeError('ledger_error', `post_ledger failed: ${error.message}`, 500);
}
