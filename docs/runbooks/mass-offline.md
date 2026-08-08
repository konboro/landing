# Runbook: mass offline

**Trigger:** fleet offline % > 10% (page).

1. **Carrier first.** Check the 2G/SIM provider status page. A carrier outage
   looks like many devices dropping at once across a region — not our bug.
2. Confirm the gateway is up (docs/runbooks/gateway-down.md) and `sessions_active`
   fell (devices gone) vs `parse_errors` rose (we're rejecting them).
3. If carrier issue: post a rider service banner (city disruption), pause
   `offline_too_long` immediate alerts to a digest to avoid alert storms.
4. If ours: check a recent FOTA rollout; roll back the affected batch.
