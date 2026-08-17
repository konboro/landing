// Production data source. Wires @penny/api-client (repos + edge fns). Reads that
// depend on admin-only views/tables are marked TODO for the Supabase wiring day;
// the panel defaults to MockDataSource so this file only runs when
// VITE_DATA_SOURCE=supabase is explicitly set.
import { createPennyClient, type PennyClient } from '@penny/api-client';
import type {
  BrandConfig,
  DataSource,
  MydataAction,
  MydataDetail,
  RideDetail,
  SimCommandInput,
  SimDetail,
  SimSyncResult,
  VehicleDetail,
  VehicleHistory,
  CustomerDetail,
  AdminChargeInput,
  AuditInput,
  BroadcastInput,
  BroadcastResult,
  CreateVehicleInput,
  SearchResult,
  MessageThread,
  ChatMessage,
  ConfigTable,
  ConfigKey,
} from './api';
import type { Page, QueryParams } from './query';
import { toVehicleRideRow, toTimelineEvent } from './rideHistoryMapper';
import type { PanelData } from './panelData';
import type { Command, VehicleAlert, Zone, TripEvent, LngLat } from '@penny/db-types';
import type {
  KpiSnapshot,
  RideRow,
  VehicleRow,
  CustomerRow,
  VerificationItem,
  AuditLogEntry,
  Payment,
  Debt,
  LedgerEntry,
  DamageReport,
  Referral,
  UserProfileFull,
  UserRideHistoryRow,
  VehicleRideHistoryRow,
  VehicleIoFrame,
  VehicleHistorySnapshot,
  SumsubProfileBundle,
  TimelineEvent,
  SimAlert,
  SimCostSummary,
  SimInventoryRow,
  BroadcastRow,
  CustomerGroupRow,
  MydataState,
  MydataSubmission,
  MydataHealth,
  MydataShadowDay,
  PaymentReceipt,
  UUID,
} from '@/types/domain';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid goes over the wire as `id`; a composite key as `key`. */
function configKey(key: ConfigKey): { id: string } | { key: Record<string, string> } {
  return typeof key === 'string' ? { id: key } : { key };
}

function notImpl(method: string): never {
  throw new Error(
    `SupabaseDataSource.${method}() is not wired yet — implement against the panel views/edge fns during the Supabase integration. Use VITE_DATA_SOURCE=mock to run the panel now.`,
  );
}

