-- 00310_thessaloniki_efun_pusa.sql
--
-- Thessaloniki becomes the operating city, and the fleet becomes a single
-- model: the EFUN Pusa. Athens was demo scaffolding from the first seed.
--
-- Athens is deactivated rather than deleted: 170 seeded trips reference its
-- vehicles, and `trips.vehicle_id` is ON DELETE RESTRICT, so dropping the city
-- would either fail or take the ride history with it. Its zones are switched
-- off (the zone engine only reads `active`), which removes it from the app
-- while leaving the history readable in the panel.
--
-- Geography is central Thessaloniki: the operating area spans the waterfront
-- from the port to the Concert Hall and inland past the university.

-- ---------------------------------------------------------------- city ----
insert into cities (name, tz, currency, center, default_zoom)
select 'Thessaloniki', 'Europe/Athens', 'EUR',
       st_setsrid(st_point(22.9444, 40.6401), 4326), 13
where not exists (select 1 from cities where name = 'Thessaloniki');

-- --------------------------------------------------------------- model ----
-- One model only. The existing rows are renamed rather than replaced so every
-- vehicle, battery curve and pricing plan pointing at them stays valid.
update vehicle_models
   set name = 'EFUN Pusa',
       kind = 'scooter',
       max_speed_kmh = 25
 where name = 'Penny Scooter';

insert into vehicle_models (name, kind, max_speed_kmh, deposit_cents, requires_licence)
select 'EFUN Pusa', 'scooter', 25, 0, false
where not exists (select 1 from vehicle_models where name = 'EFUN Pusa');

-- Any other model that no vehicle uses is scaffolding — drop it. Models that
-- ARE in use are left alone; deleting one would break its vehicles.
delete from vehicle_models m
 where m.name <> 'EFUN Pusa'
   and not exists (select 1 from vehicles v where v.model_id = m.id);

-- ------------------------------------------------------------- vehicles ----
-- Move the existing fleet to Thessaloniki and onto the one model.
update vehicles v
   set city_id  = (select id from cities where name = 'Thessaloniki'),
       model_id = (select id from vehicle_models where name = 'EFUN Pusa' limit 1),
       updated_at = now()
 where true;

-- Six more, so the map has a believable spread rather than a cluster.
insert into vehicles (code, model_id, status, visible, city_id)
select v.code,
       (select id from vehicle_models where name = 'EFUN Pusa' limit 1),
       'available', true,
       (select id from cities where name = 'Thessaloniki')
from (values
  ('PNY-2001'), ('PNY-2002'), ('PNY-2003'),
  ('PNY-2004'), ('PNY-2005'), ('PNY-2006')
) as v(code)
where not exists (select 1 from vehicles x where x.code = v.code);

-- --------------------------------------------------------- live positions ----
-- vehicle_state is normally written by the gateway from real telemetry. With no
-- device connected there is nothing to place these on the map, so seed one row
-- per vehicle across the centre. Real telemetry overwrites this on first
-- contact (the gateway upserts by vehicle_id).
-- Every point below is inside the operating polygon and outside the port
-- no-go area, because `v_public_vehicles` hides anything outside the active
-- operating zone and a scooter parked in a restricted dock would be nonsense.
with pts as (
  select code, lng, lat from (values
    ('PNY-1001', 22.9419, 40.6325),   -- Aristotelous Square
    ('PNY-1002', 22.9484, 40.6265),   -- White Tower
    ('PNY-1003', 22.9519, 40.6330),   -- Arch of Galerius (Kamara)
    ('PNY-1004', 22.9350, 40.6355),   -- Ladadika
    ('PNY-1005', 22.9601, 40.6318),   -- Aristotle University
    ('PNY-1006', 22.9440, 40.6440),   -- Ano Poli
    ('PNY-2001', 22.9455, 40.6291),   -- Navarinou
    ('PNY-2002', 22.9386, 40.6371),   -- Vardaris
    ('PNY-2003', 22.9540, 40.6247),   -- Waterfront promenade
    ('PNY-2004', 22.9625, 40.6212),   -- Concert Hall
    ('PNY-2005', 22.9478, 40.6402),   -- Ano Poli approach
    ('PNY-2006', 22.9290, 40.6440)    -- Railway station
  ) as t(code, lng, lat)
)
insert into vehicle_state
  (vehicle_id, pos, soc_pct, speed_kmh, ignition, locked, last_seen, session_online)
