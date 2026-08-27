// DataSource abstraction. There is one implementation — SupabaseDataSource,
// wiring @penny/api-client + edge functions against the live project.
import type { Page, QueryParams } from './query';
import type { PanelData } from './panelData';
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
  VehicleIoFrame,
  SumsubProfileBundle,
  TimelineEvent,
  SimAlert,
  SimCostSummary,
  SimEvent,
  SimInventoryRow,
  SimUsageDay,
  BroadcastRow,
  CustomerGroupRow,
  MydataState,
  MydataSubmission,
  MydataSubmissionFull,
  MydataHealth,
  MydataShadowDay,
  PaymentReceipt,
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
  device: PanelData['devices'][number] | null;
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

export type BroadcastChannel = 'inbox' | 'popup' | 'push';

export type BroadcastAudience =
  | { kind: 'all' }
  | { kind: 'group'; group_id: string }
  | { kind: 'users'; user_ids: string[] };

export interface BroadcastInput {
  title: string;
  body: string;
  deep_link?: string | null;
  channels: BroadcastChannel[];
  /** 'marketing' is consent-filtered per recipient, server-side. */
  category: 'transactional' | 'marketing';
  audience: BroadcastAudience;
  /** Pop-ups only: stop interrupting after this instant. */
  expires_at?: string | null;
  reason?: string;
}

/** What a send (or a dry run) reached. */
export interface BroadcastResult {
  broadcast_id?: string;
  preview?: boolean;
  recipients: number;
  reach?: Record<BroadcastChannel, number>;
  delivered?: number;
  push_sent?: number;
  push_failed?: number;
  push_devices?: number;
  errors?: string[];
}

/** Tables `admin-write` accepts. Keep in step with its TABLES whitelist —
 *  anything else is refused server-side with `table not writable here`. */
/** How a config row is addressed. Almost everything is keyed by a uuid; pass
 *  the columns as an object for the ones that are not — `app_content` is keyed
 *  by `{ key, lang }` and has no id column at all. */
export type ConfigKey = string | Record<string, string>;

export type ConfigTable =
  | 'pricing_plans' | 'packages' | 'subscriptions' | 'addons' | 'penalties'
  | 'promo_codes' | 'customer_groups' | 'loyalty_tiers' | 'pois'
  | 'faq_items' | 'app_content' | 'translations'
  | 'notification_rules' | 'customer_forms'
  | 'corporate_accounts' | 'staff';

export interface CreateVehicleInput {
  code: string;
  model_id: UUID;
  city_id?: string | null;
  plate?: string | null;
  vin?: string | null;
  notes?: string | null;
  /** Links an already-provisioned device by IMEI (Hard Rule #7: the IMEI lives
   *  on `devices`, never on the vehicle row). */
  imei?: string | null;
  status?: string;
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

/* ---------- Message centre (rider ↔ support live chat) ---------- */

/** One rider's conversation, folded to a single row for the queue list. */
export interface MessageThread {
  user_id: UUID;
  full_name: string | null;
  phone: string | null;
  last_body: string;
  last_at: string;
  last_sender: 'rider' | 'staff' | 'system';
  /** Rider turns since the last staff reply — 0 means nothing is waiting. */
  unanswered: number;
}

export interface ChatMessage {
  id: UUID;
  user_id: UUID;
  sender: 'rider' | 'staff' | 'system';
  body: string;
  created_at: string;
  staff_id: UUID | null;
}

/** Brand override as stored in `app_config.brand` — the exact JSON shape
 *  `brandFromConfig()` accepts. Kept as a loose record so a brand gaining new
 *  tokens does not need a panel release. */
export type BrandConfig = Record<string, unknown>;

/** Mutations `admin-mydata` accepts. Each one writes audit_log. */
/** Filters the receipts table applies at the database, not in the browser. */
export interface MydataListFilters {
  status?: string;
  source?: string;
  /** Matches charge id or MARK. */
  search?: string;
  limit?: number;
}

export type MydataAction =
  | 'retry' | 'cancel' | 'mark_filed' | 'review' | 'set_mode'
  // Issue-level, for the queue entries that have no receipt row behind them.
  | 'ack_issue' | 'ack_gap_range' | 'issue_receipt' | 'ack_historical';

/** One receipt with its evidence and everything already done to it. */
export interface MydataDetail {
  row: MydataSubmissionFull;
  payment: Payment | null;
  audit: Array<{ action: string; staff_id: string | null; reason: string | null; created_at: string }>;
}

export interface DataSource {
  readonly kind: 'supabase';

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
  /** Models + cities for the "add vehicle" form. */
  listVehicleModels(): Promise<Array<{ id: string; name: string }>>;
  createVehicle(input: CreateVehicleInput): Promise<{ id: string; code: string }>;
  /** `decommission` keeps the row and every trip pointing at it; `purge`
   *  really deletes and is refused server-side once the vehicle has history. */
  removeVehicle(vehicleId: string, reason: string, mode: 'decommission' | 'purge'): Promise<void>;

