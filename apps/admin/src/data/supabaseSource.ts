// Production data source. Wires @penny/api-client (repos + edge fns). Reads that
// depend on admin-only views/tables are marked TODO for the Supabase wiring day;
// the panel defaults to MockDataSource so this file only runs when
// VITE_DATA_SOURCE=supabase is explicitly set.
import { createPennyClient, type PennyClient } from '@penny/api-client';
import type {
  BrandConfig,
  DataSource,
  RideDetail,
  SimCommandInput,
  SimDetail,
  SimSyncResult,
  VehicleDetail,
  VehicleHistory,
  CustomerDetail,
  AdminChargeInput,
  AuditInput,
  SearchResult,
} from './api';
import type { Page, QueryParams } from './query';
import type { MockDb } from './mock/db';
import type { Command, VehicleAlert, Zone } from '@penny/db-types';
import type {
  KpiSnapshot,
  RideRow,
  VehicleRow,
  CustomerRow,
  VerificationItem,
  AuditLogEntry,
  UserProfileFull,
  UserRideHistoryRow,
  VehicleRideHistoryRow,
  SumsubProfileBundle,
  TimelineEvent,
  SimAlert,
  SimCostSummary,
  SimInventoryRow,
} from '@/types/domain';

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
  async getRide(_id: string): Promise<RideDetail | null> { return notImpl('getRide'); }
  async listVerification(): Promise<VerificationItem[]> {
    const res = await this.invoke<{ rows: VerificationItem[] }>('admin-list', {
      view: 'v_ride_verification_queue', limit: 200, offset: 0,
    });
    return res.rows ?? [];
  }
  async listVehicles(params: QueryParams): Promise<Page<VehicleRow>> {
    return this.listFrom<VehicleRow>('v_admin_vehicles', params);
  }
  async getVehicle(_id: string): Promise<VehicleDetail | null> { return notImpl('getVehicle'); }
  async listCustomers(params: QueryParams): Promise<Page<CustomerRow>> {
    return this.listFrom<CustomerRow>('v_admin_customers', params);
  }
  async getCustomer(_id: string): Promise<CustomerDetail | null> { return notImpl('getCustomer'); }
  async listZones(): Promise<Zone[]> {
    const { data, error } = await this.client.supabase.from('zones').select('*').eq('active', true);
    if (error) throw error;
    return (data ?? []) as Zone[];
  }
  async getPanelData(): Promise<MockDb> { return notImpl('getPanelData'); }

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

  async getVehicleHistory(vehicleId: string, params: QueryParams): Promise<VehicleHistory> {
    return this.invoke<VehicleHistory>('admin-vehicle-history', {
      vehicle_id: vehicleId, ...SupabaseDataSource.pageBody(params),
    });
  }

  async getVehicleRides(vehicleId: string, params: QueryParams): Promise<Page<VehicleRideHistoryRow>> {
    return this.invoke<Page<VehicleRideHistoryRow>>('admin-vehicle-history', {
      vehicle_id: vehicleId, section: 'rides', ...SupabaseDataSource.pageBody(params),
    });
  }

  async getVehicleTimeline(vehicleId: string, params: QueryParams): Promise<Page<TimelineEvent>> {
    return this.invoke<Page<TimelineEvent>>('admin-vehicle-history', {
      vehicle_id: vehicleId, section: 'timeline', ...SupabaseDataSource.pageBody(params),
    });
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

  async getSimAlerts(): Promise<SimAlert[]> {
    const { data, error } = await this.client.supabase.from('v_sim_alerts').select('*');
    if (error) throw error;
    return (data ?? []) as SimAlert[];
  }

  async getSimCostSummary(): Promise<SimCostSummary[]> {
    const { data, error } = await this.client.supabase
      .from('v_sim_cost_summary')
      .select('*')
      .order('month', { ascending: false })
      .limit(12);
    if (error) throw error;
    return (data ?? []) as SimCostSummary[];
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
    await this.client.supabase.functions.invoke('admin-app-config', {
      body: { key: 'brand', value: config, reason },
    });
  }

  async search(_q: string): Promise<SearchResult[]> { return notImpl('search'); }
  async listAudit(params: QueryParams): Promise<Page<AuditLogEntry>> {
    return this.listFrom<AuditLogEntry>('audit_log', params);
  }

  // ---- Mutations via edge functions (permission-checked + audited server-side) ----
  async reviewPhoto(tripId: string, verdict: 'approved' | 'rejected', reason?: string): Promise<void> {
    await this.client.supabase.functions.invoke('photo-review-decision', { body: { trip_id: tripId, verdict, reason } });
  }
  async sendCommand(vehicleId: string, kind: string, payload: Record<string, unknown> = {}): Promise<Command> {
    const res = await this.client.edge.adminCommand({ vehicle_id: vehicleId, kind, payload });
    return { id: res.command_id } as unknown as Command;
  }
  async setVehicleStatus(vehicleId: string, status: string, reason: string): Promise<void> {
    await this.client.supabase.functions.invoke('vehicle-status', { body: { vehicle_id: vehicleId, status, reason } });
  }
  async adminCharge(input: AdminChargeInput): Promise<void> {
    await this.client.edge.adminCharge(input);
  }
  async refund(paymentId: string, amountCents: number, reason: string): Promise<void> {
    await this.client.edge.adminRefund({ payment_id: paymentId, amount_cents: amountCents, reason });
  }
  async setUserBlocked(userId: string, blocked: boolean, reason: string): Promise<void> {
    await this.client.supabase.functions.invoke('admin-block-user', { body: { user_id: userId, blocked, reason } });
  }
  async creditWallet(userId: string, amountCents: number, reason: string): Promise<void> {
    await this.client.supabase.functions.invoke('admin-credit-wallet', { body: { user_id: userId, amount_cents: amountCents, reason } });
  }
  async saveZoneVersion(zones: Zone[], reason: string): Promise<number> {
    const city_id = zones[0]?.city_id ?? '';
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
