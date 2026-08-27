-- 00330_devices_sms_credentials.sql
--
-- `devices.sms_login` / `devices.sms_pass` — the per-device Teltonika SMS
-- credentials. docs/03 specifies them ("SMS format `<login> <pass> <command>`;
-- login/pass per-device from `devices` config") and the gateway has always
-- SELECTed them, but no migration ever created the columns.
--
-- The effect was total: `DeviceByIMEI` runs at handshake, the query failed with
--
--     ERROR: column "sms_login" does not exist (SQLSTATE 42703)
--
-- and the gateway answered 0x00 — so EVERY device was rejected the moment it
-- connected, real hardware included. It only shows up when something actually
-- dials in; the unit tests use the in-memory store, which has the fields.
--
-- Nullable and empty by default: SMS fallback is per-device and optional, and a
-- device with no credentials simply has no SMS channel — it must still be able
-- to connect over GPRS.

alter table devices
  add column if not exists sms_login text,
  add column if not exists sms_pass  text;

comment on column devices.sms_login is
  'Teltonika SMS command login for this device. Empty = no SMS fallback channel.';
comment on column devices.sms_pass is
  'Teltonika SMS command password. Never logged (Hard Rule #11).';
