# 14 — Setting up the Supabase project

Two ways to get a real database: **your own Supabase project** (what you want for
tomorrow's integration) or a **local Postgres** (instant, no account needed).

---

## A. Your own Supabase project — one command

You need a **Personal Access Token**. It cannot be generated for you; it is tied
to your account.

1. Open <https://supabase.com/dashboard/account/tokens>
2. **Generate new token** → name it `Penny provisioning` → copy it (`sbp_…`).
3. Run:

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx pnpm supabase:provision
```

That single command:

- finds your organization (`--org <id>` if you have more than one),
- creates the project **`penny-dev`** in `eu-central-1` (Frankfurt — lowest
  latency to Greece) with a generated DB password,
- waits until it reports `ACTIVE_HEALTHY`,
- applies **every migration** in `supabase/migrations` in order,
- sets edge-function secrets from your shell env (Stripe, Sumsub, Resend,
  Anthropic — whichever are present),
- deploys **all edge functions**,
- writes `apps/admin/.env.local`, `apps/rider/.env.local`, `apps/ops/.env.local`
  already switched to `DATA_SOURCE=supabase`, plus `.env.provisioned` with the
  service-role key, DB password and the gateway `DB_URL`.

Useful flags:

```bash
pnpm supabase:provision -- --env prod --name penny-prod   # production project
pnpm supabase:provision -- --project-ref abcd1234         # re-apply to an existing project
pnpm supabase:provision -- --dry-run                      # rehearse, change nothing
pnpm supabase:provision -- --skip-functions               # SQL only
```

### Secrets

Anything exported in your shell when you run it gets stored as a function secret:

```bash
export STRIPE_SECRET_KEY=sk_live_...
export STRIPE_WEBHOOK_SECRET=whsec_...
export SUMSUB_APP_TOKEN=...          # the EXISTING Penny Sumsub app token (docs/09)
export SUMSUB_SECRET_KEY=...
export RESEND_API_KEY=re_...
export ANTHROPIC_API_KEY=sk-ant-...  # photo-review AI pre-screen
SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm supabase:provision
```

Later: `supabase secrets set NAME=value --project-ref <ref>`.

### After provisioning — three manual bits

The Management API can't do these; they take a minute in the dashboard.

1. **Storage buckets** (all **private**): `trip-photos`, `ops-photos`, `kyc-docs`.
2. **Auth**: enable **Phone** provider (OTP is the primary rider login) and set an
   SMS provider; set Site URL / redirect URLs for the admin panel.
3. **Webhooks** pointed at the deployed functions:
   - Stripe → `https://<ref>.supabase.co/functions/v1/payments-webhook`
   - Sumsub → `https://<ref>.supabase.co/functions/v1/sumsub-webhook`

### Point the gateway at it

`.env.provisioned` contains the ready connection string:

```
DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
```

---

## B. Local Postgres — instant, no account

For development and CI, or if you just want to poke at the schema:

```bash
./scripts/db-local.sh            # creates/recreates `penny_dev`
./scripts/db-local.sh penny_test # any other name
```

It applies every migration, then prints a sanity check (table/view/RLS counts,
vehicle count, and proof the ledger nets to zero). Requires a local Postgres
with PostGIS.

The migrations include an **auth shim** (`00005_auth_shim.sql`) that creates a
minimal `auth.uid()` / `auth.users` **only when the `auth` schema is missing** —
so the exact same SQL runs on vanilla Postgres and is a complete no-op on real
Supabase.

Gateway against local:

```bash
DB_URL=postgres://postgres:postgres@localhost:5432/penny_dev pnpm gateway:run
```

---

## Switching the apps to live data

Each app reads a data-source switch (the provisioning script sets these for you):

| App   | Variable                  | Live value |
|-------|---------------------------|------------|
| admin | `VITE_DATA_SOURCE`        | `supabase` |
| rider | `EXPO_PUBLIC_DATA_SOURCE` | `supabase` |
| ops   | `EXPO_PUBLIC_DATA_SOURCE` | `supabase` |

Set back to `mock` at any time to demo without a backend.

---

## Regenerating types after a schema change

```bash
supabase gen types typescript --project-id <ref> > packages/db-types/src/database.types.ts
```

Hand-written domain models live in `packages/db-types/src/models.ts` and stay the
contract the apps compile against — keep the two in sync (Hard Rule: migrations
first, then regenerate).
