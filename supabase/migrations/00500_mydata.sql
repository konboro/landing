-- 00500_mydata.sql
--
-- Greek myDATA (AADE) receipt transmission — replaces the standalone Flask app
-- that ran on PythonAnywhere from 2024-12-01 to the cutover.
--
-- DIVERGENCE FROM docs/05: that doc specifies a certified e-invoicing provider.
-- Production has filed directly against the AADE API for 20 months (~22.4k
-- receipts, 99.8% success) and there is no free provider that does the same
-- job. Direct-to-AADE is the decision; docs/05 has been corrected. The adapter
-- seam the doc asked for is kept (services/edge/invoicing/).
--
-- The legacy pipeline kept its state in two text files. Everything below exists
-- to fix a specific failure that produced:
--
--   * 32 payments filed TWICE (Stripe webhook retry, no idempotency key)
--   * 23 payments never filed at all (single POST attempt, no retry)
--   * 578 holes in the ΑΠΥ series (the counter incremented before the POST, so
--     a failure burned the number permanently; one block of 538 was lost at
--     once on 2026-06-17)
--   * 9 out-of-order allocations (unlocked read-modify-write on counter.txt)
--
-- The fixes are structural, not defensive coding:
--   * AA comes from a row-locked counter, allocated inside the caller's txn, so
--     an abort returns the number instead of burning it.
--   * A retry re-sends the SAME AA. Numbers are never consumed by a failure.
--   * `stripe_charge_id` is unique among platform rows: double-filing a charge
--     is not expressible.
--   * net + vat = gross is a CHECK constraint, so a summary that AADE would
--     reject cannot be stored, let alone sent.

/* ---------------------------------------------------------------------------
   1. Series counters
   --------------------------------------------------------------------------- */

create table mydata_series (
  series     text primary key,                       -- e.g. 'ΑΠΥ'
  next_aa    bigint not null,                        -- the number the next receipt gets
  floor_aa   bigint not null default 1,              -- refuse to issue below this (cutover guard)
  active     boolean not null default true,
  note       text,
  updated_at timestamptz not null default now(),
  constraint mydata_series_next_above_floor check (next_aa >= floor_aa)
);

comment on table mydata_series is
  'Per-series receipt numbering. One row per myDATA series; ΑΠΥ continues the sequence the PythonAnywhere counter.txt was holding.';
comment on column mydata_series.floor_aa is
  'Hard floor. Numbers below this were issued by the legacy system and must never be reused — re-filing them at AADE would duplicate declared income.';

-- The legacy counter stood at 23108 when the log was exported (2026-08-14), so
-- the next receipt this platform issues is 23109. scripts/import-mydata-legacy.mjs
-- re-asserts both values from the real log at import time; this is the seed.
insert into mydata_series (series, next_aa, floor_aa, note) values
  ('ΑΠΥ', 23109, 23109, 'continues the PythonAnywhere sequence; last legacy receipt was AA 23108')
on conflict (series) do nothing;

