-- 00350_broadcasts.sql
--
-- Staff-initiated broadcasts: one composed message, fanned out to the in-app
-- inbox, an interrupting pop-up, and/or Expo push (docs/12 §A, §C).
--
-- Why a new table rather than `push_campaigns`: that one is the lifecycle
-- automation template (docs/12 §C — welcome series, win-back, triggers). A
-- broadcast is a one-off send a human composes and fires now, across more than
-- one channel. Keeping them apart stops "did this go out because of a trigger
-- or because someone pressed send?" from becoming unanswerable.
--
-- Per-recipient delivery keeps living in `notification_log` (docs/12 §A), which
-- already carries channel / status / error and the idempotency index — the
-- broadcast row is just the campaign header those rows point at.

-- ---------------------------------------------------------------------------
-- 1. Pop-ups reuse the message centre
--
-- A pop-up is a message that interrupts instead of waiting in a list, so it is
-- the same row with a different presentation: the rider app renders kind
-- 'popup' as a modal on next open and marks it read on dismiss. That keeps one
-- per-user RLS policy, one realtime subscription and one unread index for all
-- three surfaces (00280 established the pattern for 'chat').
-- ---------------------------------------------------------------------------
alter table inbox_messages
  -- A pop-up that no longer applies must stop interrupting people. NULL = no
  -- expiry, which is what a plain notification wants.
  add column if not exists expires_at timestamptz;

alter table inbox_messages drop constraint if exists inbox_messages_kind_check;
alter table inbox_messages
  add constraint inbox_messages_kind_check check (kind in ('notification', 'chat', 'popup'));

-- The app asks "any live pop-up I have not dismissed?" on every foreground.
create index if not exists inbox_messages_live_popup_idx
  on inbox_messages (user_id, created_at desc)
  where kind = 'popup' and read_at is null;

comment on column inbox_messages.expires_at is
  'Pop-ups only: stop showing after this instant. NULL = no expiry.';

-- ---------------------------------------------------------------------------
-- 2. The broadcast header
-- ---------------------------------------------------------------------------
create table if not exists broadcasts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  deep_link    text,
  -- Subset of inbox | popup | push. Email/SMS deliberately not here yet: they
  -- need the Resend templates and the per-category unsubscribe from docs/12 §F.
  channels     text[] not null,
  -- 'marketing' is consent-gated per recipient (users.marketing_consent +
  -- user_notification_prefs.push_marketing); 'transactional' is not, and must
  -- only be used for messages the rider needs regardless of consent.
  category     text not null default 'transactional',
  -- {kind:'all'} | {kind:'group', group_id:uuid} | {kind:'users', user_ids:[uuid]}
  audience     jsonb not null,
  expires_at   timestamptz,
  status       text not null default 'draft',
  recipients   int not null default 0,      -- users the audience resolved to, after consent filtering
  delivered    int not null default 0,      -- inbox/popup rows written
  push_sent    int not null default 0,
  push_failed  int not null default 0,
  reason       text,
  created_by   uuid references staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  constraint broadcasts_channels_not_empty check (array_length(channels, 1) >= 1),
  constraint broadcasts_category_check check (category in ('transactional', 'marketing')),
  constraint broadcasts_status_check check (status in ('draft', 'sending', 'sent', 'failed'))
);
create index if not exists broadcasts_created_idx on broadcasts (created_at desc);

alter table notification_log
  add column if not exists broadcast_id uuid references broadcasts(id) on delete set null;
create index if not exists notification_log_broadcast_idx on notification_log (broadcast_id);

-- Service-role only, like every other admin surface (Hard Rule #6): the panel
-- reads it through `admin-list`, riders must never see who else was targeted.
alter table broadcasts enable row level security;
revoke all on broadcasts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Panel read model
-- ---------------------------------------------------------------------------
create or replace view v_admin_broadcasts as
select
  b.id,
  b.title,
  b.body,
  b.channels,
  b.category,
  b.status,
  b.audience,
  case b.audience->>'kind'
    when 'all'   then 'Everyone'
    when 'group' then coalesce('Group: ' || g.name, 'Group (deleted)')
    when 'users' then 'Users: ' || coalesce(jsonb_array_length(b.audience->'user_ids'), 0)::text
    else b.audience->>'kind'
  end                                        as audience_label,
  b.recipients,
  b.delivered,
  b.push_sent,
  b.push_failed,
  b.expires_at,
  b.reason,
  coalesce(u.full_name, u.email, 'system')   as created_by_name,
  b.created_at,
  b.sent_at
from broadcasts b
left join customer_groups g on g.id = (b.audience->>'group_id')::uuid
left join staff s on s.id = b.created_by
left join users u on u.id = s.user_id;

revoke all on v_admin_broadcasts from anon, authenticated;

-- Group picker for the audience selector. `customer_groups` itself carries no
-- RLS policy (service_role only), and the panel needs the member count to say
-- how far a send will reach before it fires.
create or replace view v_admin_customer_groups as
select
  g.id,
  g.name,
  g.rules,
  count(u.id) filter (where u.status = 'active')::int as members,
  g.created_at
from customer_groups g
left join users u on u.customer_group_id = g.id
group by g.id, g.name, g.rules, g.created_at;

revoke all on v_admin_customer_groups from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Permission
--
-- Sending to the whole user base is its own blast radius — not something
-- `messages.reply` (one rider, one thread) should imply.
-- ---------------------------------------------------------------------------
insert into role_permissions (role, permission) values
  ('admin', 'notifications.send')
on conflict (role, permission) do nothing;
