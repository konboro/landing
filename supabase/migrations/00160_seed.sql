-- 00160_seed.sql
-- Minimal-but-real seed for tomorrow's testing: Athens, one model, curve, zones,
-- pricing, 6 live vehicles, config, staff owner, FAQs, products, notification rules.
-- Idempotent-friendly: guarded with on-conflict / not-exists where practical.

-- ---- City ----
insert into cities (name, tz, currency, center, default_zoom)
select 'Athens', 'Europe/Athens', 'EUR',
       st_setsrid(st_makepoint(23.7275, 37.9838), 4326), 13
where not exists (select 1 from cities where name = 'Athens');

-- ---- Vehicle model + battery curve ----
insert into vehicle_models (name, kind, max_speed_kmh, deposit_cents, requires_licence)
select 'Penny Scooter', 'scooter', 25, 0, false
where not exists (select 1 from vehicle_models where name = 'Penny Scooter');

insert into battery_curves (model_id, points)
select m.id,
  '[[30000,0],[32000,10],[33000,20],[34000,35],[35000,50],[36000,65],[37000,80],[38000,90],[39000,95],[42000,100]]'::jsonb
from vehicle_models m
where m.name = 'Penny Scooter'
  and not exists (select 1 from battery_curves bc where bc.model_id = m.id);

update vehicle_models m
   set battery_curve_id = bc.id
  from battery_curves bc
 where bc.model_id = m.id and m.name = 'Penny Scooter' and m.battery_curve_id is null;

-- ---- Pricing plan (unlock 100c, per_min 15c, pause 5c, day cap 2500c) ----
insert into pricing_plans (city_id, model_id, unlock_cents, per_min_cents, pause_per_min_cents, day_cap_cents, valid_from, dynamic)
select c.id, m.id, 100, 15, 5, 2500, now(),
  '{"happy_hours":[{"dow":[1,2,3,4,5],"from":"14:00","to":"16:00","multiplier":0.8}],
    "demand":{"enabled":true,"cell_size_m":250,"cap":1.5}}'::jsonb
from cities c, vehicle_models m
where c.name = 'Athens' and m.name = 'Penny Scooter'
  and not exists (
    select 1 from pricing_plans p where p.city_id = c.id and p.model_id = m.id
  );

-- ---- Zones (central Athens) ----
insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'operating', 'Athens Centre',
  st_geomfromtext('POLYGON((23.705 37.965,23.748 37.965,23.748 37.998,23.705 37.998,23.705 37.965))', 4326),
  '{}'::jsonb, true, 1
from cities c where c.name = 'Athens'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'operating');

insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'parking', 'Syntagma Parking',
  st_geomfromtext('POLYGON((23.7325 37.9745,23.7355 37.9745,23.7355 37.9765,23.7325 37.9765,23.7325 37.9745))', 4326),
  '{}'::jsonb, true, 1
from cities c where c.name = 'Athens'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'parking');

insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'no_parking', 'Acropolis No-Parking',
  st_geomfromtext('POLYGON((23.724 37.970,23.728 37.970,23.728 37.973,23.724 37.973,23.724 37.970))', 4326),
  '{}'::jsonb, true, 1
from cities c where c.name = 'Athens'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'no_parking');

insert into zones (city_id, kind, name, geom, rules, active, version)
select c.id, 'bonus', 'Omonoia Rebalance Bonus',
  st_geomfromtext('POLYGON((23.726 37.983,23.730 37.983,23.730 37.986,23.726 37.986,23.726 37.983))', 4326),
  '{"bonus_cents":100}'::jsonb, true, 1
from cities c where c.name = 'Athens'
  and not exists (select 1 from zones z where z.city_id = c.id and z.kind = 'bonus');

insert into zone_versions (city_id, version, payload, reason)
select c.id, 1,
  jsonb_build_object('zones', (select jsonb_agg(jsonb_build_object('kind', z.kind, 'name', z.name))
                               from zones z where z.city_id = c.id)),
  'initial seed'
from cities c where c.name = 'Athens'
  and not exists (select 1 from zone_versions v where v.city_id = c.id and v.version = 1);

-- ---- POIs ----
insert into pois (city_id, name, kind, pos, icon, active)
select c.id, 'Syntagma Metro', 'metro', st_setsrid(st_makepoint(23.7351, 37.9753), 4326), 'metro', true
from cities c where c.name = 'Athens'
  and not exists (select 1 from pois p where p.city_id = c.id and p.name = 'Syntagma Metro');

