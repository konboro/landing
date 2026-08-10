-- 00380_ops_read_access.sql
--
-- The ops app reads a vehicle's history — status log, battery swaps,
-- maintenance, alerts, fitted device, and the last ride's route. Every one of
-- those tables had RLS enabled and NOT ONE policy, so in live mode they all
-- came back as empty arrays: no error, no warning, just screens that look like
-- the vehicle has no history at all. Same failure shape as `staff` in 00360.
--
-- Scoping: where the row hangs off a vehicle, reuse `is_ops_in_city()` — the
-- exact rule `vehicles_ops_read` already applies — so an operator scoped to one
-- city cannot read another city's logs through a side door. `devices` is gated
-- on `is_staff()` instead because a spare on the shelf has no vehicle and
-- therefore no city.
--
-- Read-only throughout. Ops WRITES still go through the outbox → edge functions,
-- which is what puts them in audit_log (Hard Rule #8).

-- Helper: does the caller have ops access to the city this vehicle sits in?
create or replace function public.can_read_vehicle(v_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vehicles v
    where v.id = v_id and public.is_ops_in_city(v.city_id)
  );
$$;

comment on function public.can_read_vehicle(uuid) is
  'True when the caller may read rows belonging to this vehicle — the same city scope as vehicles_ops_read. SECURITY DEFINER so the lookup is not itself blocked by RLS.';

-- ---- per-vehicle history -------------------------------------------------
grant select on public.vehicle_status_log to authenticated;
drop policy if exists status_log_ops_read on public.vehicle_status_log;
create policy status_log_ops_read on public.vehicle_status_log
  for select to authenticated using (public.can_read_vehicle(vehicle_id));

grant select on public.battery_swaps to authenticated;
drop policy if exists battery_swaps_ops_read on public.battery_swaps;
create policy battery_swaps_ops_read on public.battery_swaps
  for select to authenticated using (public.can_read_vehicle(vehicle_id));

grant select on public.maintenance_log to authenticated;
drop policy if exists maintenance_ops_read on public.maintenance_log;
create policy maintenance_ops_read on public.maintenance_log
  for select to authenticated using (public.can_read_vehicle(vehicle_id));

grant select on public.vehicle_alerts to authenticated;
drop policy if exists vehicle_alerts_ops_read on public.vehicle_alerts;
create policy vehicle_alerts_ops_read on public.vehicle_alerts
  for select to authenticated using (public.can_read_vehicle(vehicle_id));

-- ---- devices -------------------------------------------------------------
-- IMEI/ICCID are identifiers, not secrets, and the swap-device wizard cannot
-- work without them. Still staff-only: riders must never enumerate the fleet's
-- hardware.
grant select on public.devices to authenticated;
drop policy if exists devices_ops_read on public.devices;
create policy devices_ops_read on public.devices
  for select to authenticated using (public.is_staff());

-- ---- last ride -----------------------------------------------------------
-- `trips_self_read` only ever matched the rider who took the trip, so "Last
-- ride" on a vehicle was blank for staff. This adds a SECOND policy rather than
-- widening the existing one: policies are OR-ed, so riders keep exactly the
-- access they had and staff get vehicle-scoped access on top.
--
-- PII note (docs/10): this exposes trip rows, which carry user_id. Ops needs
-- the route and timing to find and service a vehicle; the rider's identity is
-- not rendered anywhere in the ops app, and retention limits still apply to the
-- underlying data.
drop policy if exists trips_ops_read on public.trips;
create policy trips_ops_read on public.trips
  for select to authenticated using (public.can_read_vehicle(vehicle_id));

drop policy if exists trip_routes_ops_read on public.trip_routes;
create policy trip_routes_ops_read on public.trip_routes
  for select to authenticated
  using (exists (
    select 1 from trips t
    where t.id = trip_routes.trip_id and public.can_read_vehicle(t.vehicle_id)
  ));

-- ---- retire the duplicate helper ----------------------------------------
-- 00370 briefly introduced `is_active_staff()`, which was byte-for-byte what
-- `is_staff()` already did. 00370 now uses is_staff(); drop the twin so the two
-- cannot drift.
drop function if exists public.is_active_staff();
