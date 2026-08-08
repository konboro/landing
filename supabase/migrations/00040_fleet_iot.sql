-- 00040_fleet_iot.sql
-- Fleet & IoT device inventory.
-- vehicle_models <-> battery_curves is circular; we break it with a deferred ALTER.
-- vehicles.city_id references cities, which is created in 00060 — FK added there.

create table vehicle_models (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  kind             vehicle_kind not null,
  battery_curve_id uuid,                              -- FK added after battery_curves
  max_speed_kmh    int not null default 25,
  deposit_cents    int not null default 0,
  requires_licence boolean not null default false,
  photo_url        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table battery_curves (
  id         uuid primary key default gen_random_uuid(),
  model_id   uuid not null references vehicle_models(id) on delete cascade,
  points     jsonb not null default '[]'::jsonb,      -- [[voltage_mv, soc_pct], ...]
  created_at timestamptz not null default now()
);
create index on battery_curves (model_id);

alter table vehicle_models
  add constraint vehicle_models_battery_curve_fk
  foreign key (battery_curve_id) references battery_curves(id) on delete set null;

create table vehicles (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                    -- printed QR / short code
  model_id   uuid not null references vehicle_models(id),
  status     vehicle_status not null default 'offline',
  visible    boolean not null default true,           -- hide from rider map independent of status
  plate      text,
  vin        text,
  city_id    uuid,                                     -- FK to cities added in 00060
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on vehicles (model_id);
create index on vehicles (city_id);
create index on vehicles (status);

create table devices (
  id             uuid primary key default gen_random_uuid(),
  imei           text not null unique,                 -- device identity (Hard Rule #7/#10: exact text)
  iccid          text,
  phone_number   text,                                 -- SIM MSISDN for SMS fallback
  model          device_model not null default 'fmb930',
  fw_version     text,
  vehicle_id     uuid references vehicles(id) on delete set null,  -- re-linkable (device swap)
  server_profile server_profile not null default 'penny',
  added_by       uuid references users(id) on delete set null,
  status         device_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on devices (vehicle_id);
create index on devices (status);
