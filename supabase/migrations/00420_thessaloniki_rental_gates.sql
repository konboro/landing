-- 00420_thessaloniki_rental_gates.sql
--
-- Three things that each independently made it impossible to rent the one real
-- scooter, found while walking every rejection path in trips-start against live
-- data rather than discovering them one failed tap at a time.
--
-- 1. The real device sat at status 'bench' from the bench session and was never
--    promoted. Both `vehicle_snapshot` and the gateway's command dispatcher join
--    devices with `and d.status = 'active'`, so both resolved an EMPTY device id.
--    Visible effect: the gateway logged
--      [commands] NextCommand: resolve device for vehicle : ERROR: invalid input
--      syntax for type uuid: ""
--    every few seconds in a permanent retry loop, and — the part that matters —
--    an unlock could never have reached the scooter.
--
-- 2. There was no pricing plan for Thessaloniki. 00310 moved the operating city
--    from Athens and renamed the model, but left `pricing_plans` pointing at the
--    Athens city row, so trips-start would have thrown `no_pricing` (500) at the
--    moment of unlock — after the rider had already been charged nothing but had
--    every reason to think the rental worked.
--
-- 3. Two commands (an unlock and a ring) had been queued for over an hour with
--    no delivery path, because of (1). Fixing the device status without clearing
--    them would have delivered a stale unlock the instant the scooter came back
--    online — powering on an unattended scooter nobody is standing next to.

-- ------------------------------------------------------------- device ------
update devices
   set status = 'active'
 where imei = '354002392604318'
   and status = 'bench';

-- ------------------------------------------------------------ commands -----
-- Expire anything that has been waiting long enough that its rider is gone. A
-- queued unlock is a physical action; delivering it late is worse than dropping
-- it, so it is retired rather than left for the dispatcher to pick up.
update commands
   set status = 'expired'
 where status = 'queued'
   and created_at < now() - interval '15 minutes';

-- ------------------------------------------------------------- pricing -----
-- Copy the Athens plan across per model rather than inventing numbers: this is
-- the same product at the same price, only the operating city changed. Written
-- as INSERT..SELECT so every column stays in step if the plan is retuned later.
insert into pricing_plans
  (city_id, model_id, unlock_cents, per_min_cents, pause_per_min_cents, day_cap_cents, valid_from, dynamic)
select t.id, p.model_id, p.unlock_cents, p.per_min_cents, p.pause_per_min_cents,
       p.day_cap_cents, now(), p.dynamic
  from pricing_plans p
  join cities c on c.id = p.city_id and c.name = 'Athens'
 cross join (select id from cities where name = 'Thessaloniki') t
 where not exists (
   select 1 from pricing_plans p2
    where p2.city_id = t.id and p2.model_id = p.model_id
 );
