-- 00400_ops_live_state.sql
--
-- `vehicle_state` is the live mirror the gateway writes: position, battery,
-- lock, ignition, online flag, alarm bits. It is what puts pins on the ops map
-- and numbers on a vehicle card. It had RLS enabled and no policy at all, so
-- every ops read came back empty — a fleet with no positions and no batteries,
-- reported as success. Third table in this series with the same defect
-- (`staff` in 00360, the history tables in 00380).
--
-- The grant was already there for `authenticated`; only the policy was missing.
-- Scoped the same way as everything else the ops app reads, so a city-scoped
-- operator does not get another city's live telemetry.

drop policy if exists vehicle_state_ops_read on public.vehicle_state;
create policy vehicle_state_ops_read on public.vehicle_state
  for select to authenticated using (public.can_read_vehicle(vehicle_id));

-- The ride-history view the "Last ride" screen reads is service_role-only.
-- Ops needs it per vehicle, and the underlying `trips` rows are already
-- staff-readable after 00380, so exposing the view adds no new reach — it just
-- saves the app from re-deriving what the view already computes.
grant select on public.v_vehicle_ride_history to authenticated;

comment on policy vehicle_state_ops_read on public.vehicle_state is
  'Live telemetry mirror, readable by staff scoped to the vehicle''s city. Riders read positions through v_public_vehicles instead, which is filtered to available+visible.';
