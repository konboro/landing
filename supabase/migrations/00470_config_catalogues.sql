-- 00470_config_catalogues.sql
--
-- Two catalogues the admin panel has always rendered and the database never
-- had: the penalty catalogue (Pricing → Penalties) and the loyalty tiers
-- (Marketing → Loyalty). Both were typed in the panel and read through
-- `admin-list`, which returned an empty array for a missing relation — so the
-- screens looked merely empty rather than unimplemented.
--
-- Shapes follow the types the panel already renders (`PenaltyCatalogItem`,
-- `LoyaltyTier`), so nothing client-side has to change to read them.

create table if not exists penalties (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,               -- stable key used in charges/appeals
  label          text not null,
  -- Escalation: first offence, second, third… charged in cents, in order.
  -- An array rather than three columns because operators do change the depth.
  tiers_cents    int[] not null default '{}',
  requires_photo boolean not null default true,      -- evidence before charging (docs/08)
  appealable     boolean not null default true,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint penalties_tiers_not_empty check (array_length(tiers_cents, 1) >= 1)
);

create table if not exists loyalty_tiers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  min_points int not null default 0,
  perks      text[] not null default '{}',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);
create index if not exists loyalty_tiers_threshold_idx on loyalty_tiers (min_points);

-- Both are config, not user data: service_role only, reached through the
-- admin-list / admin-write edge functions which check staff permission first
-- (Hard Rule #6).
alter table penalties     enable row level security;
alter table loyalty_tiers enable row level security;
revoke all on penalties, loyalty_tiers from anon, authenticated;

-- A starting catalogue so the screens are not empty on day one. Amounts are
-- deliberately conservative and every one of them is editable in the panel.
insert into penalties (code, label, tiers_cents, requires_photo, appealable) values
  ('bad_parking',    'Bad parking',            '{500,1000,2000}', true,  true),
  ('outside_zone',   'Ended outside the zone', '{1000,2000,3000}', true, true),
  ('no_photo',       'No end-of-ride photo',   '{300,600}',        false, true),
  ('damage',         'Damage caused by rider', '{2000,5000}',      true,  true),
  ('blocked_access', 'Blocking access',        '{1000,2000}',      true,  true)
on conflict (code) do nothing;

insert into loyalty_tiers (name, min_points, perks) values
  ('Bronze',  0,    '{"Standard rates"}'),
  ('Silver',  500,  '{"5% off rides","Priority support"}'),
  ('Gold',    2000, '{"10% off rides","Free unlock once a day","Priority support"}')
on conflict (name) do nothing;