-- ---- 6 vehicles + devices + live state (all inside operating zone, varied SoC) ----
with data(code, imei, lng, lat, soc) as (
  values
    ('PNY-1001', '350451001000001', 23.7270, 37.9840, 92),
    ('PNY-1002', '350451001000002', 23.7320, 37.9760, 64),
    ('PNY-1003', '350451001000003', 23.7200, 37.9800, 45),
    ('PNY-1004', '350451001000004', 23.7400, 37.9900, 18),
    ('PNY-1005', '350451001000005', 23.7150, 37.9720, 77),
    ('PNY-1006', '350451001000006', 23.7350, 37.9830, 30)
),
ins_v as (
  insert into vehicles (code, model_id, status, visible, city_id)
  select d.code, m.id, 'available', true, c.id
  from data d, vehicle_models m, cities c
  where m.name = 'Penny Scooter' and c.name = 'Athens'
    and not exists (select 1 from vehicles v where v.code = d.code)
  returning id, code
),
ins_d as (
  insert into devices (imei, iccid, phone_number, model, vehicle_id, server_profile, status)
  select d.imei, '89300' || d.imei, '+35799' || right(d.imei, 7), 'fmb930', v.id, 'penny', 'active'
  from data d join ins_v v on v.code = d.code
  returning id
)
insert into vehicle_state (vehicle_id, pos, soc_pct, ignition, locked, last_seen, session_online)
select v.id, st_setsrid(st_makepoint(d.lng, d.lat), 4326), d.soc, false, true, now(), true
from data d join ins_v v on v.code = d.code;

-- ---- app_config (feature flags & tunables fetched at app boot) ----
insert into app_config (key, value) values
  ('reservation_ttl_min', '15'::jsonb),
  ('min_start_soc',       '15'::jsonb),
  ('night_hours',         '{"from":"23:00","to":"05:00"}'::jsonb),
  ('photo_ai_threshold',  '0.85'::jsonb),
  ('hold_cents',          '500'::jsonb),
  ('station_mode',        'false'::jsonb),
  ('reserve_free_min',    '10'::jsonb),
  ('penalties',           '{"bad_parking":[0,500,1000],"no_go":1000,"abandon":[1500,3000]}'::jsonb)
on conflict (key) do nothing;

-- ---- Global ledger accounts (singletons; owner null) ----
insert into ledger_accounts (kind, owner_id, currency)
select k, null, 'EUR'
from (values ('penny_revenue'::ledger_account_kind),
             ('stripe_clearing'::ledger_account_kind),
             ('bonus'::ledger_account_kind)) as t(k)
where not exists (select 1 from ledger_accounts a where a.kind = t.k and a.owner_id is null);

-- ---- Staff owner placeholder (also seeds auth.users on Supabase; skipped on vanilla) ----
do $$
declare owner_uid uuid := '000000aa-0000-0000-0000-0000000000aa';
begin
  begin
    insert into auth.users (id, email) values (owner_uid, 'owner@penny.rent')
      on conflict (id) do nothing;
  exception when others then
    null;  -- vanilla Postgres (no auth schema) or restricted columns
  end;

  insert into users (id, phone, email, full_name, kyc_status, status, marketing_consent)
  values (owner_uid, '+306900000000', 'owner@penny.rent', 'Penny Owner', 'approved', 'active', false)
  on conflict (id) do nothing;

  insert into staff (user_id, role, active) values (owner_uid, 'owner', true)
  on conflict (user_id) do nothing;
exception when foreign_key_violation then
  raise notice 'Owner seed skipped: a matching auth.users row is required on Supabase (%).', sqlerrm;
end $$;

-- ---- Role permissions (checked in edge functions, not client) ----
insert into role_permissions (role, permission) values
  ('owner','*'),
  ('admin','payments.charge'), ('admin','payments.refund'), ('admin','zones.edit'),
  ('admin','users.block'), ('admin','pricing.edit'), ('admin','vehicle.command'),
  ('accountant','payments.refund'), ('accountant','debt.write_off'),
  ('ops_manager','vehicle.command'), ('ops_manager','ops.assign'),
  ('ops','vehicle.command'), ('support','users.block')
on conflict (role, permission) do nothing;

-- ---- FAQ (a few, pl/en/el) ----
insert into faq_items (lang, question, answer, sort) values
  ('en','How do I unlock a scooter?','Scan the QR code on the handlebar and tap Start.',1),
  ('en','Where can I park?','End your ride inside the operating zone, away from no-parking areas. A photo is required.',2),
  ('el','Πώς ξεκλειδώνω ένα πατίνι;','Σκανάρετε τον κωδικό QR στο τιμόνι και πατήστε Έναρξη.',1),
  ('el','Πού μπορώ να παρκάρω;','Τερματίστε τη διαδρομή εντός της ζώνης λειτουργίας. Απαιτείται φωτογραφία.',2),
  ('pl','Jak odblokować hulajnogę?','Zeskanuj kod QR na kierownicy i naciśnij Start.',1),
  ('pl','Gdzie mogę zaparkować?','Zakończ przejazd w strefie operacyjnej. Wymagane jest zdjęcie.',2)
