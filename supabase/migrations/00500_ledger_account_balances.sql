-- 00500_ledger_account_balances.sql
--
-- The Finance → Ledger explorer crashed the whole page with
-- "Cannot read properties of undefined (reading 'replace')", taking the Debts,
-- Invoices and Reconciliation tabs down with it. The panel read three fields
-- that have never existed: `ledger_accounts.owner_label`,
-- `ledger_accounts.balance_cents` and `ledger_entries.account_kind`.
--
-- Hard Rule #2 is why `balance_cents` is absent and must stay absent: balances
-- are derived, never a mutable column. So this adds the derivation as a view
-- rather than a column, and the panel reads the view.
--
-- Deriving it in the edge function was the alternative and would have been
-- wrong: that function pages ledger_entries at 500 rows, so a browser-side sum
-- would silently under-report the balance of any busy account. A wrong balance
-- that renders is worse than a screen that crashes.

-- Dropped rather than replaced: `create or replace view` cannot insert a column
-- in the middle of an existing one, and nothing depends on this view yet.
drop view if exists v_ledger_account_balances;

create view v_ledger_account_balances as
select
  a.id,
  a.kind,
  a.owner_id,
  a.currency,
  -- The sum IS the balance. No row of ledger_entries is ever updated or
  -- deleted, so this cannot drift from the journal.
  coalesce(sum(e.delta_cents), 0)::bigint as balance_cents,
  -- The same money from the account holder's side. A user wallet is a
  -- LIABILITY: crediting a rider 20 € posts −2000 to their wallet and +2000 to
  -- stripe_clearing, so the raw sum of a funded wallet is negative. The rider's
  -- app already flips this (v_user_wallet_balance negates the sum), and an
  -- operator comparing the two screens must not see 80 € of credit rendered as
  -- −80.00 in red. Kept as a separate column so the raw journal figure stays
  -- available and the double-entry checks keep working on it.
  (case when a.kind = 'user_wallet'::ledger_account_kind
        then -coalesce(sum(e.delta_cents), 0)
        else  coalesce(sum(e.delta_cents), 0)
   end)::bigint                            as owner_balance_cents,
  count(e.id)                             as entry_count,
  max(e.created_at)                       as last_entry_at,
  -- Who the account belongs to, in the words an operator would use. System
  -- accounts have no owner, so they are labelled by their kind.
  coalesce(
    u.full_name,
    u.email,
    u.phone,
    c.name,
    initcap(replace(a.kind::text, '_', ' '))   -- kind is an enum, not text
  ) as owner_label
from ledger_accounts a
left join ledger_entries     e on e.account_id = a.id
left join users              u on u.id = a.owner_id
left join corporate_accounts c on c.id = a.owner_id
group by a.id, a.kind, a.owner_id, a.currency, u.full_name, u.email, u.phone, c.name;

comment on view v_ledger_account_balances is
  'Ledger account balances derived from ledger_entries (Hard Rule #2 — never a stored column).';

-- Admin-only, like every other v_* the panel reads: it is reached through the
-- admin-panel-data / admin-list edge functions with service_role, never with
-- the anon key (Hard Rule #6).
revoke all on v_ledger_account_balances from anon, authenticated;
