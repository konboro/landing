-- 00590_zone_alert_kinds.sql
-- Zone workflows P2/P3: operator-visible alerts for zone incidents.
--
-- The `zone-incident` edge fn records a vehicle_alerts row when a rider enters a
-- no-go zone (P3) or repeatedly tries to end a ride inside a no-parking zone (P2),
-- so operators see them in the admin panel. alert_kind had no value for either, so
-- add them. Additive and idempotent — ADD VALUE IF NOT EXISTS only appends.
alter type alert_kind add value if not exists 'no_go';
alter type alert_kind add value if not exists 'no_parking';
