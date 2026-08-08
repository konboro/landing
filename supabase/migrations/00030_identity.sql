-- 00030_identity.sql
-- Identity & customers. users.id mirrors auth.users(id) (Supabase auth).
-- NOTE: on vanilla Postgres the auth schema does not exist; on Supabase it does.
-- The FK to auth.users is the canonical Supabase pattern.

create table customer_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  rules       jsonb not null default '{}'::jsonb,   -- manual + rule-based segments
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table users (
  id                   uuid primary key,            -- = auth.uid()
  phone                text unique,                 -- E.164; OTP login is primary auth
  email                text,
  full_name            text,
  legacy_atom_user_id  text,                        -- keep forever (migration)
  sumsub_applicant_id  text,
  kyc_status           kyc_status not null default 'none',
  customer_group_id    uuid references customer_groups(id) on delete set null,
  status               user_status not null default 'active',
  blocked_reason       text,
  marketing_consent    boolean not null default false,
  tos_accepted_at      timestamptz,
  privacy_accepted_at  timestamptz,
  score                int not null default 100,    -- rider score
  emergency_contact    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Link to Supabase auth. Guarded so vanilla Postgres validation does not fail.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema='auth' and table_name='users') then
    alter table users
      add constraint users_id_fk_auth foreign key (id)
      references auth.users(id) on delete cascade;
  end if;
end $$;

create index on users (customer_group_id);
create index on users (kyc_status);
create index on users (status);

create table corporate_accounts (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  billing_email       text,
  stripe_customer_id  text,
  monthly_invoicing   boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table corporate_members (
  id                 uuid primary key default gen_random_uuid(),
  corporate_id       uuid not null references corporate_accounts(id) on delete cascade,
  user_id            uuid not null references users(id) on delete cascade,
  monthly_limit_cents int,
  created_at         timestamptz not null default now(),
  unique (corporate_id, user_id)
);
create index on corporate_members (user_id);

create table user_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  kind          text not null,                       -- e.g. 'driving_licence'
  sumsub_review jsonb,
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index on user_documents (user_id);
