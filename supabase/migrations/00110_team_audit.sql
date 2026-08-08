-- 00110_team_audit.sql
-- Team, RBAC permission map, audit log (Hard Rule #8: all admin/ops mutations logged).

create table staff (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  role       staff_role not null,
  city_scope uuid[],                                   -- null = all cities
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id)
);
create index on staff (role) where active;

create table role_permissions (
  role       staff_role not null,
  permission text not null,                            -- e.g. 'payments.charge', 'zones.edit'
  primary key (role, permission)
);

create table audit_log (
  id        uuid primary key default gen_random_uuid(),
  staff_id  uuid references staff(id) on delete set null,
  action    text not null,
  entity    text not null,
  entity_id text,
  before    jsonb,
  after     jsonb,
  reason    text,
  ip        text,
  at        timestamptz not null default now()
);
create index on audit_log (entity, entity_id);
create index on audit_log (staff_id, at desc);
create index on audit_log (at desc);
