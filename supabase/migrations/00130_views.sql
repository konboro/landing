-- 00130_views.sql
-- Read models for apps & panel. v_public_vehicles is the rider-safe projection of
-- vehicle_state (no IMEI, no alarms); the base table stays service_role-only (00140).
-- These views are SECURITY DEFINER by default (not security_invoker), so they read
-- past the base-table RLS and expose only the safe columns defined here.

-- Rider map feed: available + visible vehicles inside an active operating zone.
create or replace view v_public_vehicles as
select
  vs.vehicle_id,
  v.code,
  v.model_id,
  m.kind,
  st_x(vs.pos)::numeric               as lng,
  st_y(vs.pos)::numeric               as lat,
  vs.soc_pct,
  -- coarse range estimate: ~300 m per 1% SoC (calibrate per model later)
  (coalesce(vs.soc_pct, 0) * 300)::int as range_m,
  m.max_speed_kmh
from vehicle_state vs
join vehicles v       on v.id = vs.vehicle_id
join vehicle_models m on m.id = v.model_id
where v.status = 'available'
  and v.visible = true
  and vs.session_online = true
  and vs.pos is not null
  and exists (
    select 1 from zones z
    where z.city_id = v.city_id
      and z.kind = 'operating'
      and z.active
      and st_contains(z.geom, vs.pos)
  );

-- Transaction history (parity): payments enriched with net ledger movement.
create or replace view v_transaction_history as
select
  p.id            as payment_id,
  p.user_id,
  p.trip_id,
  p.stripe_pi_id,
  p.amount_cents,
  p.currency,
  p.kind,
  p.status,
  p.initiated_by,
  p.admin_reason,
  p.created_at,
  coalesce(le.ledger_delta, 0) as ledger_delta_cents
from payments p
left join lateral (
  select sum(e.delta_cents) as ledger_delta
  from ledger_entries e
  join ledger_accounts a on a.id = e.account_id
  where a.kind = 'penny_revenue'
    and e.txn_id::text = p.id::text
) le on true;

-- Ride verification queue (parity: Ride verification 99+).
create or replace view v_ride_verification_queue as
select
  t.id as trip_id,
  t.user_id,
  t.vehicle_id,
  t.end_photo_url,
  t.end_pos,
  t.end_zone_id,
  t.ended_at,
  t.photo_review,
  t.cost_cents,
  t.penalty_cents
from trips t
where t.photo_review = 'pending'
order by t.ended_at asc nulls last;

-- Heatmaps (requested): grid-snapped aggregates by hour.
create or replace view v_heatmap_starts as
select
  st_snaptogrid(t.start_pos, 0.0015) as cell,
  date_trunc('hour', t.started_at)    as hour,
  count(*)                            as rides
from trips t
where t.start_pos is not null and t.started_at is not null
group by 1, 2;

create or replace view v_heatmap_ends as
select
  st_snaptogrid(t.end_pos, 0.0015) as cell,
  date_trunc('hour', t.ended_at)   as hour,
  count(*)                         as rides
from trips t
where t.end_pos is not null and t.ended_at is not null
group by 1, 2;

-- Idle density → feeds auto rebalance tasks (docs/04, docs/07).
create or replace view v_heatmap_idle as
select
  st_snaptogrid(vs.pos, 0.0015) as cell,
  count(*)                      as idle_vehicles,
  min(vs.last_seen)             as oldest_seen
from vehicle_state vs
join vehicles v on v.id = vs.vehicle_id
where v.status = 'available' and vs.pos is not null
group by 1;

-- Vehicle error log (parity): alert stream filtered to errors.
create or replace view v_vehicle_error_log as
select
  a.id,
  a.vehicle_id,
  v.code as vehicle_code,
  a.payload,
  a.ack_by,
  a.ack_at,
  a.created_at
from vehicle_alerts a
join vehicles v on v.id = a.vehicle_id
where a.kind = 'error'
order by a.created_at desc;

-- IoT data log (parity): merged telemetry + command timeline per device.
create or replace view v_iot_data_log as
select
  t.device_id,
  t.vehicle_id,
  t.server_ts             as at,
  'telemetry'::text       as source,
  null::command_kind      as command_kind,
  null::command_status    as command_status,
  jsonb_build_object(
    'speed_kmh', t.speed_kmh,
    'ext_voltage_mv', t.ext_voltage_mv,
    'batt_voltage_mv', t.batt_voltage_mv,
    'sats', t.sats,
    'gsm_signal', t.gsm_signal
  )                       as detail
from telemetry t
union all
select
  c.device_id,
  c.vehicle_id,
  coalesce(c.acked_at, c.sent_at, c.created_at) as at,
  'command'::text                               as source,
  c.kind                                        as command_kind,
  c.status                                      as command_status,
  c.payload                                     as detail
from commands c;
