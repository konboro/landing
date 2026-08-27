-- 00280_message_centre_two_way.sql
--
-- Live chat between a rider and support, run through the EXISTING message
-- centre rather than a parallel chat system: docs/12 already calls
-- `inbox_messages` "the in-app message center", it already has per-user RLS,
-- realtime and an unread index, and staff already write to it via notifyUser().
-- A second table would have split one conversation across two places.
--
-- What changes: a message gains a direction and a kind.
--   sender = system | rider | staff   (was implicitly always 'system')
--   kind   = notification | chat      (the inbox list keeps showing both; the
--                                      chat view filters to 'chat')
--
-- Existing rows are notifications from the system, which is exactly what the
-- defaults say, so no backfill is needed.

do $$ begin
  create type message_sender as enum ('system', 'rider', 'staff');
exception when duplicate_object then null;
end $$;

alter table inbox_messages
  add column if not exists sender   message_sender not null default 'system',
  add column if not exists kind     text           not null default 'notification',
  -- Who answered, for the audit trail and to show an agent name in the app.
  add column if not exists staff_id uuid references staff(id) on delete set null;

alter table inbox_messages
  drop constraint if exists inbox_messages_kind_check;
alter table inbox_messages
  add constraint inbox_messages_kind_check check (kind in ('notification', 'chat'));

-- Chat turns have no headline; only notifications do. Defaulting the column
-- keeps it non-null without forcing callers to invent a title per message.
alter table inbox_messages alter column title set default '';

-- The chat view reads one user's thread newest-last; the inbox list reads all
-- kinds newest-first. This index serves both.
create index if not exists inbox_messages_user_kind_created_idx
  on inbox_messages (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS. Riders could already read their own messages and mark them read; now
-- they may also post their own side of the conversation.
--
-- The WITH CHECK is what keeps this safe: a rider can only write to their own
-- thread, only as `rider`, only as `chat`, and can never attribute a message to
-- a staff member. Replies stay service_role-only (the admin edge function), so
-- nobody can forge a message that looks like support.
-- ---------------------------------------------------------------------------
grant insert on public.inbox_messages to authenticated;

drop policy if exists inbox_self_insert_chat on public.inbox_messages;
create policy inbox_self_insert_chat on public.inbox_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and sender = 'rider'
    and kind = 'chat'
    and staff_id is null
  );

-- Realtime delivery of staff replies. The publication may already carry the
-- table; adding it twice is an error, so guard it.
do $$ begin
  alter publication supabase_realtime add table inbox_messages;
exception when duplicate_object then null;
     when undefined_object then null;  -- publication absent (vanilla Postgres)
end $$;

comment on column inbox_messages.sender is
  'Who wrote it: system (automated notification), rider (chat, self-insert via RLS), staff (chat reply, service_role only).';
comment on column inbox_messages.kind is
  'notification = one-way system message; chat = a turn in the rider<->support conversation.';
