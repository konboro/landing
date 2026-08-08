# 02 — Database schema (Supabase / PostGIS)

Naming: snake_case, `id uuid pk default gen_random_uuid()` unless noted, `created_at/updated_at timestamptz`. RLS on all tables; policies summarized at the end.

## Identity & customers

```sql
users            -- auth.users mirror + profile
  id uuid pk (= auth.uid)
  phone text unique          -- E.164; OTP login is primary auth
  email text
  full_name text
  legacy_atom_user_id text   -- keep forever
  sumsub_applicant_id text
  kyc_status enum(none,pending,approved,rejected,expired)
  customer_group_id fk       -- marketing segments (parity: Customer groups)
  status enum(active,blocked,shadow_banned,deleted)
  blocked_reason text
  marketing_consent bool, tos_accepted_at, privacy_accepted_at
  score int default 100      -- rider score (night rides, damages, disputes)

customer_groups(id, name, rules jsonb)         -- manual + rule-based segments
corporate_accounts(id, name, billing_email, stripe_customer_id, monthly_invoicing bool)
corporate_members(corporate_id fk, user_id fk, monthly_limit_cents int)
user_documents(user_id, kind, sumsub_review jsonb, expires_at)  -- driving licence if required per model
```

## Fleet & IoT

```sql
vehicle_models(id, name, kind enum(scooter,ebike,moped), battery_curve_id fk,
               max_speed_kmh, deposit_cents, requires_licence bool, photo_url)
vehicles(id, code text unique,            -- printed QR/short code
         model_id fk, status enum(available,reserved,in_trip,maintenance,transport,
                                  low_battery,offline,stolen,decommissioned),
         plate text, vin text, city_id fk, notes text)
devices(id, imei text unique, iccid text, phone_number text,   -- SIM MSISDN for SMS fallback
        model enum(fmb930, ...), fw_version text,
        vehicle_id fk nullable,           -- re-linkable (device swap)
        server_profile enum(atom,penny),  -- migration tracking
        added_by fk, status enum(active,bench,faulty,retired))
battery_curves(id, model_id, points jsonb)   -- [[voltage_mv, soc_pct], ...]
```

## Telemetry (high volume)

```sql
telemetry (PARTITION BY RANGE (server_ts), monthly)
  device_id fk, vehicle_id fk (denorm), device_ts, server_ts,
  pos geometry(Point,4326), speed_kmh, heading, altitude, sats, hdop,
  ext_voltage_mv, batt_voltage_mv, din1 bool, dout1 bool, dout2 bool,
  gsm_signal, io jsonb                     -- raw AVL IO elements by id
vehicle_state (1 row per vehicle, UPSERT; the ONLY table apps subscribe to)
  vehicle_id pk, pos, soc_pct, speed_kmh, ignition bool, locked bool,
  last_seen, session_online bool, alarm flags (fall bool, power_cut bool, moved_while_locked bool),
  zone_cache jsonb                          -- last zone evaluation
vehicle_alerts(id, vehicle_id, kind enum(fall,power_cut,moved_locked,geofence_exit,offline,low_batt,error),
               payload jsonb, ack_by fk, ack_at)          -- parity: Alerts & notifications, Vehicle error log
commands(id, vehicle_id, device_id, kind enum(unlock,lock,locate,reboot,setparam,custom),
         payload jsonb, status enum(queued,sent,acked,failed,expired),
         channel enum(gprs,sms), requested_by fk, trip_id fk null,
         sent_at, acked_at, error text)                    -- parity: IoT data log / Manage IoT
scan_data_log(id, user_id, vehicle_code_scanned text, resolved_vehicle_id fk null,
              result enum(ok,not_found,unavailable), pos, created_at)   -- parity: Scan data log
```

## Zones (parity: all 9 Atom zone types)

