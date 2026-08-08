# Penny Edge Functions (Supabase, Deno + TypeScript)

Every rider/ops/admin mutation that touches **money, unlock, or zones** goes through
these functions — never a direct table write (Hard Rules #2, #3, #6). Apps call them via
`supabase.functions.invoke(name, { body })`; the typed wrappers live in
`packages/api-client/src/edge.ts` and the request/response shapes here match it exactly.

## Layout

```
services/edge/
  _shared/
    cors.ts        # CORS headers + preflight
    responses.ts   # json(), EdgeError, withErrors() — structured { code, message, status }
    admin.ts       # service_role client, requireUser(), requireStaff(permission)
    validate.ts    # hand-rolled validators (no npm), haversine, WKT helpers
    ledger.ts      # accountId(), postLedger() -> calls DB post_ledger() (Hard Rule #2)
    audit.ts       # writeAudit() (Hard Rule #8), notifyUser() (inbox + notification_log)
    stripe.ts      # fetch-based Stripe REST client + webhook HMAC verification (no stripe npm)
    customers.ts   # ensureStripeCustomer() memoized in stripe_customers
    simprovider.ts # SimProvider interface + Truphone/1GLOBAL impl (docs/15) — the MNO boundary
  functions/<name>/index.ts
```

## Functions

| Function | Auth | Purpose |
|---|---|---|
| `trips-start` | rider JWT | preconditions, freeze pricing, trip(unlocking), enqueue unlock. Idempotent by `client_command_id`. No charge (Hard Rule #1). |
| `trips-end` | rider JWT | zone validation, mandatory photo, lock cmd, price from snapshot, balanced ledger, payment. |
| `trips-pause` | rider JWT | `action: pause \| resume`; lock/unlock + `pause_s` accounting. |
| `trips-reserve` | rider JWT | reserve (TTL) / `action: cancel`. |
| `vehicle-command` | rider or staff | rider `ring` (≤100 m, rate-limited) OR staff command (permission + audit). |
| `payments-setup-intent` | rider JWT | SetupIntent for adding a card. |
| `payments-pay-debt` | rider JWT | off-session debt payment + ledger. |
| `payments-buy-package` | rider JWT | PaymentIntent for a minute package (settled on webhook). |
| `payments-webhook` | signature | Stripe (`payment_intent.*`, `charge.dispute.created`, `setup_intent.succeeded`) + Sumsub `applicantReviewed`; idempotent by event id. |
| `photo-review` | service | Claude vision parking classifier; `>= photo_ai_threshold` ⇒ `auto_ok`, else pending. |
| `admin-charge` | staff | manual off-session charge, **reason mandatory** (Hard Rule #8) + ledger + audit + notify. |
| `admin-refund` | staff | full/partial refund, reason mandatory, reversing ledger + audit. |
| `zones-save` | staff | new `zone_versions` row (never mutate) + audit. |
| `gbfs` | public | GBFS 2.3 feeds from `v_public_vehicles` (coarse coords). |
| `damage-report` | rider JWT | file a damage report + ops error alert. |
| `admin-user-profile` | staff | Customer detail: profile, KYC bundle, rides, money, timeline. |
| `admin-vehicle-history` | staff | Vehicle detail: stats, rides, merged timeline, telemetry rollup. |
| `sim-sync` | staff | pull SIM inventory + usage from the provider, upsert, auto-link by exact ICCID. Idempotent. |
| `sim-command` | staff | SIM lifecycle (`activate`/`suspend`/`resume`/`terminate`/`set_plan`); reason mandatory for suspend+terminate; audited. |
| `admin-sim-detail` | staff | one SIM: inventory row, 30-day usage, events, device/vehicle, provider live view. |

## Local dev

```bash
supabase start                 # local Postgres + PostgREST + gateway to functions
supabase functions serve       # serves every function under functions/
# invoke one directly:
curl -i -X POST http://localhost:54321/functions/v1/gbfs/free_bike_status
```

`payments-webhook` and `gbfs` must run **without JWT verification**. Add to
`supabase/config.toml`:

```toml
[functions.payments-webhook]
verify_jwt = false
[functions.gbfs]
verify_jwt = false
```

## Environment variables

| Var | Used by |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | all (admin client — Hard Rule #6) |
| `STRIPE_SECRET_KEY` | all payment functions |
| `STRIPE_WEBHOOK_SECRET` | `payments-webhook` (Stripe signature) |
| `SUMSUB_WEBHOOK_SECRET` | `payments-webhook` (Sumsub `x-payload-digest`) |
| `ANTHROPIC_API_KEY` | `photo-review` (absent ⇒ leaves photo `pending`) |
| `TRUPHONE_API_BASE`, `TRUPHONE_API_TOKEN`, `TRUPHONE_ACCOUNT_ID` | `sim-sync`, `sim-command`, `admin-sim-detail` (absent ⇒ `{live:false, reason:'no_credentials'}`, cached rows still served) |

Where a credential is absent at runtime the function **degrades gracefully** rather than
crashing (photo stays pending; webhook signature check is skipped with a warning in dev).

## Ledger sign convention (Hard Rule #2)

`delta_cents` on `ledger_entries`; every `txn_id` nets to zero (enforced by `post_ledger()`
and a deferred constraint trigger). Account roles:

- `stripe_clearing` — cash received via Stripe (debit +).
- `penny_revenue` — recognized revenue (credit −); a card trip posts `[stripe_clearing +N, penny_revenue −N]`.
- `user_wallet` — liability (prepaid funds we hold); top-up `−X`, spend `+X`; available balance = `−sum` (`v_user_wallet_balance`).
- `debt` — amount owed by the user (+); cleared with `−`.
- `bonus` — deferred value of package minutes / bonus-zone credits.

## Connectivity provider — unresolved API markers (docs/15)

`_shared/simprovider.ts` hides Truphone/1GLOBAL behind the `SimProvider` interface, the
same way the gateway hides Teltonika behind `DeviceAdapter` (Hard Rule #5). Swapping MNO
= a new class + one branch in `getSimProvider()`; no SQL, no view, no flow changes.

**Nothing about the real REST API was guessed.** Every value that needs the vendor
documentation carries a `TODO(verify truphone api)` marker — the connectivity twin of the
gateway's `TODO(verify wiki)`. Find them all with:

```bash
grep -n 'TODO(verify truphone api)' services/edge/_shared/simprovider.ts
```

| # | Where | Verify |
|---|---|---|
| 1 | `getSimProvider()` | real base URL + version prefix for `TRUPHONE_API_BASE` |
| 2 | `TruphoneProvider.#request()` | auth scheme (implemented as `Authorization: Bearer`) |
| 3 | `TruphoneProvider.#request()` | where the account id goes (path / query / header) |
| 4 | `TP_PATHS.listSims` | list-SIMs endpoint path |
| 5 | `TP_PATHS.getSim` | single-SIM path; addressed by ICCID or provider id? |
| 6 | `TP_PATHS.usage` | daily-usage endpoint path |
| 7 | `TP_PATHS.setStatus` | lifecycle path **and verb** (PUT? action sub-resource? async job?) |
| 8 | `TP_PATHS.setPlan` | plan/bundle assignment path; opaque plan id vs name+MB |
| 9 | `getUsage()` | date-window query-parameter names; per-day rows vs aggregate |
| 10 | `readCollection()` / `NEXT_KEYS` / `#fetchAll()` | collection envelope + pagination contract |
| 11 | `readDataMb()` | data-volume field name **and unit** (wrong ⇒ mispriced invoice) |
| 12 | `readCostCents()` | minor-unit integer vs major-unit decimal; currency |
| 13 | `normalizeStatus()` | the full provider status enumeration |
| 14 | `toProviderSim()` | every SIM field spelling |
| 15 | `toProviderUsage()` | usage record shape; SMS split MO/MT vs single total |

Until they are resolved, run with no `TRUPHONE_API_TOKEN`: the provider reports
`live:false` and every function serves the cached `sims` / `sim_usage_daily` rows.
