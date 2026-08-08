// Production data source. Wires @penny/api-client (repos + edge fns). Reads that
// depend on admin-only views/tables are marked TODO for the Supabase wiring day;
// the panel defaults to MockDataSource so this file only runs when
// VITE_DATA_SOURCE=supabase is explicitly set.
import { createPennyClient, type PennyClient } from '@penny/api-client';
import type {
  DataSource,
  RideDetail,
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

  // ---- Reads (TODO: back with v_* panel views on integration day) ----
  async getKpis(): Promise<KpiSnapshot> { return notImpl('getKpis'); }
  async getAlerts(): Promise<VehicleAlert[]> {
    const { data, error } = await this.client.supabase.from('vehicle_alerts').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []) as VehicleAlert[];
  }
  async getLiveVehicles(): Promise<VehicleRow[]> { return notImpl('getLiveVehicles'); }
  async listRides(_params: QueryParams): Promise<Page<RideRow>> { return notImpl('listRides'); }
  async getRide(_id: string): Promise<RideDetail | null> { return notImpl('getRide'); }
  async listVerification(): Promise<VerificationItem[]> { return notImpl('listVerification'); }
  async listVehicles(_params: QueryParams): Promise<Page<VehicleRow>> { return notImpl('listVehicles'); }
  async getVehicle(_id: string): Promise<VehicleDetail | null> { return notImpl('getVehicle'); }
  async listCustomers(_params: QueryParams): Promise<Page<CustomerRow>> { return notImpl('listCustomers'); }
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
  async search(_q: string): Promise<SearchResult[]> { return notImpl('search'); }
  async listAudit(_params: QueryParams): Promise<Page<AuditLogEntry>> { return notImpl('listAudit'); }

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
