-- 00050_telemetry.sql
-- High-volume telemetry (partitioned monthly) + live state + alerts + commands.
-- Hard Rule #9: store BOTH device_ts and server_ts. Hard Rule #7: IMEI never here (device_id fk).

-- ---- telemetry (PARTITION BY RANGE(server_ts), monthly) ----
create table telemetry (
  id             uuid not null default gen_random_uuid(),
  device_id      uuid not null references devices(id) on delete cascade,
  vehicle_id     uuid references vehicles(id) on delete set null,  -- denormalized
  device_ts      timestamptz not null,
  server_ts      timestamptz not null default now(),
  pos            geometry(Point,4326),
  speed_kmh      real,
  heading        real,
  altitude       real,
  sats           smallint,
  hdop           real,
  ext_voltage_mv int,
  batt_voltage_mv int,
  din1           boolean,
  dout1          boolean,
  dout2          boolean,
  gsm_signal     smallint,
  io             jsonb not null default '{}'::jsonb,  -- raw AVL IO elements by id
  primary key (id, server_ts)                          -- partition key must be in PK
) partition by range (server_ts);

create index on telemetry (device_id, server_ts desc);
create index on telemetry (vehicle_id, server_ts desc);
create index on telemetry using gist (pos);

-- Month partitions (UTC). Extend via pg_cron in production.
create table telemetry_2026_08 partition of telemetry
  for values from ('2026-08-01 00:00:00+00') to ('2026-09-01 00:00:00+00');
create table telemetry_2026_09 partition of telemetry
  for values from ('2026-09-01 00:00:00+00') to ('2026-10-01 00:00:00+00');
create table telemetry_2026_10 partition of telemetry
  for values from ('2026-10-01 00:00:00+00') to ('2026-11-01 00:00:00+00');
-- Catch-all so inserts never fail if a month partition is missing.
create table telemetry_default partition of telemetry default;

-- ---- vehicle_state: 1 row per vehicle, UPSERT; the ONLY table apps subscribe to ----
create table vehicle_state (
  vehicle_id         uuid primary key references vehicles(id) on delete cascade,
  pos                geometry(Point,4326),
  soc_pct            smallint,
  speed_kmh          real,
  ignition           boolean not null default false,
  locked             boolean not null default true,
  last_seen          timestamptz,
  session_online     boolean not null default false,
  fall               boolean not null default false,
  power_cut          boolean not null default false,
  moved_while_locked boolean not null default false,
  zone_cache         jsonb,                            -- last zone evaluation
  updated_at         timestamptz not null default now()
);
create index on vehicle_state using gist (pos);
create index on vehicle_state (session_online);

-- ---- vehicle_alerts (parity: Alerts & notifications, Vehicle error log) ----
create table vehicle_alerts (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  kind       alert_kind not null,
  payload    jsonb not null default '{}'::jsonb,
  ack_by     uuid references users(id) on delete set null,
  ack_at     timestamptz,
  created_at timestamptz not null default now()
);
create index on vehicle_alerts (vehicle_id, created_at desc);
create index on vehicle_alerts (kind);

-- ---- commands (parity: IoT data log / Manage IoT). trip_id FK added in 00070 ----
create table commands (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references vehicles(id) on delete cascade,
  device_id         uuid references devices(id) on delete set null,
  kind              command_kind not null,
  payload           jsonb not null default '{}'::jsonb,
  status            command_status not null default 'queued',
  channel           command_channel not null default 'gprs',
  requested_by      uuid references users(id) on delete set null,
  trip_id           uuid,                              -- FK to trips added in 00070
  client_command_id text,                              -- idempotency from apps
  sent_at           timestamptz,
  acked_at          timestamptz,
  error             text,
  created_at        timestamptz not null default now()
);
create index on commands (vehicle_id, created_at desc);
create index on commands (status);
create unique index commands_client_command_id_key
  on commands (client_command_id) where client_command_id is not null;

-- ---- scan_data_log (parity: Scan data log) ----
create table scan_data_log (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references users(id) on delete set null,
  vehicle_code_scanned text not null,
  resolved_vehicle_id uuid references vehicles(id) on delete set null,
  result              scan_result not null,
  pos                 geometry(Point,4326),
  created_at          timestamptz not null default now()
);
create index on scan_data_log (user_id, created_at desc);

-- ---- vehicle_status_log (2nd pass: status/visibility audit trail) ----
create table vehicle_status_log (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  from_status vehicle_status,
  to_status   vehicle_status not null,
  by          uuid references users(id) on delete set null,
  role        text,
  reason      text,
  photos      text[] not null default '{}',
  pos         geometry(Point,4326),
  at          timestamptz not null default now()
);
create index on vehicle_status_log (vehicle_id, at desc);
