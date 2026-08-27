-- 00250_admin_action_permissions.sql
-- Permissions for the staff mutations the panel calls but that had no edge
-- function until now: photo-review-decision, vehicle-status, admin-credit-wallet
-- and admin-app-config. (admin-block-user reuses the existing `users.block`.)
--
-- Same shape as 00200 / 00230: `owner` already holds '*', so only the narrower
-- roles are enumerated here.

insert into role_permissions (role, permission) values
  -- Human verdict on an end-parking photo. Support and ops_manager work the
  -- queue day to day; accountant/readonly deliberately excluded (it is a
  -- decision, not a read).
  ('admin','rides.verify'), ('support','rides.verify'), ('ops_manager','rides.verify'),

  -- Taking a vehicle out of service / back in. Field ops need this on the ops
  -- app, hence `ops` as well.
  ('admin','vehicles.status'), ('ops_manager','vehicles.status'), ('ops','vehicles.status'),

  -- Goodwill credit moves money (Hard Rule #2 ledger), so it stays with the
  -- roles that already hold a money permission.
  ('admin','wallet.credit'), ('accountant','wallet.credit'),

  -- Feature flags, tunables and white-label brand tokens.
  ('admin','settings.edit')
on conflict do nothing;