on conflict do nothing;

-- ---- Products: packages / subscriptions / addons ----
insert into packages (name, minutes, price_cents, validity_days, active)
select 'Starter 60', 60, 999, 30, true
where not exists (select 1 from packages where name = 'Starter 60');
insert into packages (name, minutes, price_cents, validity_days, active)
select 'Commuter 200', 200, 2999, 30, true
where not exists (select 1 from packages where name = 'Commuter 200');

insert into subscriptions (name, stripe_price_id, perks, active)
select 'Penny Plus', null, '{"free_unlocks_per_day":2,"percent_off":10}'::jsonb, true
where not exists (select 1 from subscriptions where name = 'Penny Plus');

insert into addons (name, kind, price_cents, per, active)
select 'Trip Insurance', 'insurance', 99, 'trip', true
where not exists (select 1 from addons where name = 'Trip Insurance');
insert into addons (name, kind, price_cents, per, active)
select 'Helmet', 'helmet', 0, 'trip', true
where not exists (select 1 from addons where name = 'Helmet');

-- ---- Notification rules (docs/12 section B fleet alert catalogue) ----
insert into notification_rules (event_kind, condition, channels, recipients, throttle_s, digest, active) values
  ('moved_without_rental','{"min_move_m":30,"sustained_s":60,"locked":true,"no_trip":true}'::jsonb,
     array['email','push','telegram'], '{"roles":["ops"]}'::jsonb, 0, 'none', true),
  ('offline_too_long','{"min_offline_min":30,"during_trip_min":5}'::jsonb,
     array['email','telegram'], '{"roles":["ops"]}'::jsonb, 3600, 'hourly', true),
  ('fall_detected','{"tilt_deg":60,"sustained_s":10,"no_trip":true}'::jsonb,
     array['push','panel'], '{"roles":["ops"],"nearest":true}'::jsonb, 0, 'none', true),
  ('power_cut','{"ext_voltage_mv":0}'::jsonb,
     array['email','telegram'], '{"roles":["ops"]}'::jsonb, 0, 'none', true),
  ('left_operating_zone','{"no_trip":true}'::jsonb,
     array['email','telegram'], '{"roles":["ops"]}'::jsonb, 0, 'none', true),
  ('low_battery','{"warn_pct":20,"critical_pct":10}'::jsonb,
     array['panel'], '{"roles":["ops"],"auto_task":true}'::jsonb, 0, 'daily', true),
  ('no_gps_fix','{"sats_below":4,"min_min":15}'::jsonb,
     array['email'], '{"roles":["ops"]}'::jsonb, 0, 'daily', true),
  ('battery_drain_anomaly','{"sigma":2}'::jsonb,
     array['email'], '{"roles":["ops_manager"]}'::jsonb, 0, 'daily', true),
  ('repeated_unlock_failures','{"fails":3,"window_h":24}'::jsonb,
     array['email'], '{"roles":["ops_manager"],"auto_flag":"maintenance"}'::jsonb, 0, 'none', true),
  ('command_failure_spike','{"pct":5,"window_min":15}'::jsonb,
     array['telegram'], '{"roles":["ops_manager"]}'::jsonb, 0, 'none', true),
  ('stuck_trip','{"ending_over_s":60}'::jsonb,
     array['telegram','panel'], '{"roles":["support","ops"]}'::jsonb, 0, 'none', true),
  ('gateway_down','{"probe":"fail"}'::jsonb,
     array['telegram'], '{"roles":["owner","admin"]}'::jsonb, 0, 'none', true),
  ('sms_budget','{"per_day":500}'::jsonb,
     array['email'], '{"roles":["admin"]}'::jsonb, 0, 'daily', true),
  ('vandalism_pattern','{"reports":2,"window_d":7}'::jsonb,
     array['email'], '{"roles":["ops_manager"]}'::jsonb, 0, 'none', true),
  ('photo_queue_sla','{"p95_h":6}'::jsonb,
     array['email'], '{"roles":["support"]}'::jsonb, 0, 'none', true),
  ('chargeback_received','{}'::jsonb,
     array['email'], '{"roles":["owner","accountant"]}'::jsonb, 0, 'none', true),
  ('debt_threshold','{"total_eur":500}'::jsonb,
     array['email'], '{"roles":["owner"]}'::jsonb, 0, 'daily', true),
  ('new_user_spike','{"zscore":3}'::jsonb,
     array['email'], '{"roles":["admin"]}'::jsonb, 0, 'daily', true),
  ('idle_too_long','{"hours":72}'::jsonb,
     array['email'], '{"roles":["ops"],"auto_task":true}'::jsonb, 0, 'daily', true)
on conflict do nothing;
