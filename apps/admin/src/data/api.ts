// DataSource abstraction. MockDataSource (default) runs the panel standalone;
// SupabaseDataSource wires @penny/api-client + edge functions for production.
import type { Page, QueryParams } from './query';
import type { MockDb } from './mock/db';
import type {
  Command,
  VehicleAlert,
  TripEvent,
  Zone,
} from '@penny/db-types';
import type {
  KpiSnapshot,
  RideRow,
  VehicleRow,
  CustomerRow,
  VerificationItem,
  Payment,
  Debt,
  LedgerEntry,
  DamageReport,
  Referral,
  AuditLogEntry,
  TelemetrySample,
  UUID,
} from '@/types/domain';
import type { LngLat, Trip, User } from '@penny/db-types';

export interface RideDetail {
  ride: RideRow;
  events: TripEvent[];
  route: LngLat[];
  telemetry: TelemetrySample[];
  payments: Payment[];
}

export interface VehicleDetail {
  vehicle: VehicleRow;
  telemetry: TelemetrySample[];
  commands: Command[];
  alerts: VehicleAlert[];
  rides: RideRow[];
  damage: DamageReport[];
  device: MockDb['devices'][number] | null;
}

export interface CustomerDetail {
  customer: CustomerRow;
  rides: RideRow[];
  payments: Payment[];
  debts: Debt[];
  ledger: LedgerEntry[];
  referrals: Referral[];
}

export interface AdminChargeInput {
  user_id: UUID;
  amount_cents: number;
  kind: string;
  reason: string;
  evidence_urls?: string[];
}

export interface AuditInput {
  action: string;
  entity: string;
  entity_id: string;
  reason: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface DataSource {
  readonly kind: 'mock' | 'supabase';

  // Dashboard
  getKpis(): Promise<KpiSnapshot>;
  getAlerts(): Promise<VehicleAlert[]>;
  getLiveVehicles(): Promise<VehicleRow[]>;

  // Rides
  listRides(params: QueryParams): Promise<Page<RideRow>>;
  getRide(id: string): Promise<RideDetail | null>;

  // Ride verification
  listVerification(): Promise<VerificationItem[]>;
  reviewPhoto(tripId: string, verdict: 'approved' | 'rejected', reason?: string): Promise<void>;

  // Vehicles
  listVehicles(params: QueryParams): Promise<Page<VehicleRow>>;
  getVehicle(id: string): Promise<VehicleDetail | null>;
  sendCommand(vehicleId: string, kind: string, payload?: Record<string, unknown>): Promise<Command>;
  setVehicleStatus(vehicleId: string, status: string, reason: string): Promise<void>;

  // Customers
  listCustomers(params: QueryParams): Promise<Page<CustomerRow>>;
  getCustomer(id: string): Promise<CustomerDetail | null>;
  adminCharge(input: AdminChargeInput): Promise<void>;
  refund(paymentId: string, amountCents: number, reason: string): Promise<void>;
  setUserBlocked(userId: string, blocked: boolean, reason: string): Promise<void>;
  creditWallet(userId: string, amountCents: number, reason: string): Promise<void>;

  // Zones
  listZones(): Promise<Zone[]>;
  saveZoneVersion(zones: Zone[], reason: string): Promise<number>;

  // Everything else (pricing, marketing, fleet, finance, team, settings, analytics)
  getPanelData(): Promise<MockDb>;

  // Global search
  search(q: string): Promise<SearchResult[]>;

  // Audit
  logAudit(input: AuditInput): Promise<AuditLogEntry>;
  listAudit(params: QueryParams): Promise<Page<AuditLogEntry>>;
}

export interface SearchResult {
  kind: 'customer' | 'vehicle' | 'ride';
  id: string;
  label: string;
  sub: string;
  to: string;
}

let instance: DataSource | null = null;

export async function getDataSource(): Promise<DataSource> {
  if (instance) return instance;
  const mode = (import.meta.env.VITE_DATA_SOURCE ?? 'mock') as 'mock' | 'supabase';
  if (mode === 'supabase') {
    const { SupabaseDataSource } = await import('./supabaseSource');
    instance = new SupabaseDataSource();
  } else {
    const { MockDataSource } = await import('./mockSource');
    instance = new MockDataSource();
  }
  return instance;
}

// Convenience for non-async call sites once initialized.
export function dataSourceMode(): 'mock' | 'supabase' {
  return (import.meta.env.VITE_DATA_SOURCE ?? 'mock') as 'mock' | 'supabase';
}