export class SupabaseDataSource implements DataSource {
  readonly kind = 'supabase' as const;
  private client: PennyClient;

  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required for SupabaseDataSource.');
    }
    this.client = createPennyClient({
      url,
      anonKey: anon,
      auth: { storage: window.localStorage, storageKey: 'penny-admin-auth', detectSessionInUrl: true },
    });
  }

  /* ---- List pages ----
     Each reads exactly ONE admin view whose columns match the row type
     (migration 00220), so sort / filter / search / pagination push down into
     Postgres instead of being done in the browser. */

  /** Shared list reader. Goes through the `admin-list` edge function, which
   *  checks staff permission and runs the query with service_role — the
   *  v_admin_* views are deliberately unreadable with the anon key. */
  private async listFrom<T>(view: string, params: QueryParams): Promise<Page<T>> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = params.pageSize ?? 25;
    const res = await this.invoke<{ rows: T[]; total: number }>('admin-list', {
      view,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sort: params.sort ?? [],
      search: params.search ?? '',
      filters: params.filters ?? {},
    });
    return { rows: res.rows ?? [], total: res.total ?? 0, page, pageSize };
  }

  async getKpis(): Promise<KpiSnapshot> {
    const res = await this.invoke<{ rows: Record<string, unknown>[] }>('admin-list', {
      view: 'v_admin_kpis', limit: 1, offset: 0,
    });
    const k = res.rows?.[0];
    if (!k) throw new Error('v_admin_kpis returned no row');
    const arr = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : []);
    return {
      active_rides: Number(k.active_rides ?? 0),
      today_revenue_cents: Number(k.today_revenue_cents ?? 0),
      today_rides: Number(k.today_rides ?? 0),
      new_users_today: Number(k.new_users_today ?? 0),
      open_debts_cents: Number(k.open_debts_cents ?? 0),
      open_debts_count: Number(k.open_debts_count ?? 0),
      unlock_success_pct: Number(k.unlock_success_pct ?? 0),
      fleet_by_status: (k.fleet_by_status ?? {}) as Record<string, number>,
      spark_revenue: arr(k.spark_revenue),
      spark_rides: arr(k.spark_rides),
      spark_users: arr(k.spark_users),
      spark_unlock: arr(k.spark_unlock),
    };
  }
  async getAlerts(): Promise<VehicleAlert[]> {
    const { data, error } = await this.client.supabase.from('vehicle_alerts').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []) as VehicleAlert[];
  }
  async getLiveVehicles(): Promise<VehicleRow[]> {
    const res = await this.invoke<{ rows: VehicleRow[] }>('admin-list', {
      view: 'v_admin_vehicles', limit: 500, offset: 0, filters: { visible: true },
    });
    return res.rows ?? [];
  }
  async listRides(params: QueryParams): Promise<Page<RideRow>> {
    return this.listFrom<RideRow>('v_admin_rides', params);
  }
  async getRide(id: string): Promise<RideDetail | null> {
    // One ride, read through the same view the list uses so the row shape is
    // identical and the detail page never disagrees with the table it came from.
    const res = await this.invoke<{ rows: RideRow[] }>('admin-list', {
      view: 'v_admin_rides', limit: 1, offset: 0, filters: { id },
    });
    const ride = res.rows?.[0];
    if (!ride) return null;

    const [events, payments, route] = await Promise.all([
      this.invoke<{ rows: TripEvent[] }>('admin-list', {
        view: 'trip_events', limit: 200, offset: 0, filters: { trip_id: id },
        sort: [{ field: 'at', dir: 'asc' }],
      }).then((r) => r.rows ?? []).catch(() => [] as TripEvent[]),
      this.invoke<{ rows: Payment[] }>('admin-list', {
        view: 'payments', limit: 50, offset: 0, filters: { trip_id: id },
      }).then((r) => r.rows ?? []).catch(() => [] as Payment[]),
      // trip_routes stores ONE row per trip whose `path` is the whole LineString,
      // not a row per GPS point — so this reads a single row and unpacks it.
      this.invoke<{ rows: Array<{ path?: { coordinates?: LngLat[] } }> }>('admin-list', {
        view: 'trip_routes', limit: 1, offset: 0, filters: { trip_id: id },
      }).then((r) => (r.rows?.[0]?.path?.coordinates ?? []) as LngLat[])
        .catch(() => [] as LngLat[]),
    ]);

    // Telemetry for the speed/battery chart is per-device and time-ranged;
    // the ride page renders the route without it rather than blocking on a
    // query across the partitioned telemetry table.
    return { ride, events, route, telemetry: [], payments };
  }
  async listVerification(): Promise<VerificationItem[]> {
    const res = await this.invoke<{ rows: VerificationItem[] }>('admin-list', {
      view: 'v_ride_verification_queue', limit: 200, offset: 0,
    });
    return res.rows ?? [];
  }
  async listVehicles(params: QueryParams): Promise<Page<VehicleRow>> {
    return this.listFrom<VehicleRow>('v_admin_vehicles', params);
  }
  async getVehicle(id: string): Promise<VehicleDetail | null> {
    const res = await this.invoke<{ rows: VehicleRow[] }>('admin-list', {
      view: 'v_admin_vehicles', limit: 1, offset: 0, filters: { id },
    });
    const vehicle = res.rows?.[0];
    if (!vehicle) return null;

    const rows = async <T,>(view: string, filters: Record<string, unknown>, limit = 100, sort?: string) =>
      this.invoke<{ rows: T[] }>('admin-list', {
        view, limit, offset: 0, filters,
        ...(sort ? { sort: [{ field: sort, dir: 'desc' }] } : {}),
      }).then((r) => r.rows ?? []).catch(() => [] as T[]);

    const [commands, alerts, rides, damage, devices] = await Promise.all([
      rows<Command>('commands', { vehicle_id: id }, 100, 'created_at'),
      rows<VehicleAlert>('vehicle_alerts', { vehicle_id: id }, 100, 'created_at'),
      rows<RideRow>('v_admin_rides', { vehicle_id: id }, 25, 'started_at'),
      rows<DamageReport>('damage_reports', { vehicle_id: id }, 50, 'created_at'),
      rows<PanelData['devices'][number]>('devices', { vehicle_id: id }, 1),
    ]);

    return {
      vehicle,
      // Same reasoning as the ride page: telemetry lives in the partitioned
      // table and is fetched by the chart when it is actually shown.
      telemetry: [],
      commands, alerts, rides, damage,
      device: devices[0] ?? null,
    };
  }
  async listCustomers(params: QueryParams): Promise<Page<CustomerRow>> {
    return this.listFrom<CustomerRow>('v_admin_customers', params);
  }
  async getCustomer(id: string): Promise<CustomerDetail | null> {
    const res = await this.invoke<{ rows: CustomerRow[] }>('admin-list', {
      view: 'v_admin_customers', limit: 1, offset: 0, filters: { id },
    });
    const customer = res.rows?.[0];
    if (!customer) return null;

    const rows = async <T,>(view: string, filters: Record<string, unknown>, limit = 100, sort?: string) =>
      this.invoke<{ rows: T[] }>('admin-list', {
        view, limit, offset: 0, filters,
        ...(sort ? { sort: [{ field: sort, dir: 'desc' }] } : {}),
      }).then((r) => r.rows ?? []).catch(() => [] as T[]);

    const [rides, payments, debts, referrals, accounts] = await Promise.all([
      rows<RideRow>('v_admin_rides', { user_id: id }, 50, 'started_at'),
      rows<Payment>('payments', { user_id: id }, 100, 'created_at'),
      rows<Debt>('debts', { user_id: id }, 50, 'created_at'),
      rows<Referral>('referrals', { referrer_id: id }, 50, 'created_at'),
      // ledger_entries has no user column — it is keyed by account, so the
      // rider's own accounts have to be resolved first. Without this the page
      // would be showing the whole company's book under one customer.
      rows<{ id: string }>('ledger_accounts', { owner_id: id }, 20),
    ]);

    const ownAccounts = new Set(accounts.map((a) => a.id));
    const ledger = ownAccounts.size
      ? (await rows<LedgerEntry>('ledger_entries', {}, 500, 'created_at'))
          .filter((e) => ownAccounts.has(String((e as unknown as { account_id?: string }).account_id ?? '')))
      : [];

    return { customer, rides, payments, debts, ledger, referrals };
  }
  async listZones(): Promise<Zone[]> {
    const { data, error } = await this.client.supabase.from('zones').select('*').eq('active', true);
    if (error) throw error;
    // PostgREST serialises the PostGIS geometry column as GeoJSON, but adds a
    // `crs` member that `Zone.geom` (a plain GeoJSON polygon) does not have.
    // Strip it: it travels back into `apply_zone_version` → ST_GeomFromGeoJSON
    // on save, which only wants type + coordinates.
    return (data ?? []).map((row) => {
      const z = row as Zone & { geom?: { type: string; coordinates: unknown } | null };
      if (!z.geom) return z;
      return { ...z, geom: { type: z.geom.type, coordinates: z.geom.coordinates } };
    }) as Zone[];
  }
  /**
   * The catalogue payload behind Pricing / Marketing / Finance / Fleet / Team /
   * Settings / Content / Analytics.
   *
   * One call to `admin-panel-data` (service_role, staff-checked) instead of ~40
   * from the browser — most of these tables are deliberately unreadable with the
   * anon key. KPIs and the SIM fleet come from their own endpoints and are
   * merged in, so nothing is fetched twice.
   *
   * Collections with no backing table yet resolve to empty, never to invented
   * rows: an empty page is the truth, a populated fake one is not.
   */
  /* ---- myDATA (AADE) — docs/18-mydata.md ----
     Five reads against `admin-mydata`, fanned out. They are separate actions
     server-side because they answer different questions at different sizes; the
     page wants all five at once, so the fan-out happens here rather than making
     the screen orchestrate it. */
  async getMydata(): Promise<MydataState> {
    const [summary, subs, gaps, issues, daily] = await Promise.all([
      this.invoke<{
        config: Record<string, unknown>;
        series: MydataState['series'];
        totals: MydataState['totals'];
        payments_without_receipt: number;
      }>('admin-mydata', { action: 'summary' }),
      this.invoke<{ rows: MydataState['submissions'] }>('admin-mydata', { action: 'list', limit: 500 }),
      // Gaps and issues are counted, not paged: the tiles on the review queue
      // are computed from these arrays, so a truncated fetch would show a wrong
      // number rather than a partial list. The imported history alone carries
      // 578 gaps and 31 duplicates, which is already past the 500 default.
      this.invoke<{ rows: MydataState['gaps'] }>('admin-mydata', { action: 'gaps', limit: 2000 }),
      this.invoke<{ rows: MydataState['issues'] }>('admin-mydata', {
        action: 'issues', include_reviewed: true, limit: 2000,
      }),
      this.invoke<{ rows: MydataState['daily'] }>('admin-mydata', { action: 'daily' }),
    ]);

    const cfg = summary.config ?? {};
    return {
      // A missing or unreadable config must not read as "live" — the safe
      // default is the mode that transmits nothing.
      mode: (cfg.mode as MydataState['mode']) ?? 'dry_run',
      enabled: cfg.enabled === true,
      series: summary.series ?? [],
      submissions: subs.rows ?? [],
      gaps: gaps.rows ?? [],
      issues: issues.rows ?? [],
      daily: daily.rows ?? [],
      totals: summary.totals ?? { receipts: subs.rows?.length ?? 0, by_status: {} },
      payments_without_receipt: Number(summary.payments_without_receipt ?? 0),
    };
  }

  /**
   * The receipts table, filtered server-side.
   *
   * Separate from getMydata because filtering client-side only ever searched
   * whatever the first page happened to contain — with 22k rows imported, a
   * source or status that existed but sat outside that page showed as empty.
   */
  async getMydataList(f: import('./api').MydataListFilters): Promise<MydataSubmission[]> {
    const res = await this.invoke<{ rows: MydataSubmission[] }>('admin-mydata', {
      action: 'list',
      limit: f.limit ?? 200,
      ...(f.status && f.status !== 'all' ? { status: f.status } : {}),
      ...(f.source && f.source !== 'all' ? { source: f.source } : {}),
      ...(f.search ? { search: f.search } : {}),
    });
    return res.rows ?? [];
  }

  async getMydataDetail(id: UUID): Promise<MydataDetail> {
    return await this.invoke<MydataDetail>('admin-mydata', { action: 'detail', id });
  }

  /**
   * Run the myDATA worker once, now.
   *
   * The scheduler is deliberately switched off until go-live, but the worker is
   * what renders each receipt's document — so without a way to run it on demand,
   * practice mode cannot do the job it exists for. Reaching the function at all
   * requires a signed-in staff session (verify_jwt).
   */
  async runMydataWorker(): Promise<{ processed: number; sent: number; failed: number; blocked: number }> {
    return await this.invoke('mydata-submit', {});
  }

  /** Day-by-day coverage of the shadow run against the imported history. */
  async getMydataShadowCompare(): Promise<MydataShadowDay[]> {
    const res = await this.invoke<{ rows: MydataShadowDay[] }>('admin-mydata', {
      action: 'shadow_compare',
    });
    return res.rows ?? [];
  }

  /** Single-row rollup for the dashboard tile. */
  async getMydataHealth(): Promise<MydataHealth | null> {
    const res = await this.invoke<{ health: MydataHealth | null }>('admin-mydata', { action: 'health' });
    return res.health ?? null;
  }

  /** Receipt state for a page of rides, in one request rather than one per row. */
  async getReceiptsForTrips(tripIds: UUID[]): Promise<PaymentReceipt[]> {
    if (tripIds.length === 0) return [];
    const res = await this.invoke<{ rows: PaymentReceipt[] }>('admin-mydata', {
      action: 'for_trips', trip_ids: tripIds,
    });
    return res.rows ?? [];
  }

  async mydataMutate(action: MydataAction, body: Record<string, unknown>): Promise<void> {
    // invoke() throws on a non-2xx, and every myDATA mutation can legitimately
    // fail a business rule (already filed, duplicate MARK, floor violation).
    // Letting it throw is the point — the caller shows the reason.
    await this.invoke<{ ok: boolean }>('admin-mydata', { action, ...body });
  }

  async getPanelData(): Promise<PanelData> {
    const [panel, kpis, sims] = await Promise.all([
      this.invoke<Record<string, unknown>>('admin-panel-data', {}),
      this.getKpis(),
      this.getSims({ page: 1, pageSize: 500 }).then((p) => p.rows).catch(() => []),
    ]);

    const arr = <T,>(k: string): T[] => (Array.isArray(panel[k]) ? (panel[k] as T[]) : []);
    const rec = <T,>(k: string): Record<string, T> =>
      (panel[k] && typeof panel[k] === 'object' ? (panel[k] as Record<string, T>) : {});

    return {
      cities: arr('cities'),
      models: arr('models'),
      batteryCurves: arr('batteryCurves'),
      vehicles: arr('vehicles'),
      devices: arr('devices'),

      sims,
      // Per-SIM usage/events are loaded on demand by the detail drawer
      // (`admin-sim-detail`) rather than shipped with every panel load.
      simUsage: {},
      simEvents: {},
      simAlerts: await this.getSimAlerts().catch(() => []),
      simCostSummary: await this.getSimCostSummary().catch(() => []),
      simLastSyncAt: null,

      brandConfig: (await this.getBrandConfig().catch(() => null)) as PanelData['brandConfig'],

      customers: arr('customers'),
      rides: arr('rides'),
      // Detail-level data has dedicated endpoints; carrying it here would make
      // every panel load pay for data one page might open.
      rideExtras: {},
      userProfiles: {},
      sumsub: {},
      userTimelines: {},
      vehicleTimelines: {},
      tripEvents: rec('tripEvents'),

      payments: arr('payments'),
      debts: arr('debts'),
      zones: arr('zones'),
      zoneVersions: arr('zoneVersions'),
      alerts: arr('alerts'),
      commands: arr('commands'),
      opsTasks: arr('opsTasks'),
      damageReports: arr('damageReports'),
      staff: arr('staff'),
      kpis,
      ledgerAccounts: arr('ledgerAccounts'),
      ledgerEntries: arr('ledgerEntries'),
      invoices: arr('invoices'),
      corporate: arr('corporate'),
      notificationRules: arr('notificationRules'),
      notificationLog: arr('notificationLog'),
      promos: arr('promos'),
      groups: arr('groups'),
      campaigns: arr('campaigns'),
      loyalty: arr('loyalty'),
      referrals: arr('referrals'),
      pois: arr('pois'),
      pricingPlans: arr('pricingPlans'),
      packages: arr('packages'),
      subscriptions: arr('subscriptions'),
      addons: arr('addons'),
      penalties: arr('penalties'),
      translations: arr('translations'),
      appConfig: arr('appConfig'),
      tutorials: arr('tutorials'),
      faq: arr('faq'),

      heatCells: arr('heatCells'),
      revenueByDay: arr('revenueByDay'),
      // Cohorts, funnel and demand grid need analytics events we do not collect
      // yet (docs/08). Empty until that pipeline exists — the pages render their
      // own "no data" state.
      cohorts: [],
      funnel: [],
      demandCells: [],

      scanLog: arr('scanLog'),
      maintenanceLog: arr('maintenanceLog'),
      batterySwaps: arr('batterySwaps'),
      auditLog: arr('auditLog'),
    } as PanelData;
  }

  /* ---- Rich profile / history / KYC (dedicated edge functions) ----
     These three edge fns are service_role-side: they join the admin-only
     views, mask PII per docs/10 and proxy Sumsub with the app token so no
     Sumsub secret ever reaches the browser. */

  private async invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.supabase.functions.invoke(fn, { body });
    if (error) throw error;
    if (data == null) throw new Error(`${fn} returned an empty payload`);
    return data as T;
  }

  /** Pagination is passed through verbatim; the edge fn returns a Page<T>. */
  private static pageBody(params: QueryParams): Record<string, unknown> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = params.pageSize ?? 25;
    return {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sort: params.sort ?? [],
      search: params.search ?? '',
      filters: params.filters ?? {},
    };
  }

  async getUserProfile(userId: string): Promise<UserProfileFull | null> {
    const res = await this.invoke<{ profile: UserProfileFull | null }>('admin-user-profile', { user_id: userId });
    return res.profile ?? null;
  }

  async getUserRides(userId: string, params: QueryParams): Promise<Page<UserRideHistoryRow>> {
    return this.invoke<Page<UserRideHistoryRow>>('admin-user-profile', {
      user_id: userId, section: 'rides', ...SupabaseDataSource.pageBody(params),
    });
  }

  async getUserTimeline(userId: string, params: QueryParams): Promise<Page<TimelineEvent>> {
    return this.invoke<Page<TimelineEvent>>('admin-user-profile', {
      user_id: userId, section: 'timeline', ...SupabaseDataSource.pageBody(params),
    });
  }

  async getSumsubProfile(userId: string, opts?: { refresh?: boolean }): Promise<SumsubProfileBundle> {
    return this.invoke<SumsubProfileBundle>('sumsub-applicant', { user_id: userId, refresh: Boolean(opts?.refresh) });
  }

  async getVehicleIo(vehicleId: string, limit = 1): Promise<VehicleIoFrame[]> {
    const res = await this.invoke<{ rows: VehicleIoFrame[] }>('admin-list', {
      view: 'v_vehicle_io', limit, offset: 0, filters: { vehicle_id: vehicleId },
    });
    return res.rows ?? [];
  }
  /* `admin-vehicle-history` answers with ONE flat snapshot —
     { vehicle, stats, rides[], timeline[], commands[], … } — and knows nothing
     about a `section` argument or about paging. The three readers below used to
     ask for `section: 'rides'` and type the reply as `Page<T>`, so `data.rows`
     came back undefined and the table crashed on `.rows.length`: the Rides,
     Timeline and Damage tabs were a white screen. Slice the arrays here instead
     of pretending the server pages them. */

  private async vehicleSnapshot(vehicleId: string): Promise<VehicleHistorySnapshot> {
    return this.invoke<VehicleHistorySnapshot>('admin-vehicle-history', { vehicle_id: vehicleId });
  }

  /** Page an array the server returned whole. */
  private static slice<T>(rows: T[], params: QueryParams, total?: number): Page<T> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = params.pageSize ?? 25;
    const start = (page - 1) * pageSize;
    return { rows: rows.slice(start, start + pageSize), total: total ?? rows.length, page, pageSize };
  }

  async getVehicleHistory(vehicleId: string, params: QueryParams): Promise<VehicleHistory> {
    const snap = await this.vehicleSnapshot(vehicleId);
    return {
      stats: snap.stats as VehicleHistory['stats'],
      rides: SupabaseDataSource.slice((snap.rides ?? []).map(toVehicleRideRow), params, snap.total_rides),
      timeline: (snap.timeline ?? []).map(toTimelineEvent),
    };
  }

  async getVehicleRides(vehicleId: string, params: QueryParams): Promise<Page<VehicleRideHistoryRow>> {
    const snap = await this.vehicleSnapshot(vehicleId);
    return SupabaseDataSource.slice((snap.rides ?? []).map(toVehicleRideRow), params, snap.total_rides);
  }

  async getVehicleTimeline(vehicleId: string, params: QueryParams): Promise<Page<TimelineEvent>> {
    const snap = await this.vehicleSnapshot(vehicleId);
    return SupabaseDataSource.slice((snap.timeline ?? []).map(toTimelineEvent), params);
  }

  /* ---- Connectivity / SIM cards ----
     Reads come from the read-only `v_sim_*` views (anon key + RLS, same as
     zones/alerts); every mutation goes through an edge function so the
     provider credentials and audit write stay server-side. */

  async getSims(params: QueryParams): Promise<Page<SimInventoryRow>> {
    const paged = await this.listFrom<Record<string, unknown>>('v_sim_inventory', params);
    return { ...paged, rows: paged.rows.map(mapSimInventoryRow) };
  }

  /** @deprecated direct-view variant, kept for reference during integration. */
  private async getSimsDirect(params: QueryParams): Promise<Page<SimInventoryRow>> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = params.pageSize ?? 25;
    const from = (page - 1) * pageSize;

    let q = this.client.supabase.from('v_sim_inventory').select('*', { count: 'exact' });
    for (const [key, value] of Object.entries(params.filters ?? {})) {
      if (value === undefined || value === null || value === '' || value === 'all') continue;
      if (key === 'linked') {
        q = value === true || value === 'true' || value === 'yes' ? q.not('device_id', 'is', null) : q.is('device_id', null);
      } else if (key === 'over_limit') {
        q = q.gte('data_pct_used', 100);
      } else {
        q = q.eq(simViewColumn(key), value);
      }
    }
    const search = params.search?.trim();
    if (search) {
      // Identifiers are matched verbatim — never stripped or reformatted.
      const like = `%${search}%`;
      q = q.or(
        ['iccid', 'imsi', 'msisdn', 'provider_sim_id', 'device_imei', 'vehicle_code', 'label', 'plan_name']
          .map((c) => `${c}.ilike.${like}`)
          .join(','),
      );
    }
    for (const s of params.sort ?? []) q = q.order(simViewColumn(s.field), { ascending: s.dir === 'asc' });
    if (!params.sort?.length) q = q.order('data_pct_used', { ascending: false });

    const { data, error, count } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []).map(mapSimInventoryRow), total: count ?? 0, page, pageSize };
  }

  async getSimDetail(simId: string): Promise<SimDetail | null> {
    const res = await this.invoke<SimDetail | { sim: null }>('admin-sim-detail', { sim_id: simId });
    return 'sim' in res && res.sim ? (res as SimDetail) : null;
  }

  /* Both go through `admin-list`, not the anon client: migration 00210 revokes
     v_sim_alerts / v_sim_cost_summary from anon+authenticated (they expose the
     whole SIM estate), so a direct read returns "permission denied for view".
     v_sim_inventory above already took this route. */

  async getSimAlerts(): Promise<SimAlert[]> {
    const res = await this.invoke<{ rows: SimAlert[] }>('admin-list', {
      view: 'v_sim_alerts', limit: 200, offset: 0,
    });
    return res.rows ?? [];
  }

  async getSimCostSummary(): Promise<SimCostSummary[]> {
    const res = await this.invoke<{ rows: SimCostSummary[] }>('admin-list', {
      view: 'v_sim_cost_summary', limit: 12, offset: 0,
      sort: [{ field: 'month', dir: 'desc' }],
    });
    return res.rows ?? [];
  }

  async syncSims(): Promise<SimSyncResult> {
    return this.invoke<SimSyncResult>('sim-sync', {});
  }

  async simCommand(input: SimCommandInput): Promise<SimInventoryRow> {
    const res = await this.invoke<{ sim: SimInventoryRow }>('sim-command', {
      sim_id: input.sim_id,
      action: input.action,
      reason: input.reason,
      ...(input.plan ? { plan: input.plan } : {}),
    });
    return res.sim;
  }

  /* ---- Message centre ----
     All three go through `admin-messages`: a reply must be written with
     service_role so a staff turn cannot be forged from the rider app, whose
     RLS policy only permits inserting `sender = 'rider'`. */

  async listMessageThreads(): Promise<MessageThread[]> {
    const res = await this.invoke<{ threads: MessageThread[] }>('admin-messages', { section: 'list' });
    return res.threads ?? [];
  }

  async getMessageThread(userId: string): Promise<ChatMessage[]> {
    const res = await this.invoke<{ messages: ChatMessage[] }>('admin-messages', {
      section: 'thread', user_id: userId,
    });
    return res.messages ?? [];
  }

  async replyToMessage(userId: string, body: string): Promise<ChatMessage> {
    const res = await this.invoke<{ message: ChatMessage }>('admin-messages', {
      section: 'reply', user_id: userId, body,
    });
    return res.message;
  }

  /* ---- White-label branding (`app_config.brand`) ---- */

  async getBrandConfig(): Promise<BrandConfig | null> {
    const { data, error } = await this.client.supabase
      .from('app_config')
      .select('value')
      .eq('key', 'brand')
      .maybeSingle();
    if (error) throw error;
    const value = (data as { value?: unknown } | null)?.value;
    return value && typeof value === 'object' ? (value as BrandConfig) : null;
  }

  async saveBrandConfig(config: BrandConfig, reason: string): Promise<void> {
    // Writes go through an edge fn: app_config is service_role-only and the
    // change has to land in audit_log with who/what/reason (Hard Rule #8).
    await this.invoke('admin-app-config', { key: 'brand', value: config, reason });
  }

  /** Global search (cmd-k): rider by phone/email/name, vehicle by code, ride by id. */
  async search(q: string): Promise<SearchResult[]> {
    const term = q.trim();
    if (term.length < 2) return [];

    const find = async <T,>(view: string, limit = 5) =>
      this.invoke<{ rows: T[] }>('admin-list', { view, limit, offset: 0, search: term })
        .then((r) => r.rows ?? [])
        .catch(() => [] as T[]);

    const [customers, vehicles, rides] = await Promise.all([
      find<CustomerRow>('v_admin_customers'),
      find<VehicleRow>('v_admin_vehicles'),
      find<RideRow>('v_admin_rides'),
    ]);

    return [
      ...customers.map((c) => ({
        kind: 'customer' as const,
        id: c.id,
        label: c.full_name || c.phone || c.email || c.id,
        sub: [c.phone, c.email].filter(Boolean).join(' · '),
        to: `/customers/${c.id}`,
      })),
      ...vehicles.map((v) => ({
        kind: 'vehicle' as const,
        id: v.id,
        label: v.code,
        sub: [v.model_name, v.status].filter(Boolean).join(' · '),
        to: `/vehicles/${v.id}`,
      })),
      ...rides.map((r) => ({
        kind: 'ride' as const,
        id: r.id,
        label: `${r.vehicle_code ?? 'ride'} · ${(r.started_at ?? '').slice(0, 16).replace('T', ' ')}`,
        sub: r.user_name || r.user_phone || '',
        to: `/rides/${r.id}`,
      })),
    ];
  }

  /* ---- Notifications / pop-ups / push (docs/12) ---- */

  async listCustomerGroups(): Promise<CustomerGroupRow[]> {
    const res = await this.invoke<{ rows: CustomerGroupRow[] }>('admin-list', {
      view: 'v_admin_customer_groups', limit: 200, offset: 0,
    });
    return res.rows ?? [];
  }
  async listBroadcasts(params: QueryParams): Promise<Page<BroadcastRow>> {
    return this.listFrom<BroadcastRow>('v_admin_broadcasts', params);
  }
  async previewBroadcast(input: BroadcastInput): Promise<BroadcastResult> {
    return this.client.edge.adminBroadcast({ ...input, preview: true });
  }
  async sendBroadcast(input: BroadcastInput): Promise<BroadcastResult> {
    return this.client.edge.adminBroadcast(input);
  }
  async listAudit(params: QueryParams): Promise<Page<AuditLogEntry>> {
    return this.listFrom<AuditLogEntry>('audit_log', params);
  }

  /* ---- Configuration catalogues ----
     Reads reuse `admin-list`, writes go to `admin-write`; both whitelist the
     table and demand the same permission, so the two directions cannot drift.
     Nothing here touches a table directly (Hard Rule #6). */

  async configList<T>(table: ConfigTable, params: QueryParams): Promise<Page<T>> {
    return this.listFrom<T>(table, params);
  }

  async configCreate<T>(table: ConfigTable, values: Record<string, unknown>): Promise<T> {
    const res = await this.invoke<{ row: T }>('admin-write', { table, action: 'create', values });
    return res.row;
  }

  async configUpdate<T>(table: ConfigTable, key: ConfigKey, values: Record<string, unknown>): Promise<T> {
    const res = await this.invoke<{ row: T }>('admin-write', {
      table, action: 'update', ...configKey(key), values,
    });
    return res.row;
  }

  async configRemove(
    table: ConfigTable, key: ConfigKey, reason?: string,
  ): Promise<{ deleted?: boolean; deactivated?: boolean }> {
    return this.invoke('admin-write', { table, action: 'delete', ...configKey(key), reason });
  }

  /* ---- Mutations via edge functions (permission-checked + audited server-side) ----
     All of these go through invoke(), which throws on a non-2xx. Calling
     `functions.invoke` directly and dropping its `error` made a 403 (missing
     permission) look like a successful save in the UI. */

  async reviewPhoto(tripId: string, verdict: 'approved' | 'rejected', reason?: string): Promise<void> {
    await this.invoke('photo-review-decision', { trip_id: tripId, verdict, ...(reason ? { reason } : {}) });
  }
  async sendCommand(vehicleId: string, kind: string, payload: Record<string, unknown> = {}): Promise<Command> {
    const res = await this.client.edge.adminCommand({ vehicle_id: vehicleId, kind, payload });
    return { id: res.command_id } as unknown as Command;
  }
  async setVehicleStatus(vehicleId: string, status: string, reason: string): Promise<void> {
    await this.invoke('vehicle-status', { vehicle_id: vehicleId, status, reason });
  }
  async listVehicleModels(): Promise<Array<{ id: string; name: string }>> {
    // `vehicle_models` is one of the few fleet tables readable with the anon
    // key (policy vehicle_models_read) — the rider app needs it too.
    const { data, error } = await this.client.supabase.from('vehicle_models').select('id, name').order('name');
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; name: string }>;
  }
  async createVehicle(input: CreateVehicleInput): Promise<{ id: string; code: string }> {
    const res = await this.client.edge.adminCreateVehicle({
      code: input.code,
      model_id: input.model_id,
      city_id: input.city_id ?? null,
      plate: input.plate ?? null,
      vin: input.vin ?? null,
      notes: input.notes ?? null,
      imei: input.imei ?? null,
      status: input.status,
    });
    return { id: res.vehicle.id, code: res.vehicle.code };
  }
  async removeVehicle(vehicleId: string, reason: string, mode: 'decommission' | 'purge'): Promise<void> {
    await this.client.edge.adminDeleteVehicle({ vehicle_id: vehicleId, reason, mode });
  }
  async adminCharge(input: AdminChargeInput): Promise<void> {
    await this.client.edge.adminCharge(input);
  }
  async refund(paymentId: string, amountCents: number, reason: string): Promise<void> {
    await this.client.edge.adminRefund({ payment_id: paymentId, amount_cents: amountCents, reason });
  }
  async setUserBlocked(userId: string, blocked: boolean, reason: string): Promise<void> {
    await this.invoke('admin-block-user', { user_id: userId, blocked, reason });
  }
  async creditWallet(userId: string, amountCents: number, reason: string): Promise<void> {
    await this.invoke('admin-credit-wallet', { user_id: userId, amount_cents: amountCents, reason });
  }
  async saveZoneVersion(zones: Zone[], reason: string): Promise<number> {
    // `apply_zone_version(p_city uuid, …)` takes the city from this one field
    // and ignores every zone's own city_id. Picking zones[0] blindly breaks the
    // moment the first entry is a zone drawn in the panel, whose city_id is
    // whatever the editor guessed — so take the first one that is really a uuid.
    const city_id = zones.find((z) => UUID_RE.test(z.city_id ?? ''))?.city_id ?? zones[0]?.city_id ?? '';
    if (!UUID_RE.test(city_id)) {
      throw new Error('Cannot save zones: no city id on any zone. Draw inside an existing city, or reload the page so the city list is available.');
    }
    const res = await this.client.edge.saveZoneVersion({ city_id, zones, reason });
    return res.version;
  }
  async logAudit(_input: AuditInput): Promise<AuditLogEntry> {
    // Server writes audit_log inside each edge fn; client-side logging is a no-op.
    return {
      id: 'server', staff_id: null, action: _input.action, entity: _input.entity, entity_id: _input.entity_id,
      before: null, after: null, reason: _input.reason, ip: null, at: new Date().toISOString(),
    };
  }
}

