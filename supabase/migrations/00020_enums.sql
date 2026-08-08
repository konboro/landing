-- 00020_enums.sql
-- Every enum type. Names are snake_case of the @penny/db-types enum objects,
-- values are 1:1 with packages/db-types/src/enums.ts (the app compile contract).
-- Extra enums at the bottom back string-union columns declared in models.ts.

create type kyc_status as enum ('none','pending','approved','rejected','expired');
create type user_status as enum ('active','blocked','shadow_banned','deleted');
create type vehicle_kind as enum ('scooter','ebike','moped');
create type vehicle_status as enum (
  'available','reserved','in_trip','maintenance','transport',
  'low_battery','offline','stolen','decommissioned');
create type device_model as enum ('fmb930');
create type device_status as enum ('active','bench','faulty','retired');
create type server_profile as enum ('atom','penny');
create type zone_kind as enum (
  'operating','parking','paid_parking','parking_station','charging_station',
  'no_parking','bonus','speed_limit','no_go','rebalancing');
create type trip_status as enum (
  'reserved','unlocking','active','paused','ending','ended','charged','aborted','disputed');
create type photo_review as enum ('pending','auto_ok','approved','rejected');
create type command_kind as enum (
  'unlock','lock','locate','reboot','setparam','ring','alarm_on','alarm_off','custom');
create type command_status as enum ('queued','sent','acked','failed','expired');
create type command_channel as enum ('gprs','sms');
create type alert_kind as enum (
  'fall','power_cut','moved_locked','geofence_exit','offline','low_batt','error');
create type payment_kind as enum (
  'trip','topup','package','subscription','addon','debt','penalty','manual');
create type payment_status as enum (
  'requires_action','processing','succeeded','failed','refunded','partially_refunded');
create type ledger_account_kind as enum (
  'user_wallet','penny_revenue','stripe_clearing','debt','bonus','corporate');
create type debt_status as enum ('open','retrying','paid','written_off');
create type ops_task_kind as enum ('rebalance','battery_swap','pickup','repair','inspect','deploy');
create type ops_task_status as enum ('open','assigned','in_progress','done','cancelled');
create type damage_severity as enum ('low','medium','high','critical');
create type damage_status as enum ('new','confirmed','fixed','rejected');
create type staff_role as enum ('owner','admin','support','ops_manager','ops','accountant','readonly');
create type notification_channel as enum ('email','push','sms','telegram','panel','inbox');
create type lang as enum ('pl','en','el');

-- ---- Extra enums backing string-union columns in models.ts / docs 02 ----

-- TripEvent.actor
create type trip_actor as enum ('user','system','admin','ops');
-- Payment.initiated_by
create type payment_initiated_by as enum ('system','user','admin');
-- Debt.source
create type debt_source as enum ('failed_trip_payment','penalty','chargeback');
-- OpsTask.created_by
create type ops_task_created_by as enum ('admin','system_rule');
-- DamageReport.reporter
create type damage_reporter as enum ('rider','ops','admin');
-- scan_data_log.result
create type scan_result as enum ('ok','not_found','unavailable');
-- addons.kind / .per
create type addon_kind as enum ('insurance','helmet','other');
create type addon_per as enum ('trip','month');
-- promo_codes.kind
create type promo_kind as enum ('percent','fixed','free_minutes');
-- notification_log.status
create type notification_status as enum ('queued','sent','failed','suppressed');
-- notification_rules.digest
create type notification_digest as enum ('none','hourly','daily');
