-- 00180_user_profiles_kyc_history.sql
-- Customer "dokładne dane" (docs/08 Customers) + automatic Sumsub profile display
-- (docs/09: our own app token, externalUserId mapping) + full ride/vehicle history views.
--
-- Three parts:
--   (a) users            — profile enrichment (nullable / defaulted; existing rows & RLS untouched)
--   (b) sumsub_*         — cached KYC applicant / documents / review history. service_role ONLY.
--   (c) v_* views        — user & vehicle ride history, aggregates, merged timelines,
--                          and v_user_profile_full (the admin Customer detail header).
--
-- Hard Rule #11 (PII minimization) governs part (b): raw Sumsub payloads and document
-- images are personal identity data. They are readable ONLY through the service_role key
-- inside edge functions (RLS enabled, no anon/authenticated policy), never by riders and
-- never by the admin panel directly (Hard Rule #6). Document bytes live in the PRIVATE
-- Storage bucket 'kyc-docs' and are surfaced to staff as short-TTL signed URLs.
-- Hard Rule #9: every timestamp here is timestamptz (UTC).

-- ===========================================================================
-- (a) users — profile enrichment
-- ===========================================================================

alter table users add column if not exists date_of_birth     date;
alter table users add column if not exists nationality       text;          -- ISO 3166-1 alpha-2
alter table users add column if not exists gender            text;
alter table users add column if not exists address_line      text;
alter table users add column if not exists address_city      text;
alter table users add column if not exists address_postcode  text;
alter table users add column if not exists address_country   text;
alter table users add column if not exists avatar_url        text;
alter table users add column if not exists preferred_lang    text not null default 'el';
alter table users add column if not exists email_verified    boolean not null default false;
alter table users add column if not exists phone_verified    boolean not null default false;
alter table users add column if not exists signup_source     text;          -- ios|android|web|migration_atom|referral
alter table users add column if not exists signup_city_id    uuid references cities(id) on delete set null;
alter table users add column if not exists last_active_at    timestamptz;
alter table users add column if not exists risk_score        int not null default 0;   -- 0 = clean, 100 = block
alter table users add column if not exists tags              text[] not null default '{}';
alter table users add column if not exists internal_notes    text;          -- staff-only free text
-- emergency_contact already exists (00030_identity.sql) — guarded, so this is a no-op there.
alter table users add column if not exists emergency_contact text;
alter table users add column if not exists deleted_at        timestamptz;   -- GDPR soft delete

comment on column users.risk_score is
  'Fraud/abuse risk 0..100, raised by chargebacks, disputes, rejected photos. Distinct from users.score (rider score).';
comment on column users.internal_notes is
  'Staff-only. Never returned to the rider app. Surfaced via admin-user-profile edge fn only.';
comment on column users.deleted_at is
  'GDPR soft delete. Rows are retained for the legal/tax window (docs/10) and excluded from rider-facing reads.';
comment on column users.preferred_lang is
  'pl|en|el — plain text (not the lang enum) so a new locale needs no migration.';

-- Indexes for the admin Customers table (search phone/email/legacy id; sort by activity).
create index if not exists users_email_lower_idx        on users (lower(email));
create index if not exists users_phone_prefix_idx       on users (phone text_pattern_ops);
create index if not exists users_legacy_atom_idx        on users (legacy_atom_user_id)
  where legacy_atom_user_id is not null;
create index if not exists users_sumsub_applicant_idx   on users (sumsub_applicant_id)
  where sumsub_applicant_id is not null;
create index if not exists users_last_active_at_idx     on users (last_active_at desc nulls last);
create index if not exists users_kyc_status_idx         on users (kyc_status);
create index if not exists users_status_idx             on users (status);
create index if not exists users_signup_city_idx        on users (signup_city_id);
create index if not exists users_tags_gin               on users using gin (tags);
create index if not exists users_not_deleted_idx        on users (created_at desc) where deleted_at is null;

-- History views scan trips by owner/vehicle in reverse chronological order.
create index if not exists trips_user_started_idx    on trips (user_id, started_at desc nulls last);
create index if not exists trips_vehicle_started_idx on trips (vehicle_id, started_at desc nulls last);
create index if not exists payments_user_status_idx  on payments (user_id, status);

-- ===========================================================================
-- (b) Sumsub cache — service_role ONLY (Hard Rule #11)
-- ===========================================================================

create table if not exists sumsub_applicants (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references users(id) on delete cascade,
  applicant_id        text not null unique,          -- Sumsub applicant id (exact text — Hard Rule #10)
  external_user_id    text,                          -- our users.id (or legacy Atom id at migration)
  level_name          text,
  inspection_id       text,                          -- needed to fetch document images
  review_status       text,                          -- init|pending|prechecked|queued|completed|onHold
  review_answer       text,                          -- GREEN|RED
  review_reject_type  text,                          -- FINAL|RETRY
  reject_labels       text[] not null default '{}',
  moderation_comment  text,                          -- shown to the applicant
  client_comment      text,                          -- internal, never shown to the applicant
  first_name          text,
  last_name           text,
  middle_name         text,
  dob                 date,
  nationality         text,
  country             text,
  place_of_birth      text,
  gender              text,
  id_doc_type         text,                          -- ID_CARD|PASSPORT|DRIVERS|RESIDENCE_PERMIT
  id_doc_number       text,
  id_doc_expiry       date,
  id_doc_country      text,
  phone               text,
  email               text,
  applicant_created_at timestamptz,
  reviewed_at         timestamptz,
  raw                 jsonb,                         -- full /one payload — service_role only
  synced_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists sumsub_applicants_applicant_idx on sumsub_applicants (applicant_id);
create index if not exists sumsub_applicants_external_idx  on sumsub_applicants (external_user_id);
create index if not exists sumsub_applicants_status_idx    on sumsub_applicants (review_status, review_answer);

comment on table sumsub_applicants is
  'Cached Sumsub applicant profile (docs/09). PII — Hard Rule #11: service_role ONLY. Riders must never '
  'read this table; admin reads go through the sumsub-applicant / admin-user-profile edge functions, '
  'which audit the access. Never log the raw column or the app token/secret.';
comment on column sumsub_applicants.raw is
  'Full applicant payload from GET /resources/applicants/{id}/one. Hard Rule #11: never logged, never '
  'returned wholesale to a client — the edge function projects a normalized subset.';
comment on column sumsub_applicants.id_doc_number is
  'Stored exact (Hard Rule #10) but ALWAYS masked before leaving an edge function (mask_doc_number()).';

create table if not exists sumsub_documents (
  id               uuid primary key default gen_random_uuid(),
  applicant_row_id uuid not null references sumsub_applicants(id) on delete cascade,
  image_id         text not null,                    -- Sumsub imageId (exact text)
  doc_type         text,                             -- ID_CARD|PASSPORT|DRIVERS|SELFIE|...
  doc_sub_type     text,                             -- FRONT_SIDE|BACK_SIDE|null
  country          text,
  valid_until      date,
  review_answer    text,                             -- GREEN|RED per document
  reject_labels    text[] not null default '{}',
  storage_path     text,                             -- 'kyc-docs/<applicant>/<image_id>.jpg' (PRIVATE bucket)
  content_type     text,
  bytes            int,
  added_at         timestamptz,
  created_at       timestamptz not null default now(),
  unique (applicant_row_id, image_id, doc_sub_type)
);
create index if not exists sumsub_documents_applicant_idx on sumsub_documents (applicant_row_id);

comment on table sumsub_documents is
  'Identity document index. Bytes live in the PRIVATE Storage bucket kyc-docs; only short-TTL signed URLs '
  'are ever handed to the admin panel. Hard Rule #11: service_role only.';

create table if not exists sumsub_review_history (
  id                 uuid primary key default gen_random_uuid(),
  applicant_row_id   uuid not null references sumsub_applicants(id) on delete cascade,
  at                 timestamptz not null default now(),
  review_status      text,
  review_answer      text,
  review_reject_type text,
  reject_labels      text[] not null default '{}',
  moderation_comment text,
  event_id           text,                           -- Sumsub webhook correlationId (idempotency)
  raw                jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists sumsub_review_history_applicant_idx on sumsub_review_history (applicant_row_id, at desc);
create unique index if not exists sumsub_review_history_event_key
  on sumsub_review_history (event_id) where event_id is not null;

comment on table sumsub_review_history is
  'Append-style KYC transition log feeding v_user_timeline. Hard Rule #11: service_role only.';

-- RLS: enabled with NO anon/authenticated policy => only the service_role key reaches these.
alter table sumsub_applicants     enable row level security;
alter table sumsub_documents      enable row level security;
alter table sumsub_review_history enable row level security;
revoke all on sumsub_applicants, sumsub_documents, sumsub_review_history from anon, authenticated;

-- Private Storage bucket for cached document images (Supabase only; no-op on vanilla PG).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('kyc-docs', 'kyc-docs', false)
    on conflict (id) do nothing;
  else
    raise notice 'storage schema absent (vanilla Postgres) — create the PRIVATE kyc-docs bucket on Supabase.';
  end if;
exception when others then
  raise notice 'kyc-docs bucket creation skipped: %', sqlerrm;
end $$;

-- ===========================================================================
-- (c) Masking helpers + history / timeline / profile views
-- ===========================================================================

-- '+306941234567' -> '+30••••4567'. Used wherever a rider phone is shown on a
-- vehicle-centric screen (ops does not need the full number). Hard Rule #11.
create or replace function mask_phone(p text) returns text
language sql immutable as $$
  select case
    when p is null            then null
    when length(p) < 8        then repeat('•', greatest(length(p) - 2, 0)) || right(p, 2)
    else left(p, 3) || '••••' || right(p, 4)
  end;
$$;

-- 'AB1234567' -> '••••••567'. Document numbers never leave an edge function unmasked.
create or replace function mask_doc_number(p text) returns text
language sql immutable as $$
  select case
    when p is null        then null
    when length(p) <= 3   then repeat('•', length(p))
    else repeat('•', length(p) - 3) || right(p, 3)
  end;
$$;

-- ---------------------------------------------------------------------------
-- v_user_ride_history — one row per trip, for the Customer detail "Rides" tab.
-- ---------------------------------------------------------------------------
create or replace view v_user_ride_history as
select
  t.user_id,
  t.id                                          as trip_id,
  t.status,
  t.reserved_at,
  t.started_at,
  t.ended_at,
  t.vehicle_id,
  v.code                                        as vehicle_code,
  vm.name                                       as vehicle_model,
  vm.kind                                       as vehicle_kind,
  t.distance_m,
  t.duration_s,
  t.pause_s,
  t.cost_cents,
  t.discount_cents,
  t.bonus_cents,
  t.penalty_cents,
  (t.cost_cents - t.discount_cents - t.bonus_cents + t.penalty_cents) as net_cents,
  t.currency,
  t.photo_review,
  t.end_photo_url,
  rr.rating,
  rr.tags                                       as review_tags,
  rr.comment                                    as review_comment,
  st_x(t.start_pos)::numeric                    as start_lng,
  st_y(t.start_pos)::numeric                    as start_lat,
  st_x(t.end_pos)::numeric                      as end_lng,
  st_y(t.end_pos)::numeric                      as end_lat,
  sz.name                                       as start_zone_name,
  coalesce(ez.name, dz.name)                    as end_zone_name,
  t.end_zone_id,
  pay.id                                        as payment_id,
  pay.status                                    as payment_status,
  (t.status = 'disputed')                       as has_dispute,
  (t.penalty_cents > 0)                         as has_penalty,
  t.corporate_id,
  t.created_at
from trips t
join vehicles v        on v.id = t.vehicle_id
join vehicle_models vm on vm.id = v.model_id
left join ride_reviews rr on rr.trip_id = t.id
left join zones ez        on ez.id = t.end_zone_id
-- Start zone is not stored on the trip: resolve it spatially, preferring the most
-- specific zone over the city-wide 'operating' polygon.
left join lateral (
  select z.name
  from zones z
  where z.active and t.start_pos is not null and st_contains(z.geom, t.start_pos)
  order by (z.kind = 'operating'), z.kind
  limit 1
) sz on true
left join lateral (
  select z.name
  from zones z
  where z.active and t.end_zone_id is null and t.end_pos is not null and st_contains(z.geom, t.end_pos)
  order by (z.kind = 'operating'), z.kind
  limit 1
) dz on true
left join lateral (
  select p.id, p.status
  from payments p
  where p.trip_id = t.id
  order by p.created_at desc
  limit 1
) pay on true;

comment on view v_user_ride_history is
  'Customer detail -> Rides. One row per trip. Order by started_at desc (trips_user_started_idx).';

-- ---------------------------------------------------------------------------
-- v_vehicle_ride_history — one row per trip, for the Vehicle detail "Rides" tab.
-- Rider phone is masked: fleet screens do not need the full number (Hard Rule #11).
-- ---------------------------------------------------------------------------
create or replace view v_vehicle_ride_history as
select
  t.vehicle_id,
  v.code                       as vehicle_code,
  t.id                         as trip_id,
  t.user_id                    as rider_id,
  mask_phone(u.phone)          as rider_phone_masked,
  u.full_name                  as rider_name,
  t.status,
  t.started_at,
  t.ended_at,
  t.distance_m,
  t.duration_s,
  t.pause_s,
  t.cost_cents,
  t.penalty_cents,
  t.currency,
  t.photo_review,
  rr.rating,
  coalesce(ez.name, dz.name)   as end_zone_name,
  st_x(t.end_pos)::numeric     as end_lng,
  st_y(t.end_pos)::numeric     as end_lat,
  (t.status = 'disputed')      as has_dispute,
  (t.penalty_cents > 0)        as has_penalty,
  t.created_at
from trips t
join vehicles v on v.id = t.vehicle_id
join users u    on u.id = t.user_id
left join ride_reviews rr on rr.trip_id = t.id
left join zones ez        on ez.id = t.end_zone_id
left join lateral (
  select z.name
  from zones z
  where z.active and t.end_zone_id is null and t.end_pos is not null and st_contains(z.geom, t.end_pos)
  order by (z.kind = 'operating'), z.kind
  limit 1
) dz on true;

comment on view v_vehicle_ride_history is
  'Vehicle detail -> Rides history. Rider phone masked (Hard Rule #11).';

-- ---------------------------------------------------------------------------
-- v_user_stats — per-user aggregates. LEFT JOINed from users so a rider with no
-- rides still returns a row with zeroes (the Customer header must never be empty).
-- ---------------------------------------------------------------------------
create or replace view v_user_stats as
select
  u.id                                              as user_id,
  coalesce(r.total_rides, 0)                        as total_rides,
  coalesce(r.total_distance_m, 0)                   as total_distance_m,
  coalesce(r.total_duration_s, 0)                   as total_duration_s,
  coalesce(sp.total_spent_cents, 0)                 as total_spent_cents,
  rv.avg_rating_given,
  coalesce(rv.reviews_count, 0)                     as reviews_count,
  r.first_ride_at,
  r.last_ride_at,
  coalesce(r.disputes_count, 0)                     as disputes_count,
  coalesce(r.penalties_count, 0)                    as penalties_count,
  coalesce(r.penalties_cents, 0)                    as penalties_cents,
  coalesce(db.open_debt_cents, 0)                   as open_debt_cents,
  -- 0.12 kg CO2 avoided per km vs. the car trip replaced.
  round((coalesce(r.total_distance_m, 0) / 1000.0) * 0.12, 3) as co2_saved_kg,
  fc.favourite_city,
  coalesce(r.rides_last_30d, 0)                     as rides_last_30d
from users u
left join lateral (
  select
    count(*)::int                                                     as total_rides,
    coalesce(sum(t.distance_m), 0)::bigint                            as total_distance_m,
    coalesce(sum(t.duration_s), 0)::bigint                            as total_duration_s,
    min(t.started_at)                                                 as first_ride_at,
    max(coalesce(t.ended_at, t.started_at))                           as last_ride_at,
    count(*) filter (where t.status = 'disputed')::int                as disputes_count,
    count(*) filter (where t.penalty_cents > 0)::int                  as penalties_count,
    coalesce(sum(t.penalty_cents), 0)::bigint                         as penalties_cents,
    count(*) filter (where t.started_at >= now() - interval '30 days')::int as rides_last_30d
  from trips t
  where t.user_id = u.id
    and t.started_at is not null
    and t.status <> 'aborted'          -- Hard Rule #1: an aborted unlock is not a ride
) r on true
left join lateral (
  select
    round(avg(rr.rating)::numeric, 2)::numeric as avg_rating_given,
    count(*)::int                              as reviews_count
  from ride_reviews rr
  join trips t2 on t2.id = rr.trip_id
  where t2.user_id = u.id and rr.rating is not null
) rv on true
left join lateral (
  select coalesce(sum(p.amount_cents), 0)::bigint as total_spent_cents
  from payments p
  where p.user_id = u.id and p.status in ('succeeded', 'partially_refunded')
) sp on true
left join lateral (
  select coalesce(sum(d.amount_cents), 0)::bigint as open_debt_cents
  from debts d
  where d.user_id = u.id and d.status in ('open', 'retrying')
) db on true
left join lateral (
  select c.name as favourite_city
  from trips t3
  join vehicles v3 on v3.id = t3.vehicle_id
  join cities c    on c.id = v3.city_id
  where t3.user_id = u.id
  group by c.name
  order by count(*) desc, c.name
  limit 1
) fc on true;

comment on view v_user_stats is
  'Per-user lifetime aggregates. Every user yields exactly one row (zeroes when no rides).';

-- ---------------------------------------------------------------------------
-- v_vehicle_stats — per-vehicle aggregates for the Vehicle detail header
-- and the Analytics utilization table (docs/08).
-- ---------------------------------------------------------------------------
create or replace view v_vehicle_stats as
select
  v.id                                             as vehicle_id,
  v.code                                           as vehicle_code,
  v.status,
  coalesce(r.total_rides, 0)                       as total_rides,
  coalesce(r.rides_last_7d, 0)                     as rides_last_7d,
  coalesce(r.rides_last_30d, 0)                    as rides_last_30d,
  coalesce(r.total_distance_m, 0)                  as total_distance_m,
  coalesce(r.total_revenue_cents, 0)               as total_revenue_cents,
  coalesce(r.avg_trip_distance_m, 0)               as avg_trip_distance_m,
  coalesce(r.avg_trip_duration_s, 0)               as avg_trip_duration_s,
  round(
    coalesce(r.total_rides, 0)::numeric
    / greatest(extract(epoch from (now() - v.created_at)) / 86400.0, 1.0),
    3
  )                                                as utilization_rides_per_day,
  r.last_ride_at,
  round(
    extract(epoch from (now() - coalesce(r.last_ride_at, v.created_at))) / 3600.0,
    2
  )                                                as idle_hours,
  coalesce(dm.damage_reports_count, 0)             as damage_reports_count,
  coalesce(bs.battery_swaps_count, 0)              as battery_swaps_count,
  coalesce(ml.maintenance_count, 0)                as maintenance_count,
  coalesce(uf.unlock_failures_24h, 0)              as unlock_failures_24h
from vehicles v
left join lateral (
  select
    count(*)::int                                                            as total_rides,
    count(*) filter (where t.started_at >= now() - interval '7 days')::int   as rides_last_7d,
    count(*) filter (where t.started_at >= now() - interval '30 days')::int  as rides_last_30d,
    coalesce(sum(t.distance_m), 0)::bigint                                   as total_distance_m,
    coalesce(sum(t.cost_cents - t.discount_cents - t.bonus_cents + t.penalty_cents), 0)::bigint
                                                                             as total_revenue_cents,
    coalesce(round(avg(t.distance_m))::int, 0)                               as avg_trip_distance_m,
    coalesce(round(avg(t.duration_s))::int, 0)                               as avg_trip_duration_s,
    max(coalesce(t.ended_at, t.started_at))                                  as last_ride_at
  from trips t
  where t.vehicle_id = v.id and t.started_at is not null and t.status <> 'aborted'
) r on true
left join lateral (
  select count(*)::int as damage_reports_count
  from damage_reports d where d.vehicle_id = v.id
) dm on true
left join lateral (
  select count(*)::int as battery_swaps_count
  from battery_swaps b where b.vehicle_id = v.id
) bs on true
left join lateral (
  select count(*)::int as maintenance_count
  from maintenance_log m where m.vehicle_id = v.id
) ml on true
left join lateral (
  select count(*)::int as unlock_failures_24h
  from commands c
  where c.vehicle_id = v.id
    and c.kind = 'unlock'
    and c.status in ('failed', 'expired')
    and c.created_at >= now() - interval '24 hours'
) uf on true;

comment on view v_vehicle_stats is
  'Per-vehicle lifetime + rolling-window aggregates. utilization_rides_per_day is normalized '
  'over the vehicle lifetime; unlock_failures_24h feeds the repeated_unlock_failures alert rule.';

-- ---------------------------------------------------------------------------
-- v_user_timeline — every user-facing event merged chronologically.
-- Consumers order by `at desc` and paginate.
-- ---------------------------------------------------------------------------
create or replace view v_user_timeline as
-- trip state transitions (append-only source of truth — Hard Rule #4)
select
  t.user_id                                      as user_id,
  te.at                                          as at,
  'trip'::text                                   as kind,
  ('Trip ' || te.to_status::text)                as title,
  jsonb_build_object(
    'trip_id', te.trip_id, 'vehicle_id', t.vehicle_id,
    'from_status', te.from_status, 'to_status', te.to_status,
    'actor', te.actor, 'meta', te.meta
  )                                              as detail,
  te.trip_id                                     as ref_id
from trip_events te
join trips t on t.id = te.trip_id

union all
select
  p.user_id, p.created_at, 'payment',
  (initcap(p.kind::text) || ' payment ' || p.status::text),
  jsonb_build_object(
    'amount_cents', p.amount_cents, 'currency', p.currency, 'kind', p.kind,
    'status', p.status, 'trip_id', p.trip_id, 'initiated_by', p.initiated_by,
    'admin_reason', p.admin_reason, 'failure_code', p.failure_code
  ),
  p.id
from payments p

union all
select
  t.user_id, coalesce(t.ended_at, t.created_at), 'penalty',
  'Penalty applied',
  jsonb_build_object(
    'trip_id', t.id, 'vehicle_id', t.vehicle_id, 'penalty_cents', t.penalty_cents,
    'photo_review', t.photo_review
  ),
  t.id
from trips t
where t.penalty_cents > 0

union all
select
  d.user_id, d.created_at, 'debt',
  ('Debt ' || d.status::text),
  jsonb_build_object(
    'amount_cents', d.amount_cents, 'source', d.source, 'status', d.status,
    'attempts', d.attempts, 'next_retry_at', d.next_retry_at
  ),
  d.id
from debts d

union all
select
  sa.user_id, h.at, 'kyc',
  ('KYC ' || coalesce(h.review_status, 'update') || coalesce(' / ' || h.review_answer, '')),
  jsonb_build_object(
    'review_status', h.review_status, 'review_answer', h.review_answer,
    'review_reject_type', h.review_reject_type, 'reject_labels', h.reject_labels,
    'moderation_comment', h.moderation_comment
  ),
  h.id
from sumsub_review_history h
join sumsub_applicants sa on sa.id = h.applicant_row_id

union all
select
  dr.user_id, dr.created_at, 'damage_report',
  ('Damage report ' || dr.status::text),
  jsonb_build_object(
    'vehicle_id', dr.vehicle_id, 'trip_id', dr.trip_id, 'severity', dr.severity,
    'status', dr.status, 'description', dr.description
  ),
  dr.id
from damage_reports dr
where dr.user_id is not null

union all
select
  nl.user_id, coalesce(nl.sent_at, nl.created_at), 'notification',
  (nl.channel::text || ': ' || nl.template_key),
  jsonb_build_object(
    'channel', nl.channel, 'template_key', nl.template_key,
    'status', nl.status, 'payload', nl.payload
  ),
  nl.id
from notification_log nl
where nl.user_id is not null

union all
-- status / block / profile changes performed by staff (Hard Rule #8)
select
  al.entity_id::uuid, al.at, 'audit',
  al.action,
  jsonb_build_object(
    'action', al.action, 'staff_id', al.staff_id, 'before', al.before,
    'after', al.after, 'reason', al.reason, 'ip', al.ip
  ),
  al.id
from audit_log al
where al.entity = 'users'
  -- guard the text -> uuid cast so a non-uuid entity_id can never break the view
  and al.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

comment on view v_user_timeline is
  'Merged chronological user activity: trips, payments, penalties, debts, KYC transitions, '
  'damage reports, notifications, staff audit actions. Order by at desc; paginate in the edge fn.';

-- ---------------------------------------------------------------------------
-- v_vehicle_timeline — every vehicle-facing event merged chronologically.
-- ---------------------------------------------------------------------------
create or replace view v_vehicle_timeline as
select
  t.vehicle_id                                   as vehicle_id,
  coalesce(t.started_at, t.created_at)           as at,
  'ride'::text                                   as kind,
  ('Ride ' || t.status::text)                    as title,
  jsonb_build_object(
    'trip_id', t.id, 'user_id', t.user_id, 'distance_m', t.distance_m,
    'duration_s', t.duration_s, 'cost_cents', t.cost_cents, 'status', t.status,
    'photo_review', t.photo_review
  )                                              as detail,
  t.id                                           as ref_id
from trips t

union all
select
  c.vehicle_id, coalesce(c.acked_at, c.sent_at, c.created_at), 'command',
  (c.kind::text || ' ' || c.status::text),
  jsonb_build_object(
    'kind', c.kind, 'status', c.status, 'channel', c.channel, 'device_id', c.device_id,
    'trip_id', c.trip_id, 'requested_by', c.requested_by, 'error', c.error, 'payload', c.payload
  ),
  c.id
from commands c

union all
select
  sl.vehicle_id, sl.at, 'status_change',
  (coalesce(sl.from_status::text, 'new') || ' -> ' || sl.to_status::text),
  jsonb_build_object(
    'from_status', sl.from_status, 'to_status', sl.to_status, 'by', sl.by,
    'role', sl.role, 'reason', sl.reason, 'photos', sl.photos
  ),
  sl.id
from vehicle_status_log sl

union all
select
  a.vehicle_id, a.created_at, 'alert',
  ('Alert: ' || a.kind::text),
  jsonb_build_object('kind', a.kind, 'payload', a.payload, 'ack_by', a.ack_by, 'ack_at', a.ack_at),
  a.id
from vehicle_alerts a

union all
select
  dr.vehicle_id, dr.created_at, 'damage_report',
  ('Damage report ' || dr.status::text),
  jsonb_build_object(
    'reporter', dr.reporter, 'user_id', dr.user_id, 'trip_id', dr.trip_id,
    'severity', dr.severity, 'status', dr.status, 'description', dr.description,
    'photos', dr.photos
  ),
  dr.id
from damage_reports dr

union all
select
  b.vehicle_id, b.at, 'battery_swap',
  'Battery swap',
  jsonb_build_object('by', b.by, 'voltage_before', b.voltage_before, 'voltage_after', b.voltage_after),
  b.id
from battery_swaps b

union all
select
  m.vehicle_id, m.created_at, 'maintenance',
  'Maintenance',
  jsonb_build_object('task_id', m.task_id, 'parts', m.parts, 'cost_cents', m.cost_cents, 'notes', m.notes),
  m.id
from maintenance_log m;

comment on view v_vehicle_timeline is
  'Merged chronological vehicle activity: rides, commands, status changes, alerts, damage, '
  'battery swaps, maintenance. Order by at desc; paginate in the edge fn.';

-- ---------------------------------------------------------------------------
-- v_user_profile_full — the single row the admin Customer detail header binds to.
-- users + Sumsub KYC summary + lifetime stats + group/corporate + loyalty +
-- referrals + wallet. Exactly one row per user (all joins are 1:1 or lateral-limited).
-- ---------------------------------------------------------------------------
create or replace view v_user_profile_full as
select
  u.id                                as user_id,
  u.phone,
  mask_phone(u.phone)                 as phone_masked,
  u.email,
  u.full_name,
  u.avatar_url,
  u.date_of_birth,
  u.nationality,
  u.gender,
  u.address_line,
  u.address_city,
  u.address_postcode,
  u.address_country,
  u.preferred_lang,
  u.email_verified,
  u.phone_verified,
  u.signup_source,
  u.signup_city_id,
  sc.name                             as signup_city,
  u.last_active_at,
  u.risk_score,
  u.score                             as rider_score,
  u.tags,
  u.internal_notes,
  u.emergency_contact,
  u.deleted_at,
  u.legacy_atom_user_id,
  u.sumsub_applicant_id,
  u.kyc_status,
  u.status,
  u.blocked_reason,
  u.marketing_consent,
  u.tos_accepted_at,
  u.privacy_accepted_at,
  u.created_at,
  u.updated_at,
  cg.name                             as customer_group,
  u.customer_group_id,
  corp.corporate_id,
  corp.corporate_name,
  corp.corporate_limit_cents,
  -- ---- KYC summary (Sumsub cache) ----
  sa.applicant_id                     as sumsub_applicant,
  sa.level_name                       as kyc_level,
  sa.review_status                    as kyc_review_status,
  sa.review_answer                    as kyc_review_answer,
  sa.review_reject_type               as kyc_reject_type,
  sa.reject_labels                    as kyc_reject_labels,
  sa.moderation_comment               as kyc_moderation_comment,
  sa.first_name                       as kyc_first_name,
  sa.last_name                        as kyc_last_name,
  sa.dob                              as kyc_dob,
  sa.nationality                      as kyc_nationality,
  sa.id_doc_type                      as kyc_doc_type,
  mask_doc_number(sa.id_doc_number)   as kyc_doc_number_masked,
  sa.id_doc_expiry                    as kyc_doc_expiry,
  sa.id_doc_country                   as kyc_doc_country,
  sa.reviewed_at                      as kyc_reviewed_at,
  sa.synced_at                        as kyc_synced_at,
  coalesce(docs.kyc_documents_count, 0) as kyc_documents_count,
  -- ---- lifetime stats ----
  s.total_rides,
  s.total_distance_m,
  s.total_duration_s,
  s.total_spent_cents,
  s.avg_rating_given,
  s.reviews_count,
  s.first_ride_at,
  s.last_ride_at,
  s.disputes_count,
  s.penalties_count,
  s.penalties_cents,
  s.open_debt_cents,
  s.co2_saved_kg,
  s.favourite_city,
  s.rides_last_30d,
  -- ---- money & loyalty ----
  coalesce(la.points, 0)              as loyalty_points,
  coalesce(w.balance_cents, 0)        as wallet_balance_cents,
  coalesce(rf.referrals_sent, 0)      as referrals_sent,
  coalesce(rf.referrals_completed, 0) as referrals_completed,
  coalesce(pm.cards_count, 0)         as cards_count,
  pm.default_card_brand,
  pm.default_card_last4
from users u
left join cities sc          on sc.id = u.signup_city_id
left join customer_groups cg on cg.id = u.customer_group_id
left join sumsub_applicants sa on sa.user_id = u.id
left join v_user_stats s     on s.user_id = u.id
left join loyalty_accounts la on la.user_id = u.id
left join lateral (
  select cm.corporate_id, ca.name as corporate_name, cm.monthly_limit_cents as corporate_limit_cents
  from corporate_members cm
  join corporate_accounts ca on ca.id = cm.corporate_id
  where cm.user_id = u.id
  order by cm.created_at
  limit 1
) corp on true
left join lateral (
  select count(*)::int as kyc_documents_count
  from sumsub_documents sd
  where sd.applicant_row_id = sa.id
) docs on true
left join lateral (
  select b.balance_cents
  from v_user_wallet_balance b
  where b.user_id = u.id
  order by (b.currency = 'EUR') desc
  limit 1
) w on true
left join lateral (
  select
    count(*)::int                                        as referrals_sent,
    count(*) filter (where r.status = 'completed')::int  as referrals_completed
  from referrals r
  where r.referrer_id = u.id
) rf on true
left join lateral (
  select
    count(*)::int                                                        as cards_count,
    (array_agg(m.brand order by m.is_default desc, m.created_at))[1]     as default_card_brand,
    (array_agg(m.last4 order by m.is_default desc, m.created_at))[1]     as default_card_last4
  from payment_methods m
  where m.user_id = u.id and m.status = 'active'
) pm on true;

comment on view v_user_profile_full is
  'Admin Customer detail header (docs/08 "dokładne dane"). Exactly one row per user. PII — '
  'reachable only with service_role via the admin-user-profile edge fn, which writes an '
  'audit_log entry for the view (Hard Rules #6, #8, #11).';

-- These views project PII. No grant to anon/authenticated: service_role only.
revoke all on
  v_user_ride_history, v_vehicle_ride_history, v_user_stats, v_vehicle_stats,
  v_user_timeline, v_vehicle_timeline, v_user_profile_full
from anon, authenticated;
