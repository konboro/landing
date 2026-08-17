-- 00540_mydata_worker_and_queue_accuracy.sql
--
-- Two corrections and the scheduler.
--
-- 1. The queue was double-counting. Importing the history produced 655 "open
--    issues", but only 615 distinct problems: all 40 legacy failures appeared
--    both as `failed` and as `gap`, because a failed receipt IS a number with no
--    document behind it. Acknowledging one did not clear the other.
--
-- 2. `stalled` flagged practice-mode receipts. Anything sitting `pending` for
--    six hours was reported stuck — but in dry_run with no worker running, that
--    describes every receipt the platform will ever create. A signal that fires
--    on the normal case is not a signal.
--
-- 3. Nothing runs the worker. The trigger creates a receipt; the worker is what
--    renders the document and stores it. Without it, practice mode cannot do the
--    one job it exists for — comparing our document against what the old
--    pipeline filed.

/* ---------------------------------------------------------------------------
   1. `failed` means "this system tried and could not", nothing else
   --------------------------------------------------------------------------- */

-- Legacy failures are history: no amounts, numbered below the series floor, and
-- filtered out of mydata_claim, so Retry on them is a button that cannot work.
-- They are already represented honestly as series gaps — "this number has no
-- document" — which is a decision an accountant acknowledges in bulk rather
-- than a task an operator performs.
--
-- CREATE OR REPLACE keeps column names, types and order; v_mydata_health counts
-- from this view and would break on a DROP.
create or replace view v_mydata_issues as
select
  'failed'::text                              as kind,
  'high'::text                                as severity,
  s.id                                        as submission_id,
  s.series, s.aa, s.issue_date,
  s.stripe_charge_id, s.gross_cents,
  coalesce(s.last_error, 'no error recorded')  as detail,
  s.reviewed_at,
  'submission:' || s.id::text                 as issue_key,
  s.review_note
from mydata_submissions s
where s.status = 'failed'
  and s.source = 'platform'          -- (1) no longer double-counted as a gap

union all

select
  'no_receipt', 'high',
  null::uuid,
  null::text, null::bigint, (m.created_at at time zone 'UTC')::date,
  m.stripe_pi_id, m.amount_cents,
  'succeeded payment with no myDATA submission',
  r.reviewed_at,
  'payment:' || m.payment_id::text,
  r.note
from v_mydata_missing m
left join mydata_issue_reviews r
       on r.issue_kind = 'no_receipt' and r.issue_key = 'payment:' || m.payment_id::text

union all

select
  'duplicate', 'high',
  d.id,
  d.series, d.aa, d.issue_date,
  d.charge_key, d.gross_cents,
  'charge filed ' || d.filings || ' times; this one is ' ||
    case when d.is_original then 'the original to keep' else 'surplus — needs a credit note' end,
  d.reviewed_at,
  'submission:' || d.id::text,
  null::text
from v_mydata_duplicates d
where not d.is_original

union all

select
  'gap', 'medium',
  null::uuid,
  g.series, g.aa, g.issue_date,
  g.stripe_charge_id, null::int,
  'AA has no MARK at AADE (' || g.reason || ')',
  r.reviewed_at,
  'gap:' || g.series || ':' || g.aa::text,
  r.note
from v_mydata_series_gaps g
left join mydata_issue_reviews r
       on r.issue_kind = 'gap' and r.issue_key = 'gap:' || g.series || ':' || g.aa::text

union all

select
  'stalled', 'medium',
  s.id,
  s.series, s.aa, s.issue_date,
  s.stripe_charge_id, s.gross_cents,
  'in ' || s.status || ' for ' || age(now(), s.created_at) || ' after ' || s.attempts || ' attempts',
  s.reviewed_at,
  'submission:' || s.id::text,
  s.review_note
from mydata_submissions s
where s.status in ('pending', 'sending')
  and s.mode = 'live'                -- (2) practice receipts are not "stuck"
  and s.created_at < now() - interval '6 hours';

comment on view v_mydata_issues is
  'Everything about myDATA needing a human, each row exactly once. `failed` covers only receipts this platform attempted; legacy failures appear as series gaps, which is what they are.';

/* ---------------------------------------------------------------------------
   2. Let the database call the worker
   --------------------------------------------------------------------------- */

create extension if not exists pg_net;

-- Where to reach the worker. Not a secret — it ships in the client bundle — so
-- it lives in app_config where it is visible and editable rather than buried.
update app_config
   set value = value || jsonb_build_object(
         'worker_url',
         'https://pyferakmgtafifffqjat.supabase.co/functions/v1/mydata-submit'
       ),
       updated_at = now()
 where key = 'mydata'
   and not (value ? 'worker_url');

/*
  The key IS a secret, so it goes in Vault and never into a migration — this
  file is committed to a public repository. Create it once, by hand:

    select vault.create_secret(
      '<service_role key>',
      'mydata_worker_key',
      'Bearer token pg_cron uses to invoke the mydata-submit edge function'
    );

  Then enable the schedule:

    update cron.job set active = true where jobname = 'mydata-submit';

  Until both are done the job exists but does nothing, which is the intended
  resting state: a scheduled task that talks to a tax authority should be
  switched on deliberately, not by applying a migration.
*/
create or replace function mydata_tick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select value->>'worker_url' into v_url from app_config where key = 'mydata';
  if v_url is null then
    raise exception 'mydata_tick: app_config.mydata.worker_url is not set';
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'mydata_worker_key';
  if v_key is null then
    raise exception
      'mydata_tick: vault secret "mydata_worker_key" is missing — see 00540 for the one-liner that creates it';
  end if;

  -- Fire and forget: pg_net queues the request and returns an id. A slow or
  -- unreachable function must never hold a cron transaction open.
  return net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end $$;

revoke all on function mydata_tick() from public, anon, authenticated;
grant execute on function mydata_tick() to service_role;

comment on function mydata_tick() is
  'Invokes the mydata-submit edge function. Called by pg_cron; reads its bearer token from Vault so no key is ever written into a migration.';

/* ---------------------------------------------------------------------------
   3. The schedule — created switched OFF
   --------------------------------------------------------------------------- */

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mydata-submit') then
    perform cron.schedule('mydata-submit', '* * * * *', 'select public.mydata_tick()');
    raise notice 'scheduled mydata-submit (every minute)';
  end if;

  -- Off until the Vault secret exists. An active job with no key would fail
  -- sixty times an hour and bury the log it is supposed to be useful in.
  update cron.job set active = false where jobname = 'mydata-submit';
  raise notice 'mydata-submit is scheduled but INACTIVE — see the comment in 00540 to enable';
exception
  when undefined_function or invalid_schema_name then
    raise notice 'pg_cron unavailable — schedule mydata-submit by hand';
end
$$;
