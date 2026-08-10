-- 00410_real_fleet_only.sql
--
-- The first real scooter connected (IMEI 354002392604318, bound to PNY-1001)
-- and immediately exposed two problems, both fixed here.
--
-- 1. It was invisible to riders. `v_public_vehicles` requires the vehicle to
--    sit inside an active `operating` zone, and the seeded "Thessaloniki
--    Centre" polygon was drawn from a guess at the city centre. The real
--    scooter reports POINT(22.97632 40.6082366) — roughly Kalamaria, about
--    1.2 km south and 0.4 km east of that polygon — so `st_contains` was false
--    and the view returned zero rows for it.
--
-- 2. Eleven simulated vehicles were still on the map next to it.
--
-- The new operating polygon follows the built-up coastal strip from the port,
-- along the waterfront, out to Kalamaria and inland to Pylaia, instead of the
-- old rectangle. A rectangle spanning the same span would drop a large part of
-- the Thermaic Gulf inside the operating area, which both looks wrong as a map
-- overlay and would let the geofence accept an end-of-ride out over the water.
-- It is still an approximation drawn from the fleet's real position, not from
-- a surveyed service area — redraw it in the panel's zone editor once the real
-- boundary is decided. Nothing else keys on the shape, so that is a safe edit.

-- ------------------------------------------------------- operating zone ----
-- Matched on kind + city rather than on the name, so this is correct whether
-- the row is still called "Thessaloniki Centre" or has already been renamed.
update zones z
   set name = 'Thessaloniki',
       geom = st_setsrid(
         st_geomfromtext(
           'POLYGON((' ||
             '22.898 40.648, ' ||  -- west, Menemeni
             '22.930 40.662, ' ||  -- north, above Ano Poli
             '22.975 40.652, ' ||  -- north-east, Toumba
             '23.012 40.622, ' ||  -- east, Pylaia
             '23.010 40.592, ' ||  -- south-east, inland of Kalamaria
             '22.990 40.578, ' ||  -- south, Nea Krini
             '22.968 40.596, ' ||  -- coast, Kalamaria marina
             '22.952 40.613, ' ||  -- coast, waterfront south
             '22.933 40.628, ' ||  -- coast, White Tower
             '22.912 40.638, ' ||  -- coast, port
             '22.898 40.648'  ||   -- close
           '))'
         ), 4326),
       active = true
  from cities c
 where c.id = z.city_id
   and c.name = 'Thessaloniki'
   and z.kind = 'operating';

-- --------------------------------------------------- simulated vehicles ----
-- PNY-2001..2006 were seeded to pad the fleet to twelve. They carry no trips
-- and no devices, so they delete cleanly; `vehicle_state` follows on cascade.
delete from vehicles
 where code in ('PNY-2001','PNY-2002','PNY-2003','PNY-2004','PNY-2005','PNY-2006');

-- PNY-1002..1006 cannot be deleted: they hold 149 seeded trips between them and
-- `trips.vehicle_id` is ON DELETE RESTRICT, so a delete either fails or takes
-- the ride history — and with it the payments and ledger entries that make the
-- panel's revenue reporting non-empty. They are retired from the fleet instead,
-- which is what actually matters here: `v_public_vehicles` filters on both
-- `status = 'available'` and `visible`, so they leave the rider map at once.
-- Their fake devices are unbound so no simulated IMEI can claim a session.
update vehicles
   set status = 'decommissioned',
       visible = false
 where code in ('PNY-1002','PNY-1003','PNY-1004','PNY-1005','PNY-1006');

update devices d
   set vehicle_id = null
  from vehicles v
 where v.id = d.vehicle_id
   and v.code in ('PNY-1002','PNY-1003','PNY-1004','PNY-1005','PNY-1006');

-- The seeded twin on PNY-1001 (350451001000001) is unbound too: the vehicle now
-- belongs to the real modem, and two devices on one vehicle makes "which device
-- do we send the unlock to" ambiguous.
update devices
   set vehicle_id = null
 where imei = '350451001000001';

-- Their leftover live state would otherwise keep reporting an online session.
update vehicle_state vs
   set session_online = false
  from vehicles v
 where v.id = vs.vehicle_id
   and v.status = 'decommissioned';
