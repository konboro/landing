# 18 — myDATA (AADE) receipt transmission

Every successful card charge produces a Greek retail receipt (ΑΠΥ) that must be
transmitted to AADE. This document covers how that works on the platform, the
controls around it, and how it took over from the standalone pipeline that ran
on PythonAnywhere from 2024-12-01.

> Direct-to-AADE is deliberate and supersedes the certified-provider line that
> used to be in `docs/05`. No free provider does this job; the direct
> integration has 20 months of production behind it. The provider seam is kept
> (`services/edge/invoicing/`) so the decision stays reversible.

---

## 1. What gets filed

One receipt per succeeded `payments` row, replicating the legacy behaviour
exactly — it fired on Stripe `charge.succeeded` for every charge, with no
distinction between trips, packages and debt settlements.

The tax treatment is fixed and is snapshotted onto every row
(`mydata_submissions.tax_profile`) so historical receipts stay explicable if the
configuration later changes:

| Field | Value | Meaning |
|---|---|---|
| issuer VAT | `802160515` | PENNY IKE, branch 1, GR |
| series | `ΑΠΥ` | retail receipt series |
| `invoiceType` | `11.2` | retail receipt for services |
| `vatCategory` | `1` | 24% |
| classification | `E3_561_003` / `category1_3` | income classification |
| `paymentMethod.type` | `6` | card |

Amounts are integer cents throughout. **VAT is the remainder** (`vat = gross -
net`), so `net + vat = gross` is an identity rather than something to verify —
a database CHECK enforces it, and a document whose summary does not reconcile is
rejected by AADE. A unit test asserts the values are byte-identical to the legacy
Python for all amounts from 1 cent to €500.

## 2. Flow

```
payments.status -> 'succeeded'
      │  (trigger, same transaction)
      ▼
mydata_submissions row: AA allocated, amounts computed, status 'pending'
      │
      ▼  mydata-submit worker (cron, every minute)
mydata_claim(mode)  ── FOR UPDATE SKIP LOCKED ──▶  guards ──▶ AADE ──▶ MARK
      │                                              │
      └── failure: same AA, exponential backoff ─────┘
```

The enqueue is a **trigger on `payments`**, not a call inside
`payments-webhook`. Trip captures are confirmed synchronously in `trips-end`,
and the webhook deliberately no-ops on payments that are already `succeeded` —
hanging the receipt off the webhook would miss the most common payment on the
platform. The trigger catches every path in one place and never raises: a myDATA
problem must not roll back a captured payment.

## 3. Why it is built this way

The legacy pipeline worked — 22,431 of 22,471 attempts succeeded — but its state
lived in two text files, and the import surfaced exactly what that costs:

| Legacy defect | Consequence | Structural fix |
|---|---|---|
| `counter.txt`, unlocked read-modify-write | 9 out-of-order allocations | `mydata_take_aa()` — row-locked, transactional |
| counter incremented **before** the POST | 40 AA numbers burned by failures | AA allocated once; a retry re-sends the **same** number |
| no idempotency on the Stripe charge | 31 payments filed twice (32 surplus MARKs) | unique index on `stripe_charge_id` |
| single POST, no retry | 23 payments never filed at all | `pending` → backoff → `failed`, all visible |
| non-200 handler searched the **request** for errors | all 40 failures logged "Unkown Error" | `parseAadeResponse` reads the response, classifies retryable vs permanent |
| `send_failure_email(3 args)` vs `def(2 args)` | failure email never once fired | failures surface in the panel; no silent path |
| net and VAT rounded independently | latent AADE rejection | VAT is the remainder, enforced by CHECK |

There is also a **538-number block (AA 20676–21213) consumed on 2026-06-17** with
no submission and no log line. Trading that day was normal, so this was not lost
data. It is unexplained, and it is the single largest hole in the series.

None of these can recur: they are prevented by constraints and allocation
semantics, not by more careful code.

## 4. Controls

Configuration lives in `app_config` under the key `mydata`.

