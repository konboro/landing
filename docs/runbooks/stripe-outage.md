# Runbook: Stripe outage

**Trigger:** payment failure rate > 15% (warn) with Stripe status degraded.

1. Do NOT block rides globally on transient Stripe errors — trips end and create
   `debts(open)`; the retry schedule (+6h/+24h/+72h/+7d) will settle them.
2. Ensure the webhook idempotency table is healthy so replayed events don't
   double-post to the ledger.
3. If Stripe is fully down, captures queue; verify no ride was marked `charged`
   without a succeeded PaymentIntent (Hard Rule #1/#2).
4. After recovery, reconcile Stripe balance vs ledger (Admin → Finance).
