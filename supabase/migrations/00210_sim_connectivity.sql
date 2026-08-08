-- 00210_sim_connectivity.sql
-- SIM / connectivity management (docs/15).
--
-- Every FMB930 in the fleet carries an IoT SIM (currently Truphone, now trading as
-- 1GLOBAL). This migration adds the managed inventory for those SIMs, their daily
-- usage rollup, their event log, the read models the admin panel binds to, and the
-- alert rules that feed the docs/12 notification engine.
--
-- Boundaries this file respects:
--   * Hard Rule #6  — sims / sim_usage_daily / sim_events are service_role ONLY.
--                     The panel reads them through the sim-* edge functions.
--   * Hard Rule #7  — IMEI stays the device identity, ICCID is the SIM identity.
--                     Neither is ever used as a business key; the link is a uuid FK.
--   * Hard Rule #10 — ICCID / IMSI / MSISDN / provider ids are stored as EXACT text.
--                     Nothing here strips spaces, trims leading zeros, normalizes a
--                     '+' prefix or casts to a number. Ever.
--   * Hard Rule #12 — schema only via this file.
--
-- The provider is deliberately plain text, not an enum: MNOs get acquired and renamed
-- (Truphone -> 1GLOBAL is exactly that), and a rename must not need a migration.

-- ===========================================================================
-- 1. Tables
-- ===========================================================================

