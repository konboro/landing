-- 00005_auth_shim.sql
-- Supabase provides the `auth` schema, `auth.uid()`, `auth.role()`, and
-- `auth.users`. On a plain Postgres (local dev, CI, `psql` verification) they
-- do not exist, so RLS policies and FKs that reference them would fail.
--
-- This block creates a MINIMAL shim ONLY when the `auth` schema is absent, so:
--   * on real Supabase it is a complete no-op (schema already exists), and
--   * on vanilla Postgres the migrations, RLS, and seed all still apply.
--
-- The shim reads the same GUCs PostgREST/Supabase set per request
-- (request.jwt.claim.sub / .role), so policies behave consistently in tests.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $fn$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $fn$;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE AS $fn$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon')
      $fn$;

    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
      LANGUAGE sql STABLE AS $fn$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $fn$;

    -- Minimal mirror of auth.users so guarded FKs from public.users resolve.
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone text,
      email text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    RAISE NOTICE 'auth shim installed (vanilla Postgres). On Supabase this is skipped.';
  END IF;
END
$$;
