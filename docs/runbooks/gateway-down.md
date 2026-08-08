# Runbook: gateway down

**Trigger:** probe fail on TCP :5027 or metrics :9100 (Better Stack → phone page).

1. SSH the Hetzner VPS. `systemctl status penny-gateway`; `journalctl -u penny-gateway -n 200`.
2. Restart: `systemctl restart penny-gateway`. Confirm `/metrics` responds and `sessions_active` climbs as 2G devices reconnect (reconnect is normal, expect a wave).
3. If it won't bind :5027, check the static/floating IP is still attached (devices point at it — immutable, see docs/01).
4. Commands are persisted in pgmq — none are lost while down; unlocks older than 20 s will `expire` (correct, never deliver a stale unlock).
5. Postmortem: check `parse_errors` spike (bad firmware batch → docs/runbooks/fota-rollback.md).
