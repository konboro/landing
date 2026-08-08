-- 00120_notifications.sql
-- One notification engine, all channels (docs/12).

create table notification_rules (
  id          uuid primary key default gen_random_uuid(),
  event_kind  text not null,                           -- e.g. 'moved_without_rental'
  condition   jsonb not null default '{}'::jsonb,       -- {min_offline_min:30},{min_move_m:30}
  channels    text[] not null default '{}',             -- email|push|sms|telegram|panel|inbox
  recipients  jsonb not null default '{}'::jsonb,        -- roles, emails, "vehicle_owner_city_ops"
  throttle_s  int not null default 0,
  digest      notification_digest not null default 'none',
  quiet_hours jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on notification_rules (event_kind) where active;

create table notification_log (
  id           uuid primary key default gen_random_uuid(),
  rule_id      uuid references notification_rules(id) on delete set null,
  user_id      uuid references users(id) on delete cascade,
  staff_target text,
  channel      notification_channel not null,
  template_key text not null,
  payload      jsonb not null default '{}'::jsonb,
  status       notification_status not null default 'queued',
  dedupe_key   text,                                    -- event+target+template+window (idempotency)
  sent_at      timestamptz,
  error        text,
  created_at   timestamptz not null default now()
);
create index on notification_log (user_id, created_at desc);
create index on notification_log (rule_id, created_at desc);
-- Every send idempotent (docs/12 F).
create unique index notification_log_dedupe_key
  on notification_log (dedupe_key) where dedupe_key is not null;

create table user_notification_prefs (
  user_id            uuid primary key references users(id) on delete cascade,
  push_marketing     boolean not null default false,
  email_marketing    boolean not null default false,
  push_transactional boolean not null default true,     -- cannot be fully off where legally required
  email_receipts     boolean not null default true,
  lang               lang not null default 'el',
  updated_at         timestamptz not null default now()
);

create table inbox_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  title      text not null,
  body       text not null,
  deep_link  text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on inbox_messages (user_id, created_at desc);
create index on inbox_messages (user_id) where read_at is null;

create table push_tokens (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references users(id) on delete cascade,
  token     text not null,
  platform  text not null,                              -- ios | android
  last_seen timestamptz not null default now(),
  unique (token)
);
create index on push_tokens (user_id);

create table onboarding_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  step         text not null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, step)
);
create index on onboarding_progress (user_id);
