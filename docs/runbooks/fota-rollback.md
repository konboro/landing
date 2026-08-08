# Runbook: FOTA bad batch rollback

**Trigger:** `parse_errors` spike or unlock_success drop correlated with a rollout.

1. Identify the batch via `devices.server_profile` + fw_version.
2. In FOTA WEB, re-apply the `atom` (or last-good `penny`) profile to that batch.
3. Rollback is per-device and takes minutes; track recovery on the gateway
   `unlock_success_rate` metric.
4. Freeze further rollouts until the batch is green on the bench again.
