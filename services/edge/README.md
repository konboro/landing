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
