-- 00550_mydata_shadow.sql
--
-- Shadow ingest: let live Stripe traffic flow into this platform now, so the
-- receiving path is proven against real money while PythonAnywhere stays the
-- system of record and this side transmits nothing.
--
-- Why it cannot simply reuse payments-webhook:
--
--   * that function ignores charges it does not recognise (`if (!payment) return`),
--     so every Atom Mobility charge would land in stripe_events and nowhere else;
--   * `payments.user_id` is NOT NULL, and those riders do not exist here — writing
--     them to `payments` would mean inventing users and polluting the customer
--     tables and every KPI derived from them.
--
-- So shadow receipts are written straight to mydata_submissions, bypassing
-- `payments` entirely, under their own numbering series.
--
-- Three independent reasons a shadow receipt can never reach AADE:
--   1. mode is dry_run, and the adapter refuses to POST in dry_run;
--   2. status is terminal on insert — nothing claims it;
--   3. mydata_claim filters source='platform', so no worker will ever see it.

/* ---------------------------------------------------------------------------
   1. A third kind of row
   --------------------------------------------------------------------------- */

alter table mydata_submissions drop constraint if exists mydata_submissions_source_check;
alter table mydata_submissions add constraint mydata_submissions_source_check
  check (source in ('platform', 'legacy', 'shadow'));

comment on column mydata_submissions.source is
  'platform = issued by this system · legacy = imported from PythonAnywhere · shadow = live Stripe traffic recorded for comparison, never transmitted.';

-- Stripe retries webhook deliveries. Without this, a retry writes a second
-- shadow receipt for the same charge and the comparison reports a duplicate that
-- does not exist. Same guard as the platform rows, scoped to shadow.
create unique index if not exists mydata_submissions_shadow_charge_key
  on mydata_submissions (stripe_charge_id)
  where source = 'shadow' and stripe_charge_id is not null;

/* ---------------------------------------------------------------------------
   2. Its own numbering series
   --------------------------------------------------------------------------- */

-- The whole risk of a shadow run is eating the real receipt numbers while the
-- old system is still issuing them. A separate series removes that entirely: the
-- ΑΠΥ counter is untouched until cutover.
--
-- It starts at 1, deliberately. Numbers here are sequence positions for
-- comparison, not tax identities, and starting at 1 makes a shadow receipt
-- unmistakable at a glance. Correlation is by Stripe charge id, not by number.
insert into mydata_series (series, next_aa, floor_aa, note) values
  ('ΑΠΥ-SHADOW', 1, 1, 'shadow run — records live Stripe charges for comparison, never transmitted')
on conflict (series) do nothing;

/* ---------------------------------------------------------------------------
   3. Keep shadow rows out of the review queue
   --------------------------------------------------------------------------- */

-- Shadow receipts are stored with a terminal status, and the gaps view treats a
-- terminal status as "a number with no document behind it". Left alone it would
-- report every shadow receipt as a hole in the series and bury the 578 real
-- ones. Shadow numbering is not a tax series and has no gaps worth reporting.
create or replace view v_mydata_series_gaps as
with real_rows as (
  select * from mydata_submissions where source <> 'shadow'
), bounds as (
  select series, min(aa) as lo, max(aa) as hi from real_rows group by series
), expected as (
  select b.series, generate_series(b.lo, b.hi) as aa from bounds b
)
select
  e.series,
  e.aa,
  case
    when s.id is null           then 'never_issued'
    when s.status = 'cancelled' then 'cancelled'
    when s.status = 'failed'    then 'failed'
    when s.status = 'skipped'   then 'skipped'
    else 'open'
  end as reason,
  s.issue_date,
  s.stripe_charge_id
from expected e
left join real_rows s on s.series = e.series and s.aa = e.aa
where s.id is null or s.status in ('cancelled', 'failed', 'skipped');

/* ---------------------------------------------------------------------------
   4. Recording one shadow receipt
   --------------------------------------------------------------------------- */

-- Returns the inserted row so the caller can render the document against the AA
-- it was actually given, then store it. Allocating the number and inserting in
-- one transaction is what stops a crash mid-flight from burning a number.
create or replace function mydata_record_shadow(
  p_charge_id  text,
  p_pi_id      text,
  p_gross      int,
  p_issue_date date,
  p_currency   text default 'EUR'
)
returns mydata_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      jsonb := mydata_config();
  v_series text := 'ΑΠΥ-SHADOW';
  v_rate   numeric := coalesce((cfg->>'vat_rate')::numeric, 0.24);
  v_net    int;
  v_vat    int;
  row_out  mydata_submissions;
