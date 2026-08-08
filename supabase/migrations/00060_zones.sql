-- 00060_zones.sql
-- Cities, geofence zones (all 9 Atom zone types), zone version history, POIs.
-- Hard Rule #3: geofence decisions are server-side authoritative.

create table cities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  tz           text not null default 'Europe/Athens',
  currency     text not null default 'EUR',
  center       geometry(Point,4326),
  default_zoom int not null default 13,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Now that cities exists, wire up the deferred FK from 00040.
alter table vehicles
  add constraint vehicles_city_fk foreign key (city_id)
  references cities(id) on delete set null;

create table zones (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references cities(id) on delete cascade,
  kind       zone_kind not null,
  name       text,
  geom       geometry(Polygon,4326) not null,
  rules      jsonb not null default '{}'::jsonb,       -- {bonus_cents:100} {fee_cents:200} {limit_kmh:15}
  active     boolean not null default true,
  valid_from timestamptz,
  valid_to   timestamptz,
  version    int not null default 1,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on zones (city_id, kind) where active;
create index on zones using gist (geom);

-- Full history — the admin editor writes a new version row, never mutates existing.
create table zone_versions (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references cities(id) on delete cascade,
  version    int not null,
  payload    jsonb not null,                            -- full snapshot of zones for this version
  reason     text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (city_id, version)
);
create index on zone_versions (city_id, version desc);

create table pois (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references cities(id) on delete cascade,
  name       text not null,
  kind       text not null,
  pos        geometry(Point,4326) not null,
  icon       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index on pois (city_id) where active;
create index on pois using gist (pos);
