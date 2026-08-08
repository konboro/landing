# Runbook: DB failover

**Trigger:** db probe fail / Supabase incident (page).

1. Check Supabase status. Gateway is stateless (session registry in memory,
   commands in pgmq) — telemetry ingest will buffer/retry.
2. Apps degrade to read-only cached state; block new unlocks (they need
   server preconditions) with a clear user message.
3. On recovery: verify pgmq drained, no duplicate ledger txns, PITR intact.
4. Nightly logical dump to R2 is the escape hatch for point-in-time restore.
