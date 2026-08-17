# 19 — myDATA: what is actually live right now

**Snapshot updated 2026-08-17, late.** This is a point-in-time status, not a
reference — it goes stale. `docs/18-mydata.md` explains how the system works and
stays true; this file says what is deployed today and what is not.

Everything below was verified against the live project by query, not from
memory. §7 has the commands to re-check it.

Project: **`pyferakmgtafifffqjat`** · branch **`feat/mydata-aade`**

---

## 1. One-line summary

The pipeline is built, deployed and wired to the panel, but it has **never
filed a receipt and cannot currently do so**. The PythonAnywhere pipeline is
still the system of record and is still doing all the real work.

## 2. What is live

| | |
|---|---|
| Migrations `00500`, `00510`, `00520`, `00530` | applied 2026-08-17 |
| Migration `00540` (worker schedule + queue accuracy) | **written, not yet applied** |
| Imported history | **22,471 receipts, AA 100–23108**, series bytes verified `ce91cea0cea5` |
| Tables | `mydata_series`, `mydata_submissions` |
| Views | `v_mydata_issues`, `v_mydata_missing`, `v_mydata_series_gaps`, `v_mydata_duplicates`, `v_mydata_daily`, `v_mydata_daily_review` — all execute |
| Functions | `mydata_take_aa`, `mydata_claim`, `mydata_settle`, `mydata_config`, `mydata_enqueue_for_payment`, `mydata_mark_filed`, `mydata_review` |
| Trigger | `payments_mydata_enqueue` on `payments`, installed |
| Permissions | `mydata.read` × 4 roles, `mydata.manage` × 2 roles |
| Edge functions | `admin-mydata`, `mydata-submit` — both `ACTIVE`, v1 |
| Panel | Admin → Money → **myDATA (AADE)**, reading live data |
| Mode | **`dry_run`** |
| Series | `ΑΠΥ`, `next_aa = 23109`, `floor_aa = 23109` — **stale, see §5** |
| Receipts issued | **0** |

## 3. Four independent reasons nothing can reach AADE

Not defence in depth by accident — each of these alone is sufficient.

1. `app_config.mydata.mode` is `dry_run`.
2. Rows record their mode at creation, and the adapter refuses to POST in
   `dry_run` regardless of the caller.
3. The `mydata-submit` cron job exists but is **inactive**, and stays that way
   until somebody creates the Vault secret and flips it on (`00540`).
4. `AADE_USER_ID` and `AADE_SUBSCRIPTION_KEY` are **not set** as function
   secrets, so the adapter would fail closed even if the first three were
   removed.

## 4. What is not built or not done

- **The cron job is inactive** (see §3.3 — currently a feature, not an
  omission). Until go-live, use **Run now** on the myDATA → Series & controls
  tab; the worker is what renders each receipt's document, so practice mode
  needs it to be useful at all.
- **Credit notes on refund** are not implemented. `doc_kind` exists for them.
  Note the legacy system never did this either; it is a pre-existing gap.
- **Shadow ingest from live Stripe is not built** — see §6.
- **AADE reconciliation** (`RequestTransmittedDocs`) not wired.
- **Legacy rows carry no amounts.** The old log stored only AA / MARK / date /
  Stripe ids.

## 4a. What the queue holds, verified

After the import, against the live project:

| Kind | Count | What it is |
|---|---|---|
| Missing number (gap) | 578 | 40 burned by legacy failures + the 538-block of 2026-06-17 |
| Filed twice | 32 | surplus receipts across 31 payments; one charge was filed three times |
| Not filed | 40 → **0 after `00540`** | legacy failures; already counted as gaps, and never retryable |
| Payment with no receipt | 5 | the €20 charges of 10–11 August |

Every count matches the independent analysis of `invoices_log.txt` exactly,
which is the best evidence available that nothing was lost in the import.

`00540` removes the double-count: 655 "open issues" is really 615 distinct
problems, and after the bulk gap acknowledgement it should be **37**.

## 5. Two live findings that need a decision

### 5.1 The series counter is stale, and drifts ~25/day

