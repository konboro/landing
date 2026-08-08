-- 00080_money.sql
-- Double-entry ledger + Stripe payment surface + products + loyalty + invoices.
-- Hard Rule #2: ALL money moves through ledger_entries; balances are derived, never a column.

-- ---- Ledger core ----
create table ledger_accounts (
  id         uuid primary key default gen_random_uuid(),
  kind       ledger_account_kind not null,
  owner_id   uuid,                                   -- user/corporate owner, null for global accounts
  currency   text not null default 'EUR',
  created_at timestamptz not null default now()
);
-- One account per (kind, owner). Global accounts (owner null) are singletons per kind.
create unique index ledger_accounts_kind_owner_key
  on ledger_accounts (kind, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table ledger_entries (
  id         uuid primary key default gen_random_uuid(),
  txn_id     uuid not null,                          -- groups the two+ legs of one movement
  account_id uuid not null references ledger_accounts(id) on delete restrict,
  delta_cents bigint not null,                       -- sign convention: credit +, debit -
  currency   text not null default 'EUR',
  memo       text,
  created_at timestamptz not null default now()
);
create index on ledger_entries (txn_id);
create index on ledger_entries (account_id, created_at desc);

-- Hard Rule #2: every txn must net to zero. Deferred so post_ledger() can insert
-- all legs inside one transaction; the balance check runs at COMMIT.
create or replace function ledger_txn_balanced() returns trigger
language plpgsql as $$
declare
  s bigint;
begin
  select coalesce(sum(delta_cents), 0) into s
    from ledger_entries where txn_id = new.txn_id;
  if s <> 0 then
    raise exception
      'ledger txn % is unbalanced (sum=% cents). Hard Rule #2: double-entry must net to zero.',
      new.txn_id, s;
  end if;
  return null;
end $$;

create constraint trigger ledger_entries_balanced
  after insert on ledger_entries
  deferrable initially deferred
  for each row execute function ledger_txn_balanced();

-- ---- Stripe payment surface ----
create table payment_methods (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  stripe_pm_id text not null,
  brand        text,
  last4        text,                                 -- last4 only; never full PAN (Hard Rule #11)
  exp          text,
  status       text not null default 'active',
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (user_id, stripe_pm_id)
);
create index on payment_methods (user_id);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete restrict,
  trip_id      uuid references trips(id) on delete set null,
  stripe_pi_id text,
  amount_cents int not null,
  currency     text not null default 'EUR',
  kind         payment_kind not null,
  status       payment_status not null default 'processing',
  failure_code text,
  initiated_by payment_initiated_by not null default 'system',
  admin_reason text,                                 -- REQUIRED for manual charges (Hard Rule #8)
  created_at   timestamptz not null default now()
);
create index on payments (user_id, created_at desc);
create index on payments (trip_id);
create unique index payments_stripe_pi_key on payments (stripe_pi_id) where stripe_pi_id is not null;
-- Hard Rule #8: a manual charge cannot exist without a reason.
alter table payments add constraint payments_manual_needs_reason
  check (kind <> 'manual' or (admin_reason is not null and length(admin_reason) > 0));

create table debts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  amount_cents  int not null,
  source        debt_source not null,
  status        debt_status not null default 'open',
  next_retry_at timestamptz,
  attempts      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on debts (user_id);
create index on debts (status, next_retry_at);

-- ---- Pricing & products ----
create table pricing_plans (
  id                 uuid primary key default gen_random_uuid(),
  city_id            uuid references cities(id) on delete cascade,
  model_id           uuid references vehicle_models(id) on delete cascade,
  unlock_cents       int not null default 0,
  per_min_cents      int not null default 0,
  pause_per_min_cents int not null default 0,
  day_cap_cents      int,
  valid_from         timestamptz,
  valid_to           timestamptz,
  dynamic            jsonb not null default '{}'::jsonb,  -- happy hours, demand multipliers
  created_at         timestamptz not null default now()
);
create index on pricing_plans (city_id, model_id);

create table packages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  minutes       int not null,
  price_cents   int not null,
  validity_days int not null default 30,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table package_purchases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  package_id   uuid not null references packages(id) on delete restrict,
  minutes_left int not null,
  expires_at   timestamptz,
  stripe_pi_id text,
  created_at   timestamptz not null default now()
);
create index on package_purchases (user_id) where minutes_left > 0;

create table subscriptions (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  stripe_price_id text,
  perks           jsonb not null default '{}'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table user_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  subscription_id uuid not null references subscriptions(id) on delete restrict,
  stripe_sub_id   text,
  status          text not null default 'active',
  period_end      timestamptz,
  created_at      timestamptz not null default now()
);
create index on user_subscriptions (user_id);

create table addons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        addon_kind not null,
  price_cents int not null,
  per         addon_per not null default 'trip',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table addon_purchases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  addon_id    uuid not null references addons(id) on delete restrict,
  trip_id     uuid references trips(id) on delete set null,
  price_cents int not null,
  created_at  timestamptz not null default now()
);
create index on addon_purchases (user_id);

create table promo_codes (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  kind           promo_kind not null,
  value          int not null,                        -- percent, cents, or free minutes
  max_uses       int,
  per_user_limit int not null default 1,
  valid_from     timestamptz,
  valid_to       timestamptz,
  new_users_only boolean not null default false,
  city_id        uuid references cities(id) on delete set null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table promo_redemptions (
  id         uuid primary key default gen_random_uuid(),
  promo_id   uuid not null references promo_codes(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  trip_id    uuid references trips(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on promo_redemptions (promo_id);
create index on promo_redemptions (user_id);

-- Wire the deferred FK from 00070.
alter table trips
  add constraint trips_promo_redemption_fk foreign key (promo_redemption_id)
  references promo_redemptions(id) on delete set null;

create table loyalty_accounts (
  user_id    uuid primary key references users(id) on delete cascade,
  points     int not null default 0,
  updated_at timestamptz not null default now()
);

create table loyalty_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  delta      int not null,
  reason     text,
  trip_id    uuid references trips(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on loyalty_events (user_id, created_at desc);

create table referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references users(id) on delete cascade,
  referee_id  uuid references users(id) on delete set null,
  status      text not null default 'pending',        -- pending | completed | expired
  reward_cents int not null default 0,
  created_at  timestamptz not null default now(),
  unique (referrer_id, referee_id)
);

create table invoices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete set null,
  corporate_id uuid references corporate_accounts(id) on delete set null,
  number       text not null unique,
  pdf_url      text,
  mydata_mark  text,                                  -- AADE myDATA MARK once transmitted
  amount_cents int not null default 0,
  currency     text not null default 'EUR',
  issued_at    timestamptz not null default now(),
  check (user_id is not null or corporate_id is not null)
);
create index on invoices (user_id);
create index on invoices (corporate_id);
