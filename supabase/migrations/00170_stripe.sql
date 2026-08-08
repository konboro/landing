-- 00170_stripe.sql
-- Backend-only infra tables (not part of the app-facing @penny/db-types models):
--   * stripe_customers  — user <-> Stripe Customer mapping (one customer per user, docs/05)
--   * stripe_events     — processed webhook event ids for idempotency (docs/05)
-- Both are service_role-only: RLS enabled with no authenticated policy.

create table stripe_customers (
  user_id            uuid primary key references users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

create table stripe_events (
  id          text primary key,                    -- Stripe event id (evt_...)
  type        text not null,
  received_at timestamptz not null default now()
);

alter table stripe_customers enable row level security;
alter table stripe_events enable row level security;
