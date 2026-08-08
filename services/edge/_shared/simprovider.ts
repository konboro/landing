// simprovider.ts — the connectivity-provider boundary.
//
// Same idea as the gateway's `DeviceAdapter` (docs/03, Hard Rule #5): everything
// operator-specific lives behind one interface, so swapping Truphone/1GLOBAL for
// another MNO is a new implementation of `SimProvider` plus one line in
// `getSimProvider()` — no business logic, no SQL and no edge-function flow changes.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  READ THIS BEFORE THE FIRST REAL API CALL                                │
// │                                                                          │
// │  Truphone's IoT Connectivity REST API surface (base URL, auth scheme,    │
// │  endpoint paths, pagination style, JSON field names) is NOT reproduced   │
// │  from memory here — guessing it would produce code that looks right and  │
// │  silently does the wrong thing. Every place that needs a real value is   │
// │  marked `TODO(verify truphone api)`, exactly like the gateway's          │
// │  `TODO(verify wiki)` markers. docs/15 lists them all in one table.       │
// │                                                                          │
// │  The response readers below are deliberately TOLERANT: each field is     │
// │  looked up under several plausible spellings, and unknown shapes are     │
// │  skipped rather than crashing. First contact with the real API should    │
// │  be a small edit (add the real key names to a `pick()` list, fix a path) │
// │  and not a rewrite.                                                      │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Degradation contract: with no `TRUPHONE_API_TOKEN` the provider reports
// `live === false, reason === 'no_credentials'`. `listSims()` / `getUsage()`
// return `[]` and the mutating calls return `null`. Every sim-* edge function
// keeps working off the cached rows in `sims` / `sim_usage_daily`, and says so
// in its response. Nothing throws just because the integration is not wired yet.
//
// Hard Rule #10: ICCID / IMSI / MSISDN / provider ids are carried through as the
// EXACT text the provider sent. No trimming, no re-spacing, no numeric casts.
// Hard Rule #11: the API token is never logged, never echoed, never stored.

import { EdgeError } from './responses.ts';

/* ═══════════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════════ */

/** The lifecycle transitions a provider can be asked to perform. */
export type SimLifecycleStatus = 'active' | 'suspended' | 'terminated';

/** Our `sims.status` vocabulary (mirrors the sims_status_chk constraint). */
export type SimStatus = 'inventory' | 'active' | 'suspended' | 'terminated' | 'test';

/** How a SIM is addressed at the provider. ICCID always works; the provider's own id is faster. */
export interface SimRef {
  iccid: string;
  provider_sim_id?: string | null;
}

/** A SIM as the provider describes it, normalized onto our column names. */
export interface ProviderSim {
  iccid: string;
  imsi: string | null;
  msisdn: string | null;
  provider_sim_id: string | null;
  /** Normalized to SimStatus when recognizable, otherwise null (never guessed). */
  status: SimStatus | null;
  plan_name: string | null;
  plan_data_mb: number | null;
  /** YYYY-MM-DD. */
  cycle_start: string | null;
  cycle_end: string | null;
  monthly_cost_cents: number | null;
  /** ISO 8601 UTC. */
  last_seen_at: string | null;
  network: string | null;
  country: string | null;
  /** The untouched provider payload — kept for sim_events.detail while the mapping settles. */
  raw: Record<string, unknown>;
}

/** One provider usage bucket, already collapsed to a single UTC day. */
export interface ProviderUsageRow {
  iccid: string | null;
  provider_sim_id: string | null;
  /** YYYY-MM-DD. */
  day: string;
  data_mb: number;
  sms_out: number;
  sms_in: number;
  cost_cents: number;
  network: string | null;
  country: string | null;
}

export interface SimPlanChange {
  plan_name?: string | null;
  plan_data_mb?: number | null;
}

