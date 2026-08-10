// admin-list — paginated reads of the admin-only list views.
//
// Hard Rule #6: the panel talks to edge functions, never to the database with
// elevated rights. The `v_admin_*` views are service_role-only on purpose —
// granting them to `authenticated` would let ANY signed-in rider read every
// customer, ride and vehicle. So the panel asks here, and this function checks
// staff membership + permission before running the query with service_role.
//
// The view name is matched against a whitelist; nothing else is reachable.

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num } from '../../_shared/validate.ts';

interface ViewSpec {
  /** Permission the caller must hold. */
  permission: string;
  /** Columns `search` is matched against (ilike). */
  search: string[];
  /** Applied when the caller sends no sort. */
  defaultSort: { field: string; asc: boolean };
  /** Columns a caller may filter/sort on. Everything else is rejected. */
  columns?: string[];
}

const VIEWS: Record<string, ViewSpec> = {
  v_admin_vehicles: {
    permission: 'vehicles.read',
    search: ['code', 'model_name', 'imei', 'plate', 'vin', 'city_name'],
    defaultSort: { field: 'last_seen', asc: false },
  },
  v_admin_rides: {
    permission: 'rides.read',
    search: ['id', 'user_name', 'user_phone', 'vehicle_code', 'city_name'],
    defaultSort: { field: 'started_at', asc: false },
  },
  v_admin_customers: {
    permission: 'customers.read',
    search: ['phone', 'email', 'full_name', 'legacy_atom_user_id'],
    defaultSort: { field: 'created_at', asc: false },
  },
  v_admin_kpis: {
    permission: 'dashboard.read',
    search: [],
    defaultSort: { field: 'active_rides', asc: false },
  },
  v_ride_verification_queue: {
    permission: 'rides.read',
    search: [],
    defaultSort: { field: 'ended_at', asc: false },
  },
  v_sim_inventory: {
    permission: 'sims.read',
    search: ['iccid', 'imsi', 'msisdn', 'provider_sim_id', 'device_imei', 'vehicle_code', 'label', 'plan_name'],
    defaultSort: { field: 'data_pct_used', asc: false },
  },
  // Both are built on the same service_role-only SIM tables as v_sim_inventory
  // (migration 00210 revokes them from anon/authenticated), so they have to come
  // through here rather than straight from the panel's anon client.
  v_sim_alerts: {
    permission: 'sims.read',
    search: ['iccid', 'msisdn', 'label', 'vehicle_code', 'device_imei'],
    defaultSort: { field: 'severity_rank', asc: true },
  },
  v_sim_cost_summary: {
    permission: 'sims.read',
    search: [],
    defaultSort: { field: 'month', asc: false },
  },
  // Broadcast history. Gated on the send permission rather than a read one:
  // the rows spell out who was targeted with what, which is not something a
  // support agent needs in order to answer one rider.
  v_admin_broadcasts: {
    permission: 'notifications.send',
    search: ['title', 'body', 'audience_label', 'created_by_name'],
    defaultSort: { field: 'created_at', asc: false },
  },
  v_admin_customer_groups: {
    permission: 'customers.read',
    search: ['name'],
    defaultSort: { field: 'name', asc: true },
  },
  // Digital lines per telemetry frame. Polled by the vehicle IO monitor, so
  // keep the default sort newest-first — the panel asks for limit 1 to get
  // "now" and a larger limit for the recent trace.
  v_vehicle_io: {
    permission: 'vehicles.read',
    search: [],
    defaultSort: { field: 'at', asc: false },
  },
  /* Config catalogues the panel edits through admin-write. Read here so the
     same permission gates both directions. */
  pricing_plans: {
    permission: 'pricing.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  packages: {
    permission: 'pricing.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  subscriptions: {
    permission: 'pricing.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  addons: {
    permission: 'pricing.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  penalties: {
    permission: 'pricing.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  promo_codes: {
    permission: 'settings.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  loyalty_tiers: {
    permission: 'settings.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  faq_items: {
    permission: 'settings.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  app_content: {
    permission: 'settings.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  pois: {
    permission: 'settings.edit',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  corporate_accounts: {
    permission: 'team.manage',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  audit_log: {
    permission: 'audit.read',
    search: ['action', 'entity', 'entity_id', 'reason'],
    defaultSort: { field: 'at', asc: false },
  },

  /* ---- Detail pages ----
     Ride / vehicle / customer detail read these filtered by a single parent id.
     They are service_role-only tables, so the panel cannot query them directly;
     each still demands the same permission as the list it hangs off. */
  trip_events: {
    permission: 'rides.read',
    search: [],
    defaultSort: { field: 'at', asc: true },
  },
  // One row per trip holding the whole path as a LineString — not one row per
  // GPS point, which is why this sorts on updated_at and not a timestamp.
  trip_routes: {
    permission: 'rides.read',
    search: [],
    defaultSort: { field: 'updated_at', asc: false },
  },
  payments: {
    permission: 'rides.read',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  commands: {
    permission: 'vehicles.read',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  vehicle_alerts: {
    permission: 'vehicles.read',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  damage_reports: {
    permission: 'vehicles.read',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  devices: {
    permission: 'vehicles.read',
    search: ['imei', 'iccid', 'phone_number'],
    defaultSort: { field: 'imei', asc: true },
  },
  ledger_accounts: {
    permission: 'customers.read',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  ledger_entries: {
    permission: 'customers.read',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  debts: {
    permission: 'customers.read',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
  referrals: {
    permission: 'customers.read',
    search: [],
    defaultSort: { field: 'created_at', asc: false },
  },
};

/** Reject anything that isn't a plain column identifier. */
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);

  const body = await readJson(req);
  const view = str(body, 'view')!;
  const spec = VIEWS[view];
  if (!spec) throw new EdgeError('bad_request', `unknown view: ${view}`, 400);

  await requireStaff(admin, callerId, spec.permission);

  const limit = Math.min(num(body, 'limit', false) ?? 25, 500);
  const offset = num(body, 'offset', false) ?? 0;
  const search = (str(body, 'search', false) ?? '').trim();
  const filters = (body.filters ?? {}) as Record<string, unknown>;
  const sort = Array.isArray(body.sort)
    ? (body.sort as Array<{ field?: unknown; dir?: unknown }>)
    : [];

  let q = admin.from(view).select('*', { count: 'exact' });

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    if (!SAFE_IDENT.test(key)) throw new EdgeError('bad_request', `bad filter column: ${key}`, 400);
    q = q.eq(key, value as string | number | boolean);
  }

  if (search && spec.search.length) {
    // Identifiers (ICCID/IMEI/phone) are matched verbatim — never reformatted.
    const like = `%${search.replaceAll(',', '')}%`;
    q = q.or(spec.search.map((c) => `${c}.ilike.${like}`).join(','));
  }

  let sorted = false;
  for (const s of sort) {
    const field = typeof s.field === 'string' ? s.field : '';
    if (!SAFE_IDENT.test(field)) continue;
    q = q.order(field, { ascending: s.dir === 'asc' });
    sorted = true;
  }
  if (!sorted) q = q.order(spec.defaultSort.field, { ascending: spec.defaultSort.asc, nullsFirst: false });

  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw new EdgeError('db_error', error.message, 500);

  return json({
    rows: data ?? [],
    total: count ?? (data ?? []).length,
    limit,
    offset,
  });
});

Deno.serve(handler);