| Control | Where | What it stops |
|---|---|---|
| `enabled` | `app_config.mydata` | master switch; false records nothing |
| `mode` | `dry_run` \| `sandbox` \| `live` | whether anything reaches AADE |
| `max_gross_cents` | default €200 | an implausible receipt auto-filing |
| `floor_aa` | `mydata_series` | ever re-issuing a number the legacy system used |
| date window | `guards.ts` | future-dated or long-expired receipts |
| `max_attempts` | default 8 | infinite retry on a permanent rejection |
| unique `stripe_charge_id` | index | double-filing a charge |
| `net + vat = gross` | CHECK | a summary AADE would reject |

**Mode is recorded per row at creation.** A row created in `dry_run` or
`sandbox` is terminal and can never be transmitted to live AADE — the worker
claims only rows matching the *current* mode, and the adapter refuses to POST in
`dry_run` regardless of what the caller asks. This is what makes the cutover
one-way and rehearsable: flipping to live never retro-transmits the shadow-mode
backlog.

Three views make the previously invisible visible:

- `v_mydata_series_gaps` — every AA in an issued range with no MARK. Should be
  empty in steady state; it currently holds the 578 inherited holes.
- `v_mydata_missing` — succeeded payments with no submission row. This is the
  check that would have caught all 23 never-filed payments on day one.
- `v_mydata_daily` — the rollup that replaces the emailed CSV.

