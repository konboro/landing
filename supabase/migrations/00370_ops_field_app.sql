-- 00370_ops_field_app.sql
--
-- Backing for the field-service screens the ops app is growing: damage reports
-- filed against a named PART, a per-vehicle note thread, and shifts.
--
-- Everything here is written by staff from the ops app with the anon key, so
-- each table gets an explicit policy keyed on an active `staff` row — the same
-- shape 00360 established for staff reading their own record. Ops mutations
-- that touch money or vehicle state still go through edge functions
-- (Hard Rules #6, #8); these three are field notes, not business state.

-- ---------------------------------------------------------------------------
-- 1. Damage reports get a part
--
-- The app files damage against a specific component (mirror, ignition, frame…)
-- and groups the history by it. That was previously buried in free text, which
-- cannot be counted, filtered, or turned into "this vehicle has broken its
-- mirror three times".
-- ---------------------------------------------------------------------------
alter table damage_reports add column if not exists part text;
create index if not exists damage_reports_part_idx on damage_reports (part) where part is not null;

comment on column damage_reports.part is
  'Component the damage is filed against — the chip picked in the ops app. Free text on purpose: the catalogue is per-operator and lives in app_config, not in an enum that needs a migration to extend.';

-- ---------------------------------------------------------------------------
-- 2. Per-vehicle notes
--
-- A running thread on the vehicle, written by whoever is standing next to it.
-- Deliberately NOT `vehicles.notes` (a single text column): that one field
-- cannot say who wrote what or when, so the second mechanic overwrites the
-- first one's observation.
-- ---------------------------------------------------------------------------
create table if not exists vehicle_notes (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  staff_id   uuid references staff(id) on delete set null,
  body       text not null,
  photos     text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint vehicle_notes_body_not_blank check (length(btrim(body)) > 0 or array_length(photos, 1) >= 1)
);
create index if not exists vehicle_notes_vehicle_idx on vehicle_notes (vehicle_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Shifts
--
-- "Start my shift" / "End my shift" with the counters the app shows. One open
-- shift per staff member at a time — enforced by a partial unique index rather
-- than by hoping the client behaves.
-- ---------------------------------------------------------------------------
create table if not exists ops_shifts (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references staff(id) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  tasks_completed int not null default 0,
  note            text
);
create unique index if not exists ops_shifts_one_open_per_staff
  on ops_shifts (staff_id) where ended_at is null;
create index if not exists ops_shifts_staff_idx on ops_shifts (staff_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 4. RLS — active staff only
-- ---------------------------------------------------------------------------
alter table vehicle_notes enable row level security;
alter table ops_shifts    enable row level security;

-- `is_staff()` already exists (SECURITY DEFINER, "active row in staff") and is
-- what every other ops-facing policy is built on. Reuse it rather than adding a
-- second helper that means the same thing — two of those drift apart the first
-- time someone tightens one.

grant select, insert on public.vehicle_notes to authenticated;
drop policy if exists vehicle_notes_staff_read on public.vehicle_notes;
create policy vehicle_notes_staff_read on public.vehicle_notes
  for select to authenticated using (public.is_staff());
drop policy if exists vehicle_notes_staff_write on public.vehicle_notes;
create policy vehicle_notes_staff_write on public.vehicle_notes
  for insert to authenticated with check (public.is_staff());

grant select, insert, update on public.ops_shifts to authenticated;
-- A shift is personal: staff see and close their own, not the depot's.
drop policy if exists ops_shifts_self on public.ops_shifts;
create policy ops_shifts_self on public.ops_shifts
  for all to authenticated
  using (staff_id in (select id from staff where user_id = auth.uid()))
  with check (staff_id in (select id from staff where user_id = auth.uid()));

-- Damage reports: the ops app lists and files them directly.
grant select, insert on public.damage_reports to authenticated;
drop policy if exists damage_staff_read on public.damage_reports;
create policy damage_staff_read on public.damage_reports
  for select to authenticated using (public.is_staff());
drop policy if exists damage_staff_write on public.damage_reports;
create policy damage_staff_write on public.damage_reports
  for insert to authenticated with check (public.is_staff());