```sql
zones(id, city_id, kind enum(operating,        -- ride allowed (root)
                             parking,          -- free parking allowed
                             paid_parking,     -- parking with fee
                             parking_station,  -- point/small poly, mandatory in station-mode areas
                             charging_station,
                             no_parking,
                             bonus,            -- discount for ending here (rebalancing by users)
                             speed_limit,      -- INFO ONLY on FMB930 (no controller link) — banner + beep
                             no_go,            -- ride forbidden: warning + trip-end forced at edge? NO — warn + fine flag
                             rebalancing),     -- ops app only
      geom geometry(Polygon,4326), rules jsonb,   -- e.g. {bonus_cents:100} {fee_cents:200} {limit_kmh:15}
      active bool, valid_from, valid_to, version int, created_by)
zone_versions(...)          -- full history; admin editor writes new version, never mutates
cities(id, name, tz, currency, center, default_zoom)
```

## Trips

```sql
trips(id, user_id, vehicle_id, status enum(reserved,unlocking,active,paused,ending,
                                           ended,charged,aborted,disputed),
      reserved_at, started_at, ended_at,
      start_pos, end_pos, distance_m, duration_s, pause_s,
      pricing_snapshot jsonb,     -- tariff frozen at start
      cost_cents, discount_cents, bonus_cents, penalty_cents, currency,
      end_photo_url, photo_review enum(pending,auto_ok,approved,rejected),
      end_zone_id fk, corporate_id fk null, promo_redemption_id fk null)
trip_events(id, trip_id, from_status, to_status, at, actor enum(user,system,admin,ops), meta jsonb) -- append-only
trip_routes(trip_id, path geometry(LineString,4326), simplified path for display)
reservations: modeled as trips(status=reserved) + pg_cron expiry (default 15 min, config)
ride_reviews(trip_id, rating int, tags text[], comment)
```

## Money (double-entry, cents, EUR)

```sql
ledger_accounts(id, kind enum(user_wallet,penny_revenue,stripe_clearing,debt,bonus,corporate), owner_id)
ledger_entries(id, txn_id, account_id, delta_cents, currency, created_at)  -- SUM per txn = 0, enforced
payment_methods(id, user_id, stripe_pm_id, brand, last4, exp, status, is_default)
payments(id, user_id, trip_id null, stripe_pi_id, amount_cents, kind enum(trip,topup,package,
         subscription,addon,debt,penalty,manual), status, failure_code,
         initiated_by enum(system,user,admin), admin_reason text null)  -- manual charge from panel REQUIRES reason
debts(id, user_id, amount_cents, source enum(failed_trip_payment,penalty,chargeback),
      status enum(open,retrying,paid,written_off), next_retry_at, attempts int)
pricing_plans(id, city_id, model_id, unlock_cents, per_min_cents, pause_per_min_cents,
              day_cap_cents, valid_from/to, dynamic jsonb)   -- dynamic: happy hours, demand multipliers
packages(id, name, minutes int, price_cents, validity_days, active)      -- parity: Pricing packages
package_purchases(id, user_id, package_id, minutes_left, expires_at)
subscriptions(id, name, stripe_price_id, perks jsonb, active)            -- parity: Subscriptions
user_subscriptions(id, user_id, subscription_id, stripe_sub_id, status, period_end)
addons(id, name, kind enum(insurance,helmet,other), price_cents, per enum(trip,month))  -- parity: Add-ons
addon_purchases(...)
promo_codes(id, code unique, kind enum(percent,fixed,free_minutes), value, max_uses,
            per_user_limit, valid_from/to, new_users_only bool, city_id null)
promo_redemptions(id, promo_id, user_id, trip_id null)
loyalty_accounts(user_id pk, points int); loyalty_events(user_id, delta, reason, trip_id)  -- parity: Loyalty
referrals(id, referrer_id, referee_id, status, reward_cents)             -- NEW vs Atom
invoices(id, user_id/corporate_id, number text unique, pdf_url, mydata_mark text null, issued_at)
```

## Ops / maintenance (parity: Fleet maintenance)

