-- 00510_mydata_review.sql
--
-- The human half of myDATA.
--
-- The legacy pipeline mailed a CSV every morning so an employee could scan it,
-- spot the receipts that had gone wrong, and fix those by hand — usually by
-- filing them through the AADE portal directly. That loop is the part 00500 did
-- not replace: it gave the platform retries and controls, but nowhere for a
-- person to record what they did outside the system.
--
-- Without that, a receipt filed by hand stays 'failed' forever, keeps showing up
-- as an open issue, and leaves a permanent false hole in the series.

/* ---------------------------------------------------------------------------
   1. Recording out-of-band work
   --------------------------------------------------------------------------- */

alter table mydata_submissions
  add column if not exists filed_manually boolean not null default false,
  add column if not exists review_note    text,
  add column if not exists reviewed_by    uuid references staff(id) on delete set null,
  add column if not exists reviewed_at    timestamptz;

comment on column mydata_submissions.filed_manually is
  'True when the MARK was obtained outside the platform — typically the AADE portal. The receipt is real; this platform just did not send it.';
comment on column mydata_submissions.review_note is
  'What the reviewer did and why. This is the institutional memory the CSV-and-email loop never kept.';

-- Acknowledge an issue without changing its filing state, so a known-and-accepted
-- problem stops competing for attention with new ones.
create index if not exists mydata_submissions_unreviewed_idx
  on mydata_submissions (status, created_at desc)
  where reviewed_at is null;

/* ---------------------------------------------------------------------------
   2. Record a receipt that a person filed by hand
   --------------------------------------------------------------------------- */

-- Deliberately separate from mydata_settle: that one is the worker's, this one
-- is a person's, and conflating them would make the audit trail ambiguous about
-- who actually transmitted a receipt.
create or replace function mydata_mark_filed(
  p_id    uuid,
  p_mark  text,
  p_staff uuid,
  p_note  text
)
returns mydata_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out mydata_submissions;
  existing text;
begin
  if p_mark is null or length(trim(p_mark)) = 0 then
    raise exception 'mydata_mark_filed: a MARK is required';
  end if;
  if p_mark !~ '^\d+$' then
    raise exception 'mydata_mark_filed: a MARK is all digits, got %', p_mark;
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'mydata_mark_filed: a note is required — say where this MARK came from';
  end if;

  -- A MARK identifies one document at AADE. The same one appearing twice means
  -- someone pasted the wrong number, and accepting it would hide a real gap.
  select id::text into existing from mydata_submissions
   where mark = p_mark and id <> p_id limit 1;
  if existing is not null then
    raise exception 'mydata_mark_filed: MARK % is already recorded on submission %', p_mark, existing;
  end if;

  update mydata_submissions
     set status = 'sent',
         mark = trim(p_mark),
         filed_manually = true,
         sent_at = coalesce(sent_at, now()),
         review_note = p_note,
         reviewed_by = p_staff,
         reviewed_at = now(),
         last_error = null
   where id = p_id
     and status <> 'sent'          -- never overwrite a MARK the platform earned
  returning * into row_out;

  if row_out.id is null then
    raise exception 'mydata_mark_filed: submission % not found, or already filed', p_id;
  end if;
  return row_out;
end $$;

