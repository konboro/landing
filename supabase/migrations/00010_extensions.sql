-- 00010_extensions.sql
-- Penny Platform — required Postgres extensions.
-- Hard Rule #12: every schema change lives here, never dashboard-only.

-- PostGIS: all geo columns are geometry(...,4326).
create extension if not exists postgis;

-- pgcrypto: gen_random_uuid() for uuid pk defaults, hmac() for webhook sig checks.
create extension if not exists pgcrypto;

-- pgmq (queue) and pg_cron (scheduler) are Supabase-managed extensions. They are
-- normally pre-installed on Supabase Postgres. We guard them so a fresh vanilla
-- Postgres+PostGIS still accepts this migration set even when the packages are
-- unavailable (they are only exercised by edge functions / cron jobs at runtime).
do $$
begin
  begin
    create extension if not exists pgmq;
  exception when others then
    raise notice 'pgmq extension unavailable (Supabase-managed) — skipping: %', sqlerrm;
  end;

  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron extension unavailable (Supabase-managed) — skipping: %', sqlerrm;
  end;
end $$;
