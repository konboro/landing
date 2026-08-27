# 12 — Notifications, alerting, onboarding, tutorials (EXHAUSTIVE)

## A. Notification engine (one engine, all channels)

```
event (DB trigger / gateway / edge fn / pg_cron)
   → notification_rules match (kind + condition jsonb)
   → throttle/dedupe/quiet-hours/digest
   → fan-out: email (Resend) | push (Expo) | SMS | Telegram (staff) | panel bell | in-app inbox
   → notification_log (delivery status, opens where possible)
```

Tables (added to docs/02):

```sql
notification_rules(id, event_kind, condition jsonb,      -- e.g. {min_offline_min:30},{min_move_m:30}
        channels text[], recipients jsonb,               -- roles, emails, "vehicle_owner_city_ops"
        throttle_s int, digest enum(none,hourly,daily), quiet_hours jsonb, active bool)
notification_log(id, rule_id null, user_id null, staff_target text null, channel,
        template_key, payload jsonb, status enum(queued,sent,failed,suppressed), sent_at, error)
user_notification_prefs(user_id pk, push_marketing bool, email_marketing bool,
        push_transactional bool default true,            -- transactional cannot be fully off where legally required
        email_receipts bool, lang)
inbox_messages(id, user_id, title, body, deep_link, read_at, created_at)  -- in-app message center
```

SIM/connectivity alerts (`sim_*`) mirror `v_sim_alerts`; the rule thresholds and that view
must be changed together — see docs/15 §E.

Rules editable in panel: **Settings → Alerts & notifications** (parity + upgrade): pick event, condition values, channels, recipients, test-fire button. Every rule change → audit_log.

### A.1 Manual broadcasts (panel → riders)

The rule engine above reacts to events. **Notifications** in the panel is the other
direction: a human composes one message and fires it now. Edge fn
`admin-broadcast`, permission `notifications.send` (migration 00310).

- **Surfaces**, any combination: `inbox` (waits in the message centre) ·
  `popup` (interrupting modal on next app open, optional `expires_at`) ·
  `push` (Expo, to every row in `push_tokens`). A pop-up is an
  `inbox_messages` row with `kind='popup'`, not a parallel system — same RLS,
  same realtime, same unread index as the message centre (00280 set that
  precedent for `chat`). The inbox list filters pop-ups out so a send on both
  surfaces is not shown twice.
- **Audience**: `{kind:'all'}` (active riders) · `{kind:'group', group_id}`
  (membership via `users.customer_group_id`; the rule-based segments
  `customer_groups.rules` describes are **not** evaluated yet) ·
  `{kind:'users', user_ids[]}`.
- **Consent**: `category='marketing'` filters on `users.marketing_consent`, and
  push additionally on `user_notification_prefs.push_marketing` (opt-in,
  default false). `transactional` skips the marketing gate but still honours
  `push_transactional`.