```sql
ops_tasks(id, kind enum(rebalance,battery_swap,pickup,repair,inspect,deploy),
          vehicle_id, zone_id null, priority int, status enum(open,assigned,in_progress,done,cancelled),
          assignee fk null, due_at, checklist jsonb, photos text[], notes,
          created_by enum(admin,system_rule), completed_at)
damage_reports(id, vehicle_id, reporter enum(rider,ops,admin), user_id null, trip_id null,
               description, photos text[], severity, status enum(new,confirmed,fixed,rejected),
               linked_task_id fk null, penalty_payment_id fk null)      -- parity: Damage reports
battery_swaps(id, vehicle_id, by fk, at, voltage_before, voltage_after)
maintenance_log(id, vehicle_id, task_id null, parts jsonb, cost_cents, notes)
```

## Marketing & content (parity: Marketing, Personalization)

```sql
push_campaigns(id, title, body, segment jsonb, scheduled_at, sent_count, status)
email_campaigns(...)         -- Resend
pois(id, city_id, name, kind, pos, icon, active)          -- parity: POI
faq_items(id, lang, question, answer, sort)               -- parity: Manage FAQ
app_content(key, lang, value jsonb)                        -- tutorials, onboarding slides, map icons config
app_config(key pk, value jsonb)                            -- feature flags, reservation_ttl, photo_ai_threshold
translations(lang, ns, key, value)                         -- parity: App localization (PL/EN/EL)
customer_forms(id, fields jsonb, active)                   -- parity: Customer form (extra signup questions)
reaction_tests(id, user_id, trip_id null, started_at, passed bool, score jsonb)  -- parity: Reaction test (night anti-DUI gate)
```

## Team & audit (parity: Team and accounts)

```sql
staff(id, user_id fk, role enum(owner,admin,support,ops_manager,ops,accountant,readonly),
      city_scope uuid[] null, active bool)
role_permissions(role, permission text)     -- checked in edge functions, not client
audit_log(id, staff_id, action, entity, entity_id, before jsonb, after jsonb, reason text, ip, at)
   -- parity: Employee activity log; REQUIRED for: manual charge, refund, block user, zone edit,
   -- price change, command send, debt write-off
```

## Views for panel parity

- `v_transaction_history` — payments + ledger joined (parity: Transaction history)
- `v_ride_verification_queue` — trips with photo_review='pending' (parity: Ride verification 99+)
- `v_heatmap_starts` / `v_heatmap_ends` — ST_SnapToGrid aggregates by hour/day (requested: heat maps)
- `v_vehicle_error_log` — vehicle_alerts kind='error'
- `v_iot_data_log` — telemetry + commands merged timeline per device

## RLS summary

- riders: own rows only (`users`, `trips`, `payments`, `payment_methods`, wallets read-only via view).
- `vehicle_state`: readable by authenticated (rider map) but columns limited via view `v_public_vehicles` (no IMEI, no alarms; only available vehicles inside operating zones).
- ops: `ops_tasks` where assignee or unassigned-in-scope; `vehicles`, `damage_reports` in city scope.
- staff/admin: nothing direct — all through edge functions with permission checks + audit.
- telemetry/commands: service_role only.

## Retention (pg_cron)

- `telemetry`: raw 90 days → downsample to 1/min into `telemetry_archive` 24 mo → drop.
- `trip_routes`: full 30 days → simplified only.
- `scan_data_log` 12 mo; `audit_log` 5 y; invoices per Greek tax law (see docs/10).

## Notifications & onboarding (see docs/12 for full spec)

```sql
notification_rules(...)   -- event_kind, condition jsonb, channels[], recipients, throttle, digest, quiet_hours
notification_log(...)     -- every send, all channels, status
user_notification_prefs(user_id pk, push_marketing, email_marketing, push_transactional, email_receipts, lang)
inbox_messages(id, user_id, title, body, deep_link, read_at)
push_tokens(user_id, token, platform, last_seen)
onboarding_progress(user_id, step, completed_at)
```

## Status & visibility (2nd pass additions)

```sql
vehicles.visible bool default true          -- hide from rider map independent of status
vehicle_status_log(id, vehicle_id, from_status, to_status, by fk, role, reason, photos text[], pos, at)
commands.kind += enum values: ring, alarm_on, alarm_off   -- DOUT2 siren
```