/* ---------------------------------------------------------------------------
   v_sim_inventory → SimInventoryRow

   Two impedance mismatches make a raw cast wrong:
     1. the view's primary key is `sim_id`, the panel's row shape uses `id`, so
        a cast leaves every React key, row link and getSimDetail() call
        undefined;
     2. Postgres reports EVERY column of a view as nullable, and inventory SIMs
        genuinely have no plan/cycle/MSISDN yet — so the non-null fields the UI
        renders need explicit fallbacks rather than `undefined` leaking into
        the table.
   Keep this in step with migration 00210's view definition.
   --------------------------------------------------------------------------- */
/** Panel column name → v_sim_inventory column name. */
function simViewColumn(field: string): string {
  const alias: Record<string, string> = {
    id: 'sim_id',
    cycle_start: 'cycle_from',
    cycle_end: 'cycle_to',
    data_used: 'data_used_mb_cycle',
  };
  return alias[field] ?? field;
}

function mapSimInventoryRow(r: Record<string, unknown>): SimInventoryRow {
  const s = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const n = (v: unknown, fallback = 0): number => (v == null ? fallback : Number(v));
  const nullableS = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const nullableN = (v: unknown): number | null => (v == null ? null : Number(v));

  return {
    id: s(r.sim_id),
    iccid: s(r.iccid),
    imsi: s(r.imsi),
    msisdn: s(r.msisdn),
    provider: s(r.provider, 'truphone'),
    provider_sim_id: s(r.provider_sim_id),
    status: s(r.status, 'inventory') as SimInventoryRow['status'],

    plan_name: s(r.plan_name, '—'),
    plan_data_mb: n(r.plan_data_mb),
    cycle_start: s(r.cycle_from ?? r.cycle_start),
    cycle_end: s(r.cycle_to ?? r.cycle_end),
    monthly_cost_cents: n(r.monthly_cost_cents),

    device_id: nullableS(r.device_id),
    device_imei: nullableS(r.device_imei),
    vehicle_id: nullableS(r.vehicle_id),
    vehicle_code: nullableS(r.vehicle_code),
    vehicle_status: nullableS(r.vehicle_status),

    label: s(r.label),
    notes: nullableS(r.notes),

    last_seen_at: nullableS(r.last_seen_at),
    network: nullableS(r.network),
    country: nullableS(r.country),

    data_used_mb_cycle: n(r.data_used_mb_cycle),
    data_pct_used: n(r.data_pct_used),
    cost_mtd_cents: n(r.cost_mtd_cents),
    days_since_seen: nullableN(r.days_since_seen),
    health: s(r.health, 'ok') as SimInventoryRow['health'],
  };
}