- **Reason** is mandatory whenever more than one person is targeted, and the
  whole send is audited (Hard Rule #8). Header row in `broadcasts`,
  per-recipient rows in `notification_log` (`broadcast_id`); `notification_channel`
  has no `popup` member, so a pop-up logs as `inbox` with `payload.surface='popup'`.
- **Dry run**: `preview: true` resolves the audience and reports reach per
  channel without sending — the panel's "Check reach" button. Push reach is the
  number of *registered devices*, which is how "0 devices" becomes visible
  before someone assumes a send landed.

## B. Fleet alert catalogue (staff: email + Telegram + panel; each rule pre-seeded, thresholds in condition jsonb)

| Event | Default condition | Default channels |
|---|---|---|
| **moved_without_rental** (requested) | displacement > 30 m, locked, no trip, sustained 60 s | email ops + push ops app + Telegram, immediate; auto-action: locate cmd + mark `stolen?` review |
| **offline_too_long** (requested) | last_seen > 30 min (in-fleet), > 5 min (during trip) | email digest hourly + immediate Telegram if >5% fleet |
| fall_detected | tilt > 60° for 10 s, no trip | push ops (nearest), panel |
| power_cut / battery removed | ext_voltage ≈ 0 | email + Telegram immediate |
| left_operating_zone (no trip — being carried/driven away) | outside operating poly | email + Telegram immediate |
| low_battery | soc < 20% / < 10% critical | ops task auto-create + daily digest |
| no_gps_fix | sats < 4 for > 15 min | digest |
| battery_drain_anomaly | Δsoc vs fleet median > 2σ | daily digest (predictive maintenance) |
| repeated_unlock_failures | ≥ 3 fails/24 h same vehicle | email + auto `maintenance?` flag |
| command_failure_spike | > 5% failed cmds 15 min | Telegram page |
| stuck_trip (no lock ACK at end) | > 60 s in `ending` | Telegram + panel banner |
| gateway_down / db_down | probe fail | phone page (Better Stack) |
| sms_budget | > N SMS/day (fleet-wide, `sim_usage_daily.sms_out`) | email |
| **sim_over_limit** (docs/15) | SIM data ≥ 100% of its bundle this cycle | email + Telegram admin/ops_manager, throttled 24 h |
| **sim_near_limit** (docs/15) | SIM data ≥ 80% of its bundle this cycle | email daily digest, admin/ops_manager |
| **sim_silent** (docs/15) | active SIM with no network activity 7 d | email daily digest + auto ops task, ops_manager |
| **sim_cost_spike** (docs/15) | month cost > 50% over the trailing-3-month baseline and > 20 € | email daily digest, owner/accountant/admin |
| vandalism_pattern | ≥ 2 damage reports same vehicle 7 d | email |
| photo_queue_sla | pending p95 > 6 h | email support lead |
| chargeback_received | any | email owner + finance |
| debt_threshold | open debts total > X € | daily email owner |
| new_user_spike / signup_anomaly | z-score | daily digest |
| idle_too_long | vehicle 0 rides > 72 h | auto rebalance task + weekly digest |

Weekly **owner email report** (auto): revenue, rides, utilization, top alerts, debt aging, fleet health — the "Monday morning" mail.

## C. Rider push/email catalogue (transactional + lifecycle)

Transactional (always on): reservation expiring (2 min left) • unlock succeeded/failed • trip receipt (push + optional email PDF) • payment failed → debt created (+ email) • debt retry reminders (D+1, D+3, D+7 email+push, then monthly) • penalty issued (photo + appeal link) • dispute status updates • KYC approved / rejected (with reason + retry CTA) • card expiring (30/7 d) • package minutes low (< 15 min) / expiring (3 d) • subscription renewal upcoming / payment failed • promo applied confirmation • referral reward credited • account blocked/unblocked • GDPR export ready.

Lifecycle automations (marketing consent gated, editable as `push_campaigns` templates with triggers): welcome series (D0 tutorial nudge, D1 first-ride promo if no ride) • abandoned onboarding (KYC started not finished 24 h; card not added 48 h) • win-back (14 d / 30 d / 60 d inactive, escalating offer) • first-ride congratulation + referral ask • loyalty tier reached • bonus-zone nearby during high demand (geo-push, opt-in) • weather-based pause notice (city-wide service alerts) • NPS ask after 5th ride.

Service alerts to riders: vehicle you reserved went offline (auto-cancel + apology credit rule) • trip ended remotely by support (reason) • city service disruption banner.

## D. Onboarding (rider) — full flow spec

1. Splash → language auto (device) with switch (PL/EN/EL).
2. Value slides (3, content from `app_content`, editable in panel, skippable).
3. Phone OTP (retry/resend timers, fallback voice call config).
4. Name + email + `customer_forms` extra fields (panel-configurable).
5. Consents: ToS/Privacy (required), marketing (optional, granular push/email).
6. Permissions — progressive, each with pre-prompt explainer screen: location (when-in-use; ask at map, not at boot) → camera (ask at first scan) → notifications (ask AFTER first successful action, higher grant rate).
7. KYC (Sumsub SDK) — deferred until first unlock attempt if `kyc_defer` flag on; blocking screen shows status live via webhook→realtime.
8. Payment method — deferred until first unlock; wallet top-up alternative.
9. Main tutorial (interactive, see E) — auto-launch first session, replayable from Profile.
10. `onboarding_progress(user_id, step, completed_at)` table → funnel analytics + resume exactly where left + abandonment automations (C).
A/B: slide variants + copy via `app_config.experiments` (deterministic bucket by user id).

## E. Tutorials & education (parity: Main/Short tutorial + more)

- **Main tutorial:** interactive overlay on real map: find vehicle → tap pin → mock scan → mock ride screen → how to end (photo demo with GOOD vs BAD parking examples — real photos from panel content) → wallet. Content = `app_content` (panel-editable, per-language).
- **Short tutorial:** 30 s version, re-shown after 60 d inactivity.
- **Contextual first-use tooltips:** first pause, first bonus zone seen, first low-battery vehicle, first paid-parking zone — one-time flags per user.
- **Parking school:** dedicated screen with photo examples per city + the exact criteria the AI/reviewer uses; linked from every rejected-photo penalty (reduce repeat offenses).
- **Safety onboarding:** helmet/rules card per city (config), required scroll-through before first ride where city mandates.
- **Reaction test** intro explainer (why we ask at night).
- Ops app has its own onboarding: task types walkthrough + offline-mode explainer.

## F. Implementation notes

- Email: Resend + react-email templates in `packages/emails`; all templates per-language; unsubscribe honored per category; DKIM/SPF for penny.rent.
- Push: Expo push tokens per device row `push_tokens(user_id, token, platform, last_seen)`; token hygiene job; deep links into screens.
- Geo-push: computed server-side (pg_cron every 10 min against opted-in last-known coarse location) — GDPR: separate explicit consent, coarse grid only.
- Every send idempotent (`notification_log` unique key event+target+template+window).
- Panel test mode: send any template to yourself.