Retry, cancel and mode changes go through `admin-mydata` and write `audit_log`
(Hard Rule #8). Cancelling and changing mode both require a reason.

## 4a. The review desk

The old process had a human in it: a CSV arrived by email each morning, someone
scanned it, and anything that had gone wrong was filed by hand through the AADE
portal. That loop matters — automation gets a receipt to AADE, but only a person
can decide what to do when AADE says no.

**Admin → Money → myDATA (AADE)** is that job:

- **Review queue** — one list of everything needing a person, from
  `v_mydata_issues`: receipts that failed, payments with no receipt at all,
  charges filed twice, holes in the series, and submissions stuck in flight.
  Each kind carries the action it actually wants, not just a status.
- **All receipts** — searchable by AA, MARK or charge id, across imported
  history and platform-issued rows alike.
- **Daily** — the CSV, except it is never a day stale and it says how many
  receipts were filed by hand. Still exports to CSV for the accountant.
- **Series & controls** — the numbering state and the `dry_run` / `sandbox` /
  `live` switch, which asks for a reason and warns that the old pipeline must be
  off first.

Opening a receipt shows why it failed, the exact document sent, and the exact
response — none of which survived before, because the legacy pipeline
overwrote one `edited_invoice.xml` on every run. From there:

| Action | When | Effect |
|---|---|---|
| **Retry** | the failure looked transient | requeues with the **same** AA |
| **Record a MARK filed by hand** | you filed it on the AADE portal | `mydata_mark_filed` — status `sent`, `filed_manually`, MARK recorded |
| **Note as reviewed** | known and accepted | `mydata_review` — off the queue, filing state unchanged |
| **Cancel** | should not be filed | retires the AA deliberately |

`mydata_mark_filed` rejects a MARK that is already recorded on another
submission, because a MARK identifies one document at AADE — a pasted-in
duplicate would hide a real gap rather than close one. Every action writes
`audit_log` with the reviewer's note, so the reasoning survives the person.

## 4b. Shadow ingest

`mydata-shadow` is a second Stripe webhook endpoint that records live
`charge.succeeded` events — the same event the legacy Flask app listened to —
without transmitting anything. It exists because the alternative way to test the
receiving path is to wait for this platform's first completed ride, and that
gives you one data point whenever it happens.

It writes into `mydata_submissions` as `source = 'shadow'`, bypassing `payments`
entirely: `payments.user_id` is `not null` and those riders exist in the old
system, not here. Receipts go into a separate **`ΑΠΥ-SHADOW`** series so the real
counter is never consumed while both systems are issuing.

Nothing shadow can reach AADE, for three independent reasons: `mode` is
`dry_run`; the status is terminal on insert; and `mydata_claim` filters
`source = 'platform'`. The document is rendered by the ingest function itself
rather than by the worker — the worker is the thing that talks to AADE, and a
shadow receipt should never pass through it.

`v_mydata_shadow_compare` reports daily coverage against the imported history:
charges recorded here, charges the old pipeline filed, and the difference both
ways. It proves the two systems see the same charges. It cannot compare amounts —
the legacy log never recorded any.

Setup, and how to switch it off at cutover: `docs/19-mydata-state.md` §6.

## 5. Testing

`services/edge/invoicing/` is deliberately free of Deno APIs so it runs under
`node --test` with the rest of the workspace:

```bash
pnpm --filter @penny/edge test
```

44 tests. The ones that matter most:

- **Golden document** — building the receipt for AA 23108 reproduces
  `edited_invoice.xml`, the last document the legacy pipeline actually sent,
  element for element.
- **Money agreement** — for every amount from 1 to 50,000 cents, the new split
  produces the same net and VAT strings as the legacy Python. Zero divergences.
- **Namespaces** — including AADE's own misspelling of `incomeClassificaton`,
  which is load-bearing. Correcting it produces a document they reject.
- **Transport** — `dry_run` cannot reach the network; timeouts, connection
  failures and 5xx are retryable; a 400 ValidationError is not.

For an end-to-end rehearsal without touching live AADE, set `mode` to `sandbox`,
which posts to `mydataapidev.aade.gr`.

## 6. Cutover from PythonAnywhere

Both systems receive the same Stripe events, so **they must never both be live.**
The switch is the Stripe endpoint, not a code deploy.

1. **Import the history.** Needed before anything else: without it the platform
   cannot tell an unfiled payment from one PythonAnywhere already filed.
   ```bash
   node --experimental-strip-types scripts/mydata-import-legacy.mjs \
     --log "../myData integration/invoices_log.txt" \
     --out supabase/seed-mydata-legacy.sql
   ```
   Review the SQL, then apply it. It sets `next_aa` and `floor_aa` to 23109 from
   the real log rather than trusting the seed value in the migration.

2. **Shadow run.** Deploy with `mode: 'dry_run'` (the migration's default).
   Every payment now gets a number and a rendered document; nothing is
   transmitted. PythonAnywhere is still the system of record. Let it run long
   enough to compare a meaningful sample in the panel against what the legacy
   system filed for the same charges.

3. **Sandbox** (optional). `mode: 'sandbox'` exercises the real transport and
   response parsing against AADE's dev endpoint.

4. **Go live.** In one window:
   - stop the legacy pipeline first — disable its endpoint in the Stripe
     dashboard, so it stops receiving `charge.succeeded`;
   - read the final `counter.txt` and confirm `mydata_series.next_aa` is above
     it (re-run the import if the legacy system filed anything after the export);
   - switch `mode` to `live` via the panel, with a reason.

   `admin-mydata` refuses to go live if `next_aa` is below `floor_aa`.

5. **Rollback.** Set `mode` back to `dry_run` and re-enable the Stripe endpoint
   on PythonAnywhere. Receipts already transmitted are untouched; in-flight rows
   can be retried or cancelled individually. Set `counter.txt` to the current
   `next_aa` before re-enabling, or the series will collide.

## 7. Open items

- **Credit notes on refund are not implemented.** They were not implemented in
  the legacy system either, so this is a pre-existing gap rather than a
  regression — but a refund should file a credit note, and `admin-refund`
  currently does not. `mydata_submissions.doc_kind` exists for it.
- **The 96 inherited exceptions** (31 double-filed payments, 23 never filed, 578
  series holes) need an accountant's decision. They are listed in
  `v_mydata_series_gaps` and were exported during the analysis. The authoritative
  cross-check is AADE's `RequestTransmittedDocs` endpoint, which is not yet
  wired up.
- **Legacy rows carry no amounts.** The old log stored only AA / MARK / date /
  Stripe ids. Backfilling means querying Stripe for ~22k charges — worth doing
  for complete reporting, not a precondition for cutover.
- **`paymentMethod.type = 6`** is inherited from the legacy template. AADE's
  code list distinguishes web banking from POS/e-POS; worth confirming with the
  accountant that 6 is the intended code for card payments.
- **Credentials** (`AADE_USER_ID`, `AADE_SUBSCRIPTION_KEY`, `MYDATA_CRON_SECRET`)
  are function secrets. The legacy source files still contain live keys in
  plaintext and should be rotated.
