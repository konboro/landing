-- 00520_mydata_integration.sql
--
-- Stop myDATA being a tab.
--
-- 00500/00510 built the pipeline and the review desk, but everything about
-- receipts lived on one screen. A ride, a customer and the dashboard could all
-- show money moving with no hint of whether the tax office had been told.
--
-- The unit that makes this composable is not "a receipt" — it is "a payment,
-- and what happened to its receipt". Rides join through `payments.trip_id`,
-- customers through `payments.user_id`, and the dashboard aggregates the same
-- thing over time. One view, three screens.

/* ---------------------------------------------------------------------------
   1. Receipt state, per payment
   --------------------------------------------------------------------------- */

create or replace view v_mydata_by_payment as
select distinct on (p.id)
  p.id                as payment_id,
  p.trip_id,
  p.user_id,
  p.amount_cents,
  p.kind              as payment_kind,
  p.status            as payment_status,
  p.created_at        as paid_at,

  s.id                as submission_id,
  s.series,
  s.aa,
  s.status            as receipt_status,
  s.mode              as receipt_mode,
  s.mark,
  s.filed_manually,
  s.issue_date,
  s.last_error,

  -- The single value every screen renders. Collapsing this here rather than in
  -- each component is what keeps the rides table, the customer card and the
  -- dashboard from drifting into three different vocabularies.
  --
  -- `practice` is deliberately ABOVE the status checks: a receipt created in
  -- dry_run or sandbox has provably never reached AADE, whatever its status
  -- column says. Letting it fall through to 'filed' would make the panel report
  -- a tax position that does not exist.
  case
    when p.status <> 'succeeded'            then 'not_chargeable'
    when s.id is null                       then 'missing'
    when s.mode <> 'live'                   then 'practice'
    when s.status = 'sent'                  then 'filed'
    when s.status = 'failed'                then 'failed'
    when s.status in ('pending', 'sending') then 'in_flight'
    when s.status = 'skipped'               then 'not_filed'
    else 'unknown'
  end                 as receipt_state
from payments p
left join mydata_submissions s
       on (s.payment_id = p.id
           or (s.payment_id is null and s.stripe_charge_id is not null
               and s.stripe_charge_id = p.stripe_pi_id))
      and s.status <> 'cancelled'
-- Highest AA wins when a payment somehow carries more than one live receipt;
-- the duplicate itself is reported separately by v_mydata_duplicates.
order by p.id, s.aa desc nulls last;

comment on view v_mydata_by_payment is
  'One row per payment with the state of its tax receipt. The join for rides (via trip_id), customers (via user_id) and the dashboard.';

/* ---------------------------------------------------------------------------
   2. Dashboard rollup
   --------------------------------------------------------------------------- */

-- Deliberately one row, so a dashboard tile is one cheap query rather than
-- pulling a table and counting in the browser — the mistake that capped every
-- figure on the review desk at 1000 rows.
create or replace view v_mydata_health as
with scoped as (
  select
    s.status,
    s.mode,
    s.filed_manually,
    coalesce(s.gross_cents, 0) as gross_cents,
    s.created_at >= date_trunc('day', now())      as d_today,
    s.created_at >= now() - interval '24 hours'   as d_24h,
    s.created_at >= now() - interval '7 days'     as d_7d
  from mydata_submissions s
  where s.source = 'platform'          -- imported history is not "how we are doing"
)
select
  (select value->>'mode' from app_config where key = 'mydata')          as mode,
  (select coalesce((value->>'enabled')::boolean, false)
     from app_config where key = 'mydata')                              as enabled,

  count(*) filter (where d_today)                                       as today_receipts,
  count(*) filter (where d_today and status = 'sent')                   as today_filed,
  count(*) filter (where d_today and status = 'failed')                 as today_failed,
  coalesce(sum(gross_cents) filter (where d_today), 0)                  as today_gross_cents,

  count(*) filter (where d_24h)                                         as h24_receipts,
  count(*) filter (where d_24h and status = 'sent')                     as h24_filed,
  count(*) filter (where d_24h and status = 'failed')                   as h24_failed,
  coalesce(sum(gross_cents) filter (where d_24h), 0)                    as h24_gross_cents,

  count(*) filter (where d_7d)                                          as d7_receipts,
  count(*) filter (where d_7d and status = 'sent')                      as d7_filed,
  count(*) filter (where d_7d and status = 'failed')                    as d7_failed,
  count(*) filter (where d_7d and filed_manually)                       as d7_by_hand,
  coalesce(sum(gross_cents) filter (where d_7d), 0)                     as d7_gross_cents,

  count(*) filter (where status in ('pending', 'sending'))              as in_flight,

  (select count(*) from v_mydata_issues where reviewed_at is null)      as open_issues,
  (select count(*) from v_mydata_missing)                              as payments_without_receipt,
  (select max(updated_at) from mydata_series)                          as series_synced_at
from scoped;

comment on view v_mydata_health is
  'Single-row myDATA summary for the dashboard: today, last 24h, last 7 days, plus anything waiting on a person.';

/* ---------------------------------------------------------------------------
   3. Lock down, like every other admin view
   --------------------------------------------------------------------------- */

revoke all on v_mydata_by_payment, v_mydata_health from anon, authenticated;
