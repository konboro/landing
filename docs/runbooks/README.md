# Runbooks

Operational playbooks referenced by `docs/10-compliance-monitoring.md`.
Each is a short, do-this-now checklist for on-call. Keep them terse.

## Index

- [gateway-down.md](./gateway-down.md) — TCP gateway not accepting connections
- [mass-offline.md](./mass-offline.md) — large fraction of fleet offline (carrier check first)
- [stuck-trip.md](./stuck-trip.md) — trip stuck in `ending` (no lock ACK)
- [stripe-outage.md](./stripe-outage.md) — payments failing; queue captures
- [fota-rollback.md](./fota-rollback.md) — bad firmware batch; re-profile to `atom`
- [db-failover.md](./db-failover.md) — Supabase/Postgres incident
- [sms-budget-spike.md](./sms-budget-spike.md) — SMS fallback volume alarm

## Escalation

Telegram (ops) for warnings; Better Stack phone call for pages (SLO breaches in
docs/10). Public status page: status.penny.rent.
