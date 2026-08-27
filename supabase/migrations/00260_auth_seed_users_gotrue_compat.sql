-- 00260_auth_seed_users_gotrue_compat.sql
--
-- The seeds in 00160 and 00190 create auth.users rows with only (id, email),
-- which is enough for the foreign keys in `users`/`staff` but NOT enough for
-- GoTrue to read them back. Signing in as any seeded account failed with
--
--     {"code":500,"error_code":"unexpected_failure",
--      "msg":"Database error finding user"}
--
-- because GoTrue scans the token columns into non-nullable Go strings, and
-- with a NULL `instance_id` its lookup misses the row entirely — so a phone
-- sign-in then tried to INSERT a second user and hit
-- `duplicate key value violates unique constraint "users_phone_key"` instead.
--
-- Nothing caught it because the panel signs in with email+password against a
-- dashboard-created user (a complete row), while the seeded rider accounts had
-- never been used to log in.
--
-- Idempotent, and safe to re-run: it only fills NULLs.

do $$
begin
  update auth.users set
    instance_id            = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
    aud                    = coalesce(aud, 'authenticated'),
    role                   = coalesce(role, 'authenticated'),
    raw_app_meta_data      = coalesce(raw_app_meta_data, '{}'::jsonb),
    raw_user_meta_data     = coalesce(raw_user_meta_data, '{}'::jsonb),
    created_at             = coalesce(created_at, now()),
    updated_at             = coalesce(updated_at, now()),
    -- GoTrue reads these as plain strings; NULL breaks the row scan.
    confirmation_token     = coalesce(confirmation_token, ''),
    recovery_token         = coalesce(recovery_token, ''),
    email_change           = coalesce(email_change, ''),
    email_change_token_new = coalesce(email_change_token_new, '')
  where instance_id is null
     or aud is null
     or role is null
     or raw_app_meta_data is null
     or raw_user_meta_data is null
     or created_at is null
     or updated_at is null
     or confirmation_token is null
     or recovery_token is null
     or email_change is null
     or email_change_token_new is null;
exception when undefined_table or undefined_column or insufficient_privilege then
  -- Vanilla Postgres (no auth schema) or a restricted role: nothing to repair.
  raise notice 'auth.users compat skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Signing in as a seeded rider without an SMS provider
--
-- Phone auth needs no Twilio account for a fixed test number. In the dashboard
-- (Authentication -> Sign In / Providers -> Phone), or via the Management API:
--
--   PATCH /v1/projects/<ref>/config/auth
--   { "external_phone_enabled": true,
--     "sms_test_otp": "306941000001=123456",
--     "sms_test_otp_valid_until": "<future ISO timestamp>" }
--
-- and give that seeded rider the matching phone (GoTrue stores it without `+`):
--
--   update auth.users
--      set phone = '306941000001', phone_confirmed_at = now()
--    where id = '000000d0-0000-0000-0000-000000000001';
--
-- The rider app then signs in with +30 6941000001 / 123456 and lands on a real
-- profile — `verifyOtp` is followed by a `users` lookup, and an auth user with
-- no matching `users` row fails with "no profile found".
-- ---------------------------------------------------------------------------
