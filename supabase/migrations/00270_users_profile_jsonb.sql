-- 00270_users_profile_jsonb.sql
--
-- `users.profile` — the jsonb bag the customer-form extras live in
-- (date of birth, nationality, gender, preferred language, structured address,
-- emergency contact name). docs/02 and docs/08 "Customer form builder" describe
-- these as panel-configurable fields that are NOT first-class columns.
--
-- The rider app already reads and writes it on both sides:
--   * SupabaseRiderApi.updateProfile() merges them into `profile`
--   * readProfileExtras() reads `row.profile` on every session load
-- but no migration ever created the column, so onboarding died at the "about
-- you" step:
--
--     column "profile" of relation "users" does not exist   (PostgREST 42703)
--
-- and the screen showed nothing, because its handler had no catch (fixed in the
-- same change as this migration).
--
-- Worth knowing: the write happens on EVERY pass through that screen, not only
-- when a rider fills the optional fields — `date_of_birth: dob || null` sends
-- null rather than undefined, so the patch always carries `profile`.

alter table users
  add column if not exists profile jsonb not null default '{}'::jsonb;

comment on column users.profile is
  'Customer-form extras (docs/02): date_of_birth, nationality, gender, preferred_lang, address{line,city,postcode,country}, emergency_contact_name. Panel-configurable, so deliberately schemaless.';
