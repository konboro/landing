-- grant-admin.sql — make one e-mail address an owner of the admin panel.
--
-- Run it in the Supabase dashboard → SQL Editor (it runs as `postgres`, which is
-- what writing to the `auth` schema needs). Edit the three values at the top
-- first. Idempotent: re-running it resets the password and re-asserts the role.
--
-- Why all three inserts are needed — `admin-me` (services/edge/functions/admin-me)
-- is what the panel calls right after sign-in, and it wants:
--   1. auth.users   — a GoTrue-readable row, so signInWithPassword works at all
--   2. users        — the profile it reads name/email/phone from
--   3. staff        — active row, else it answers 403 "not an active staff member"
-- Only 1+3 are strictly required to get in; 2 keeps the top bar from saying "Staff".
--
-- The auth.users row is written with every column GoTrue scans into a non-nullable
-- Go string. That is the same trap as migration 00260: a NULL `instance_id` or
-- `confirmation_token` makes GoTrue miss the row and fail with
-- "Database error finding user" instead of "invalid credentials".

do $$
declare
  -- ── edit these ────────────────────────────────────────────────────────────
  v_email    text := 'kbborowiec@gmail.com';
  v_password text := 'CHANGE_ME_BEFORE_RUNNING';
  v_name     text := 'Konrad';
  -- ──────────────────────────────────────────────────────────────────────────
  v_uid      uuid;
  v_crypto   text;      -- schema holding pgcrypto (public on vanilla, extensions on Supabase)
  v_hash     text;
  v_created  boolean := false;
begin
  if v_password = 'CHANGE_ME_BEFORE_RUNNING' or length(v_password) < 8 then
    raise exception 'Set v_password (min 8 chars) before running this script.';
  end if;

  select n.nspname into v_crypto
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'gen_salt'
  limit 1;
  if v_crypto is null then
    raise exception 'pgcrypto is not installed — run: create extension pgcrypto with schema extensions;';
  end if;
  execute format('select %I.crypt($1, %I.gen_salt(''bf''))', v_crypto, v_crypto)
    into v_hash using v_password;

  -- ── 1. auth.users ─────────────────────────────────────────────────────────
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    v_uid := gen_random_uuid();
    v_created := true;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, v_hash, now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
    instance_id        = coalesce(auth.users.instance_id, excluded.instance_id),
    aud                = coalesce(auth.users.aud, excluded.aud),
    role               = coalesce(auth.users.role, excluded.role),
    raw_app_meta_data  = coalesce(auth.users.raw_app_meta_data, excluded.raw_app_meta_data),
    raw_user_meta_data = coalesce(auth.users.raw_user_meta_data, excluded.raw_user_meta_data),
    confirmation_token     = coalesce(auth.users.confirmation_token, ''),
    recovery_token         = coalesce(auth.users.recovery_token, ''),
    email_change           = coalesce(auth.users.email_change, ''),
    email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
    updated_at         = now();

  -- Identity row: GoTrue signs in without it, but the dashboard and the
  -- password-reset flow expect it. Column layout differs between versions,
  -- so try the current shape and fall back to the old one.
  if not exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    begin
      insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_uid, v_uid::text,
              jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
              'email', now(), now(), now());
    exception when undefined_column or not_null_violation then
      begin
        insert into auth.identities (id, user_id, identity_data, provider,
                                     last_sign_in_at, created_at, updated_at)
        values (v_uid::text, v_uid,
                jsonb_build_object('sub', v_uid::text, 'email', v_email),
                'email', now(), now(), now());
      exception when others then
        raise notice 'identity row skipped: %', sqlerrm;
      end;
    end;
  end if;

  -- ── 2. users (profile) ────────────────────────────────────────────────────
  -- phone stays NULL: it is UNIQUE and this account signs in by e-mail.
  insert into users (id, email, full_name, kyc_status, status, marketing_consent)
  values (v_uid, v_email, v_name, 'approved', 'active', false)
  on conflict (id) do update set
    email     = excluded.email,
    full_name = coalesce(users.full_name, excluded.full_name),
    status    = 'active',
    updated_at = now();

  -- ── 3. staff (role) ───────────────────────────────────────────────────────
  -- city_scope NULL = every city. 'owner' maps to permission '*' (seed 00160).
  insert into staff (user_id, role, city_scope, active)
  values (v_uid, 'owner', null, true)
  on conflict (user_id) do update set
    role   = 'owner',
    active = true;

  raise notice '% owner %  (auth.users.id = %)',
    case when v_created then 'Created' else 'Updated' end, v_email, v_uid;
end $$;

-- Verify (should return one row, active = true, role = owner):
select u.email, s.role, s.active, s.city_scope, au.email_confirmed_at is not null as confirmed
from staff s
join users u on u.id = s.user_id
join auth.users au on au.id = s.user_id
where lower(u.email) = lower('kbborowiec@gmail.com');
