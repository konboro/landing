-- 00150_functions.sql
-- Ledger poster, atomic trip transition, derived wallet balance.

-- post_ledger: insert a set of balanced legs under one txn id.
-- entries := jsonb array of { account_id, delta_cents, currency?, memo? }.
-- Raises immediately if the legs do not net to zero (Hard Rule #2); the deferred
-- constraint trigger in 00080 is the backstop at COMMIT.
create or replace function post_ledger(txn uuid, entries jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint := 0;
  leg   jsonb;
begin
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) < 2 then
    raise exception 'post_ledger: entries must be a jsonb array of >= 2 legs';
  end if;

  for leg in select * from jsonb_array_elements(entries) loop
    total := total + (leg->>'delta_cents')::bigint;
  end loop;

  if total <> 0 then
    raise exception
      'post_ledger: unbalanced txn % (sum=% cents). Hard Rule #2: double-entry must net to zero.',
      txn, total;
  end if;

  insert into ledger_entries (txn_id, account_id, delta_cents, currency, memo)
  select
    txn,
    (leg->>'account_id')::uuid,
    (leg->>'delta_cents')::bigint,
    coalesce(leg->>'currency', 'EUR'),
    leg->>'memo'
  from jsonb_array_elements(entries) as leg;

  return txn;
end $$;

-- trip_transition: append a trip_events row (from = current cached status) and move
-- trips.status forward atomically (Hard Rule #4: trips.status is a cache of last event).
create or replace function trip_transition(
  trip   uuid,
  to_st  trip_status,
  actor  trip_actor,
  meta   jsonb default '{}'::jsonb
)
returns trip_status
language plpgsql
security definer
set search_path = public
as $$
declare
  from_st trip_status;
begin
  select status into from_st from trips where id = trip for update;
  if not found then
    raise exception 'trip_transition: trip % not found', trip;
  end if;

  insert into trip_events (trip_id, from_status, to_status, actor, meta)
  values (trip, from_st, to_st, actor, coalesce(meta, '{}'::jsonb));

  update trips set status = to_st where id = trip;
  return to_st;
end $$;

-- Derived per-user wallet balance (never a stored column — Hard Rule #2).
create or replace view v_user_wallet_balance as
select
  a.owner_id                          as user_id,
  coalesce(sum(e.delta_cents), 0)::bigint as balance_cents,
  a.currency
from ledger_accounts a
left join ledger_entries e on e.account_id = a.id
where a.kind = 'user_wallet' and a.owner_id is not null
group by a.owner_id, a.currency;

-- Rider-facing wallet balance: same derivation, self-scoped. The view is
-- security-definer (reads ledger past its RLS) and filters to the caller, so a
-- rider only ever sees their own balance. v_user_wallet_balance stays service_role-only.
create or replace view v_my_wallet_balance as
select user_id, balance_cents, currency
from v_user_wallet_balance
where user_id = auth.uid();

grant select on public.v_my_wallet_balance to authenticated;
