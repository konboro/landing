-- 00230_admin_list_permissions.sql
-- Permissions checked by the `admin-list` edge function.
--
-- The v_admin_* views stay service_role-only (granting them to `authenticated`
-- would expose every customer and ride to any signed-in rider). `admin-list`
-- is the only door, and it demands one of these per view.

insert into role_permissions (role, permission) values
  ('admin','dashboard.read'), ('support','dashboard.read'),
  ('ops_manager','dashboard.read'), ('accountant','dashboard.read'),
  ('readonly','dashboard.read'),

  ('admin','rides.read'), ('support','rides.read'),
  ('ops_manager','rides.read'), ('accountant','rides.read'),
  ('readonly','rides.read'),

  ('admin','audit.read'), ('accountant','audit.read'), ('readonly','audit.read'),

  ('admin','sims.read'), ('support','sims.read'),
  ('ops_manager','sims.read'), ('readonly','sims.read'),
  ('admin','sims.manage'), ('ops_manager','sims.manage')
on conflict do nothing;
