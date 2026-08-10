-- 00450_sweep_stuck_unlocks.sql
--
-- A failed unlock used to take the scooter off the map permanently.
--
-- `trips-start` sets `vehicles.status = 'in_trip'` to reserve the vehicle, then
-- queues the unlock. If the command never lands, NOTHING anywhere put either the
-- trip or the vehicle back: the gateway marks only the command failed, and the
-- rider app shows "Trip aborted · zero charge" purely client-side, which is a lie
-- — server-side the trip is still `unlocking` and the vehicle still `in_trip`.
-- `v_public_vehicles` only lists `available`, so every failed unlock silently
-- removed one scooter from the fleet until someone fixed it by hand. Observed
-- three times on the single real scooter in one afternoon; at fifty vehicles the
-- map would bleed out.
--
-- This is the backstop, deliberately in the database rather than in the gateway:
-- it catches every failure mode, including the ones the gateway cannot report
-- because it crashed, lost the queue message, or never saw the device at all.
-- The gateway also releases the vehicle immediately on a terminal failure — that
-- is the fast path for the rider; this is the guarantee.
--
-- Only `unlocking` is swept. `reserved` trips are legitimate holds with their own
-- expiry and must not be cancelled by this.

create or replace function public.sweep_stuck_unlocks(p_window_s integer default 60)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select t.id, t.vehicle_id
      from trips t
     where t.status = 'unlocking'
       and t.created_at < now() - make_interval(secs => p_window_s)
     for update skip locked
  loop
    update trips set status = 'aborted' where id = r.id;

    -- trip_events is append-only; the transition is part of the record, not a
    -- side effect, so the abort has to be written like any other state change.
    insert into trip_events (trip_id, from_status, to_status, actor, meta)
    values (r.id, 'unlocking', 'aborted', 'system',
            jsonb_build_object('reason', 'unlock not confirmed', 'window_s', p_window_s));

    -- Release the vehicle only if it is still held by THIS attempt. If it moved
    -- on to another status in the meantime, leave it alone.
    update vehicles
       set status = 'available'
     where id = r.vehicle_id
       and status = 'in_trip';

    -- An undelivered unlock must never fire later: it powers on a scooter nobody
    -- is standing next to.
    update commands
       set status = 'expired',
           error = coalesce(error, 'trip aborted before delivery')
     where trip_id = r.id
       and status in ('queued', 'sent');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.sweep_stuck_unlocks(integer) from public, anon, authenticated;

select cron.schedule(
  'sweep-stuck-unlocks',
  '* * * * *',
  $$select public.sweep_stuck_unlocks(60)$$
);
