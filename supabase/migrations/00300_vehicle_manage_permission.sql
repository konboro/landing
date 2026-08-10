-- 00300_vehicle_manage_permission.sql
--
-- Adding and removing vehicles is a fleet-admin action, not an ops one:
-- `vehicles.status` lets ops park a scooter in maintenance, but creating a
-- business record or retiring one changes what the fleet *is*. So it gets its
-- own permission rather than riding along on an existing grant.
--
-- Checked by admin-vehicle-create / admin-vehicle-delete via requireStaff().
-- `owner` already holds '*' and is not listed here.

insert into role_permissions (role, permission) values
  ('admin', 'vehicles.manage')
on conflict (role, permission) do nothing;