  // Vehicle — exhaustive history (edge fn `admin-vehicle-history`)
  /** Digital lines (DIN1/DOUT1/DOUT2) newest-first. Each value is null
   *  unless its AVL element was in the frame — see `VehicleIoFrame`. */
  getVehicleIo(vehicleId: string, limit?: number): Promise<VehicleIoFrame[]>;
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

  // Message centre (edge fn `admin-messages`)
  listMessageThreads(): Promise<MessageThread[]>;
  getMessageThread(userId: string): Promise<ChatMessage[]>;
  replyToMessage(userId: string, body: string): Promise<ChatMessage>;

  // White-label branding (`app_config.brand`)
  getBrandConfig(): Promise<BrandConfig | null>;
  saveBrandConfig(config: BrandConfig, reason: string): Promise<void>;

  // Zones
  listZones(): Promise<Zone[]>;
  saveZoneVersion(zones: Zone[], reason: string): Promise<number>;

  // Everything else (pricing, marketing, fleet, finance, team, settings, analytics)
  getPanelData(): Promise<PanelData>;

  // myDATA (AADE) — docs/18-mydata.md. Deliberately NOT folded into
  // getPanelData: the submissions table carries 20 months of receipt history,
  // and no other screen needs a byte of it.
  getMydata(): Promise<MydataState>;
  /** The receipts table, filtered server-side rather than over one fetched page. */
  getMydataList(f: MydataListFilters): Promise<MydataSubmission[]>;
  getMydataDetail(id: UUID): Promise<MydataDetail>;
  mydataMutate(action: MydataAction, body: Record<string, unknown>): Promise<void>;
  /** Day-by-day coverage of the shadow run. Empty until a shadow endpoint receives. */
  getMydataShadowCompare(): Promise<MydataShadowDay[]>;
  /** Run the myDATA worker once on demand — the scheduler stays off until go-live. */
  runMydataWorker(): Promise<{ processed: number; sent: number; failed: number; blocked: number }>;
  /** Dashboard rollup. Callers hide the tile on 403 rather than showing an error. */
  getMydataHealth(): Promise<MydataHealth | null>;
  /** Receipt state for a page of rides — one request per page, not per row. */
  getReceiptsForTrips(tripIds: UUID[]): Promise<PaymentReceipt[]>;

  // Global search
  search(q: string): Promise<SearchResult[]>;

  // Notifications / pop-ups / push (docs/12)
  listCustomerGroups(): Promise<CustomerGroupRow[]>;
  listBroadcasts(params: QueryParams): Promise<Page<BroadcastRow>>;
  /** `preview` resolves the audience and reports reach without sending. */
  previewBroadcast(input: BroadcastInput): Promise<BroadcastResult>;
  sendBroadcast(input: BroadcastInput): Promise<BroadcastResult>;

  /* ---- Configuration catalogues (pricing, marketing, content, team) ----
     One generic path per operation, backed by the `admin-write` edge function.
     It owns the whitelist: which table, which permission, which columns may be
     set, and whether a delete is a real delete or a deactivation. The panel
     therefore cannot write anything the server has not explicitly allowed. */
  configList<T>(table: ConfigTable, params: QueryParams): Promise<Page<T>>;
  configCreate<T>(table: ConfigTable, values: Record<string, unknown>, reason?: string): Promise<T>;
  configUpdate<T>(table: ConfigTable, key: ConfigKey, values: Record<string, unknown>, reason?: string): Promise<T>;
  /** Resolves with `deactivated: true` when the row is referenced by history and
   *  was flipped inactive instead of removed — say so in the UI. */
  configRemove(table: ConfigTable, key: ConfigKey, reason?: string): Promise<{ deleted?: boolean; deactivated?: boolean }>;

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

// There is exactly one data source: the live project. The mock source is gone on
// purpose — it used to be the DEFAULT whenever VITE_DATA_SOURCE was unset, so a
// deploy that merely forgot the variable served a panel full of invented rides,
// revenue and customers with nothing on screen saying so. A panel that cannot
// reach the backend has to look broken, not busy.
export async function getDataSource(): Promise<DataSource> {
  if (instance) return instance;
  const { SupabaseDataSource } = await import('./supabaseSource');
  instance = new SupabaseDataSource();
  return instance;
}