begin
  if p_charge_id is null or length(p_charge_id) = 0 then
    raise exception 'mydata_record_shadow: charge id is required';
  end if;
  if p_gross is null or p_gross <= 0 then
    raise exception 'mydata_record_shadow: gross must be positive, got %', p_gross;
  end if;
  if coalesce(p_currency, 'EUR') <> 'EUR' then
    -- Not an error worth failing the webhook over; simply not our series.
    return null;
  end if;

  -- Stripe retries deliveries, so this runs more than once for the same charge.
  -- Checked explicitly rather than through ON CONFLICT: inferring a partial
  -- unique index is fiddly, and returning the row we already made is what makes
  -- the caller idempotent too. The unique index is still the backstop for a race.
  select * into row_out from mydata_submissions
   where source = 'shadow' and stripe_charge_id = p_charge_id;
  if row_out.id is not null then
    return row_out;
  end if;

  -- Same split as the trigger and the same as the legacy Python: VAT is the
  -- remainder, so net + vat = gross by construction.
  v_net := round(p_gross::numeric / (1 + v_rate));
  v_vat := p_gross - v_net;

  insert into mydata_submissions (
    source, stripe_charge_id, stripe_pi_id,
    series, aa, issue_date,
    gross_cents, net_cents, vat_cents, currency,
    mode, status, last_error, tax_profile
  ) values (
    'shadow', p_charge_id, p_pi_id,
    v_series, mydata_take_aa(v_series), p_issue_date,
    p_gross, v_net, v_vat, 'EUR',
    -- dry_run and a terminal status: nothing will ever pick this up.
    'dry_run', 'skipped',
    'shadow: recorded for comparison, never transmitted',
    jsonb_build_object(
      'vat_rate', v_rate,
      'issuer_vat', cfg->>'issuer_vat',
      'branch', cfg->'branch',
      'invoice_type', cfg->>'invoice_type',
      'vat_category', cfg->'vat_category',
      'payment_method_type', cfg->'payment_method_type',
      'classification_type', cfg->>'classification_type',
      'classification_category', cfg->>'classification_category'
    )
  )
  returning * into row_out;

  return row_out;
exception
  -- Two deliveries of the same charge arriving at once. The index held; return
  -- whichever row won rather than failing the webhook.
  when unique_violation then
    select * into row_out from mydata_submissions
     where source = 'shadow' and stripe_charge_id = p_charge_id;
    return row_out;
end $$;

revoke all on function mydata_record_shadow(text, text, int, date, text) from public, anon, authenticated;
grant execute on function mydata_record_shadow(text, text, int, date, text) to service_role;

/* ---------------------------------------------------------------------------
   5. The comparison
   --------------------------------------------------------------------------- */

-- Day by day: did both systems see the same charges?
--
-- What this CAN prove: coverage. Every charge the old pipeline filed should have
-- a shadow row, and vice versa. That is exactly the question a shadow run exists
-- to answer — is the new receiving path complete.
--
-- What it CANNOT prove: amounts. The legacy log recorded AA / MARK / date /
-- Stripe ids and no money at all, so there is nothing on that side to compare a
-- figure against. Verifying amounts means asking Stripe, which is a separate job.
create or replace view v_mydata_shadow_compare as
with shadow as (
  select stripe_charge_id as charge, issue_date, gross_cents
    from mydata_submissions
   where source = 'shadow' and stripe_charge_id is not null
), span as (
  select min(issue_date) as from_date from shadow
), legacy as (
  -- Scoped to the shadow period. Without this, every one of the 622 historical
  -- days would report as "theirs only" and drown the days that matter.
  select stripe_charge_id as charge, issue_date, mark
    from mydata_submissions
   where source = 'legacy'
     and stripe_charge_id is not null
     and issue_date >= (select from_date from span)
)
select
  coalesce(s.issue_date, l.issue_date)                              as issue_date,
  count(*) filter (where s.charge is not null)                      as recorded_here,
  count(*) filter (where l.charge is not null)                      as filed_by_old_system,
  count(*) filter (where s.charge is not null and l.charge is null) as here_only,
  count(*) filter (where s.charge is null and l.charge is not null) as old_system_only,
  coalesce(sum(s.gross_cents), 0)                                   as gross_cents
from shadow s
full outer join legacy l on l.charge = s.charge
group by 1
order by 1 desc;

comment on view v_mydata_shadow_compare is
  'Daily coverage comparison between the shadow ingest and the imported PythonAnywhere history. here_only and old_system_only should both be 0; anything else means the two systems are not seeing the same charges.';

revoke all on v_mydata_shadow_compare from anon, authenticated;
