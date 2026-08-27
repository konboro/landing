-- 00580_verification_queue_enrich.sql
-- Make the ride-verification queue carry the full RideRow shape (zone workflows M1).
--
-- The original v_ride_verification_queue (00130) returned only bare trip columns, so
-- the admin panel could not show the rider, vehicle, or city beside the parking photo
-- and the SupabaseDataSource had nothing to map into VerificationItem.trip (RideRow).
-- v_admin_rides (00220) already projects exactly RideRow, so build the queue on top of
-- it and just filter to the photos still awaiting a human decision.
--
-- DROP then CREATE (not CREATE OR REPLACE): the original view led with column `trip_id`
-- and the RideRow projection leads with `id`. CREATE OR REPLACE cannot rename an
-- existing view column (Postgres 42P16), so the old view has to go first. Nothing in
-- the schema depends on it — the admin panel reads it dynamically through admin-list.
drop view if exists v_ride_verification_queue;

create view v_ride_verification_queue as
select *
from v_admin_rides
where photo_review = 'pending';

comment on view v_ride_verification_queue is
  'Parking photos awaiting human review — full RideRow projection (via v_admin_rides), '
  'filtered to photo_review = pending. end_photo_url is a private-bucket object path; '
  'admin-list mints a signed url before returning it. See migrations 00570/00580.';
