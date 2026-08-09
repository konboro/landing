-- 00320_gateway_db_role.sql
--
-- A dedicated Postgres role for the IoT gateway.
--
-- The gateway is the one component that connects to Postgres directly rather
-- than through PostgREST, so it needs a real database login. The obvious
-- shortcut is to hand it the `postgres` superuser password — which would mean
-- a box sitting on the public internet, listening on a raw TCP port for
-- unauthenticated devices, holding credentials that can drop the database.
--
-- Instead this role gets exactly the objects `internal/store/storepg.go` and
-- the command consumer touch, and nothing else:
--
--   devices          SELECT            resolve IMEI -> vehicle at handshake
--   telemetry        INSERT            AVL records (COPY, partitioned parent)
--   vehicle_state    SELECT/INS/UPD    the hot per-vehicle row
--   vehicle_alerts   INSERT            fall / power-cut / moved-while-locked
--   commands         SELECT/UPDATE     mark sent / acked / failed
--   pgmq queue       read + archive    outbound command delivery
--
-- It cannot read `users`, `trips`, `payments` or the ledger. A gateway
-- compromise costs telemetry, not the customer database.
--
-- BYPASSRLS is deliberate and required: these tables are default-deny (00140)
-- and the gateway writes as itself, not on behalf of a signed-in user.
--
-- The password is NOT in this file. Set it once, out of band:
--   alter role penny_gateway with password '<generated>';
-- and put the connection string in /etc/penny/gateway.env on the VPS (0640).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'penny_gateway') then
    -- No password here on purpose; it is set separately so this migration can
    -- live in git.
    create role penny_gateway with login bypassrls;
  end if;
end $$;

grant usage on schema public to penny_gateway;

grant select                         on public.devices        to penny_gateway;
grant insert                         on public.telemetry      to penny_gateway;
grant select, insert, update         on public.vehicle_state  to penny_gateway;
grant insert                         on public.vehicle_alerts to penny_gateway;
grant select, update                 on public.commands       to penny_gateway;

-- telemetry is partitioned; new monthly partitions must inherit the grant or
-- ingest silently starts failing at the turn of a month.
alter default privileges in schema public grant insert on tables to penny_gateway;

-- pgmq keeps its queues in its own schema and needs both the table and the
-- helper functions.
grant usage on schema pgmq to penny_gateway;
grant select, insert, update, delete on all tables in schema pgmq to penny_gateway;
grant execute on all functions in schema pgmq to penny_gateway;
alter default privileges in schema pgmq grant select, insert, update, delete on tables to penny_gateway;

comment on role penny_gateway is
  'IoT gateway (VPS). Least privilege: telemetry/vehicle_state/alerts/commands + pgmq only. No access to users, trips, payments or the ledger.';
