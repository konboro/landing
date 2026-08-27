// admin-panel-data — everything the "long tail" admin pages need, in one call.
//
// Pricing, Marketing, Finance, Fleet, Team, Settings, Content and Analytics each
// read a handful of small catalogue tables. Fetching those from the browser is
// not an option: the v_admin_* views and most catalogues are service_role-only
// (migration 00140), so the panel would need ~40 edge calls. This is one
// permission check, one round trip, one payload.
//
// Everything returned is REAL. Where a table is genuinely empty the array comes
// back empty — the panel then shows an empty state, which is the truth. Nothing
// here fabricates rows to make a page look populated.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Read a whole (small) table. Catalogues are tens of rows, not thousands. */
async function all(
  admin: SupabaseClient,
  table: string,
  opts: { order?: string; asc?: boolean; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  let q = admin.from(table).select('*');
  if (opts.order) q = q.order(opts.order, { ascending: opts.asc ?? false });
  q = q.limit(opts.limit ?? 500);
  const { data, error } = await q;
  if (error) {
    // One missing catalogue must not blank the whole panel — the page that
    // needs it shows empty, every other page still works.
    console.error(`admin-panel-data: ${table}: ${error.message}`);
    return [];
  }
  return (data ?? []) as Record<string, unknown>[];
}

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  // Same gate as the list views: if you may not read the dashboard, you may not
  // read the catalogues behind it.
  await requireStaff(admin, callerId, 'dashboard.read');

  const [
    cities, models, batteryCurves, vehicles, devices,
    customers, rides, payments, debts,
    zones, zoneVersions, alerts, commands, opsTasks, damageReports, staff,
    ledgerAccounts, ledgerEntries, invoices, corporate,
    notificationRules, notificationLog,
    promos, groups, campaigns, referrals, pois,
    pricingPlans, packages, subscriptions, addons,
    translations, appConfig, appContent, faq,
    scanLog, maintenanceLog, batterySwaps, auditLog,
    loyaltyTiers, tripEventRows,
  ] = await Promise.all([
    all(admin, 'cities', { order: 'name', asc: true }),
    all(admin, 'vehicle_models', { order: 'name', asc: true }),
    all(admin, 'battery_curves'),
    all(admin, 'v_admin_vehicles', { order: 'code', asc: true }),
    all(admin, 'devices', { order: 'imei', asc: true }),
    all(admin, 'v_admin_customers', { order: 'created_at' }),
    all(admin, 'v_admin_rides', { order: 'started_at', limit: 500 }),
    all(admin, 'payments', { order: 'created_at', limit: 500 }),
    all(admin, 'debts', { order: 'created_at' }),
    all(admin, 'zones'),
    // Shaped for the history list below, which needs a zone count and the
    // operator's note — the table stores `payload` and `reason`.
    all(admin, 'zone_versions', { order: 'version' }),
    all(admin, 'vehicle_alerts', { order: 'created_at', limit: 200 }),
    all(admin, 'commands', { order: 'created_at', limit: 200 }),
    all(admin, 'ops_tasks', { order: 'created_at' }),
    all(admin, 'damage_reports', { order: 'created_at' }),
    all(admin, 'staff'),
    // The view, not the table: it carries the derived balance and the owner's
    // name, both of which the panel's LedgerAccount type declares and the table
    // has never had (migration 00500).
    all(admin, 'v_ledger_account_balances'),
    all(admin, 'ledger_entries', { order: 'created_at', limit: 500 }),
    all(admin, 'invoices', { order: 'created_at' }),
    all(admin, 'corporate_accounts'),
    all(admin, 'notification_rules'),
    all(admin, 'notification_log', { order: 'sent_at', limit: 200 }),
    all(admin, 'promo_codes'),
    all(admin, 'customer_groups'),
    all(admin, 'push_campaigns', { order: 'created_at' }),
    all(admin, 'referrals', { order: 'created_at' }),
    all(admin, 'pois'),
    all(admin, 'pricing_plans'),
    all(admin, 'packages'),
    all(admin, 'subscriptions'),
    all(admin, 'addons'),
    all(admin, 'translations'),
    all(admin, 'app_config'),
    all(admin, 'app_content'),
    all(admin, 'faq_items'),
    all(admin, 'scan_data_log', { order: 'at', limit: 200 }),
    all(admin, 'maintenance_log', { order: 'at', limit: 200 }),
    all(admin, 'battery_swaps', { order: 'at', limit: 200 }),
    all(admin, 'audit_log', { order: 'at', limit: 300 }),
    // The tier catalogue, which is what `loyalty` is typed as in the panel.
    // This used to read loyalty_accounts — per-user point balances, a different
    // shape entirely — so the Loyalty card rendered account rows through a tier
    // template and showed nothing. Per-user points belong to the customer
    // detail page, which gets them from admin-user-profile.
    all(admin, 'loyalty_tiers', { order: 'min_points', asc: true }),
    all(admin, 'trip_events', { order: 'at', limit: 1000 }),
  ]);

  // Its own table since migration 00490. It used to be a jsonb object under
  // app_config.penalties, read here through an Array.isArray guard it could
  // never satisfy — so the catalogue rendered empty whatever was configured.
  const penalties = await all(admin, 'penalties', { order: 'code', asc: true });

  // The zone history list reads `note` and `count`; the table has `reason` and
  // a `payload` array. Reading the raw row rendered "Δ vs v1: NaN zones" and an
  // empty note. `payload` rides along — rollback replays it.
  // `created_by` is a user id; the history line showed it raw, so every entry
  // read "2d05d0bd-7e6d-…" instead of naming who redrew the city.
  const authorIds = [...new Set(zoneVersions.map((v) => v.created_by).filter(Boolean))] as string[];
  const { data: authorRows } = authorIds.length
    ? await admin.from('users').select('id, full_name, email').in('id', authorIds)
    : { data: [] };
  const authorName = new Map(
    ((authorRows ?? []) as Array<{ id: string; full_name?: string; email?: string }>)
      .map((u) => [u.id, u.full_name || u.email || u.id]),
  );

  const zoneVersionsShaped = zoneVersions.map((v) => ({
    ...v,
    note: v.reason ?? '',
    count: Array.isArray(v.payload) ? v.payload.length : 0,
    created_by: authorName.get(String(v.created_by)) ?? String(v.created_by ?? '—'),
  }));

  // Each entry carries the kind of the account it hit, so the ledger explorer
  // can label "Stripe clearing +8.00 / User wallet −8.00" without a second
  // lookup. `account_kind` is on the panel's LedgerEntry type but not on the
  // table — reading it raw was what crashed the whole Finance page.
  const accountKind = new Map(ledgerAccounts.map((a) => [String(a.id), a.kind]));
  const ledgerEntriesLabelled = ledgerEntries.map((e) => ({
    ...e,
    account_kind: accountKind.get(String(e.account_id)) ?? null,
  }));

  // trip_events keyed by trip, the shape the ride timeline expects.
  const tripEvents: Record<string, unknown[]> = {};
  for (const e of tripEventRows) {
    const k = String(e.trip_id ?? '');
    if (!k) continue;
    (tripEvents[k] ??= []).push(e);
  }

  /* ---- Analytics, derived from real trips rather than invented ----
     These have no tables of their own; the panel used to read generated
     fixtures. Computing them here from `rides` keeps the pages honest: with no
     trips yet the charts are simply empty. */

  const revenueByDayMap = new Map<string, { date: string; revenue_cents: number; rides: number }>();
  for (const r of rides) {
    const started = typeof r.started_at === 'string' ? r.started_at.slice(0, 10) : null;
    if (!started) continue;
    const row = revenueByDayMap.get(started) ?? { date: started, revenue_cents: 0, rides: 0 };
    row.revenue_cents += Number(r.cost_cents ?? 0);
    row.rides += 1;
    revenueByDayMap.set(started, row);
  }
  const revenueByDay = [...revenueByDayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Heatmap cells: trip start/end points rounded to a ~250 m grid.
  const cell = (lng: number, lat: number) => `${lng.toFixed(3)}:${lat.toFixed(3)}`;
  const heat = new Map<string, { lng: number; lat: number; starts: number; ends: number }>();
  const bump = (pos: unknown, key: 'starts' | 'ends') => {
    const c = (pos as { coordinates?: [number, number] } | null)?.coordinates;
    if (!c) return;
    const id = cell(c[0], c[1]);
    const e = heat.get(id) ?? { lng: c[0], lat: c[1], starts: 0, ends: 0 };
    e[key] += 1;
    heat.set(id, e);
  };
  for (const r of rides) {
    bump(r.start_pos, 'starts');
    bump(r.end_pos, 'ends');
  }
  const heatCells = [...heat.values()];

  return json({
    cities, models, batteryCurves, vehicles, devices,
    customers, rides, payments, debts,
    zones, zoneVersions: zoneVersionsShaped, alerts, commands, opsTasks, damageReports, staff,
    ledgerAccounts, ledgerEntries: ledgerEntriesLabelled, invoices, corporate,
    notificationRules, notificationLog,
    promos, groups, campaigns, referrals, pois,
    pricingPlans, packages, subscriptions, addons, penalties,
    translations, appConfig, tutorials: appContent, faq,
    scanLog, maintenanceLog, batterySwaps, auditLog,
    loyalty: loyaltyTiers,
    tripEvents,
    revenueByDay, heatCells,
    generated_at: new Date().toISOString(),
  });
});

Deno.serve(handler);