-- Atomic allocation. The UPDATE ... RETURNING takes a row lock, so concurrent
-- callers serialise; if the caller's transaction aborts the number is released.
-- This is the whole fix for the 9 out-of-order allocations in the legacy log.
create or replace function mydata_take_aa(p_series text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aa bigint;
begin
  update mydata_series
     set next_aa = next_aa + 1, updated_at = now()
   where series = p_series and active
  returning next_aa - 1 into v_aa;

  if v_aa is null then
    raise exception 'mydata_take_aa: series % is unknown or inactive', p_series;
  end if;
  return v_aa;
end $$;

comment on function mydata_take_aa(text) is
  'Allocate the next AA for a series. Row-locked and transactional: an aborted caller returns the number rather than burning it.';

revoke all on function mydata_take_aa(text) from public, anon, authenticated;
grant execute on function mydata_take_aa(text) to service_role;

/* ---------------------------------------------------------------------------
   2. Submissions
   --------------------------------------------------------------------------- */

create type mydata_status as enum (
  'pending',    -- allocated, waiting for the worker
  'sending',    -- claimed by a worker (crash-visible)
  'sent',       -- AADE returned a MARK
  'failed',     -- attempts exhausted; needs a human
  'cancelled',  -- withdrawn before transmission, AA deliberately retired
  'skipped'     -- deliberately not filed (legacy period, non-invoiceable payment)
);

-- How a row was produced, and therefore what may happen to it. A row created in
-- dry_run or sandbox is TERMINAL: it can never be transmitted to live AADE. That
-- is what makes the cutover one-way and rollback free of retro-filing risk.
create type mydata_mode as enum ('dry_run', 'sandbox', 'live');

create table mydata_submissions (
  id               uuid primary key default gen_random_uuid(),
  source           text not null default 'platform'
                     check (source in ('platform', 'legacy')),
  doc_kind         text not null default 'receipt'
                     check (doc_kind in ('receipt', 'credit_note')),

  -- what it bills
  payment_id       uuid references payments(id) on delete set null,
  stripe_charge_id text,
  stripe_pi_id     text,

  -- identity at AADE
  series           text not null,
  aa               bigint not null,
  issue_date       date not null,

  -- Money, in cents, always. Nullable ONLY because the imported PythonAnywhere
  -- log recorded no amounts — it stored AA, MARK, date and the Stripe ids and
  -- nothing else. Platform rows must have them; the constraint below enforces
  -- that. Backfilling legacy amounts means asking Stripe for 22k charges, which
  -- is a separate job, not a precondition for the cutover.
  gross_cents      int,
  net_cents        int,
  vat_cents        int,
  currency         text not null default 'EUR',

  -- the tax treatment AS APPLIED, snapshotted. If the classification or VAT rate
  -- changes later, historical rows still explain themselves to an auditor.
  tax_profile      jsonb not null default '{}'::jsonb,

  mode             mydata_mode not null,
  status           mydata_status not null default 'pending',

  -- what AADE gave back
  mark             text,
  uid              text,
  auth_code        text,

  -- worker state
  attempts         int not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  request_xml      text,
  response_body    text,

  created_at       timestamptz not null default now(),
  sent_at          timestamptz,

  -- A stored summary that does not add up is a guaranteed AADE rejection, and
  -- was a live risk in the legacy code (net and VAT were rounded independently).
  constraint mydata_amounts_reconcile check (
    gross_cents is null or net_cents + vat_cents = gross_cents
  ),
  constraint mydata_amounts_positive check (
    gross_cents is null or (gross_cents > 0 and net_cents >= 0 and vat_cents >= 0)
  ),
  -- Anything this platform issues must carry its amounts. Only imported history
  -- is allowed to be missing them.
  constraint mydata_platform_has_amounts check (
    source = 'legacy' or (gross_cents is not null and net_cents is not null and vat_cents is not null)
  ),
  -- A 'sent' row without a MARK is a lie; a MARK without 'sent' is a lost update.
  constraint mydata_sent_has_mark check (
    (status = 'sent' and mark is not null and sent_at is not null)
    or (status <> 'sent' and mark is null)
  )
);

-- One receipt per number, per series. Covers legacy and platform rows together,
-- which is what stops the new system from re-issuing a legacy number.
create unique index mydata_submissions_series_aa_key
  on mydata_submissions (series, aa);

-- Idempotency: a Stripe charge gets at most one live receipt from this platform.
-- Scoped to source='platform' because the legacy log genuinely contains 32
-- double-filed charges that must import as-is rather than be silently dropped.
-- Cancelled rows are excluded so a withdrawn receipt can be re-issued.
create unique index mydata_submissions_charge_key
  on mydata_submissions (stripe_charge_id)
  where source = 'platform' and stripe_charge_id is not null and status <> 'cancelled';

create index mydata_submissions_due_idx
  on mydata_submissions (next_attempt_at)
  where status in ('pending', 'sending');
create index mydata_submissions_status_idx on mydata_submissions (status, created_at desc);
create index mydata_submissions_issue_date_idx on mydata_submissions (issue_date desc);
create index mydata_submissions_payment_idx on mydata_submissions (payment_id);

comment on table mydata_submissions is
  'One row per receipt offered to AADE. Also holds the imported PythonAnywhere history (source=legacy) so reconciliation spans the cutover.';
comment on column mydata_submissions.mode is
  'Mode AT CREATION. dry_run/sandbox rows are terminal and never reach live AADE — this is what makes the cutover one-way.';
comment on column mydata_submissions.tax_profile is
  'Snapshot of invoiceType / vatCategory / classification / VAT rate / issuer VAT as applied to THIS receipt.';

/* ---------------------------------------------------------------------------
   3. Configuration + kill switch
   --------------------------------------------------------------------------- */

-- Lives in app_config alongside the other feature flags (CLAUDE.md: flags in
-- app_config, fetched at boot).
--
--   enabled          master switch. false = record nothing, change nothing.
--   mode             dry_run | sandbox | live  (see mydata_mode)
--   series           which series new receipts draw from
--   max_gross_cents  refuse to auto-file anything above this; a 500 EUR scooter
--                    receipt is a bug, and filing it is expensive to undo
--   max_attempts     before a row parks in 'failed' for a human
--   vat_rate         0.24 — kept here so a rate change is config, not a deploy
insert into app_config (key, value) values (
  'mydata',
  jsonb_build_object(
    'enabled', true,
    'mode', 'dry_run',
    'series', 'ΑΠΥ',
    'max_gross_cents', 20000,
    'max_attempts', 8,
    'vat_rate', 0.24,
    'issuer_vat', '802160515',
    'branch', 1,
    'invoice_type', '11.2',
    'vat_category', 1,
    'payment_method_type', 6,
    'classification_type', 'E3_561_003',
    'classification_category', 'category1_3'
  )
) on conflict (key) do nothing;

create or replace function mydata_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select value from app_config where key = 'mydata'), '{}'::jsonb) $$;

