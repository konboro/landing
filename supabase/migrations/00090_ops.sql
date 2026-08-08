-- 00090_ops.sql
-- Ops tasks, damage reports, battery swaps, maintenance log (parity: Fleet maintenance).

create table ops_tasks (
  id           uuid primary key default gen_random_uuid(),
  kind         ops_task_kind not null,
  vehicle_id   uuid references vehicles(id) on delete set null,
  zone_id      uuid references zones(id) on delete set null,
  priority     int not null default 0,
  status       ops_task_status not null default 'open',
  assignee     uuid references users(id) on delete set null,
  due_at       timestamptz,
  checklist    jsonb not null default '[]'::jsonb,     -- [{key,label,required_photo,done}]
  photos       text[] not null default '{}',
  notes        text,
  created_by   ops_task_created_by not null default 'admin',
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on ops_tasks (status, priority desc);
create index on ops_tasks (assignee) where status in ('open','assigned','in_progress');
create index on ops_tasks (vehicle_id);

create table damage_reports (
  id                 uuid primary key default gen_random_uuid(),
  vehicle_id         uuid not null references vehicles(id) on delete cascade,
  reporter           damage_reporter not null,
  user_id            uuid references users(id) on delete set null,
  trip_id            uuid references trips(id) on delete set null,
  description        text,
  photos             text[] not null default '{}',
  severity           damage_severity not null default 'low',
  status             damage_status not null default 'new',
  linked_task_id     uuid references ops_tasks(id) on delete set null,
  penalty_payment_id uuid references payments(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index on damage_reports (vehicle_id, created_at desc);
create index on damage_reports (status);

create table battery_swaps (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references vehicles(id) on delete cascade,
  by             uuid references users(id) on delete set null,
  at             timestamptz not null default now(),
  voltage_before int,
  voltage_after  int
);
create index on battery_swaps (vehicle_id, at desc);

create table maintenance_log (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  task_id    uuid references ops_tasks(id) on delete set null,
  parts      jsonb not null default '[]'::jsonb,
  cost_cents int not null default 0,
  notes      text,
  created_at timestamptz not null default now()
);
create index on maintenance_log (vehicle_id, created_at desc);
