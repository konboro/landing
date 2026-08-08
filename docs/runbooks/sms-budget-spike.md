# Runbook: SMS budget spike

**Trigger:** > N SMS/day (email alert). SMS fallback fires when GPRS command
delivery fails — a spike means GPRS problems, not just cost.

1. Check gateway `cmd_latency` and GPRS vs SMS channel split in `commands`.
2. If a region's devices can't hold GPRS, treat as carrier/coverage issue.
3. Confirm every `alarm`/siren command still has its scheduled failsafe OFF
   (SMS OFF if unreachable) — a stuck siren is worse than the SMS bill.
