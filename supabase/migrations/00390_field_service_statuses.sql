-- 00390_field_service_statuses.sql
--
-- Four vehicle states the field app needs and the enum did not have. Ops crews
-- were forced to spell all of these "maintenance", which then meant five
-- different things and could not be filtered, counted or acted on.
--
--   charging            on a charger right now (distinct from broken)
--   storage             in the warehouse, deliberately out of circulation
--   not_ready           physically present but not serviceable yet (assembled,
--                       awaiting QA, missing plate…)
--   needs_investigation someone looked at it and something is wrong, but the
--                       fault is not yet known. docs/07 calls this the
--                       "offline-investigate" step. It is NOT `offline`, which
--                       means the device has not reported — conflating "no GPRS
--                       session" with "a human flagged this" makes both useless.
--
-- SAFETY: every rider-facing surface is an ALLOWLIST, not a denylist —
-- `v_public_vehicles` is `where status = 'available' and visible = true`, and
-- GBFS is built on that view. So a new status is invisible and unrentable the
-- moment it exists, with no other change required. That is the only reason this
-- is a safe additive migration rather than a cross-cutting one.
--
-- docs/07 defines the ops transition matrix in terms of the original
-- vocabulary; these are additions to it, not a replacement, and the trip engine
-- still owns `reserved` / `in_trip` exclusively.

alter type vehicle_status add value if not exists 'charging';
alter type vehicle_status add value if not exists 'storage';
alter type vehicle_status add value if not exists 'not_ready';
alter type vehicle_status add value if not exists 'needs_investigation';
