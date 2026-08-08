// Production data source. Wires @penny/api-client (repos + edge fns). Reads that
// depend on admin-only views/tables are marked TODO for the Supabase wiring day;
// the panel defaults to MockDataSource so this file only runs when
// VITE_DATA_SOURCE=supabase is explicitly set.
import { createPennyClient, type PennyClient } from '@penny/api-client';
import type {
  DataSource,
  RideDetail,
  VehicleDetail,
  CustomerDetail,
  AdminChargeInput,
  AuditInput,
  SearchResult,
} from './api';
import type { Page, QueryParams } from './query';
import type { MockDb } from './mock/db';
import type { Command, VehicleAlert, Zone } from '@penny/db-types';
import type { KpiSnapshot, RideRow, VehicleRow, CustomerRow, VerificationItem, AuditLogEntry } from '@/types/domain';

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