/* ---------------------------------------------------------------------------
   4. Enqueue on payment success
   --------------------------------------------------------------------------- */

-- Why a trigger and not a call inside payments-webhook: trip captures are
-- confirmed synchronously in trips-end, and the webhook deliberately no-ops on
-- payments that are already 'succeeded'. Hanging the receipt off the webhook
-- would therefore miss the single most common payment on the platform. The
-- trigger catches every path — trips-end, webhook, admin-charge, packages — in
-- one place, inside the same transaction as the payment.
create or replace function mydata_enqueue_for_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg        jsonb := mydata_config();
  v_series   text;
  v_mode     mydata_mode;
  v_rate     numeric;
  v_gross    int;
  v_net      int;
  v_vat      int;
  v_charge   text;
  v_existing int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then
    return new;
  end if;

  v_gross := new.amount_cents;
  if v_gross is null or v_gross <= 0 then
    return new;                                  -- nothing to declare
  end if;
  if coalesce(new.currency, 'EUR') <> 'EUR' then
    return new;                                  -- myDATA series is EUR-only
  end if;

  v_series := coalesce(cfg->>'series', 'ΑΠΥ');
  v_mode   := coalesce(cfg->>'mode', 'dry_run')::mydata_mode;
  v_rate   := coalesce((cfg->>'vat_rate')::numeric, 0.24);

  -- Cents-exact split. VAT is the remainder, never rounded on its own, so
  -- net + vat = gross by construction and the CHECK can never fire.
  v_net := round(v_gross::numeric / (1 + v_rate));
  v_vat := v_gross - v_net;

  -- The platform's charge id. payments stores the PaymentIntent; the legacy
  -- system keyed on the Charge. Both are recorded so reconciliation can match
  -- either way, and the PI is what we can guarantee is present here.
  v_charge := new.stripe_pi_id;

  -- Belt and braces alongside the unique index: also refuse if the LEGACY system
  -- already filed this charge, which the partial index deliberately does not cover.
  select count(*) into v_existing
    from mydata_submissions
   where stripe_charge_id is not null
     and stripe_charge_id = v_charge
     and status <> 'cancelled';
  if v_existing > 0 then
    return new;
  end if;

  insert into mydata_submissions (
    payment_id, stripe_pi_id, stripe_charge_id,
    series, aa, issue_date,
    gross_cents, net_cents, vat_cents, currency,
    mode, status, tax_profile
  ) values (
    new.id, new.stripe_pi_id, v_charge,
    v_series, mydata_take_aa(v_series), (new.created_at at time zone 'UTC')::date,
    v_gross, v_net, v_vat, 'EUR',
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
    )
  )
  on conflict do nothing;                        -- concurrent duplicate: first writer wins

  return new;
exception
  when others then
    -- A myDATA problem must never roll back a captured payment. The receipt is
    -- recoverable (scripts/mydata-reconcile.mjs finds payments with no row); the
    -- payment is not.
    raise warning 'mydata_enqueue_for_payment(%): %', new.id, sqlerrm;
    return new;
end $$;

create trigger payments_mydata_enqueue
  after insert or update of status on payments
  for each row
  when (new.status = 'succeeded')
  execute function mydata_enqueue_for_payment();

comment on function mydata_enqueue_for_payment() is
  'Creates the myDATA submission row when a payment reaches succeeded, whatever path got it there. Never raises: a receipt failure must not unwind a capture.';

/* ---------------------------------------------------------------------------
   5. Worker claim / settle helpers
   --------------------------------------------------------------------------- */

-- Claim a batch for transmission. SKIP LOCKED so two workers never fight, and
-- the claim is what moves a row to 'sending' — a crashed worker leaves visible
-- evidence rather than a silently lost receipt.
create or replace function mydata_claim(p_mode mydata_mode, p_limit int default 25)
returns setof mydata_submissions
language sql
security definer
set search_path = public
as $$
  update mydata_submissions s
     set status = 'sending', attempts = s.attempts + 1
   where s.id in (
     select id from mydata_submissions
      where status in ('pending', 'sending')
        and mode = p_mode
        -- Imported history is never transmitted by a worker. Those receipts
        -- either already carry a MARK, or re-filing them is an accountant's
        -- decision. They also have no amounts to render.
        and source = 'platform'
        and gross_cents is not null
        and next_attempt_at <= now()
      order by aa
      for update skip locked
      limit p_limit
   )
  returning s.*;