The database says the next receipt is **AA 23109**. PythonAnywhere has since
issued through **AA 23165** (confirmed from its daily CSV for 2026-08-16). Those
57 numbers are already filed at AADE.

Going live today would issue a number that already carries a MARK.
`floor_aa` does **not** protect against this — it blocks numbers *below* the
floor, and 23109 is not below 23109.

The counter is only trustworthy at the instant it is synced, and it drifts for
as long as both systems coexist. The cutover procedure in `docs/18` §6 handles
this by re-syncing from a fresh export *after* stopping the old pipeline, but it
is currently a written step rather than something enforced.

**Proposed, not yet built:** `set_mode` refuses to switch to `live` when
`mydata_series.updated_at` is older than a day, plus a staleness banner on the
Series tab. That turns the procedure into a control.

### 5.2 Five succeeded payments have no receipt

`v_mydata_issues` shows 5 rows, all `no_receipt`, all exactly €20.00, dated
2026-08-10 and 2026-08-11. They look like test top-ups, but that is a guess —
somebody who knows what those charges were needs to either dismiss them
("Note as reviewed") or decide AADE is owed receipts.

## 6. The shadow-run idea (discussed, not built)

Proposal: point live Stripe at this platform now, so it records every real
charge and populates the panel, while still transmitting nothing. That would
test the receiving path against real traffic instead of waiting for the first
completed ride.

It does not work as-is, for two reasons found while checking:

- `payments-webhook` ignores charges it does not recognise (`if (!payment)
  return`), so foreign charges would land in `stripe_events` and nowhere else.
- `payments.user_id` is `not null` — Atom Mobility's riders do not exist here,
  so the charges cannot be written to `payments` without inventing users.

**The shape that would work:** ingest `charge.succeeded` straight into
`mydata_submissions`, bypassing `payments`, under a separate **`ΑΠΥ-SHADOW`**
series so the real counter is never consumed. Comparison is then by charge id,
amount and rendered document — which is what matters; AA is just a counter.

Needs: a small migration (`source = 'shadow'`, the shadow series, a partial
unique index on charge id), one edge function, and a second endpoint on the live
Stripe account.

## 7. How to re-verify this file

Read-only. Management API, `POST /v1/projects/<ref>/database/query`.

```sql
-- objects
select
  (select count(*) from information_schema.tables  where table_schema='public' and table_name like 'mydata%') as tables,
  (select count(*) from information_schema.views   where table_schema='public' and table_name like 'v_mydata%') as views,
  (select count(*) from pg_trigger where tgname='payments_mydata_enqueue') as trigger,
  (select value->>'mode' from app_config where key='mydata') as mode,
  (select count(*) from mydata_submissions) as receipts;

-- series, byte-checked (ce91cea0cea5 is ΑΠΥ in UTF-8)
select series, next_aa, floor_aa, updated_at,
       encode(convert_to(series,'UTF8'),'hex') = 'ce91cea0cea5' as series_ok
from mydata_series;

-- the work queue
select kind, count(*) from v_mydata_issues group by kind;

-- is the worker scheduled?
select jobname, schedule, active from cron.job;
```

Deployed functions: `GET /v1/projects/<ref>/functions`.
Secret **names** (never values): `GET /v1/projects/<ref>/secrets`.

## 8. Code state

Branch `feat/mydata-aade`, one commit on top of `fix/admin-missing-edge-fns`.

- `pnpm --filter @penny/edge test` — **44 pass**, including a golden check that
  rebuilding AA 23108 reproduces the last document the legacy pipeline actually
  sent, and an agreement check that the money split matches the legacy Python
  for every amount from 1 cent to €500.
- `@penny/admin` and `@penny/edge` typecheck clean.
- `@penny/rider` typecheck **fails** — `src/components/ui/Icon.tsx`,
  `@types/react` 18 vs 19. **Pre-existing on the branch, unrelated to myDATA.**

What is proven and what is not: the pure logic (money, XML, response parsing,
guards, transport) is covered by tests. The SQL is proven to *apply and query* —
every view executes — but the write paths (`mydata_take_aa`, `mydata_claim`,
`mydata_settle`, the trigger) have **never run**, because nothing has created a
payment since the migration landed.