create table if not exists sims (
  id                 uuid primary key default gen_random_uuid(),
  -- Integrated Circuit Card Id, printed on the SIM. Exact text (Hard Rule #10):
  -- 19 or 20 digits depending on the issuer, sometimes with a Luhn check digit.
  iccid              text not null unique,
  imsi               text,                                  -- exact text, may be null until provisioned
  msisdn             text,                                  -- the SMS-fallback number (docs/03)
  provider           text not null default 'truphone',      -- truphone | other; free text on purpose
  provider_sim_id    text,                                  -- the provider's own id/href for API calls
  status             text not null default 'inventory',
  activated_at       timestamptz,
  suspended_at       timestamptz,
  terminated_at      timestamptz,
  plan_name          text,                                  -- e.g. 'IoT 500MB'
  plan_data_mb       int,                                   -- bundle allowance per cycle
  cycle_start        date,
  cycle_end          date,
  monthly_cost_cents int not null default 0,
  device_id          uuid references devices(id) on delete set null,
  label              text,
  notes              text,
  last_seen_at       timestamptz,                           -- last time the provider saw it on a network
  network            text,                                  -- last known operator (e.g. 'COSMOTE')
  country            text,                                  -- last known MCC country (ISO 3166-1 alpha-2)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint sims_status_chk check (
    status in ('inventory', 'active', 'suspended', 'terminated', 'test')
  )
);

create index if not exists sims_status_idx     on sims (status);
create index if not exists sims_device_id_idx  on sims (device_id);
create index if not exists sims_provider_idx   on sims (provider, provider_sim_id);
create index if not exists sims_last_seen_idx  on sims (last_seen_at desc nulls last);

comment on table sims is
  'Managed IoT SIM inventory (docs/15). One row per physical SIM, spare or fitted. '
  'service_role ONLY (Hard Rule #6) — the admin panel reads it via the sim-* edge functions.';
comment on column sims.iccid is
  'SIM identity. EXACT printed value (Hard Rule #10) — never trimmed, re-spaced or numeric-cast. '
  'This is also the join key sim-sync uses to auto-link a SIM to devices.iccid.';
comment on column sims.msisdn is
  'SIM phone number. This is the target of the gateway SMS command fallback (docs/03); it must '
  'stay identical to devices.phone_number for the fitted device.';
comment on column sims.provider is
  'Free text, not an enum: MNOs rename and get acquired (Truphone -> 1GLOBAL). Adding an operator '
  'must not require a migration — see the SimProvider adapter in services/edge/_shared/simprovider.ts.';
comment on column sims.device_id is
  'Which device this SIM physically sits in. Set by sim-sync on an exact ICCID match, or manually. '
  'A swapped-out SIM keeps this link until ops clears it — v_sim_alerts flags a terminated SIM that '
  'is still pointing at a device, which is why there is no unique constraint here.';
comment on column sims.status is
  'inventory (in the drawer) | active | suspended | terminated | test (bench SIM). '
  'Mirrors the provider state; sim-sync reconciles it, sim-command changes it.';

create table if not exists sim_usage_daily (
  id         uuid primary key default gen_random_uuid(),
  sim_id     uuid not null references sims(id) on delete cascade,
  day        date not null,
  data_mb    numeric(14,3) not null default 0,
  sms_out    int not null default 0,
  sms_in     int not null default 0,
  cost_cents int not null default 0,
  network    text,
  country    text,
  created_at timestamptz not null default now(),
  unique (sim_id, day)
);

create index if not exists sim_usage_daily_sim_day_idx on sim_usage_daily (sim_id, day desc);
create index if not exists sim_usage_daily_day_idx     on sim_usage_daily (day desc);

comment on table sim_usage_daily is
  'One row per SIM per UTC day, upserted idempotently by sim-sync on (sim_id, day). '
  'data_mb is megabytes as the provider reports them; cost_cents is EUR cents, usage only '
  '(the recurring bundle fee lives on sims.monthly_cost_cents).';

create table if not exists sim_events (
  id       uuid primary key default gen_random_uuid(),
  sim_id   uuid not null references sims(id) on delete cascade,
  at       timestamptz not null default now(),
  kind     text not null,
  detail   jsonb not null default '{}'::jsonb,
  staff_id uuid references staff(id) on delete set null,
  reason   text,
  constraint sim_events_kind_chk check (
    kind in ('created', 'activated', 'suspended', 'resumed', 'terminated',
             'plan_changed', 'synced', 'linked', 'unlinked', 'alert')
  )
);

create index if not exists sim_events_sim_at_idx on sim_events (sim_id, at desc);
create index if not exists sim_events_kind_idx   on sim_events (kind, at desc);

comment on table sim_events is
  'Append-style connectivity history for a SIM. Written by sim-sync (kind=synced) and '
  'sim-command (lifecycle kinds). It complements audit_log — audit_log records WHO did it '
  '(Hard Rule #8), sim_events records WHAT the SIM did, including provider-side changes '
  'that had no staff actor.';

-- ---------------------------------------------------------------------------
-- devices.sim_id — the managed link from the device side.
-- ---------------------------------------------------------------------------
alter table devices add column if not exists sim_id uuid references sims(id) on delete set null;
create index if not exists devices_sim_id_idx on devices (sim_id);

comment on column devices.sim_id is
  'The device''s CURRENT managed SIM (a sims row). Maintained by sim-sync / sim-command. '
  'This is the link business code should follow; devices.iccid stays as the label of record.';
comment on column devices.iccid is
  'The ICCID printed on the SIM fitted in this device — the label of record, kept exactly as '
  'entered (Hard Rule #10). It is the human/paperwork value and the key sim-sync matches on; '
  'devices.sim_id is the managed relational link to the sims row.';

-- ---------------------------------------------------------------------------
-- RLS: enabled with NO anon/authenticated policy => service_role only,
-- exactly like telemetry / commands / sumsub_* (00140, 00180).
-- ---------------------------------------------------------------------------
alter table sims             enable row level security;
alter table sim_usage_daily  enable row level security;
alter table sim_events       enable row level security;
revoke all on sims, sim_usage_daily, sim_events from anon, authenticated;

-- ===========================================================================
-- 2. Read models
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- v_sim_inventory — one row per SIM: the whole record plus the fitted device,
-- its vehicle, the current-cycle consumption, month-to-date cost and a single
-- `health` verdict the panel can colour a row by.
--
-- health precedence (first match wins):
--   ok          non-active SIM (inventory/suspended/terminated/test) — nothing to watch
--   over_limit  cycle data >= bundle
--   near_limit  cycle data >= 80% of bundle
--   unassigned  active but not fitted to any device (paying for nothing)
--   silent      never seen, or not seen for > 7 days (docs/03 offline signature)
--   no_usage    fitted and seen, but zero bytes this cycle (freshly swapped SIM, or APN wrong)
--   ok          everything else
-- A terminated SIM still linked to a device is NOT a health state (the SIM itself is
-- fine); it surfaces in v_sim_alerts as a housekeeping item.
-- ---------------------------------------------------------------------------
create or replace view v_sim_inventory as
select
  x.*,
  case
    when x.plan_data_mb is null or x.plan_data_mb <= 0 then null
    else round((x.data_used_mb_cycle / x.plan_data_mb::numeric) * 100, 1)
  end                                                                as data_pct_used,
  case
    when x.status <> 'active'                                        then 'ok'
    when x.plan_data_mb > 0 and x.data_used_mb_cycle >= x.plan_data_mb::numeric
                                                                     then 'over_limit'
    when x.plan_data_mb > 0 and x.data_used_mb_cycle >= x.plan_data_mb::numeric * 0.8
                                                                     then 'near_limit'
    when x.device_id is null                                         then 'unassigned'
    when x.last_seen_at is null
      or x.last_seen_at < now() - interval '7 days'                  then 'silent'
    when x.data_used_mb_cycle = 0                                    then 'no_usage'
    else 'ok'
  end::text                                                          as health
from (
  select
    s.id                       as sim_id,
    s.iccid,
    s.imsi,
    s.msisdn,
    s.provider,
    s.provider_sim_id,
    s.status,
    s.activated_at,
    s.suspended_at,
    s.terminated_at,
    s.plan_name,
    s.plan_data_mb,
    s.cycle_start,
    s.cycle_end,
    s.monthly_cost_cents,
    s.device_id,
    s.label,
    s.notes,
    s.last_seen_at,
    s.network,
    s.country,
    s.created_at,
    s.updated_at,
    d.imei                     as device_imei,
    d.status                   as device_status,
    d.phone_number             as device_phone_number,
    -- The paperwork value and the managed link must agree; when they don't, the
    -- panel shows a mismatch badge and sim-sync re-links on the next run.
    (d.id is not null and d.iccid is distinct from s.iccid) as iccid_mismatch,
    v.id                       as vehicle_id,
    v.code                     as vehicle_code,
    v.status                   as vehicle_status,
    cyc.from_day               as cycle_from,
    cyc.to_day                 as cycle_to,
    coalesce(cu.data_mb, 0)    as data_used_mb_cycle,
    coalesce(cu.sms_out, 0)    as sms_out_cycle,
    coalesce(cu.sms_in, 0)     as sms_in_cycle,
    coalesce(cu.cost_cents, 0) as usage_cost_cycle_cents,
    coalesce(mtd.data_mb, 0)   as data_mtd_mb,
    coalesce(mtd.cost_cents, 0) + case when s.status = 'active' then s.monthly_cost_cents else 0 end
                               as cost_mtd_cents,
    coalesce(mtd.cost_cents, 0) as usage_cost_mtd_cents,
    case
      when s.last_seen_at is null then null
      else floor(extract(epoch from (now() - s.last_seen_at)) / 86400.0)::int
    end                        as days_since_seen
  from sims s
  left join devices  d on d.id = s.device_id
  left join vehicles v on v.id = d.vehicle_id
  -- Billing cycle window; falls back to the calendar month when the provider has
  -- not told us the cycle yet.
  cross join lateral (
    select
      coalesce(s.cycle_start, date_trunc('month', current_date)::date) as from_day,
      coalesce(s.cycle_end,
               (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date)
                                                                       as to_day
  ) cyc
  left join lateral (
    select
      sum(u.data_mb)         as data_mb,
      sum(u.sms_out)::int    as sms_out,
      sum(u.sms_in)::int     as sms_in,
      sum(u.cost_cents)::int as cost_cents
    from sim_usage_daily u
    where u.sim_id = s.id and u.day between cyc.from_day and cyc.to_day
  ) cu on true
  left join lateral (
    select sum(u.data_mb) as data_mb, sum(u.cost_cents)::int as cost_cents
    from sim_usage_daily u
    where u.sim_id = s.id and u.day >= date_trunc('month', current_date)::date
  ) mtd on true
) x;

comment on view v_sim_inventory is
  'Admin Connectivity -> SIMs table. One row per SIM with the fitted device/vehicle, '
  'current-cycle consumption, month-to-date cost and a single `health` verdict. '
  'cost_mtd_cents = usage this month + the recurring bundle fee for active SIMs.';

-- ---------------------------------------------------------------------------
-- v_sim_usage_30d — per-SIM daily series for the detail charts.
-- ---------------------------------------------------------------------------
create or replace view v_sim_usage_30d as
select
  u.sim_id,
  s.iccid,
  s.label,
  d.imei  as device_imei,
  v.code  as vehicle_code,
  u.day,
  u.data_mb,
  u.sms_out,
  u.sms_in,
  u.cost_cents,
  u.network,
  u.country,
  sum(u.data_mb)    over (partition by u.sim_id order by u.day)         as data_mb_cum,
  sum(u.cost_cents) over (partition by u.sim_id order by u.day)::bigint as cost_cents_cum
from sim_usage_daily u
join sims s        on s.id = u.sim_id
left join devices d  on d.id = s.device_id
left join vehicles v on v.id = d.vehicle_id
where u.day >= current_date - 29;

comment on view v_sim_usage_30d is
  'Last 30 days of daily SIM usage with running totals — the admin-sim-detail chart series.';

-- ---------------------------------------------------------------------------
-- v_sim_cost_summary — monthly connectivity spend.
-- sms_out ties this view to the docs/03 "budget alarm on > N SMS/day": the
-- threshold is read live from the sms_budget notification rule, so moving the
-- rule in the panel moves the reporting with it.
-- ---------------------------------------------------------------------------
create or replace view v_sim_cost_summary as
with per_day as (
  select
    date_trunc('month', u.day)::date as month,
    u.day,
    sum(u.data_mb)                   as data_mb,
    sum(u.sms_out)::int              as sms_out,
    sum(u.sms_in)::int               as sms_in,
    sum(u.cost_cents)::bigint        as cost_cents,
    count(distinct u.sim_id)::int    as sims_seen
  from sim_usage_daily u
  group by 1, 2
),
per_month as (
  select
    month,
    round(sum(data_mb), 3)                                as total_data_mb,
    sum(sms_out)::bigint                                  as total_sms_out,
    sum(sms_in)::bigint                                   as total_sms_in,
    max(sms_out)::int                                     as peak_sms_out_day,
    (array_agg(day order by sms_out desc, day))[1]        as peak_sms_out_on,
    sum(cost_cents)::bigint                               as usage_cost_cents,
    max(sims_seen)::int                                   as peak_sims_seen
  from per_day
  group by month
),
per_month_sims as (
  select
    x.month,
    count(*)::int                                                  as sims_with_usage,
    count(*) filter (where s.status = 'active')::int               as sims_active,
    coalesce(sum(s.monthly_cost_cents), 0)::bigint                 as subscription_cost_cents
  from (select distinct date_trunc('month', u.day)::date as month, u.sim_id from sim_usage_daily u) x
  join sims s on s.id = x.sim_id
  group by x.month
),
budget as (
  select (r.condition ->> 'per_day')::int as sms_per_day
  from notification_rules r
  where r.event_kind = 'sms_budget' and r.active
  order by r.created_at
  limit 1
)
select
  m.month,
  ms.sims_active,
  ms.sims_with_usage,
  m.peak_sims_seen,
  m.total_data_mb,
  m.total_sms_out,
  m.total_sms_in,
  m.usage_cost_cents,
  ms.subscription_cost_cents,
  (m.usage_cost_cents + ms.subscription_cost_cents)                        as total_cost_cents,
  case
    when coalesce(ms.sims_active, 0) = 0 then null
    else round((m.usage_cost_cents + ms.subscription_cost_cents)::numeric / ms.sims_active, 1)
  end                                                                      as avg_cost_per_active_sim_cents,
  case
    when coalesce(ms.sims_active, 0) = 0 then null
    else round(m.total_data_mb / ms.sims_active, 3)
  end                                                                      as avg_data_mb_per_active_sim,
  m.peak_sms_out_day,
  m.peak_sms_out_on,
  b.sms_per_day                                                            as sms_budget_per_day,
  (select count(*)::int
     from per_day d
    where d.month = m.month
      and b.sms_per_day is not null
      and d.sms_out > b.sms_per_day)                                       as sms_budget_breach_days
from per_month m
join per_month_sims ms on ms.month = m.month
left join budget b on true
order by m.month desc;

comment on view v_sim_cost_summary is
  'Monthly connectivity spend: usage cost + recurring bundle fees, per-SIM averages and the '
  'SMS totals. sms_budget_per_day / sms_budget_breach_days are evaluated against the live '
  'sms_budget notification rule (docs/03 SMS budget alarm).';

-- ---------------------------------------------------------------------------
-- v_sim_alerts — the "needs attention" list. Everything here is actionable.
-- ---------------------------------------------------------------------------
create or replace view v_sim_alerts as
select * from (
  select
    i.sim_id, i.iccid, i.msisdn, i.label, i.status, i.provider,
    i.device_id, i.device_imei, i.vehicle_id, i.vehicle_code,
    'sim_over_limit'::text as kind,
    'critical'::text       as severity,
    1                      as severity_rank,
    format('Used %s MB of the %s MB %s bundle this cycle (%s%%).',
           round(i.data_used_mb_cycle, 1), i.plan_data_mb,
           coalesce(i.plan_name, 'unnamed'), i.data_pct_used) as reason,
    i.data_used_mb_cycle, i.plan_data_mb, i.data_pct_used,
    i.last_seen_at, i.days_since_seen, i.cost_mtd_cents
  from v_sim_inventory i
  where i.health = 'over_limit'

  union all
  select
    i.sim_id, i.iccid, i.msisdn, i.label, i.status, i.provider,
    i.device_id, i.device_imei, i.vehicle_id, i.vehicle_code,
    'sim_near_limit', 'warning', 2,
    format('At %s%% of the %s MB %s bundle with %s day(s) left in the cycle.',
           i.data_pct_used, i.plan_data_mb, coalesce(i.plan_name, 'unnamed'),
           greatest((i.cycle_to - current_date), 0)),
    i.data_used_mb_cycle, i.plan_data_mb, i.data_pct_used,
    i.last_seen_at, i.days_since_seen, i.cost_mtd_cents
  from v_sim_inventory i
  where i.health = 'near_limit'

  union all
  select
    i.sim_id, i.iccid, i.msisdn, i.label, i.status, i.provider,
    i.device_id, i.device_imei, i.vehicle_id, i.vehicle_code,
    'sim_silent', 'warning', 2,
    case
      when i.last_seen_at is null
        then 'Active SIM has never been seen on a network by the provider.'
      else format('No network activity for %s day(s) — check the device, the APN or the antenna.',
                  i.days_since_seen)
    end,
    i.data_used_mb_cycle, i.plan_data_mb, i.data_pct_used,
    i.last_seen_at, i.days_since_seen, i.cost_mtd_cents
  from v_sim_inventory i
  where i.health = 'silent'

  union all
  select
    i.sim_id, i.iccid, i.msisdn, i.label, i.status, i.provider,
    i.device_id, i.device_imei, i.vehicle_id, i.vehicle_code,
    'sim_unassigned', 'info', 3,
    format('Active and billed (%s c/month) but not fitted to any device — suspend it or fit it.',
           i.monthly_cost_cents),
    i.data_used_mb_cycle, i.plan_data_mb, i.data_pct_used,
    i.last_seen_at, i.days_since_seen, i.cost_mtd_cents
  from v_sim_inventory i
  where i.health = 'unassigned'

  union all
  select
    i.sim_id, i.iccid, i.msisdn, i.label, i.status, i.provider,
    i.device_id, i.device_imei, i.vehicle_id, i.vehicle_code,
    'sim_terminated_still_linked', 'warning', 2,
    format('Terminated on %s but still linked to device %s%s — clear the link so the inventory is truthful.',
           coalesce(i.terminated_at::date::text, 'an unknown date'),
           coalesce(i.device_imei, '?'),
           coalesce(' (' || i.vehicle_code || ')', '')),
    i.data_used_mb_cycle, i.plan_data_mb, i.data_pct_used,
    i.last_seen_at, i.days_since_seen, i.cost_mtd_cents
  from v_sim_inventory i
  where i.status = 'terminated' and i.device_id is not null
) a
order by a.severity_rank, a.iccid;

comment on view v_sim_alerts is
  'SIMs needing attention: over/near bundle, silent > 7 days, active-but-unassigned, and '
  'terminated-but-still-linked. Mirrors the sim_* notification_rules (docs/12 B) — the rule '
  'thresholds and this view must be changed together.';

-- Read models over service_role-only tables: no anon/authenticated grant.
revoke all on v_sim_inventory, v_sim_usage_30d, v_sim_cost_summary, v_sim_alerts
  from anon, authenticated;

-- ===========================================================================
-- 3. Permissions (checked by requireStaff() in the sim-* edge functions)
-- ===========================================================================
insert into role_permissions (role, permission) values
  -- read the inventory, usage, cost and alerts
  ('admin',       'sims.read'),
  ('ops_manager', 'sims.read'),
  ('support',     'sims.read'),
  ('accountant',  'sims.read'),   -- connectivity is a line item in the monthly cost report
  ('readonly',    'sims.read'),
  -- activate / suspend / resume / terminate / change plan (always audited)
  ('admin',       'sims.manage'),
  ('ops_manager', 'sims.manage')
on conflict do nothing;

-- ===========================================================================
-- 4. Notification rules (docs/12 B — fleet alert catalogue)
-- notification_rules has no unique key, so each insert is guarded by event_kind.
-- ===========================================================================
insert into notification_rules (event_kind, condition, channels, recipients, throttle_s, digest, active)
select * from (values
  ('sim_over_limit',
     '{"pct":100,"scope":"cycle"}'::jsonb,
     array['email','telegram'], '{"roles":["admin","ops_manager"]}'::jsonb, 86400, 'none'::notification_digest, true),
  ('sim_near_limit',
     '{"pct":80,"scope":"cycle"}'::jsonb,
     array['email'], '{"roles":["admin","ops_manager"]}'::jsonb, 86400, 'daily'::notification_digest, true),
  ('sim_silent',
     '{"no_usage_days":7}'::jsonb,
     array['email'], '{"roles":["ops_manager"],"auto_task":true}'::jsonb, 0, 'daily'::notification_digest, true),
  ('sim_cost_spike',
     '{"pct_over_trailing_3m":50,"min_cost_cents":2000}'::jsonb,
     array['email'], '{"roles":["owner","accountant","admin"]}'::jsonb, 0, 'daily'::notification_digest, true)
) as v(event_kind, condition, channels, recipients, throttle_s, digest, active)
where not exists (
  select 1 from notification_rules r where r.event_kind = v.event_kind
);

-- sms_budget already ships in 00160_seed.sql (docs/03: alarm on > N SMS/day). Insert it
-- only if that seed was skipped, so v_sim_cost_summary always has a threshold to read.
insert into notification_rules (event_kind, condition, channels, recipients, throttle_s, digest, active)
select 'sms_budget', '{"per_day":500}'::jsonb, array['email'], '{"roles":["admin"]}'::jsonb,
       0, 'daily'::notification_digest, true
where not exists (select 1 from notification_rules r where r.event_kind = 'sms_budget');

-- ===========================================================================
-- 5. Seed — extends 00160_seed.sql / 00190_seed_profiles_history.sql.
--
-- Deterministic: no random(). Ids are md5('penny-sim...')::uuid and every "random"
-- value comes from _sim_rnd(key), so re-running is a no-op and two machines produce
-- identical rows. The helper is dropped at the end of this file.
--
-- The seeded ICCIDs / IMSIs / MSISDNs are synthetic but shaped like the real ones
-- (8944… IIN, 19 and 20 digit variants) — they are placeholders until the real
-- inventory is exported from the provider portal.
--
-- Scenarios deliberately built in, so the alert view and the health column have real
-- rows to render on a fresh database:
--   PNY-1002  near_limit  (~84% of the bundle)
--   PNY-1004  silent      (no network activity for 12 days)
--   PNY-1005  over_limit  (chattering device, ~120% of the bundle)
--   PNY-1006  no_usage    (SIM swapped 2 days ago, online, no traffic yet)
--   + the SIM it replaced: terminated, still linked to the same device
--   + one active hot spare that is not fitted to anything (unassigned)
-- ===========================================================================

create or replace function _sim_rnd(k text) returns double precision
language sql immutable as $$
  select ((('x' || substr(md5(k), 1, 8))::bit(32)::bigint & 2147483647)::double precision)
         / 2147483647.0;
$$;

-- ---------------------------------------------------------------------------
-- 5a. Fitted fleet SIMs — one per seeded device.
-- ---------------------------------------------------------------------------
insert into sims (
  id, iccid, imsi, msisdn, provider, provider_sim_id, status, activated_at,
  plan_name, plan_data_mb, cycle_start, cycle_end, monthly_cost_cents,
  device_id, label, last_seen_at, network, country, created_at, updated_at
)
select
  md5('penny-sim:' || t.iccid)::uuid,
  t.iccid, t.imsi, t.msisdn, 'truphone', t.provider_sim_id, 'active',
  now() - make_interval(days => t.activated_days_ago),
  'IoT 500MB', 500, current_date - 27, current_date + 2, 180,
  d.id,
  t.label,
  now() - make_interval(hours => t.seen_hours_ago),
  t.network, 'GR',
  now() - make_interval(days => t.activated_days_ago),
  now()
from (values
  -- code,      iccid (19),            imsi (15),         msisdn,          provider id,       label,                    act d,  seen h, network
  ('PNY-1001', '8944201050000010017', '204040000010017', '+357991000001', 'tp-sim-0010017', 'Athens fleet · PNY-1001', 210,   1,      'COSMOTE'),
  ('PNY-1002', '8944201050000010025', '204040000010025', '+357991000002', 'tp-sim-0010025', 'Athens fleet · PNY-1002', 210,   1,      'COSMOTE'),
  ('PNY-1003', '8944201050000010033', '204040000010033', '+357991000003', 'tp-sim-0010033', 'Athens fleet · PNY-1003', 205,   2,      'VODAFONE GR'),
  ('PNY-1004', '8944201050000010041', '204040000010041', '+357991000004', 'tp-sim-0010041', 'Athens fleet · PNY-1004', 205,   288,    'COSMOTE'),
  ('PNY-1005', '8944201050000010058', '204040000010058', '+357991000005', 'tp-sim-0010058', 'Athens fleet · PNY-1005', 198,   1,      'NOVA GR'),
  ('PNY-1006', '8944201050000010066', '204040000010066', '+357991000006', 'tp-sim-0010066', 'Athens fleet · PNY-1006', 2,     1,      'COSMOTE')
) as t(code, iccid, imsi, msisdn, provider_sim_id, label, activated_days_ago, seen_hours_ago, network)
join vehicles v on v.code = t.code
join devices  d on d.vehicle_id = v.id
on conflict (iccid) do nothing;

-- ---------------------------------------------------------------------------
-- 5b. The SIM that PNY-1006's device used before the swap: terminated, and
--     deliberately left linked so v_sim_alerts has a housekeeping row.
-- ---------------------------------------------------------------------------
insert into sims (
  id, iccid, imsi, msisdn, provider, provider_sim_id, status, activated_at, terminated_at,
  plan_name, plan_data_mb, cycle_start, cycle_end, monthly_cost_cents,
  device_id, label, notes, last_seen_at, network, country, created_at, updated_at
)
select
  md5('penny-sim:8944201050000009964')::uuid,
  '8944201050000009964', '204040000009964', '+357991000996', 'truphone', 'tp-sim-0009964',
  'terminated',
  now() - interval '400 days', now() - interval '2 days',
  'IoT 500MB', 500, current_date - 27, current_date + 2, 180,
  d.id,
  'Retired · was PNY-1006',
  'Swapped out after repeated attach failures; terminated with the provider. Link not cleared yet.',
  now() - interval '3 days', 'COSMOTE', 'GR',
  now() - interval '400 days', now() - interval '2 days'
from vehicles v
join devices d on d.vehicle_id = v.id
where v.code = 'PNY-1006'
on conflict (iccid) do nothing;

-- ---------------------------------------------------------------------------
-- 5c. Unfitted stock: 6 inventory spares, 1 suspended, 1 active hot spare.
--     The 20-digit ICCIDs are intentional — issuers mix 19 and 20 digits and the
--     column must carry both untouched (Hard Rule #10).
-- ---------------------------------------------------------------------------
insert into sims (
  id, iccid, imsi, msisdn, provider, provider_sim_id, status,
  activated_at, suspended_at, plan_name, plan_data_mb, cycle_start, cycle_end,
  monthly_cost_cents, label, notes, last_seen_at, network, country, created_at, updated_at
)
select
  md5('penny-sim:' || t.iccid)::uuid,
  t.iccid, t.imsi, t.msisdn, 'truphone', t.provider_sim_id, t.status,
  case when t.activated_days_ago is null then null
       else now() - make_interval(days => t.activated_days_ago) end,
  case when t.suspended_days_ago is null then null
       else now() - make_interval(days => t.suspended_days_ago) end,
  t.plan_name, t.plan_data_mb,
  case when t.status = 'inventory' then null else current_date - 27 end,
  case when t.status = 'inventory' then null else current_date + 2 end,
  t.monthly_cost_cents, t.label, t.notes,
  case when t.seen_hours_ago is null then null
       else now() - make_interval(hours => t.seen_hours_ago) end,
  t.network, t.country,
  now() - interval '120 days', now()
from (values
  ('8944201050000010074',  '204040000010074', null,            'tp-sim-0010074', 'inventory',
     null::int, null::int, null,        null::int, 0,   'Spare 01 · warehouse Athens', 'Sealed, never activated.', null::int, null, null),
  ('8944201050000010082',  '204040000010082', null,            'tp-sim-0010082', 'inventory',
     null,      null,      null,        null,      0,   'Spare 02 · warehouse Athens', 'Sealed, never activated.', null,      null, null),
  ('8944201050000010090',  '204040000010090', null,            'tp-sim-0010090', 'inventory',
     null,      null,      null,        null,      0,   'Spare 03 · warehouse Athens', 'Sealed, never activated.', null,      null, null),
  ('89442010500010010108', '204040000010108', null,            'tp-sim-0010108', 'inventory',
     null,      null,      null,        null,      0,   'Spare 04 · van kit',          '20-digit ICCID batch.',    null,      null, null),
  ('89442010500010010116', '204040000010116', null,            'tp-sim-0010116', 'inventory',
     null,      null,      null,        null,      0,   'Spare 05 · van kit',          '20-digit ICCID batch.',    null,      null, null),
  ('89442010500010010124', '204040000010124', null,            'tp-sim-0010124', 'inventory',
     null,      null,      null,        null,      0,   'Spare 06 · van kit',          '20-digit ICCID batch.',    null,      null, null),
  ('8944201050000010132',  '204040000010132', '+357991000132', 'tp-sim-0010132', 'suspended',
     150,       9,         'IoT 500MB', 500,       180, 'Suspended · ex bench unit',   'Bench device retired; suspended to stop the bundle fee.', 240, 'COSMOTE', 'GR'),
  ('8944201050000010140',  '204040000010140', '+357991000140', 'tp-sim-0010140', 'active',
     45,        null,      'IoT 500MB', 500,       180, 'Hot spare · kept live',       'Activated for a swap that never happened — costs 180 c/month for nothing.', 3, 'COSMOTE', 'GR')
) as t(iccid, imsi, msisdn, provider_sim_id, status, activated_days_ago, suspended_days_ago,
       plan_name, plan_data_mb, monthly_cost_cents, label, notes, seen_hours_ago, network, country)
on conflict (iccid) do nothing;

-- ---------------------------------------------------------------------------
-- 5d. Point each seeded device at its SIM, and make devices.iccid the exact
--     ICCID of the SIM actually fitted (the label of record). Guarded so it only
--     ever rewrites the placeholder ICCIDs from 00160_seed.sql.
--     devices.phone_number already equals sims.msisdn for these rows.
-- ---------------------------------------------------------------------------
update devices d
   set sim_id     = s.id,
       iccid      = s.iccid,
       updated_at = now()
  from sims s
 where s.device_id = d.id
   and s.status = 'active'
   and d.sim_id is null;

-- ---------------------------------------------------------------------------
-- 5e. 30 days of daily usage.
--     Profiles are per-SIM so the alert scenarios are reproducible:
--       base_mb/jitter_mb  the daily data envelope
--       first_day/last_day the window the SIM actually reported in
--     Cost model: 0.4 c per MB + 4 c per outbound SMS (rounded), which is the
--     order of magnitude of an IoT bundle overage in EUR cents.
-- ---------------------------------------------------------------------------
insert into sim_usage_daily (id, sim_id, day, data_mb, sms_out, sms_in, cost_cents, network, country)
select
  md5('penny-sim-usage:' || s.iccid || ':' || g.day::text)::uuid,
  s.id,
  g.day,
  u.data_mb,
  u.sms_out,
  u.sms_in,
  round(u.data_mb * 0.4 + u.sms_out * 4)::int,
  s.network,
  coalesce(s.country, 'GR')
from (values
  -- iccid,                 base_mb, jitter_mb, first_day_ago, last_day_ago
  ('8944201050000010017',   1.20,    1.80,      29,            0),   -- healthy
  ('8944201050000010025',   14.00,   2.00,      29,            0),   -- near_limit  (~84% of 500 MB)
  ('8944201050000010033',   0.90,    1.40,      29,            0),   -- healthy, quiet
  ('8944201050000010041',   1.60,    1.20,      29,            12),  -- silent since D-12
  ('8944201050000010058',   21.00,   4.00,      29,            0),   -- over_limit  (~120% of 500 MB)
  ('8944201050000009964',   1.50,    1.50,      29,            3),   -- the terminated SIM, history only
  ('8944201050000010132',   1.10,    1.00,      29,            10)   -- suspended 9 days ago
  -- PNY-1006's new SIM and the hot spare have no usage on purpose.
) as p(iccid, base_mb, jitter_mb, first_day_ago, last_day_ago)
join sims s on s.iccid = p.iccid
cross join lateral generate_series(
  current_date - p.first_day_ago,
  current_date - p.last_day_ago,
  interval '1 day'
) as g(day)
cross join lateral (
  select
    round((p.base_mb + _sim_rnd(p.iccid || g.day::text || ':mb') * p.jitter_mb)::numeric, 3) as data_mb,
    -- SMS is the gateway command fallback (docs/03): rare, and bursty when GPRS is bad.
    case
      when _sim_rnd(p.iccid || g.day::text || ':sms') < 0.16
        then 1 + floor(_sim_rnd(p.iccid || g.day::text || ':smsn') * 4)::int
      else 0
    end                                                                                      as sms_out,
    case when _sim_rnd(p.iccid || g.day::text || ':smsi') < 0.05 then 1 else 0 end            as sms_in
) u
on conflict (sim_id, day) do nothing;

-- One bad day on PNY-1005: GPRS flapped, everything fell back to SMS. This is the
-- shape the docs/03 "> N SMS/day" budget alarm is watching for.
update sim_usage_daily u
   set sms_out    = 37,
       cost_cents = round(u.data_mb * 0.4 + 37 * 4)::int
  from sims s
 where s.id = u.sim_id
   and s.iccid = '8944201050000010058'
   and u.day = current_date - 6
   and u.sms_out < 37;

-- ---------------------------------------------------------------------------
-- 5f. SIM events.
-- ---------------------------------------------------------------------------
-- created + activated/suspended/terminated lifecycle
insert into sim_events (id, sim_id, at, kind, detail, staff_id, reason)
select md5('penny-sim-ev:created:' || s.iccid)::uuid, s.id, s.created_at, 'created',
       jsonb_build_object('provider', s.provider, 'provider_sim_id', s.provider_sim_id,
                          'source', 'seed'),
       null, null
from sims s
on conflict (id) do nothing;

insert into sim_events (id, sim_id, at, kind, detail, staff_id, reason)
select md5('penny-sim-ev:activated:' || s.iccid)::uuid, s.id, s.activated_at, 'activated',
       jsonb_build_object('plan_name', s.plan_name, 'plan_data_mb', s.plan_data_mb,
                          'monthly_cost_cents', s.monthly_cost_cents),
       (select st.id from staff st order by st.created_at limit 1), null
from sims s
where s.activated_at is not null
on conflict (id) do nothing;

insert into sim_events (id, sim_id, at, kind, detail, staff_id, reason)
select md5('penny-sim-ev:suspended:' || s.iccid)::uuid, s.id, s.suspended_at, 'suspended',
       jsonb_build_object('previous_status', 'active'),
       (select st.id from staff st order by st.created_at limit 1),
       'Bench device retired — stop the recurring bundle fee'
from sims s
where s.suspended_at is not null
on conflict (id) do nothing;

insert into sim_events (id, sim_id, at, kind, detail, staff_id, reason)
select md5('penny-sim-ev:terminated:' || s.iccid)::uuid, s.id, s.terminated_at, 'terminated',
       jsonb_build_object('previous_status', 'active'),
       (select st.id from staff st order by st.created_at limit 1),
       'SIM replaced after repeated attach failures'
from sims s
where s.terminated_at is not null
on conflict (id) do nothing;

-- the swap that fitted PNY-1006's new SIM
insert into sim_events (id, sim_id, at, kind, detail, staff_id, reason)
select md5('penny-sim-ev:linked:' || s.iccid)::uuid, s.id, s.activated_at, 'linked',
       jsonb_build_object('device_imei', d.imei, 'vehicle_code', v.code, 'replaces_iccid',
                          '8944201050000009964'),
       (select st.id from staff st order by st.created_at limit 1),
       'SIM swap on site'
from sims s
join devices d  on d.id = s.device_id
join vehicles v on v.id = d.vehicle_id
where s.iccid = '8944201050000010066'
on conflict (id) do nothing;

-- a plan change on the chattering SIM, before anyone understood why it burns data
insert into sim_events (id, sim_id, at, kind, detail, staff_id, reason)
select md5('penny-sim-ev:plan:' || s.iccid)::uuid, s.id, now() - interval '21 days', 'plan_changed',
       jsonb_build_object('from', jsonb_build_object('plan_name', 'IoT 100MB', 'plan_data_mb', 100),
                          'to',   jsonb_build_object('plan_name', 'IoT 500MB', 'plan_data_mb', 500)),
       (select st.id from staff st order by st.created_at limit 1),
       'Bundle raised while the overage was investigated'
from sims s
where s.iccid = '8944201050000010058'
on conflict (id) do nothing;

-- the over-limit alert that fired
insert into sim_events (id, sim_id, at, kind, detail, staff_id, reason)
select md5('penny-sim-ev:alert:' || s.iccid)::uuid, s.id, now() - interval '2 days', 'alert',
       jsonb_build_object('rule', 'sim_over_limit', 'pct', 100, 'severity', 'critical'),
       null, null
from sims s
where s.iccid = '8944201050000010058'
on conflict (id) do nothing;

-- last provider sync, for every SIM the provider still knows about
insert into sim_events (id, sim_id, at, kind, detail, staff_id, reason)
select md5('penny-sim-ev:synced:' || s.iccid)::uuid, s.id, now() - interval '55 minutes', 'synced',
       jsonb_build_object('source', 'seed', 'live', false, 'reason', 'no_credentials',
                          'status', s.status, 'network', s.network),
       null, null
from sims s
where s.status <> 'inventory'
on conflict (id) do nothing;

drop function if exists _sim_rnd(text);