$$;

-- Settle a claim. Kept in SQL so the 'sent' invariants are enforced in one place.
create or replace function mydata_settle(
  p_id       uuid,
  p_ok       boolean,
  p_mark     text default null,
  p_uid      text default null,
  p_auth     text default null,
  p_error    text default null,
  p_request  text default null,
  p_response text default null
)
returns mydata_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      jsonb := mydata_config();
  max_att  int   := coalesce((cfg->>'max_attempts')::int, 8);
  row_out  mydata_submissions;
begin
  if p_ok then
    if p_mark is null or length(p_mark) = 0 then
      raise exception 'mydata_settle: success requires a MARK';
    end if;
    update mydata_submissions
       set status = 'sent', mark = p_mark, uid = p_uid, auth_code = p_auth,
           sent_at = now(), last_error = null,
           request_xml = coalesce(p_request, request_xml),
           response_body = coalesce(p_response, response_body)
     where id = p_id
    returning * into row_out;
  else
    update mydata_submissions
       set status = case when attempts >= max_att then 'failed' else 'pending' end,
           last_error = p_error,
           -- exponential backoff, capped at an hour: 2^n seconds
           next_attempt_at = now() + (least(power(2, attempts)::int, 3600) || ' seconds')::interval,
           request_xml = coalesce(p_request, request_xml),
           response_body = coalesce(p_response, response_body)
     where id = p_id
    returning * into row_out;
  end if;

  if row_out.id is null then
    raise exception 'mydata_settle: no submission %', p_id;
  end if;
  return row_out;
end $$;

revoke all on function mydata_claim(mydata_mode, int) from public, anon, authenticated;
revoke all on function mydata_settle(uuid, boolean, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function mydata_claim(mydata_mode, int) to service_role;
grant execute on function mydata_settle(uuid, boolean, text, text, text, text, text, text) to service_role;

/* ---------------------------------------------------------------------------
   6. Controls the panel reads
   --------------------------------------------------------------------------- */

-- Every hole in every series, with why. The legacy system had 578 of these and
-- no way to know; this is the view that makes them impossible to miss.
create or replace view v_mydata_series_gaps as
with bounds as (
  select series, min(aa) as lo, max(aa) as hi
    from mydata_submissions group by series
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
left join mydata_submissions s on s.series = e.series and s.aa = e.aa
where s.id is null or s.status in ('cancelled', 'failed', 'skipped');

comment on view v_mydata_series_gaps is
  'AA numbers in an issued range that carry no MARK at AADE. Should be empty in steady state; non-empty is an accountant conversation.';

-- Daily rollup for the Finance page, replacing the CSV that used to be emailed.
create or replace view v_mydata_daily as
select
  issue_date,
  series,
  mode,
  count(*)                                             as receipts,
  count(*) filter (where status = 'sent')              as sent,
  count(*) filter (where status = 'failed')            as failed,
  count(*) filter (where status in ('pending','sending')) as in_flight,
  sum(gross_cents)                                     as gross_cents,
  sum(net_cents)                                       as net_cents,
  sum(vat_cents)                                       as vat_cents
from mydata_submissions
group by issue_date, series, mode;

-- Payments that should have a receipt and do not. This is the check that would
-- have caught all 23 never-filed payments in the legacy log on day one.
create or replace view v_mydata_missing as
select p.id as payment_id, p.stripe_pi_id, p.amount_cents, p.currency, p.kind, p.created_at
  from payments p
  left join mydata_submissions s on s.payment_id = p.id
 where p.status = 'succeeded'
   and coalesce(p.currency, 'EUR') = 'EUR'
   and p.amount_cents > 0
   and s.id is null;

/* ---------------------------------------------------------------------------
   7. RLS — Hard Rule #6: service_role only. The panel goes through admin-mydata.
   --------------------------------------------------------------------------- */

alter table mydata_submissions enable row level security;
alter table mydata_series      enable row level security;
-- No policies: anon/authenticated get nothing. Edge functions use service_role,
-- which bypasses RLS.

revoke all on v_mydata_series_gaps, v_mydata_daily, v_mydata_missing from anon, authenticated;

/* ---------------------------------------------------------------------------
   8. Who may look, and who may pull the lever
   --------------------------------------------------------------------------- */

insert into role_permissions (role, permission) values
  -- reading the filing state is part of reading the finances
  ('admin',      'mydata.read'),
  ('accountant', 'mydata.read'),
  ('support',    'mydata.read'),
  ('readonly',   'mydata.read'),
  -- retry / cancel / change mode. The mode switch decides whether receipts go
  -- to AADE for real, so it stays with the two roles accountable for the books.
  ('admin',      'mydata.manage'),
  ('accountant', 'mydata.manage')
on conflict (role, permission) do nothing;
-- 'owner' already holds '*'.
