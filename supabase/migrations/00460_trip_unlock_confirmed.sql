-- 00460_trip_unlock_confirmed.sql
--
-- Nothing in the system ever moved a trip out of `unlocking`.
--
-- trips-start creates the trip and queues the unlock; the gateway delivers it and
-- records the acknowledgement on `commands` — and there the chain ended. The
-- gateway has no reference to `trips` at all. So the scooter physically opened,
-- the rider held an unlocked vehicle, and the app still reported failure because
-- server-side the trip never started. Every trip ever created has started_at null.
-- The sweeper then aborted it 60 s later, correctly by its own rules.
--
-- Measured on the real scooter: trip created 20:57:25, unlock acked 20:57:26 —
-- one second — and the trip was aborted anyway.
--
-- `trip_transition` exists but only writes the status; billing needs `started_at`,
-- and the gateway deliberately has no UPDATE on `trips` (least privilege), so this
-- is a SECURITY DEFINER entry point of its own.
--
-- Why the device's acknowledgement is the right moment to start:
-- the Codec 12 reply means the modem accepted the command, and that is when the
-- rider gets the vehicle. The stronger signal — DIN1 going high, i.e. the scooter
-- really powered on — only arrives with the next AVL record, which on the current
-- device configuration can be five minutes away. Holding the trip until then
-- would keep telling a rider standing next to an open scooter that unlocking
-- failed. DIN1 stays the verification of that start, not its precondition.

create or replace function public.trip_unlock_confirmed(p_trip uuid)
returns trip_status
language plpgsql
security definer
set search_path = public
as $$
declare
  cur trip_status;
begin
  select status into cur from trips where id = p_trip for update;
  if not found then
    raise exception 'trip_unlock_confirmed: trip % not found', p_trip;
  end if;

  -- Only ever from `unlocking`. A late acknowledgement must not resurrect a trip
  -- the rider already gave up on, nor restart one that is running.
  if cur <> 'unlocking' then
    return cur;
  end if;

  insert into trip_events (trip_id, from_status, to_status, actor, meta)
  values (p_trip, 'unlocking', 'active', 'system',
          jsonb_build_object('reason', 'unlock acknowledged by device'));

  update trips
     set status = 'active',
         started_at = coalesce(started_at, now())
   where id = p_trip;

  return 'active';
end;
$$;

-- The gateway is the only caller. Riders start trips through trips-start.
revoke all on function public.trip_unlock_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.trip_unlock_confirmed(uuid) to penny_gateway;