revoke all on function mydata_mark_filed(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function mydata_mark_filed(uuid, text, uuid, text) to service_role;

-- Note a receipt as reviewed without claiming it was filed. For the ones the
-- answer is "this is fine, leave it" — a cancelled duplicate, a legacy hole
-- nobody will ever fill.
create or replace function mydata_review(p_id uuid, p_staff uuid, p_note text)
returns mydata_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out mydata_submissions;
begin
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'mydata_review: a note is required';
  end if;
  update mydata_submissions
     set review_note = p_note, reviewed_by = p_staff, reviewed_at = now()
   where id = p_id
  returning * into row_out;
  if row_out.id is null then
    raise exception 'mydata_review: no submission %', p_id;
  end if;
  return row_out;
end $$;

revoke all on function mydata_review(uuid, uuid, text) from public, anon, authenticated;
grant execute on function mydata_review(uuid, uuid, text) to service_role;

/* ---------------------------------------------------------------------------
   3. Duplicates — the class of error nobody could see before
   --------------------------------------------------------------------------- */

-- One Stripe charge carrying more than one MARK means income declared twice.
-- The legacy log had 31 of these across 20 months and no way to surface them;
-- they were only found by parsing the log after the fact. The unique index in
-- 00500 stops new ones, so in steady state this view shows only imported history.
create or replace view v_mydata_duplicates as
with keyed as (
  select
    coalesce(stripe_charge_id, stripe_pi_id) as charge_key,
    id, series, aa, mark, issue_date, source, status, gross_cents, filed_manually, reviewed_at
  from mydata_submissions
  where status = 'sent'
    and coalesce(stripe_charge_id, stripe_pi_id) is not null
), counted as (
  select charge_key, count(*) as filings from keyed group by charge_key having count(*) > 1
)
select
  k.charge_key,
  c.filings,
  k.id, k.series, k.aa, k.mark, k.issue_date, k.source, k.gross_cents,
  k.filed_manually, k.reviewed_at,
  -- The earliest number is the one to keep; the rest are the surplus that needs
  -- a credit note.
  (k.aa = min(k.aa) over (partition by k.charge_key)) as is_original
from keyed k
join counted c on c.charge_key = k.charge_key;

comment on view v_mydata_duplicates is
  'Charges filed more than once. is_original marks the receipt to keep; the others are surplus declared income.';

/* ---------------------------------------------------------------------------
   4. One queue for everything that needs a person
   --------------------------------------------------------------------------- */

-- The panel reads this instead of assembling four separate lists. Each row is a
-- unit of work with a severity, so the employee's morning is "work this list
-- until it is empty" rather than "read a CSV and hope you spot something".
create or replace view v_mydata_issues as
-- Receipts the platform could not file.
select
  'failed'::text                              as kind,
  'high'::text                                as severity,
  s.id                                        as submission_id,
  s.series, s.aa, s.issue_date,
  s.stripe_charge_id, s.gross_cents,
  coalesce(s.last_error, 'no error recorded')  as detail,
  s.reviewed_at
from mydata_submissions s
where s.status = 'failed'

union all

-- Money taken with no receipt anywhere. The worst kind: invisible until asked for.
select
  'no_receipt', 'high',
  null::uuid,
  null::text, null::bigint, (m.created_at at time zone 'UTC')::date,
  m.stripe_pi_id, m.amount_cents,
  'succeeded payment with no myDATA submission',
  null::timestamptz
from v_mydata_missing m

union all

-- Income declared more than once.
select
  'duplicate', 'high',
  d.id,
  d.series, d.aa, d.issue_date,
  d.charge_key, d.gross_cents,
  'charge filed ' || d.filings || ' times; this one is ' ||
    case when d.is_original then 'the original to keep' else 'surplus — needs a credit note' end,
  d.reviewed_at
from v_mydata_duplicates d
where not d.is_original

union all

-- Numbers with no document behind them.
select
  'gap', 'medium',
  null::uuid,
  g.series, g.aa, g.issue_date,
  g.stripe_charge_id, null::int,
  'AA has no MARK at AADE (' || g.reason || ')',
  null::timestamptz
from v_mydata_series_gaps g

union all

-- Stuck in flight far longer than the backoff should allow.
select
  'stalled', 'medium',
  s.id,
  s.series, s.aa, s.issue_date,
  s.stripe_charge_id, s.gross_cents,
  'in ' || s.status || ' for ' || age(now(), s.created_at) || ' after ' || s.attempts || ' attempts',
  s.reviewed_at
from mydata_submissions s
where s.status in ('pending', 'sending')
  and s.created_at < now() - interval '6 hours';

comment on view v_mydata_issues is
  'Everything about myDATA that needs a human, in one list. Empty is the goal; reviewed_at marks the ones already dealt with.';

revoke all on v_mydata_duplicates, v_mydata_issues from anon, authenticated;

/* ---------------------------------------------------------------------------
   5. Daily rollup with the review state folded in
   --------------------------------------------------------------------------- */

-- This is the CSV that used to arrive by email, except it is never a day stale
-- and it says how many rows still need attention.
create or replace view v_mydata_daily_review as
select
  s.issue_date,
  s.series,
  s.mode,
  count(*)                                                    as receipts,
  count(*) filter (where s.status = 'sent')                   as sent,
  count(*) filter (where s.status = 'sent' and s.filed_manually) as filed_by_hand,
  count(*) filter (where s.status = 'failed')                 as failed,
  count(*) filter (where s.status in ('pending', 'sending'))  as in_flight,
  count(*) filter (where s.status = 'cancelled')              as cancelled,
  coalesce(sum(s.gross_cents), 0)                             as gross_cents,
  coalesce(sum(s.net_cents), 0)                               as net_cents,
  coalesce(sum(s.vat_cents), 0)                               as vat_cents,
  min(s.aa)                                                   as first_aa,
  max(s.aa)                                                   as last_aa
from mydata_submissions s
group by s.issue_date, s.series, s.mode;

revoke all on v_mydata_daily_review from anon, authenticated;
