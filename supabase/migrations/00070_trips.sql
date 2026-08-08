-- 00070_trips.sql
-- Trips + append-only trip_events (Hard Rule #4) + routes + reviews.
-- promo_redemption_id FK is wired in 00080 (promo_redemptions created there).

create table trips (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete restrict,
  vehicle_id          uuid not null references vehicles(id) on delete restrict,
  status              trip_status not null default 'reserved',
  group_id            uuid,                            -- multi-vehicle group ride
  client_command_id   text,                            -- idempotency for trips-start
  reserved_at         timestamptz,
  started_at          timestamptz,
  ended_at            timestamptz,
  start_pos           geometry(Point,4326),
  end_pos             geometry(Point,4326),
  distance_m          int not null default 0,
  duration_s          int not null default 0,
  pause_s             int not null default 0,
  pricing_snapshot    jsonb,                           -- tariff frozen at start
  cost_cents          int not null default 0,
  discount_cents      int not null default 0,
  bonus_cents         int not null default 0,
  penalty_cents       int not null default 0,
  currency            text not null default 'EUR',
  end_photo_url       text,
  photo_review        photo_review,
  end_zone_id         uuid references zones(id) on delete set null,
  corporate_id        uuid references corporate_accounts(id) on delete set null,
  promo_redemption_id uuid,                            -- FK added in 00080
  created_at          timestamptz not null default now()
);
create index on trips (user_id, created_at desc);
create index on trips (vehicle_id, created_at desc);
create index on trips (status);
create index on trips (photo_review) where photo_review = 'pending';
-- One trip per idempotency key (trips-start replays return the same trip).
create unique index trips_client_command_id_key
  on trips (client_command_id) where client_command_id is not null;
-- A user may only have one live trip at a time (start precondition, docs/04).
create unique index trips_one_active_per_user
  on trips (user_id)
  where status in ('reserved','unlocking','active','paused','ending');

-- Now wire the deferred FK from 00050 (commands -> trips).
alter table commands
  add constraint commands_trip_fk foreign key (trip_id)
  references trips(id) on delete set null;

-- ---- trip_events: append-only ledger of every state transition ----
create table trip_events (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  from_status trip_status,
  to_status   trip_status not null,
  at          timestamptz not null default now(),
  actor       trip_actor not null,
  meta        jsonb not null default '{}'::jsonb
);
create index on trip_events (trip_id, at);

-- Enforce append-only: no updates, no deletes.
create or replace function trip_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'trip_events is append-only (Hard Rule #4): % not allowed', tg_op;
end $$;
create trigger trip_events_no_mutate
  before update or delete on trip_events
  for each row execute function trip_events_append_only();

-- ---- trip_routes: server-built path (from telemetry), simplified for display ----
create table trip_routes (
  trip_id    uuid primary key references trips(id) on delete cascade,
  path       geometry(LineString,4326),
  simplified geometry(LineString,4326),
  updated_at timestamptz not null default now()
);
create index on trip_routes using gist (path);

-- ---- ride_reviews ----
create table ride_reviews (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  rating     int check (rating between 1 and 5),
  tags       text[] not null default '{}',
  comment    text,
  created_at timestamptz not null default now(),
  unique (trip_id)
);