/**
 * The connectivity provider boundary. Implement this once per MNO.
 *
 * Implementations MUST NOT throw for "the integration is not configured": set
 * `live = false` + `reason` and return empty/null. They SHOULD throw an
 * `EdgeError('provider_error', …)` for a real API failure (5xx, bad auth on a
 * configured token), because that is a condition an operator must see.
 */
export interface SimProvider {
  /** Matches `sims.provider` — 'truphone', 'other', … */
  readonly name: string;
  /** True when credentials are present and calls will actually be made. */
  readonly live: boolean;
  /** Why the provider is not live: 'no_credentials' | 'no_base_url' | null. */
  readonly reason: string | null;

  listSims(): Promise<ProviderSim[]>;
  getSim(ref: SimRef): Promise<ProviderSim | null>;
  /** Inclusive YYYY-MM-DD window. */
  getUsage(from: string, to: string): Promise<ProviderUsageRow[]>;
  setStatus(ref: SimRef, status: SimLifecycleStatus): Promise<ProviderSim | null>;
  setPlan?(ref: SimRef, plan: SimPlanChange): Promise<ProviderSim | null>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tolerant readers — every provider spells these differently.
   ═══════════════════════════════════════════════════════════════════════════ */

type Json = Record<string, unknown>;

function isJson(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** First non-empty value among `keys`, searched case-insensitively, one level deep. */
export function pick(o: Json, keys: string[]): unknown {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(o)) lower.set(k.toLowerCase(), v);
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Exact text, never reformatted (Hard Rule #10). Numbers are stringified as-is. */
export function pickText(o: Json, keys: string[]): string | null {
  const v = pick(o, keys);
  if (v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return null;
}

export function pickNumber(o: Json, keys: string[]): number | null {
  const v = pick(o, keys);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** ISO 8601 UTC, or null when the value is not a parseable instant. */
export function pickTimestamp(o: Json, keys: string[]): string | null {
  const v = pick(o, keys);
  if (typeof v === 'number') {
    // Epoch seconds vs milliseconds — anything below ~1e11 is seconds.
    const ms = v < 1e11 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** YYYY-MM-DD, or null. */
export function pickDate(o: Json, keys: string[]): string | null {
  const ts = pickTimestamp(o, keys);
  return ts ? ts.slice(0, 10) : null;
}

/**
 * Data volume in megabytes. Providers report bytes, kB, MB or GB under a dozen
 * different names; whichever unit we find, we normalize to MB (1 MB = 1e6 bytes,
 * the unit carriers bill in).
 *
 * TODO(verify truphone api): confirm the actual field name AND unit on the usage
 * endpoint before trusting these numbers on an invoice.
 */
export function readDataMb(o: Json): number {
  const bytes = pickNumber(o, ['bytes', 'dataBytes', 'volumeBytes', 'totalBytes', 'data_volume_bytes']);
  if (bytes !== null) return round3(bytes / 1e6);
  const kb = pickNumber(o, ['kb', 'kilobytes', 'dataKb', 'volumeKb', 'data_kb']);
  if (kb !== null) return round3(kb / 1000);
  const mb = pickNumber(o, ['mb', 'megabytes', 'dataMb', 'dataVolume', 'volume', 'volumeMb', 'data_mb', 'usageMb']);
  if (mb !== null) return round3(mb);
  const gb = pickNumber(o, ['gb', 'gigabytes', 'dataGb', 'volumeGb', 'data_gb']);
  if (gb !== null) return round3(gb * 1000);
  return 0;
}

/** Bundle allowance in MB, same unit tolerance as readDataMb. */
export function readPlanDataMb(o: Json): number | null {
  const bytes = pickNumber(o, ['bundleBytes', 'allowanceBytes', 'planBytes', 'quotaBytes']);
  if (bytes !== null) return Math.round(bytes / 1e6);
  const mb = pickNumber(o, ['bundleMb', 'allowanceMb', 'planDataMb', 'quotaMb', 'dataAllowanceMb', 'plan_data_mb']);
  if (mb !== null) return Math.round(mb);
  const gb = pickNumber(o, ['bundleGb', 'allowanceGb', 'planDataGb', 'quotaGb', 'dataAllowanceGb']);
  if (gb !== null) return Math.round(gb * 1000);
  return null;
}

/**
 * Money in EUR cents. Accepts a minor-unit integer or a major-unit decimal —
 * `costCents`/`amountMinor` are taken literally, `cost`/`price`/`amount` are
 * treated as a decimal amount and multiplied by 100.
 *
 * TODO(verify truphone api): confirm which representation the API returns and
 * whether the currency can be anything other than EUR for our account.
 */
export function readCostCents(o: Json): number {
  const minor = pickNumber(o, ['costCents', 'amountMinor', 'priceCents', 'costMinor', 'cost_cents']);
  if (minor !== null) return Math.round(minor);
  const major = pickNumber(o, ['cost', 'price', 'amount', 'charge', 'totalCost', 'monthlyCost']);
  if (major !== null) return Math.round(major * 100);
  return 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Map a provider status string onto our vocabulary. Anything unrecognized returns
 * null — the caller then LEAVES `sims.status` alone rather than inventing a state.
 *
 * TODO(verify truphone api): the real state machine almost certainly has more
 * states than this (pre-activation / test / stock / barred / …). Extend the map
 * once the enumeration is confirmed; do not add speculative entries.
 */
export function normalizeStatus(raw: string | null): SimStatus | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const map: Record<string, SimStatus> = {
    active: 'active',
    activated: 'active',
    live: 'active',
    enabled: 'active',
    in_use: 'active',
    suspended: 'suspended',
    suspend: 'suspended',
    paused: 'suspended',
    barred: 'suspended',
    disabled: 'suspended',
    terminated: 'terminated',
    deactivated: 'terminated',
    cancelled: 'terminated',
    canceled: 'terminated',
    deleted: 'terminated',
    inventory: 'inventory',
    stock: 'inventory',
    in_stock: 'inventory',
    available: 'inventory',
    pre_activation: 'inventory',
    preactive: 'inventory',
    test: 'test',
  };
  return map[s] ?? null;
}

/**
 * Pull the array of records out of a response body. Providers wrap collections
 * in `data` / `items` / `results` / `content` / an embedded HAL object, or return
 * a bare array.
 *
 * TODO(verify truphone api): confirm the collection envelope and the pagination
 * contract (cursor? page/size? Link header?) — `fetchAll()` below only follows
 * the shapes listed in `NEXT_KEYS`.
 */
export function readCollection(body: unknown): Json[] {
  if (Array.isArray(body)) return body.filter(isJson);
  if (!isJson(body)) return [];
  for (const key of ['data', 'items', 'results', 'content', 'sims', 'usage', 'records', 'list']) {
    const v = body[key];
    if (Array.isArray(v)) return v.filter(isJson);
  }
  // HAL / _embedded style.
  const embedded = body['_embedded'];
  if (isJson(embedded)) {
    for (const v of Object.values(embedded)) {
      if (Array.isArray(v)) return v.filter(isJson);
    }
  }
  return [];
}

/** Unwrap a single-object response that may be nested under `data` / `sim` / … */
export function readObject(body: unknown): Json | null {
  if (!isJson(body)) return null;
  for (const key of ['data', 'sim', 'item', 'result', 'subscription']) {
    const v = body[key];
    if (isJson(v)) return v;
  }
  return body;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Truphone / 1GLOBAL implementation
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Endpoint paths. EVERY ONE OF THESE IS A PLACEHOLDER.
 *
 * TODO(verify truphone api): replace each path with the documented one from the
 * 1GLOBAL/Truphone IoT Connectivity API reference. `{sim}` is substituted with
 * `provider_sim_id` when we have it, otherwise with the ICCID.
 */
const TP_PATHS = {
  /** TODO(verify truphone api): list/search SIMs for the account. */
  listSims: '/sims',
  /** TODO(verify truphone api): fetch a single SIM. */
  getSim: '/sims/{sim}',
  /** TODO(verify truphone api): daily usage over a date range. */
  usage: '/usage/daily',
  /** TODO(verify truphone api): lifecycle change — may be PUT /sims/{sim}/status, or per-action POSTs. */
  setStatus: '/sims/{sim}/status',
  /** TODO(verify truphone api): bundle/plan assignment. */
  setPlan: '/sims/{sim}/plan',
} as const;

/**
 * Keys a paginated response may expose to point at the next page.
 * TODO(verify truphone api): confirm the pagination contract.
 */
const NEXT_KEYS = ['next', 'nextPage', 'nextPageUrl', 'next_url', 'nextCursor'];

/** Hard stop so a misread pagination contract can never spin forever. */
const MAX_PAGES = 50;

class TruphoneProvider implements SimProvider {
  readonly name = 'truphone';
  readonly live: boolean;
  readonly reason: string | null;

  #base: string;
  #token: string;
  #accountId: string | null;

  constructor(base: string, token: string, accountId: string | null) {
    this.#base = base.replace(/\/+$/, '');
    this.#token = token;
    this.#accountId = accountId;
    this.live = true;
    this.reason = null;
  }

  /**
   * TODO(verify truphone api): auth scheme. Implemented as `Authorization: Bearer
   * <TRUPHONE_API_TOKEN>`; if the real API uses an API-key header, HTTP Basic, or
   * an OAuth2 client-credentials exchange, this is the ONE place to change.
   * TODO(verify truphone api): whether the account/organisation id belongs in the
   * path, a query parameter, or a header — it is sent as a header here.
   */
  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const url = path.startsWith('http') ? path : `${this.#base}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.#token}`,
      'Accept': 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.#accountId ? { 'X-Account-Id': this.#accountId } : {}),
    };

    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      // Never include the header set in the message — it carries the token.
      throw new EdgeError('provider_unreachable', `truphone request failed: ${(e as Error).message}`, 502);
    }

    const text = await res.text();
    if (!res.ok) {
      // Body may echo the request; truncate and keep the token out of the log.
      throw new EdgeError('provider_error', `truphone ${res.status} on ${path}: ${text.slice(0, 300)}`, 502);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new EdgeError('provider_error', `truphone returned non-JSON on ${path}`, 502);
    }
  }

  /** Follow pages while the body advertises a next one. */
  async #fetchAll(path: string): Promise<Json[]> {
    const out: Json[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const body: unknown = await this.#request(next);
      out.push(...readCollection(body));
      next = null;
      if (isJson(body)) {
        const n = pick(body, NEXT_KEYS);
        if (typeof n === 'string') next = n;
        const links = body['_links'];
        if (!next && isJson(links)) {
          const l = links['next'];
          if (typeof l === 'string') next = l;
          else if (isJson(l) && typeof l['href'] === 'string') next = l['href'] as string;
        }
      }
    }
    return out;
  }

  #ref(ref: SimRef): string {
    // Prefer the provider's own id; fall back to the ICCID. Encoded, not reformatted.
    return encodeURIComponent(ref.provider_sim_id || ref.iccid);
  }

  async listSims(): Promise<ProviderSim[]> {
    const rows = await this.#fetchAll(TP_PATHS.listSims);
    return rows.map(toProviderSim).filter((s): s is ProviderSim => s !== null);
  }

  async getSim(ref: SimRef): Promise<ProviderSim | null> {
    const body = await this.#request(TP_PATHS.getSim.replace('{sim}', this.#ref(ref)));
    const obj = readObject(body);
    return obj ? toProviderSim(obj) : null;
  }

  /**
   * TODO(verify truphone api): query-parameter names for the date window
   * (`from`/`to` vs `startDate`/`endDate` vs `period`), and whether the endpoint
   * returns one row per SIM per day or a single aggregate per SIM that has to be
   * requested day by day. `toProviderUsage()` handles the per-day-row shape.
   */
  async getUsage(from: string, to: string): Promise<ProviderUsageRow[]> {
    const qs = new URLSearchParams({ from, to });
    const rows = await this.#fetchAll(`${TP_PATHS.usage}?${qs.toString()}`);
    return rows.map(toProviderUsage).filter((r): r is ProviderUsageRow => r !== null);
  }

  /**
   * TODO(verify truphone api): the request body / verb for a lifecycle change.
   * Sent here as `PUT {status: 'active'|'suspended'|'terminated'}`; the real API
   * may want `{state: 'ACTIVE'}`, an action sub-resource (`POST /sims/{id}/suspend`),
   * or an asynchronous job handle that has to be polled.
   */
  async setStatus(ref: SimRef, status: SimLifecycleStatus): Promise<ProviderSim | null> {
    const body = await this.#request(TP_PATHS.setStatus.replace('{sim}', this.#ref(ref)), {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    const obj = readObject(body);
    return obj ? toProviderSim(obj) : null;
  }

  /**
   * TODO(verify truphone api): plan/bundle assignment is usually by an opaque
   * plan/tariff id rather than a name. Until that is confirmed we send both the
   * name and the MB allowance and let the caller record what it asked for.
   */
  async setPlan(ref: SimRef, plan: SimPlanChange): Promise<ProviderSim | null> {
    const body = await this.#request(TP_PATHS.setPlan.replace('{sim}', this.#ref(ref)), {
      method: 'PUT',
      body: JSON.stringify({ plan_name: plan.plan_name ?? null, plan_data_mb: plan.plan_data_mb ?? null }),
    });
    const obj = readObject(body);
    return obj ? toProviderSim(obj) : null;
  }
}

/* ---------------------------------------------------------------------------
   Response mappers. One place to fix when the real field names are known.
   --------------------------------------------------------------------------- */

/**
 * TODO(verify truphone api): every `pick*()` key list below is a guess at the
 * spelling. A record with no recognizable ICCID is DROPPED rather than stored
 * under a wrong key — silently mislinking a SIM to a device is worse than a gap.
 */
export function toProviderSim(o: Json): ProviderSim | null {
  const iccid = pickText(o, ['iccid', 'ICCID', 'icc', 'simIccid', 'sim_iccid', 'cardId']);
  if (!iccid) return null;
  return {
    iccid, // exact text — Hard Rule #10
    imsi: pickText(o, ['imsi', 'IMSI', 'simImsi']),
    msisdn: pickText(o, ['msisdn', 'MSISDN', 'phoneNumber', 'phone_number', 'number']),
    provider_sim_id: pickText(o, ['id', 'simId', 'sim_id', 'uuid', 'href', 'self', 'resourceId']),
    status: normalizeStatus(pickText(o, ['status', 'state', 'simState', 'lifecycleState', 'sim_status'])),
    plan_name: pickText(o, ['planName', 'plan', 'bundleName', 'tariff', 'tariffName', 'productName', 'plan_name']),
    plan_data_mb: readPlanDataMb(o),
    cycle_start: pickDate(o, ['cycleStart', 'billingCycleStart', 'periodStart', 'cycle_start', 'startDate']),
    cycle_end: pickDate(o, ['cycleEnd', 'billingCycleEnd', 'periodEnd', 'cycle_end', 'endDate']),
    monthly_cost_cents: pick(o, ['monthlyCost', 'recurringCost', 'monthlyCostCents', 'subscriptionFee']) !== undefined
      ? readCostCents(o)
      : null,
    last_seen_at: pickTimestamp(o, ['lastSeen', 'lastSeenAt', 'lastActivity', 'lastConnected', 'last_seen_at', 'lastUsedAt']),
    network: pickText(o, ['network', 'operator', 'currentNetwork', 'plmn', 'networkName', 'carrier']),
    country: pickText(o, ['country', 'countryCode', 'mccCountry', 'currentCountry', 'iso2']),
    raw: o,
  };
}

/**
 * TODO(verify truphone api): the usage record shape. In particular whether SMS is
 * split into MO/MT (`smsOut`/`smsIn`) or reported as one total — when only a total
 * is present it is recorded as outbound, because outbound is what the docs/03 SMS
 * budget alarm cares about.
 */
export function toProviderUsage(o: Json): ProviderUsageRow | null {
  const day = pickDate(o, ['day', 'date', 'usageDate', 'periodStart', 'timestamp', 'from']);
  if (!day) return null;
  const iccid = pickText(o, ['iccid', 'ICCID', 'simIccid', 'sim_iccid']);
  const providerSimId = pickText(o, ['simId', 'sim_id', 'id', 'subscriptionId']);
  if (!iccid && !providerSimId) return null;

  const smsOut = pickNumber(o, ['smsOut', 'smsMo', 'sms_out', 'smsSent', 'moSms']);
  const smsIn = pickNumber(o, ['smsIn', 'smsMt', 'sms_in', 'smsReceived', 'mtSms']);
  const smsTotal = pickNumber(o, ['sms', 'smsCount', 'smsTotal', 'sms_count']);

  return {
    iccid,
    provider_sim_id: providerSimId,
    day,
    data_mb: readDataMb(o),
    sms_out: Math.round(smsOut ?? (smsOut === null && smsIn === null ? (smsTotal ?? 0) : 0)),
    sms_in: Math.round(smsIn ?? 0),
    cost_cents: readCostCents(o),
    network: pickText(o, ['network', 'operator', 'plmn', 'networkName', 'carrier']),
    country: pickText(o, ['country', 'countryCode', 'iso2', 'mccCountry']),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Offline provider — the graceful-degradation path
   ═══════════════════════════════════════════════════════════════════════════ */

class OfflineProvider implements SimProvider {
  readonly name: string;
  readonly live = false;
  readonly reason: string;

  constructor(name: string, reason: string) {
    this.name = name;
    this.reason = reason;
  }

  listSims(): Promise<ProviderSim[]> {
    return Promise.resolve([]);
  }
  getSim(): Promise<ProviderSim | null> {
    return Promise.resolve(null);
  }
  getUsage(): Promise<ProviderUsageRow[]> {
    return Promise.resolve([]);
  }
  setStatus(): Promise<ProviderSim | null> {
    return Promise.resolve(null);
  }
  setPlan(): Promise<ProviderSim | null> {
    return Promise.resolve(null);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Factory
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Resolve the connectivity provider from the environment.
 *
 *   TRUPHONE_API_BASE    base URL of the IoT Connectivity API
 *                        TODO(verify truphone api): the real base URL + version prefix.
 *   TRUPHONE_API_TOKEN   bearer token (absent ⇒ offline mode, everything still works)
 *   TRUPHONE_ACCOUNT_ID  optional account/organisation id
 *
 * Adding an MNO: write `class FooProvider implements SimProvider`, and branch here
 * on an env var or on `sims.provider`. Nothing else in the codebase changes.
 */
export function getSimProvider(providerName = 'truphone'): SimProvider {
  if (providerName !== 'truphone') {
    return new OfflineProvider(providerName, 'unsupported_provider');
  }
  const base = Deno.env.get('TRUPHONE_API_BASE');
  const token = Deno.env.get('TRUPHONE_API_TOKEN');
  const accountId = Deno.env.get('TRUPHONE_ACCOUNT_ID') ?? null;

  if (!token) return new OfflineProvider('truphone', 'no_credentials');
  if (!base) return new OfflineProvider('truphone', 'no_base_url');
  return new TruphoneProvider(base, token, accountId);
}
