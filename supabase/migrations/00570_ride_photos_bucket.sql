-- 00570_ride_photos_bucket.sql
-- Private Storage bucket for end-of-ride parking photos (docs/04, zone workflows M1).
--
-- Same convention as kyc-docs (00180): bytes live in a PRIVATE bucket; nothing is
-- ever public. The rider uploads through a short-TTL SIGNED UPLOAD URL minted by the
-- `photos-sign-upload` edge fn (service_role), and staff/AI read through short-TTL
-- SIGNED DOWNLOAD URLs minted server-side. Because all I/O is server-signed, no
-- storage.objects RLS policy is needed — the anon/authenticated roles never touch
-- the bucket directly.
--
-- Object layout: 'ride-photos/<trip_id>/end.jpg' — one canonical end photo per trip.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('ride-photos', 'ride-photos', false)
    on conflict (id) do nothing;
  else
    raise notice 'storage schema absent (vanilla Postgres) — create the PRIVATE ride-photos bucket on Supabase.';
  end if;
exception when others then
  raise notice 'ride-photos bucket creation skipped: %', sqlerrm;
end $$;

-- trips.end_photo_url already exists (00070). Its meaning is now the storage OBJECT
-- PATH within ride-photos (e.g. '<trip_id>/end.jpg'), not a fetchable URL. Every read
-- site turns it into a short-TTL signed URL. Comment records the contract.
comment on column trips.end_photo_url is
  'Storage object path in the PRIVATE ride-photos bucket (e.g. "<trip_id>/end.jpg"). '
  'Never a public URL — read sites mint a short-TTL signed URL. See migration 00570.';
