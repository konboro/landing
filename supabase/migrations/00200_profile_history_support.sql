-- 00200_profile_history_support.sql
-- Support objects for the profile / KYC / history edge functions:
--   1. the granular permissions those functions check,
--   2. the daily telemetry rollup used by the vehicle-history charts.

/* ---------------------------------------------------------------------------
   1. Role permissions
   `owner` holds '*', but every other role needs explicit grants or
   requireStaff() rejects them. Keep this aligned with docs/08 role matrix.
   --------------------------------------------------------------------------- */

insert into role_permissions (role, permission) values
  -- read access to customer records (profile, KYC, rides, money)
  ('admin',       'customers.read'),
  ('support',     'customers.read'),
  ('accountant',  'customers.read'),
  ('readonly',    'customers.read'),
  -- read access to fleet records (detail, history, telemetry)
  ('admin',       'vehicles.read'),
  ('support',     'vehicles.read'),
  ('ops_manager', 'vehicles.read'),
  ('ops',         'vehicles.read'),
  ('readonly',    'vehicles.read')
on conflict do nothing;

/* ---------------------------------------------------------------------------
   2. vehicle_telemetry_daily(p_vehicle_id, p_days)
   Daily rollup for the vehicle-history charts. `telemetry` is partitioned and
   very large (docs/02 retention: raw 90 d), so this is deliberately bounded by
   p_days and always filtered on the partition key (server_ts) to enable
   partition pruning.
   --------------------------------------------------------------------------- */

create or replace function vehicle_telemetry_daily(
  p_vehicle_id uuid,
  p_days int default 30
)
returns table (
  day date,
  samples bigint,
  avg_speed_kmh numeric,
  max_speed_kmh numeric,
  distance_m numeric,
  avg_batt_mv numeric,
  min_batt_mv numeric,
  avg_gsm numeric,
  online_minutes numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with win as (
    select
      date_trunc('day', server_ts)::date as day,
      speed_kmh,
      batt_voltage_mv,
      gsm_signal,
      pos,
      server_ts,
      lag(pos) over (order by server_ts)       as prev_pos,
      lag(server_ts) over (order by server_ts) as prev_ts
    from telemetry
    where vehicle_id = p_vehicle_id
      and server_ts >= now() - make_interval(days => greatest(p_days, 1))
  )
  select
    day,
    count(*)                                                   as samples,
    round(avg(speed_kmh)::numeric, 1)                          as avg_speed_kmh,
    round(max(speed_kmh)::numeric, 1)                          as max_speed_kmh,
    -- Sum consecutive fixes; ignore >500 m jumps (GPS glitch / long 2G gap).
    round(coalesce(sum(
      case
        when prev_pos is null then 0
        when st_distancesphere(prev_pos, pos) > 500 then 0
        else st_distancesphere(prev_pos, pos)
      end
    )::numeric, 0), 0)                                         as distance_m,
    round(avg(batt_voltage_mv)::numeric, 0)                    as avg_batt_mv,
    min(batt_voltage_mv)::numeric                              as min_batt_mv,
    round(avg(gsm_signal)::numeric, 1)                         as avg_gsm,
    -- Minutes covered by gaps <= 10 min are treated as "online".
    round(coalesce(sum(
      case
        when prev_ts is null then 0
        when extract(epoch from (server_ts - prev_ts)) > 600 then 0
        else extract(epoch from (server_ts - prev_ts)) / 60.0
      end
    )::numeric, 0), 1)                                         as online_minutes
  from win
  group by day
  order by day desc;
$$;

comment on function vehicle_telemetry_daily(uuid, int) is
  'Daily telemetry rollup for a vehicle (admin-vehicle-history). security definer: telemetry is service_role-only, this exposes aggregates only.';

revoke all on function vehicle_telemetry_daily(uuid, int) from public, anon, authenticated;
grant execute on function vehicle_telemetry_daily(uuid, int) to service_role;
