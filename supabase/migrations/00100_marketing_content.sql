-- 00100_marketing_content.sql
-- Marketing campaigns, FAQ, editable app content/config, localization, forms, reaction tests.
-- (pois live in 00060 alongside the other geo tables.)

create table push_campaigns (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  segment      jsonb not null default '{}'::jsonb,     -- audience selector
  trigger      jsonb,                                  -- lifecycle automation trigger (docs/12 C)
  scheduled_at timestamptz,
  sent_count   int not null default 0,
  status       text not null default 'draft',          -- draft | scheduled | sending | sent
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table email_campaigns (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null,
  template_key text not null,                          -- react-email template in packages/emails
  segment      jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  sent_count   int not null default 0,
  status       text not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table faq_items (
  id       uuid primary key default gen_random_uuid(),
  lang     lang not null,
  question text not null,
  answer   text not null,
  sort     int not null default 0,
  active   boolean not null default true
);
create index on faq_items (lang, sort);

create table app_content (
  key        text not null,                            -- tutorials, onboarding slides, map icons
  lang       lang not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (key, lang)
);

create table app_config (
  key        text primary key,                         -- feature flags & tunables
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table translations (
  lang  lang not null,
  ns    text not null,
  key   text not null,
  value text not null,
  primary key (lang, ns, key)
);

create table customer_forms (
  id         uuid primary key default gen_random_uuid(),
  fields     jsonb not null default '[]'::jsonb,        -- extra signup questions
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table reaction_tests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  trip_id    uuid references trips(id) on delete set null,
  started_at timestamptz not null default now(),
  passed     boolean,
  score      jsonb not null default '{}'::jsonb
);
create index on reaction_tests (user_id, started_at desc);
