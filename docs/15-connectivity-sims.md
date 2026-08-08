# 15 — Connectivity & SIM management (Truphone / 1GLOBAL)

Every FMB930 in the fleet carries an IoT SIM. The SIM is what makes the tracker
reachable at all: it carries the GPRS session the Codec 8E/12 command bus rides on,
and its MSISDN is the target of the **SMS command fallback** (docs/03). A dead SIM is
a scooter that cannot be unlocked, cannot be located and cannot be alarmed — so the
SIM estate is fleet infrastructure, not a billing footnote.

Our SIMs come from **Truphone**, which now trades as **1GLOBAL**. The provider is
modelled as swappable from day one (see [The provider boundary](#the-provider-boundary)).

Owning docs: data model extends docs/02, alert rules extend docs/12 §B, the SMS
budget alarm is defined in docs/03.

---

## A. Data model (migration `00210_sim_connectivity.sql`)

```
sims(id, iccid unique, imsi, msisdn, provider, provider_sim_id, status,
     activated_at, suspended_at, terminated_at,
     plan_name, plan_data_mb, cycle_start, cycle_end, monthly_cost_cents,
     device_id → devices, label, notes,
     last_seen_at, network, country, created_at, updated_at)

sim_usage_daily(id, sim_id → sims, day, data_mb, sms_out, sms_in, cost_cents,
                network, country, unique(sim_id, day))

sim_events(id, sim_id → sims, at, kind, detail jsonb, staff_id → staff, reason)

devices.sim_id → sims          -- added by 00210
```

Indexes: `sims(status)`, `sims(device_id)`, `sims(provider, provider_sim_id)`,
`sims(last_seen_at desc)`, `sim_usage_daily(sim_id, day desc)`, `sim_events(sim_id, at desc)`.

**RLS: all three tables are `service_role` only** (Hard Rule #6). They have RLS enabled
with no `anon`/`authenticated` policy, exactly like `telemetry`, `commands` and the
`sumsub_*` cache. The admin panel never reads them directly — it calls the `sim-*` edge
functions, which check a permission and (for mutations) write `audit_log`.

### Identity rules

| Value | Meaning | Rule |
|---|---|---|
| `devices.imei` | device identity | Hard Rule #7 — never a business key |
| `vehicles.code` | business identity | Hard Rule #7 |
| `sims.iccid` | **SIM identity** | Hard Rule #10 — stored as EXACT text |
| `sims.msisdn` | SMS-fallback number | must equal `devices.phone_number` for the fitted device |

Nothing in this feature trims, re-spaces, strips a leading zero from, or numerically
casts an ICCID / IMSI / MSISDN / provider id. ICCIDs are 19 **or** 20 digits depending on
the issuer and both lengths exist in the seed on purpose. The auto-link in `sim-sync`
matches `sims.iccid = devices.iccid` **byte for byte** — a fuzzy match would link the
wrong scooter, which is worse than leaving it unlinked.

### `devices.iccid` vs `devices.sim_id`

Both are kept, deliberately:

- **`devices.iccid`** — the *label of record*: the ICCID printed on the SIM someone
  physically pushed into that tracker, typed in during provisioning (docs/03 "admin
  enters IMEI+ICCID+SIM MSISDN"). It is paperwork, and it stays authoritative.
- **`devices.sim_id`** — the *managed relational link* to the `sims` row. Filled in by
  `sim-sync` when the printed value matches a SIM we know about. This is the link
  business code should follow.

When they disagree, `v_sim_inventory.iccid_mismatch` is true and the panel shows a
badge — that is a physical-vs-records discrepancy for a human to resolve, not something
software should silently "fix".

### `sims.device_id` vs `devices.sim_id`

`sims.device_id` records which device a SIM sits in *from the SIM side*, and there is
**no unique constraint** on it. A swapped-out SIM keeps pointing at its old device until
ops clears the link — that is the exact condition the `sim_terminated_still_linked`
alert exists to surface. `devices.sim_id` always points at the device's current SIM.

### Why `provider` and `status` are `text`, not enums

MNOs get acquired and renamed (Truphone → 1GLOBAL is precisely that), and their state
machines gain states. A rename or a new provider state must not require a migration.
`sims.status` is constrained by a plain `CHECK` (`inventory | active | suspended |
terminated | test`) which is one `ALTER` to extend; `provider` is unconstrained.
`packages/db-types` models both as string unions so the panel still gets exhaustive
switches.

---

## B. The provider boundary

`services/edge/_shared/simprovider.ts` is to connectivity what
`services/gateway/adapter/DeviceAdapter` is to telemetry (Hard Rule #5): **one interface,
all operator-specific code behind it.**

```ts
interface SimProvider {
  readonly name: string;        // matches sims.provider
  readonly live: boolean;       // false ⇒ no credentials, calls are not made
  readonly reason: string | null;

  listSims(): Promise<ProviderSim[]>;
  getSim(ref: SimRef): Promise<ProviderSim | null>;
  getUsage(from: string, to: string): Promise<ProviderUsageRow[]>;   // inclusive YYYY-MM-DD
  setStatus(ref: SimRef, s: 'active'|'suspended'|'terminated'): Promise<ProviderSim | null>;
  setPlan?(ref: SimRef, plan: SimPlanChange): Promise<ProviderSim | null>;
}

function getSimProvider(providerName = 'truphone'): SimProvider;
```

`ProviderSim` / `ProviderUsageRow` are already normalized onto **our** column names, so
no edge function ever sees a provider-shaped object.

### Swapping providers

1. Write `class FooProvider implements SimProvider` (same file, or `_shared/providers/foo.ts`).
2. Add a branch in `getSimProvider()` — it already dispatches on the provider name, and
   `sims.provider` is per-row, so a mixed estate during a migration works.
3. Nothing else changes: no SQL, no view, no edge-function flow, no panel code.

### Degradation contract

With no `TRUPHONE_API_TOKEN` the factory returns an `OfflineProvider`:

| call | offline behaviour |
|---|---|
| `listSims()` / `getUsage()` | `[]` |
| `getSim()` / `setStatus()` / `setPlan()` | `null` |
| `live` / `reason` | `false` / `'no_credentials'` |

Every `sim-*` function keeps working off the cached DB rows and reports
`{ live: false, reason: 'no_credentials' }` in its response. Nothing throws because the
integration is not wired yet — same principle as `photo-review` without
`ANTHROPIC_API_KEY`. A *configured* provider that then fails does throw
(`provider_error` / `provider_unreachable`, HTTP 502): that is an outage an operator
must see.

### Tolerant parsing

Response readers (`pickText`, `pickNumber`, `pickTimestamp`, `readDataMb`,
`readCostCents`, `normalizeStatus`, `readCollection`) accept several plausible spellings
per field, case-insensitively — `iccid`/`ICCID`, `dataVolume`/`bytes`/`mb`/`gb`,
`costCents`/`cost`, `lastSeen`/`lastConnected`. Data volume is normalized to **MB**
(1 MB = 1e6 bytes) and money to **EUR cents** whatever unit arrives. A record with no
recognizable ICCID is **dropped**, and an unrecognized status leaves `sims.status`
untouched rather than inventing a state.

The point is that first contact with the real API should be adding a key name to a list
and correcting a path — not a rewrite.

### Environment

| Var | Meaning |
|---|---|
| `TRUPHONE_API_BASE` | base URL of the IoT Connectivity API |
| `TRUPHONE_API_TOKEN` | bearer token — **absent ⇒ offline mode** |
| `TRUPHONE_ACCOUNT_ID` | optional account/organisation id |

Hard Rule #11: the token is never logged, never echoed into an error message and never
stored in the database.

---

## C. `TODO(verify truphone api)` markers

**Nothing about the real API was guessed.** Every value that needs the vendor
documentation is marked, the same way the gateway marks unverified Teltonika parameter
ids with `TODO(verify wiki)` (docs/03). All markers live in
`services/edge/_shared/simprovider.ts`; resolve them in one session with the API
reference open.

| # | Location | What must be verified |
|---|---|---|
| 1 | `getSimProvider()` env block | The real **base URL** and version prefix for `TRUPHONE_API_BASE`. |
| 2 | `TruphoneProvider.#request()` | **Auth scheme.** Implemented as `Authorization: Bearer <token>`. May instead be an API-key header, HTTP Basic, or an OAuth2 client-credentials exchange. One place to change. |
| 3 | `TruphoneProvider.#request()` | Whether the **account/organisation id** belongs in the path, a query parameter, or a header (sent as `X-Account-Id`). |
| 4 | `TP_PATHS.listSims` | Endpoint path for **listing/searching SIMs** on the account. |
| 5 | `TP_PATHS.getSim` | Endpoint path for **one SIM**, and whether it is addressed by ICCID or by the provider's own id. |
| 6 | `TP_PATHS.usage` | Endpoint path for **daily usage** over a date range. |
| 7 | `TP_PATHS.setStatus` | Endpoint path **and verb** for a lifecycle change (`PUT /sims/{sim}/status` vs action sub-resources vs an async job handle to poll). |
| 8 | `TP_PATHS.setPlan` | Endpoint path for **bundle/plan assignment**, and whether it takes an opaque plan id rather than a name + MB. |
| 9 | `getUsage()` | **Query-parameter names** for the window (`from`/`to` vs `startDate`/`endDate` vs `period`), and whether the endpoint returns one row per SIM per day or an aggregate that must be requested day by day. |
| 10 | `readCollection()` / `NEXT_KEYS` / `#fetchAll()` | The **collection envelope** and the **pagination contract** (cursor / page+size / `Link` header). `MAX_PAGES = 50` is a safety stop, not a real limit. |
| 11 | `readDataMb()` | The **data-volume field name and its unit**. Getting this wrong misprices an invoice. |
| 12 | `readCostCents()` | Whether money is a **minor-unit integer or a major-unit decimal**, and whether the currency can be anything but EUR on our account. |
| 13 | `normalizeStatus()` | The **full status enumeration**. The current map covers the obvious names; the real machine likely has pre-activation / stock / barred states. Do not add speculative entries. |
| 14 | `toProviderSim()` | Every **SIM field spelling** (`iccid`, `imsi`, `msisdn`, plan, cycle dates, `lastSeen`, network, country). |
| 15 | `toProviderUsage()` | The **usage record shape**, in particular whether SMS is split MO/MT or reported as one total (a bare total is recorded as outbound, because outbound is what the SMS budget alarm watches). |

Until they are resolved, run with no token: everything works on cached rows.

---

## D. Read models

### `v_sim_inventory` — one row per SIM

All `sims` columns, plus the fitted device (`device_imei`, `device_status`,
`device_phone_number`, `iccid_mismatch`) and its vehicle (`vehicle_id`, `vehicle_code`,
`vehicle_status`), plus:

| Column | Meaning |
|---|---|
| `cycle_from` / `cycle_to` | the billing window; falls back to the calendar month when the provider has not told us the cycle |
| `data_used_mb_cycle`, `sms_out_cycle`, `sms_in_cycle`, `usage_cost_cycle_cents` | consumption inside that window |
| `data_pct_used` | `data_used_mb_cycle / plan_data_mb × 100`, null with no bundle |
| `data_mtd_mb`, `usage_cost_mtd_cents` | calendar-month-to-date |
| `cost_mtd_cents` | usage MTD **+ the recurring bundle fee** for an active SIM |
| `days_since_seen` | whole days since `last_seen_at`, null if never seen |
| `health` | the single verdict below |

**`health` precedence (first match wins):**

| Value | Condition | What it means |
|---|---|---|
| `ok` | `status <> 'active'` | inventory / suspended / terminated / test — not in service, nothing to watch |
| `over_limit` | cycle data ≥ bundle | over the allowance, being charged overage |
| `near_limit` | cycle data ≥ 80% of bundle | will overrun before the cycle ends |
| `unassigned` | active but `device_id is null` | paying a bundle for a SIM in a drawer |
| `silent` | never seen, or `last_seen_at` older than 7 days | device off, out of coverage, or the SIM has failed |
| `no_usage` | fitted and seen, but 0 MB this cycle | freshly swapped SIM, or a wrong APN |
| `ok` | everything else | |

A terminated SIM still linked to a device is deliberately **not** a health state — the
SIM itself is fine, it is the records that are stale. It surfaces in `v_sim_alerts`.

### `v_sim_usage_30d`

Per-SIM daily series for the last 30 days with `data_mb_cum` / `cost_cents_cum` running
totals — the detail-drawer chart.

### `v_sim_cost_summary`

Per calendar month: `sims_active`, `sims_with_usage`, `peak_sims_seen`,
`total_data_mb`, `total_sms_out` / `total_sms_in`, `usage_cost_cents`,
`subscription_cost_cents` (sum of `monthly_cost_cents` over the SIMs live that month),
`total_cost_cents`, `avg_cost_per_active_sim_cents`, `avg_data_mb_per_active_sim`.

The SMS side ties back to the **docs/03 budget alarm** ("> N SMS/day indicates GPRS
problems"): `sms_budget_per_day` is read **live** from the active `sms_budget`
notification rule, and `sms_budget_breach_days` counts the days that month that went
over it. Moving the threshold in the panel moves the reporting with it.

### `v_sim_alerts`

The actionable list, one row per problem, with `kind`, `severity`
(`critical`/`warning`/`info`), `severity_rank` for sorting, and a preformatted human
`reason`:

| kind | severity | fires when |
|---|---|---|
| `sim_over_limit` | critical | `health = 'over_limit'` |
| `sim_near_limit` | warning | `health = 'near_limit'` |
| `sim_silent` | warning | `health = 'silent'` |
| `sim_unassigned` | info | `health = 'unassigned'` |
| `sim_terminated_still_linked` | warning | `status = 'terminated'` and `device_id is not null` |

All four views are `revoke`d from `anon`/`authenticated` — service_role only.

---

## E. Alert rules (docs/12 §B additions)

Seeded into `notification_rules` in the docs/12 style. They mirror `v_sim_alerts`;
**the rule thresholds and the view must be changed together.**

| Event | Default condition | Default channels | Recipients |
|---|---|---|---|
| `sim_over_limit` | `{"pct":100,"scope":"cycle"}` | email + Telegram | admin, ops_manager |
| `sim_near_limit` | `{"pct":80,"scope":"cycle"}` | email (daily digest) | admin, ops_manager |
| `sim_silent` | `{"no_usage_days":7}` | email (daily digest), auto ops task | ops_manager |
| `sim_cost_spike` | `{"pct_over_trailing_3m":50,"min_cost_cents":2000}` | email (daily digest) | owner, accountant, admin |
| `sms_budget` | `{"per_day":500}` | email (daily digest) | admin |

`sms_budget` already ships in `00160_seed.sql` (docs/03); `00210` inserts it only if it
is missing, so `v_sim_cost_summary` always has a threshold to read. All inserts are
guarded on `event_kind`, so re-running the migration set does not duplicate rules.

---

## F. Edge functions

All three are staff-only via `requireStaff()`. Permissions added to `role_permissions`
by `00210`:

| Permission | owner | admin | ops_manager | support | accountant | readonly | ops |
|---|---|---|---|---|---|---|---|
| `sims.read` | ✔ (`*`) | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `sims.manage` | ✔ (`*`) | ✔ | ✔ | — | — | — | — |

`accountant` gets read because connectivity is a line item in the monthly cost report.
Field `ops` does not: SIM state is not actionable from the van.

### `sim-sync` — `sims.read`

```
POST { from?, to?, days?, provider? }
  → { live, reason?, provider, window:{from,to},
      sims_seen, sims_created, sims_updated, sims_failed,
      usage_rows, usage_unmatched, linked }
```

1. Load the local inventory into ICCID / provider-id maps.
2. `provider.listSims()` → insert new ICCIDs, patch existing rows. **A null field in the
   provider payload means "not reported", never "clear our value"** — only fields the
   provider actually sent are written. Lifecycle timestamps (`activated_at`,
   `suspended_at`, `terminated_at`) are stamped when the reported status *changes*.
3. `provider.getUsage(from, to)` → upsert `sim_usage_daily` on `(sim_id, day)`, in
   chunks of 500. Records for an unknown ICCID are counted as `usage_unmatched`, not
   guessed at. A provider that splits one day across records is deduped per `(sim, day)`.
4. **Auto-link** every SIM with `device_id is null` to the device whose `iccid` matches
   exactly, and back-fill `devices.sim_id`. Both updates are guarded with `is null`, so
   an existing link is never re-pointed. Each link writes `sim_events(kind='linked')`.
5. Write `sim_events(kind='synced')` for every SIM the provider returned.

Idempotent by construction: `sims` conflicts on `iccid`, `sim_usage_daily` on
`(sim_id, day)`, linking only fills nulls. Two runs back to back change nothing.

Read-level permission is intentional: sync **mirrors** provider state into our cache and
never changes anything *at* the provider.

### `sim-command` — `sims.manage`

```
POST { sim_id, action: 'activate'|'suspend'|'resume'|'terminate'|'set_plan',
       reason, plan?: { plan_name?, plan_data_mb?, monthly_cost_cents? } }
  → { ok, sim, action, live, provider_applied, reason?, provider_echo }
```

Order: validate → guard → **call the provider** → persist → `sim_events` → `audit_log`.
The provider goes first so we never record a state the operator did not actually reach.

- **`reason` is mandatory for `suspend` and `terminate`.** Both cost money to reverse,
  and a suspended SIM means a scooter that cannot be commanded over SMS.
- **Transition guard** (`invalid_transition`, 409): `activate` from
  inventory/test/suspended, `resume` only from suspended, `suspend` from active/test,
  `terminate` from anything not already terminated.
- **In-service guard** (`sim_in_service`, 409): a SIM fitted to a device whose vehicle
  is not `decommissioned` **cannot be terminated**. Termination kills the GPRS session
  *and* the SMS fallback, leaving the vehicle uncommandable. The error names the ICCID,
  the IMEI, the vehicle code and its status, and says what to do (decommission the
  vehicle, or swap the SIM out first).
- With no credentials the local row is still updated and the response carries
  `provider_applied: false` plus the reason, so the panel can show the truth rather than
  a green tick.
- `audit_log` gets action `sim.<action>`, entity `sims`, the before/after status + plan,
  and the reason (Hard Rule #8).

### `admin-sim-detail` — `sims.read`

```
POST { sim_id | iccid, event_limit? }
  → { sim, device, vehicle, usage_30d, events, alerts, provider:{name,live,reason?,sim,error?} }
```

The `v_sim_inventory` row, the 30-day chart series, the event log, the open alerts, the
fitted device + vehicle, and — when credentials exist — the provider's own live view so
an operator can see whether our cache is stale. A provider outage is surfaced as
`provider.error` rather than blanking the drawer. Accepts an ICCID as well as the uuid,
because an operator reading a physical label has the ICCID.

---

## G. Seed (dev / demo)

`00210` extends the existing seed (`00160`, `00190`) with 15 SIMs. Deterministic — ids
are `md5('penny-sim…')::uuid`, every "random" value comes from an md5 PRNG, so re-running
is a no-op and two machines produce identical rows.

The six seeded devices each get an active SIM on `IoT 500MB` (500 MB, 180 c/month) with
a 30-day cycle, and `devices.iccid` is rewritten to the SIM's ICCID so the exact-match
link is real. `sims.msisdn` equals the existing `devices.phone_number`.

Scenarios built in so the alert view and the health column have real rows on a fresh DB:

| SIM | Health | Story |
|---|---|---|
| PNY-1001, PNY-1003 | `ok` | ~1–3 MB/day, healthy |
| PNY-1002 | `near_limit` | ~84% of the bundle |
| PNY-1004 | `silent` | no network activity for 12 days |
| PNY-1005 | `over_limit` | chattering device, ~127% of the bundle; also one day with 37 SMS (GPRS flapped → everything fell back to SMS, the docs/03 signature) |
| PNY-1006 | `no_usage` | SIM swapped 2 days ago, online, no traffic yet |
| ex-PNY-1006 | `ok` (terminated) | the SIM it replaced — terminated but **still linked**, so `sim_terminated_still_linked` fires |
| hot spare | `unassigned` | active and billed, fitted to nothing |
| 6 spares | `ok` (inventory) | sealed stock; three carry 20-digit ICCIDs on purpose |
| ex-bench | `ok` (suspended) | suspended 9 days ago to stop the bundle fee |

The ICCIDs / IMSIs / MSISDNs are synthetic but correctly shaped (`8944…` IIN, mixed
19/20 digits). They are placeholders until the real inventory is exported from the
provider portal — resolving marker #4 above is what replaces them.

Verify on a fresh database:

```sql
select health, count(*) from v_sim_inventory group by 1;
select kind, severity, iccid, reason from v_sim_alerts;
select * from v_sim_cost_summary;
```

---

## H. Open items

- **Scheduled sync.** `sim-sync` is invoked on demand today. Once the API is verified,
  schedule it with `pg_cron` (hourly for inventory, daily for the previous day's usage)
  and fan its output into the alert rules.
- **Rule evaluation.** The `sim_*` rules are seeded but, like the rest of docs/12 §B,
  the evaluator that turns `v_sim_alerts` rows into `notification_log` sends is part of
  the notification-engine work, not this migration.
- **`sim_cost_spike`** has a rule row but no view column yet — it needs a trailing-3-month
  baseline per SIM. Add it to `v_sim_cost_summary` when the first real invoices land, so
  the baseline is calibrated against real numbers rather than seed data.
- **myDATA.** Connectivity is a cost, not revenue, so it is out of scope for the Greek
  e-invoicing work (docs/05) — but it belongs in the monthly owner report (docs/12 §B).
