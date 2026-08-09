-- 00220_admin_panel_views.sql
-- Views backing the admin panel's list pages.
--
-- The panel is a thin client: it never assembles a row shape out of several
-- round-trips. Each list page reads exactly one view whose columns match the
-- TypeScript row type in apps/admin/src/types/domain.ts, so sort/filter/search
-- and pagination all push down into Postgres.
--
-- service_role only, like every other admin view: the panel reaches them
-- through edge functions / an authenticated staff session, never anon.

/* ---------------------------------------------------------------------------
   v_admin_vehicles → VehicleRow
   --------------------------------------------------------------------------- */
create or replace view v_admin_vehicles as
select
  v.id,
  v.code,
  v.model_id,
  v.status,
  v.visible,
  v.plate,
  v.vin,
  v.city_id,
  v.notes,
  v.created_at,
  v.updated_at,
  coalesce(m.name, '—')                        as model_name,
  coalesce(c.name, '—')                        as city_name,
  s.soc_pct,
  s.last_seen,
  coalesce(s.session_online, false)            as session_online,
  coalesce(t.rides_today, 0)::int              as rides_today,
  -- Hours since the vehicle last ended a trip; deployment age when never ridden.
  round(extract(epoch from (now() - coalesce(t.last_ride_at, v.created_at))) / 3600.0, 1)::float8
                                               as idle_hours,
  d.imei,
  coalesce(st_x(s.pos::geometry), 0)::float8   as lng,
  coalesce(st_y(s.pos::geometry), 0)::float8   as lat
from vehicles v
left join vehicle_models m on m.id = v.model_id
left join cities c         on c.id = v.city_id
left join vehicle_state s  on s.vehicle_id = v.id
left join devices d        on d.vehicle_id = v.id
left join lateral (
  select
    count(*) filter (where tr.started_at >= date_trunc('day', now())) as rides_today,
    max(tr.ended_at)                                                  as last_ride_at
  from trips tr
  where tr.vehicle_id = v.id
) t on true;

comment on view v_admin_vehicles is
  'Fleet table for the admin panel. Matches VehicleRow in apps/admin/src/types/domain.ts.';

/* ---------------------------------------------------------------------------
   v_admin_rides → RideRow
   --------------------------------------------------------------------------- */
create or replace view v_admin_rides as
select
  t.id,
  t.user_id,
  t.vehicle_id,
  t.status,
  t.group_id,
  t.reserved_at,
  t.started_at,
  t.ended_at,
  t.start_pos,
  t.end_pos,
  t.distance_m,
  t.duration_s,
  t.pause_s,
  t.pricing_snapshot,
  t.cost_cents,
  t.discount_cents,
  t.bonus_cents,
  t.penalty_cents,
  t.currency,
  t.end_photo_url,
  t.photo_review,
  t.end_zone_id,
  t.corporate_id,
  t.promo_redemption_id,
  t.created_at,
  coalesce(u.full_name, '—')            as user_name,
  coalesce(u.phone, '')                 as user_phone,
  coalesce(v.code, '—')                 as vehicle_code,
  coalesce(c.name, '—')                 as city_name,
  (t.status = 'disputed')               as has_dispute,
  (coalesce(t.penalty_cents, 0) > 0)    as has_penalty
from trips t
left join users u    on u.id = t.user_id
left join vehicles v on v.id = t.vehicle_id
left join cities c   on c.id = v.city_id;

comment on view v_admin_rides is
  'Rides table for the admin panel. Matches RideRow in apps/admin/src/types/domain.ts.';

/* ---------------------------------------------------------------------------
   v_admin_customers → CustomerRow
   Users plus the three aggregates the table sorts on.
   --------------------------------------------------------------------------- */
create or replace view v_admin_customers as
select
  u.*,
  coalesce(agg.rides, 0)::int         as rides,
  coalesce(agg.spend_cents, 0)::int   as spend_cents,
  coalesce(dbt.debt_cents, 0)::int    as debt_cents,
  coalesce(c.name, '—')               as city_name