select v.id,
       st_setsrid(st_point(p.lng, p.lat), 4326),
       -- Spread the charge so low-battery styling has something to show.
       (55 + (row_number() over (order by p.code) * 7) % 45)::smallint,
       0, false, true, now(),
       -- REQUIRED: v_public_vehicles filters on session_online, so a vehicle
       -- left at the column default (false) is invisible to every rider.
       true
from pts p
join vehicles v on v.code = p.code
on conflict (vehicle_id) do update
   set pos            = excluded.pos,
       soc_pct        = excluded.soc_pct,
       last_seen      = excluded.last_seen,
       session_online = excluded.session_online;

-- ---------------------------------------------------------------- zones ----
-- Athens off, Thessaloniki on. The engine reads `active`, so this is the
-- switch-over.
update zones z
   set active = false
  from cities c
 where c.id = z.city_id and c.name = 'Athens';

-- Operating area: waterfront + centre + university, bounded by the ring road.
insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'operating', 'Thessaloniki Centre',
  st_geomfromtext('POLYGON((22.9200 40.6180,22.9720 40.6180,22.9720 40.6520,22.9200 40.6520,22.9200 40.6180))', 4326),
  '{}'::jsonb, true, 1
from cities c where c.name = 'Thessaloniki'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'operating');

insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'parking', 'Aristotelous Square Parking',
  st_geomfromtext('POLYGON((22.9405 40.6315,22.9435 40.6315,22.9435 40.6338,22.9405 40.6338,22.9405 40.6315))', 4326),
  '{}'::jsonb, true, 1
from cities c where c.name = 'Thessaloniki'
  and not exists (select 1 from zones z where z.city_id = c.id and z.name = 'Aristotelous Square Parking');

insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'parking', 'University Parking',
  st_geomfromtext('POLYGON((22.9575 40.6300,22.9625 40.6300,22.9625 40.6335,22.9575 40.6335,22.9575 40.6300))', 4326),
  '{}'::jsonb, true, 1
from cities c where c.name = 'Thessaloniki'
  and not exists (select 1 from zones z where z.city_id = c.id and z.name = 'University Parking');

-- The White Tower forecourt is a pedestrian landmark — parking there blocks it.
insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'no_parking', 'White Tower No-Parking',
  st_geomfromtext('POLYGON((22.9465 40.6252,22.9500 40.6252,22.9500 40.6278,22.9465 40.6278,22.9465 40.6252))', 4326),
  '{}'::jsonb, true, 1
from cities c where c.name = 'Thessaloniki'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'no_parking');

-- Pull vehicles back towards the station in the evening.
insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'bonus', 'Railway Station Rebalance Bonus',
  st_geomfromtext('POLYGON((22.9255 40.6415,22.9330 40.6415,22.9330 40.6470,22.9255 40.6470,22.9255 40.6415))', 4326),
  '{"bonus_cents": 100}'::jsonb, true, 1
from cities c where c.name = 'Thessaloniki'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'bonus');

-- The port is working dockside, closed to riders.
insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'no_go', 'Port Restricted Area',
  st_geomfromtext('POLYGON((22.9245 40.6350,22.9330 40.6350,22.9330 40.6412,22.9245 40.6412,22.9245 40.6350))', 4326),
  '{}'::jsonb, true, 1
from cities c where c.name = 'Thessaloniki'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'no_go');

-- Ano Poli is steep and narrow — advisory only, the FMB930 cannot enforce it.
insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'speed_limit', 'Ano Poli Slow Zone',
  st_geomfromtext('POLYGON((22.9420 40.6420,22.9560 40.6420,22.9560 40.6500,22.9420 40.6500,22.9420 40.6420))', 4326),
  '{"limit_kmh": 15}'::jsonb, true, 1
from cities c where c.name = 'Thessaloniki'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'speed_limit');
