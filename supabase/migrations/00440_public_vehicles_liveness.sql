-- 00440_public_vehicles_liveness.sql
--
-- `v_public_vehicles` decided a vehicle was live from `session_online`, i.e. from
-- an open TCP socket. Measured against the real fleet, that is the wrong signal.
--
-- The FMB930 does not hold a persistent link: it connects, uploads its batch and
-- hangs up. Observed on the first real scooter — session up 12:42:30, session
-- down 12:45:17, next connection five minutes later. So the socket is open for
-- roughly three minutes out of every five, and the scooter would blink on and off
-- the rider map on that cycle.
--
-- This only became visible once the gateway started clearing `session_online` on
-- disconnect (previously nothing ever unset it, so every vehicle looked online
-- forever — wrong in the opposite direction, and it hid this).
--
-- Liveness now means "we heard from it recently", which is what a rider actually
-- needs to know and is independent of how the device manages its link. The window
-- is generous relative to the five-minute reporting period: the scooter should
-- not vanish because one upload was late.
--
-- `session_online` stays accurate and is still the right signal for "can a
-- command be delivered right now" — trips-start keeps its own, tighter staleness
-- check via app_config.max_telemetry_age_s.

create or replace view public.v_public_vehicles as
 select vs.vehicle_id,
    v.code,
    v.model_id,
    m.kind,
    st_x(vs.pos)::numeric as lng,
    st_y(vs.pos)::numeric as lat,
    vs.soc_pct,
    coalesce(vs.soc_pct::integer, 0) * 300 as range_m,
    m.max_speed_kmh
   from vehicle_state vs
     join vehicles v on v.id = vs.vehicle_id
     join vehicle_models m on m.id = v.model_id
  where v.status = 'available'::vehicle_status
    and v.visible = true
    and vs.pos is not null
    and vs.last_seen > now() - interval '15 minutes'
    and (exists ( select 1
           from zones z
          where z.city_id = v.city_id
            and z.kind = 'operating'::zone_kind
            and z.active
            and st_contains(z.geom, vs.pos)));
