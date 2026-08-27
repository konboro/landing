-- 00530_mydata_issue_review.sql
--
-- Make the review queue workable.
--
-- 00510 built the queue but hung every action off `mydata_submissions`: retry,
-- cancel, mark-filed and the review note all write to a receipt row. Two of the
-- five issue kinds have no receipt row at all —
--
--   * `gap`        — a number consumed with no document behind it
--   * `no_receipt` — a succeeded payment that never produced a submission
--
-- so they had no actions, and, worse, no way to be acknowledged. Once the 20
-- months of history import, those two kinds are ~600 of ~640 rows. A queue where
-- 94% of the entries cannot be touched or dismissed is not a queue; it is a
-- permanent red number that people learn to ignore.
--
-- Two things fix it: somewhere to record a decision about an issue that has no
-- receipt, and a real action for the one kind that can actually be fixed.

/* ---------------------------------------------------------------------------
   1. A decision, recorded against the issue rather than the receipt
   --------------------------------------------------------------------------- */

create table if not exists mydata_issue_reviews (
  issue_kind  text not null,
  -- Stable identity for an issue with no row of its own:
  --   gap:<series>:<aa>      payment:<uuid>      submission:<uuid>
  issue_key   text not null,
  note        text not null,
  reviewed_by uuid references staff(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  primary key (issue_kind, issue_key)
);

comment on table mydata_issue_reviews is
  'Human decisions about myDATA issues that have no receipt row to write on — chiefly series gaps and payments with no receipt.';
comment on column mydata_issue_reviews.issue_key is
  'Stable identity for the issue. Not a foreign key: the whole point is that the thing being reviewed may not exist as a row.';

alter table mydata_issue_reviews enable row level security;

create or replace function mydata_ack_issue(
  p_kind  text,
  p_key   text,
  p_staff uuid,
  p_note  text
)
returns mydata_issue_reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out mydata_issue_reviews;
begin
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'mydata_ack_issue: a note is required — say what was decided and why';
  end if;
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'mydata_ack_issue: an issue key is required';
  end if;

  insert into mydata_issue_reviews (issue_kind, issue_key, note, reviewed_by)
  values (p_kind, p_key, trim(p_note), p_staff)
  on conflict (issue_kind, issue_key) do update
    set note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = now()
  returning * into row_out;

  return row_out;
end $$;

revoke all on function mydata_ack_issue(text, text, uuid, text) from public, anon, authenticated;
grant execute on function mydata_ack_issue(text, text, uuid, text) to service_role;

/* ---------------------------------------------------------------------------
   2. Issue a receipt for a payment that never got one
   --------------------------------------------------------------------------- */

-- The trigger in 00500 does this for new payments. Pulling the body out means a
-- receipt issued by hand from the queue is built by exactly the same code as one
-- issued automatically — rather than a second implementation that drifts.
create or replace function mydata_issue_receipt(p_payment uuid, p_staff uuid default null)
returns mydata_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      jsonb := mydata_config();
  pay      payments;
  v_series text;
  v_mode   mydata_mode;
  v_rate   numeric;
  v_net    int;
  v_vat    int;
  v_exists int;
  row_out  mydata_submissions;
begin
  select * into pay from payments where id = p_payment;
  if pay.id is null then
    raise exception 'mydata_issue_receipt: no payment %', p_payment;
  end if;
  if pay.status <> 'succeeded' then
    raise exception 'mydata_issue_receipt: payment % is %, not succeeded', p_payment, pay.status;
  end if;
  if coalesce(pay.amount_cents, 0) <= 0 then
    raise exception 'mydata_issue_receipt: payment % has no amount', p_payment;
  end if;
  if coalesce(pay.currency, 'EUR') <> 'EUR' then
    raise exception 'mydata_issue_receipt: payment % is %, myDATA series is EUR only', p_payment, pay.currency;
  end if;

  -- Covers both the platform's own rows and anything the legacy system filed
  -- for the same charge. Re-issuing over either would double-declare income.
  select count(*) into v_exists
    from mydata_submissions
   where status <> 'cancelled'
     and (payment_id = pay.id
          or (stripe_charge_id is not null and stripe_charge_id = pay.stripe_pi_id));
  if v_exists > 0 then
    raise exception 'mydata_issue_receipt: payment % already has a receipt', p_payment;
  end if;

  v_series := coalesce(cfg->>'series', 'ΑΠΥ');
  v_mode   := coalesce(cfg->>'mode', 'dry_run')::mydata_mode;
  v_rate   := coalesce((cfg->>'vat_rate')::numeric, 0.24);
  v_net    := round(pay.amount_cents::numeric / (1 + v_rate));
  v_vat    := pay.amount_cents - v_net;

  insert into mydata_submissions (
    payment_id, stripe_pi_id, stripe_charge_id,
    series, aa, issue_date,
    gross_cents, net_cents, vat_cents, currency,
    mode, status, tax_profile,
    review_note, reviewed_by, reviewed_at
  ) values (
    pay.id, pay.stripe_pi_id, pay.stripe_pi_id,
    v_series, mydata_take_aa(v_series), (pay.created_at at time zone 'UTC')::date,
    pay.amount_cents, v_net, v_vat, 'EUR',
    v_mode, 'pending',
    jsonb_build_object(
      'vat_rate', v_rate,
      'issuer_vat', cfg->>'issuer_vat',
      'branch', cfg->'branch',
      'invoice_type', cfg->>'invoice_type',
      'vat_category', cfg->'vat_category',
      'payment_method_type', cfg->'payment_method_type',
      'classification_type', cfg->>'classification_type',
      'classification_category', cfg->>'classification_category'
    ),
    case when p_staff is null then null else 'Issued by hand from the review queue.' end,
    p_staff,
    case when p_staff is null then null else now() end
  )
  returning * into row_out;

  return row_out;
end $$;

revoke all on function mydata_issue_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function mydata_issue_receipt(uuid, uuid) to service_role;

comment on function mydata_issue_receipt(uuid, uuid) is
  'Create the receipt for a succeeded payment that has none. Same construction as the automatic trigger, so a hand-issued receipt is identical to an automatic one.';

/* ---------------------------------------------------------------------------
   3. Every issue gets an identity and a review state
   --------------------------------------------------------------------------- */

-- CREATE OR REPLACE, not DROP: v_mydata_health counts from this view. Existing
-- columns keep their name, type and position; the two new ones are appended.
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
  and s.created_at < now() - interval '6 hours';

comment on view v_mydata_issues is
  'Everything about myDATA needing a human. Every row carries an issue_key so it can be acknowledged, including the kinds that have no receipt row of their own.';

/* ---------------------------------------------------------------------------
   4. Acknowledging in bulk
   --------------------------------------------------------------------------- */

-- The 578 inherited gaps are one decision, not 578. Making somebody click them
-- individually would guarantee the queue is abandoned on day one.
create or replace function mydata_ack_gap_range(
  p_series text,
  p_from   bigint,
  p_to     bigint,
  p_staff  uuid,
  p_note   text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'mydata_ack_gap_range: a note is required';
  end if;
  if p_to < p_from then
    raise exception 'mydata_ack_gap_range: % is below %', p_to, p_from;
  end if;

  insert into mydata_issue_reviews (issue_kind, issue_key, note, reviewed_by)
  select 'gap', 'gap:' || g.series || ':' || g.aa::text, trim(p_note), p_staff
    from v_mydata_series_gaps g
   where g.series = p_series and g.aa between p_from and p_to
  on conflict (issue_kind, issue_key) do update
    set note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = now();

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function mydata_ack_gap_range(text, bigint, bigint, uuid, text) from public, anon, authenticated;
grant execute on function mydata_ack_gap_range(text, bigint, bigint, uuid, text) to service_role;

revoke all on mydata_issue_reviews from anon, authenticated;