from users u
left join lateral (
  select count(*) as rides,
         sum(t.cost_cents + coalesce(t.penalty_cents, 0)
             - coalesce(t.discount_cents, 0) - coalesce(t.bonus_cents, 0)) as spend_cents
  from trips t
  where t.user_id = u.id and t.status in ('charged', 'ended', 'disputed')
) agg on true
left join lateral (
  select sum(d.amount_cents) as debt_cents
  from debts d
  where d.user_id = u.id and d.status in ('open', 'retrying')
) dbt on true
left join cities c on c.id = u.signup_city_id;

comment on view v_admin_customers is
  'Customers table for the admin panel. Matches CustomerRow in apps/admin/src/types/domain.ts.';

/* ---------------------------------------------------------------------------
   v_admin_kpis → KpiSnapshot (single row)
   Sparklines are 7-day arrays, oldest first.
   --------------------------------------------------------------------------- */
create or replace view v_admin_kpis as
with days as (
  select generate_series(date_trunc('day', now()) - interval '6 days',
                         date_trunc('day', now()), interval '1 day')::date as d
),
per_day as (
  select
    days.d,
    (select count(*) from trips t
      where t.started_at::date = days.d and t.status in ('charged','ended','disputed')) as rides,
    (select coalesce(sum(t.cost_cents), 0) from trips t
      where t.started_at::date = days.d and t.status = 'charged')                       as revenue,
    (select count(*) from users u where u.created_at::date = days.d)                    as new_users,
    (select case
       when count(*) = 0 then 100
       else round(100.0 * count(*) filter (where c.status = 'acked') / count(*))
     end
     from commands c
     where c.kind = 'unlock' and c.created_at::date = days.d)                            as unlock_pct
  from days
)
select
  (select count(*) from trips where status in ('active','paused','unlocking','ending'))          as active_rides,
  (select coalesce(sum(cost_cents), 0)::int from trips
     where status = 'charged' and started_at >= date_trunc('day', now()))                        as today_revenue_cents,
  (select count(*)::int from trips
     where started_at >= date_trunc('day', now()) and status in ('charged','ended','disputed'))  as today_rides,
  (select count(*)::int from users where created_at >= date_trunc('day', now()))                 as new_users_today,
  (select coalesce(sum(amount_cents), 0)::int from debts where status in ('open','retrying'))    as open_debts_cents,
  (select count(*)::int from debts where status in ('open','retrying'))                          as open_debts_count,
  (select case
     when count(*) = 0 then 100
     else round(100.0 * count(*) filter (where status = 'acked') / count(*))
   end
   from commands
   where kind = 'unlock' and created_at >= now() - interval '24 hours')::float8                  as unlock_success_pct,
  (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
     from (select status::text, count(*)::int as n from vehicles group by status) x)             as fleet_by_status,
  (select coalesce(array_agg(revenue order by d), '{}') from per_day)::int[]                     as spark_revenue,
  (select coalesce(array_agg(rides order by d), '{}') from per_day)::int[]                       as spark_rides,
  (select coalesce(array_agg(new_users order by d), '{}') from per_day)::int[]                   as spark_users,
  (select coalesce(array_agg(unlock_pct order by d), '{}') from per_day)::int[]                  as spark_unlock;

comment on view v_admin_kpis is
  'Dashboard KPI snapshot (single row). Matches KpiSnapshot in apps/admin/src/types/domain.ts.';

/* ---------------------------------------------------------------------------
   Lock them down — service_role only, consistent with the other admin views.
   --------------------------------------------------------------------------- */
revoke all on v_admin_vehicles, v_admin_rides, v_admin_customers, v_admin_kpis
  from public, anon, authenticated;
grant select on v_admin_vehicles, v_admin_rides, v_admin_customers, v_admin_kpis
  to service_role;
