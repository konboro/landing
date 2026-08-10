-- 00360_staff_self_read.sql
--
-- The ops app could never sign in. `SupabaseOpsApi.login()` verifies the OTP,
-- then reads the caller's own row from `staff` with the anon key to learn their
-- role — but `staff` had RLS enabled and NOT ONE policy, so that read returned
-- nothing for everybody and login always ended in
--
--     Error: Not an active staff account
--
-- which reads like a permissions problem with the account rather than a missing
-- policy. Nothing caught it because the admin panel never takes this path: it
-- asks `admin-me` (service_role) instead, precisely because staff is not
-- readable with the anon key.
--
-- What is safe to expose: a staff member's OWN row. Their role and city scope
-- are things they already know — the app just showed them the ops UI — and the
-- policy is keyed on auth.uid(), so it can never return a colleague's row. The
-- permission MAP (`role_permissions`) stays service_role-only, so this does not
-- become a way to enumerate what any role may do.
--
-- Hard Rule #6 is intact: apps still use the anon key + RLS, and every ops
-- mutation still goes through the edge functions that write audit_log.

grant select on public.staff to authenticated;

drop policy if exists staff_self_read on public.staff;
create policy staff_self_read on public.staff
  for select to authenticated
  using (user_id = auth.uid());

comment on policy staff_self_read on public.staff is
  'A signed-in user may read their own staff row (role + city scope) — this is what the ops app checks at login. Never another user''s.';
