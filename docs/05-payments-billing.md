# 05 — Payments, wallet, billing (Stripe, EUR, Greece)

## Card lifecycle

- Add card: SetupIntent (on-session, SCA/3DS) → `payment_methods`. Optional 0 € auth or 1 € auth-void per risk config.
- Trip: pre-auth **hold** at unlock (config, default 5 €; skip if wallet/package covers estimate) → capture actual amount at end; release remainder. Off-session PaymentIntent with `confirm=true`, handle `authentication_required` → push user to complete 3DS (trip stays `ended`, debt pending until done).
- One Stripe Customer per user; corporate accounts have own Customer + monthly invoicing option (Stripe Invoicing).

## Ledger rules

Every payment/refund/bonus/package consumption emits balanced `ledger_entries`. Examples:
- Trip 3.40 € card: user_wallet 0; stripe_clearing +340; penny_revenue −340 (sign convention documented in code).
- Package minutes: consumption entries against `bonus` account valued at package unit price (for revenue reporting).
Wallet top-ups allowed (config) — prepaid balance used before card.

## Debt subsystem

- On failed capture → `debts(open)` + immediate lock of new rides.
- Retry schedule (pg_cron): +6 h, +24 h, +72 h, +7 d (smart retry: skip cards Stripe marks as permanently failed; prompt user to add new card).
- Partial payments allowed; user sees debt banner with 1-tap pay.
- Write-off only by admin with reason → audit_log.
- Chargebacks: Stripe webhook → debt + user blocked pending review + evidence pack auto-assembled (trip route, photo, timestamps).

## Manual charge from panel (requested)

Edge fn `admin-charge`: staff with `payments.charge` permission selects user → amount, kind (penalty/damage/other), MANDATORY reason + evidence attachment → off-session PI → ledger + audit_log → user gets push + email with breakdown and appeal link. Refunds mirror this (`admin-refund`, partial or full, reason mandatory).

## Products

- **Packages** (minute bundles): purchase → PI → `package_purchases`; consumption at trip end before card.
- **Subscriptions**: Stripe Billing subscriptions; perks jsonb (e.g., free unlocks, % off, daily free minutes). Webhooks keep `user_subscriptions.status` synced.
- **Add-ons**: per-trip insurance toggle at unlock (adds fixed fee, stored in pricing_snapshot) or monthly via subscription.
- Promo codes & referrals: validated server-side at start; referral reward credited to wallet after referee's first `charged` trip.

## Invoicing & Greek compliance

- Receipt (απόδειξη) per charged trip: PDF (edge fn + storage) + email on request; monthly consolidated invoice for corporate.
- **myDATA**: transmission of retail receipts/invoices to AADE required — integrate via a certified e-invoicing provider API rather than direct AADE integration (decision: provider TBD, adapter interface in `services/edge/invoicing/`). Timelines/specs must be re-verified at implementation time; keep VAT rate config per product type. Until go-live of own billing, Atom/current provider handles this — hard dependency for cutover date.
- VAT: transport service VAT rate config; prices stored gross; ledger stores net+vat split per entry group.

## Webhooks (edge/webhooks)

`payment_intent.succeeded/failed`, `charge.dispute.created`, `customer.subscription.*`, `setup_intent.succeeded`, Sumsub `applicantReviewed`. All idempotent (event id table), signed-secret verified.

## Transaction history (parity)

`v_transaction_history` powers panel + user-facing history: every payment with trip link, method, status, refunds, exportable CSV.

## 2nd-pass addition: Apple Pay / Google Pay (docs/13)

Stripe PaymentSheet in rider app; wallet payments become default CTA on add-payment and debt-pay screens. Off-session trip captures still ride on the underlying card PM created by the wallet. No extra PSP work — Stripe handles domain verification (apple-developer-merchantid file on penny.rent).
