-- 00140_rls.sql
-- Enable RLS everywhere, then open the minimum surface.
-- Model: riders touch their OWN rows; reference data is world-readable; the rider
-- map reads vehicle_state ONLY through v_public_vehicles; ops reads its city scope;
-- staff/admin mutations + telemetry/commands/ledger are service_role-only
-- (RLS enabled with no matching policy => denied for anon/authenticated; the
--  service_role key used inside edge functions bypasses RLS).

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read staff past its own RLS).
-- ---------------------------------------------------------------------------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff s where s.user_id = auth.uid() and s.active);
$$;

create or replace function public.is_ops_in_city(target_city uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff s
    where s.user_id = auth.uid()
      and s.active
      and s.role in ('ops','ops_manager','admin','owner')
      and (s.city_scope is null or target_city = any(s.city_scope))
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table in public.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reference / public-readable tables (anon + authenticated SELECT).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'cities','zones','pois','vehicle_models','packages','subscriptions',
    'addons','faq_items','app_content','app_config','translations','customer_forms'
  ] loop
    execute format('grant select on public.%I to anon, authenticated;', t);
    execute format($p$create policy %I on public.%I for select to anon, authenticated using (true);$p$,
                   t || '_read', t);
  end loop;
end $$;

-- Rider-safe live vehicle feed (view runs security-definer, bypassing vehicle_state RLS).
grant select on public.v_public_vehicles to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rider-owned rows: SELECT own.
-- ---------------------------------------------------------------------------
-- users (self read + limited self update)
grant select, update on public.users to authenticated;
create policy users_self_read on public.users
  for select to authenticated using (id = auth.uid());
create policy users_self_update on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Tables keyed by user_id: SELECT own.
do $$
declare t text;
begin
  foreach t in array array[
    'user_documents','trips','payment_methods','payments','debts',
    'package_purchases','user_subscriptions','addon_purchases','promo_redemptions',
    'loyalty_accounts','loyalty_events','invoices','reaction_tests','corporate_members'
  ] loop
    execute format('grant select on public.%I to authenticated;', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (user_id = auth.uid());$p$,
                   t || '_self_read', t);
  end loop;
end $$;

-- referrals: either side may read.
grant select on public.referrals to authenticated;
create policy referrals_self_read on public.referrals
  for select to authenticated
  using (referrer_id = auth.uid() or referee_id = auth.uid());

-- trip_events / trip_routes / ride_reviews: readable via ownership of the parent trip.
grant select on public.trip_events to authenticated;
create policy trip_events_owner_read on public.trip_events
  for select to authenticated
  using (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));

grant select on public.trip_routes to authenticated;
create policy trip_routes_owner_read on public.trip_routes
  for select to authenticated
  using (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));

grant select, insert on public.ride_reviews to authenticated;
create policy ride_reviews_owner_read on public.ride_reviews
  for select to authenticated
  using (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));
create policy ride_reviews_owner_write on public.ride_reviews
  for insert to authenticated
  with check (exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid()));

-- inbox_messages: read own + mark-read (update read_at) own.
grant select, update on public.inbox_messages to authenticated;
create policy inbox_self_read on public.inbox_messages
  for select to authenticated using (user_id = auth.uid());
create policy inbox_self_update on public.inbox_messages
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- user_notification_prefs: full self CRUD.
grant select, insert, update on public.user_notification_prefs to authenticated;
create policy prefs_self_all on public.user_notification_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- push_tokens: self register/list/remove.
grant select, insert, update, delete on public.push_tokens to authenticated;
create policy push_tokens_self_all on public.push_tokens
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- onboarding_progress: self CRUD.
grant select, insert, update on public.onboarding_progress to authenticated;
create policy onboarding_self_all on public.onboarding_progress
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- scan_data_log: rider logs & reads own scans (writes usually via edge, but allow app fallback).
grant select, insert on public.scan_data_log to authenticated;
create policy scan_self_read on public.scan_data_log
  for select to authenticated using (user_id = auth.uid());
create policy scan_self_write on public.scan_data_log
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Ops surface (city-scoped). Ops app authenticates as a normal user linked to staff.
-- ---------------------------------------------------------------------------
grant select on public.vehicles to authenticated;
create policy vehicles_ops_read on public.vehicles
  for select to authenticated using (is_ops_in_city(city_id));

grant select, insert, update on public.ops_tasks to authenticated;
create policy ops_tasks_read on public.ops_tasks
  for select to authenticated
  using (
    assignee = auth.uid()
    or (assignee is null and is_staff())
  );
create policy ops_tasks_update on public.ops_tasks
  for update to authenticated
  using (assignee = auth.uid() or is_staff())
  with check (is_staff());

grant select, insert on public.damage_reports to authenticated;
create policy damage_reports_ops_read on public.damage_reports
  for select to authenticated
  using (
    exists (select 1 from vehicles v where v.id = vehicle_id and is_ops_in_city(v.city_id))
    or user_id = auth.uid()               -- a rider can see a report they filed
  );
create policy damage_reports_insert on public.damage_reports
  for insert to authenticated
  with check (user_id = auth.uid() or is_staff());

-- ---------------------------------------------------------------------------
-- Everything not addressed above (vehicle_state, telemetry, commands, vehicle_alerts,
-- vehicle_status_log, ledger_accounts, ledger_entries, staff, role_permissions,
-- audit_log, notification_rules, notification_log, zone_versions, pricing_plans,
-- promo_codes, campaigns, corporate_accounts, debts writes, etc.) has RLS enabled
-- with NO authenticated policy => reachable only via the service_role key in edge
-- functions and the gateway. This is the intended lock-down (docs/02 RLS summary).
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
