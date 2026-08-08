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
  UserProfileFull,
  UserRideHistoryRow,
  VehicleRideHistoryRow,
  VehicleStats,
  SumsubProfileBundle,
  TimelineEvent,
  SimAlert,
  SimCostSummary,
  SimEvent,
  SimInventoryRow,
  SimUsageDay,
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

/** Summary + first page of a vehicle's exhaustive history. */
export interface VehicleHistory {
  stats: VehicleStats;
  rides: Page<VehicleRideHistoryRow>;
  timeline: TimelineEvent[];
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

/* ---------- Connectivity / SIM cards ---------- */

/** Everything the SIM detail drawer renders in one round-trip. */
export interface SimDetail {
  sim: SimInventoryRow;
  /** Newest last — the 30-day usage chart plots it as-is. */
  usage: SimUsageDay[];
  /** Newest first. */
  events: SimEvent[];
  /** `live` = fetched from the provider just now, `cache` = from our tables. */
  source: 'live' | 'cache';
  fetched_at: string;
}

export type SimAction = 'activate' | 'suspend' | 'resume' | 'terminate' | 'set_plan';

export interface SimCommandInput {
  sim_id: string;
  action: SimAction;
  /** Mandatory for `suspend` and `terminate` — lands in `audit_log`. */
  reason: string;
  /** Only read for `set_plan`. */
  plan?: string;
}

/** Result of a `sim-sync` run against the provider adapter. */
export interface SimSyncResult {
  /** Rows the provider returned. */
  fetched: number;
  /** Rows whose status/usage actually changed. */
  updated: number;
  /** Provider SIMs we have never seen before. */
  discovered: number;
  synced_at: string;
  provider: string;
}

/** Brand override as stored in `app_config.brand` — the exact JSON shape
 *  `brandFromConfig()` accepts. Kept as a loose record so a brand gaining new
 *  tokens does not need a panel release. */
export type BrandConfig = Record<string, unknown>;

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

  // Vehicle — exhaustive history (edge fn `admin-vehicle-history`)
  getVehicleHistory(vehicleId: string, params: QueryParams): Promise<VehicleHistory>;
  getVehicleRides(vehicleId: string, params: QueryParams): Promise<Page<VehicleRideHistoryRow>>;
  getVehicleTimeline(vehicleId: string, params: QueryParams): Promise<Page<TimelineEvent>>;

  // Customers
  listCustomers(params: QueryParams): Promise<Page<CustomerRow>>;
  getCustomer(id: string): Promise<CustomerDetail | null>;

  // Customer — rich profile, history, KYC (edge fns `admin-user-profile`,
  // `sumsub-applicant`)
  getUserProfile(userId: string): Promise<UserProfileFull | null>;
  getUserRides(userId: string, params: QueryParams): Promise<Page<UserRideHistoryRow>>;
  getUserTimeline(userId: string, params: QueryParams): Promise<Page<TimelineEvent>>;
  getSumsubProfile(userId: string, opts?: { refresh?: boolean }): Promise<SumsubProfileBundle>;
  adminCharge(input: AdminChargeInput): Promise<void>;
  refund(paymentId: string, amountCents: number, reason: string): Promise<void>;
  setUserBlocked(userId: string, blocked: boolean, reason: string): Promise<void>;
  creditWallet(userId: string, amountCents: number, reason: string): Promise<void>;

  // Connectivity / SIM cards (views `v_sim_*`, edge fns `sim-sync`,
  // `sim-command`, `admin-sim-detail`)
  getSims(query: QueryParams): Promise<Page<SimInventoryRow>>;
  getSimDetail(simId: string): Promise<SimDetail | null>;
  getSimAlerts(): Promise<SimAlert[]>;
  getSimCostSummary(): Promise<SimCostSummary[]>;
  syncSims(): Promise<SimSyncResult>;
  simCommand(input: SimCommandInput): Promise<SimInventoryRow>;

  // White-label branding (`app_config.brand`)
  getBrandConfig(): Promise<BrandConfig | null>;
  saveBrandConfig(config: BrandConfig, reason: string): Promise<void>;

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
