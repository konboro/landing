# 17 — Running this on your own machine

Everything below assumes the work branch
`claude/ios-android-web-admin-app-or6boz`.

> **No secrets in this file.** It is committed to GitHub. Where a value is
> needed, it says where to get it.

---

## 1. Get the code

```bash
git clone https://github.com/konboro/landing.git
cd landing
git checkout claude/ios-android-web-admin-app-or6boz
pnpm install
```

Requires **Node ≥ 22** (the unit tests use native TS type-stripping), **pnpm**,
and **Go ≥ 1.22** for the gateway.

## 2. Env files (not in git — you create them once)

`.env.local` and `.env.provisioned` are gitignored on purpose, so a fresh clone
has none of them. Two ways to produce them:

**a. Regenerate everything from the Supabase project** (recommended — also
re-applies migrations and redeploys functions, all idempotent):

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm supabase:provision -- --project-ref <ref>
```

**b. Write them by hand.** `apps/admin/.env.local`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_EDGE_BASE_URL=https://<ref>.supabase.co/functions/v1
VITE_DATA_SOURCE=supabase          # or `mock` to run with no backend
# VITE_MAPBOX_TOKEN=pk.eyJ...      # optional; without it maps show a fallback
```

The **anon key** is public by design (it ships inside the client bundle) —
Dashboard → Project Settings → API. The **service_role key** is not: it belongs
only in edge functions and the gateway, never in an app.

`apps/rider/.env.local` and `apps/ops/.env.local` are the same with the
`EXPO_PUBLIC_` prefix.

## 3. Run each piece

```bash
# Admin panel
pnpm --filter @penny/admin dev            # http://localhost:5173

# Rider / Ops apps
pnpm --filter @penny/rider start
pnpm --filter @penny/ops start

# Gateway — bench mode, no database, accepts any IMEI
pnpm gateway:run
pnpm gateway:sim                          # simulated FMB930 in a second terminal

# Gateway against the live database
DB_URL='<pooler URL from .env.provisioned>' pnpm gateway:run
```

Watch `http://localhost:9100/metrics` during a bench session:

| metric | meaning |
|---|---|
| `gateway_sessions_active` | devices currently connected |
| `gateway_telemetry_records_total` | AVL records parsed — **flat means the device is connected but silent** |
| `gateway_parse_errors_total` | bad frames; should stay 0 |
| `gateway_unlock_success_rate` | the SLO from docs/10 |

## 4. Signing in to the panel

Live mode needs a staff account: a Supabase auth user **plus** an active row in
`staff`. A Supabase user without that row is rejected by `admin-me` with 403 —
that is what stops a rider account from opening the panel.

To add another staff member, create the auth user in the dashboard
(Authentication → Users), then:

```sql
insert into users (id, phone, email, full_name, status)
values ('<auth user id>', '<phone>', '<email>', '<name>', 'active')
on conflict (id) do nothing;

insert into staff (user_id, role, active)
values ('<auth user id>', 'ops_manager', true);
```

Roles: `owner`, `admin`, `support`, `ops_manager`, `ops`, `accountant`,
`readonly` — permissions per role live in `role_permissions`.

## 5. Continuing with Claude Code locally

```bash
cd landing
claude
```

Sessions started on the web do **not** import into the local CLI — but they do
not need to. `CLAUDE.md` and `docs/00`–`docs/16` are in the repo, so a fresh
local session picks up the hard rules, the architecture and the current state
on its own. Point it at the doc for whatever you are changing.

A useful opening line: *"Read CLAUDE.md and docs/11-roadmap.md, then …"*.

## 6. Before a real scooter connects

1. **`DB_URL` must use the pooler.** `db.<ref>.supabase.co` is IPv6-only on
   current Supabase projects; an IPv4-only VPS cannot reach it. See docs/03.
2. **Check the command queue exists** — without it nothing unlocks:
   ```sql
   select queue_name from pgmq.list_queues();   -- expect: commands
   ```
3. **Register the real device** — `devices.imei` exactly as printed, no
   reformatting (Hard Rule #10), `server_profile = 'penny'`, linked to a
   `vehicles` row.
4. **Point the device at the gateway** via FOTA WEB (docs/03 `penny` profile)
   and confirm the static IP and port 5027 are reachable from the SIM's network.
5. Resolve the `TODO(verify wiki)` markers listed in
   `services/gateway/README.md` on the bench — DOUT wiring and the AVL ids are
   assumptions until a real device confirms them.
