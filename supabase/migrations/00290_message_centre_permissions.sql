-- 00290_message_centre_permissions.sql
-- Permissions for the staff side of the message centre (`admin-messages`).
--
-- Support and ops_manager work the queue; accountant and readonly can follow a
-- conversation but not answer it, because a reply goes out under the operator's
-- name. Same shape as 00200 / 00230 / 00250 — `owner` already holds '*'.

insert into role_permissions (role, permission) values
  ('admin','messages.read'), ('support','messages.read'),
  ('ops_manager','messages.read'), ('accountant','messages.read'),
  ('readonly','messages.read'),

  ('admin','messages.reply'), ('support','messages.reply'),
  ('ops_manager','messages.reply')
on conflict do nothing;
