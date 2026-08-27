// Shape of the single payload behind the panel (`admin-panel-data`).
//
// This type used to live inside the mock "database" and was called MockDb, so
// every real screen was typed against a fixture file. The fixtures are gone; the
// contract they described is real and stays here, under its own name.

import type { LngLat } from '@penny/db-types';
import type {
  City,
  VehicleModel,
  Zone,
  VehicleAlert,
  Command,
  Device,
  OpsTask,
  DamageReport,
  TripEvent,
  Poi,
  FaqItem,
} from '@penny/db-types';
import type {
  BatteryCurve,
  PricingPlan,
  Package,
  Subscription,
  Addon,
  PenaltyCatalogItem,
  PromoCode,
  CustomerGroup,
  PushCampaign,
  LoyaltyTier,
  Referral,
  LedgerAccount,
  LedgerEntry,
  Invoice,
  CorporateAccount,
  StaffMember,
  NotificationRule,
  NotificationLogEntry,
  Translation,
  AppConfigItem,
  Tutorial,
  KpiSnapshot,
  HeatCell,
  RevenueByDay,
  CohortRow,
  FunnelStep,
  DemandCell,
  RideRow,
  VehicleRow,
  CustomerRow,
  ScanLogRow,
  MaintenanceLogRow,
  BatterySwapRow,
  Payment,
  Debt,
  AuditLogEntry,
  SumsubProfileBundle,
  TimelineEvent,
  UserProfileFull,
  SimAlert,
  SimCostSummary,
  SimEvent,
  SimInventoryRow,
  SimUsageDay,
} from '@/types/domain';

/** Per-ride detail behind the exhaustive user/vehicle ride tables. */
export interface RideExtra {
  vehicle_model: string;
  rating: number | null;
  rating_tags: string[];
  start_zone_name: string | null;
  end_zone_name: string | null;
  minutes_cents: number;
  pause_cents: number;
  paid_parking_cents: number;
  payment_status: string | null;
  route: LngLat[];
}

export interface PanelData {
  cities: City[];
  models: VehicleModel[];
  batteryCurves: BatteryCurve[];
  vehicles: VehicleRow[];
  devices: Device[];
  /** Connectivity fleet (`v_sim_inventory`) — one row per SIM card. */
  sims: SimInventoryRow[];
  /** 30 days of daily usage, keyed by sim id (`v_sim_usage_30d`). */
  simUsage: Record<string, SimUsageDay[]>;
  /** Append-only lifecycle log, keyed by sim id (`sim_events`). */
  simEvents: Record<string, SimEvent[]>;
  simAlerts: SimAlert[];
  simCostSummary: SimCostSummary[];
  /** Last successful provider sync (null until "Sync from Truphone" is run). */
  simLastSyncAt: string | null;
  /** White-label brand override persisted in `app_config.brand` (null = default). */
  brandConfig: Record<string, unknown> | null;
  customers: CustomerRow[];
  rides: RideRow[];
  /** Per-ride detail behind the exhaustive user/vehicle ride tables. */
  rideExtras: Record<string, RideExtra>;
  /** Rich customer profiles, keyed by user id. */
  userProfiles: Record<string, UserProfileFull>;
  /** Sumsub applicant bundles, keyed by user id. */
  sumsub: Record<string, SumsubProfileBundle>;
  /** Merged activity timelines, keyed by user id / vehicle id. */
  userTimelines: Record<string, TimelineEvent[]>;
  vehicleTimelines: Record<string, TimelineEvent[]>;
  tripEvents: Record<string, TripEvent[]>;
  payments: Payment[];
  debts: Debt[];
  zones: Zone[];
  /** `note` and `count` are derived server-side from the row's `reason` and
   *  `payload`; `payload` is the full geometry of that version, which is what
   *  a rollback replays. */
  zoneVersions: Array<{
    version: number; created_at: string; created_by: string;
    note: string; count: number; payload?: unknown;
  }>;
  alerts: VehicleAlert[];
  commands: Command[];
  opsTasks: OpsTask[];
  damageReports: DamageReport[];
  staff: StaffMember[];
  kpis: KpiSnapshot;
  ledgerAccounts: LedgerAccount[];
  ledgerEntries: LedgerEntry[];
  invoices: Invoice[];
  corporate: CorporateAccount[];
  notificationRules: NotificationRule[];
  notificationLog: NotificationLogEntry[];
  promos: PromoCode[];
  groups: CustomerGroup[];
  campaigns: PushCampaign[];
  loyalty: LoyaltyTier[];
  referrals: Referral[];
  pois: Poi[];
  pricingPlans: PricingPlan[];
  packages: Package[];
  subscriptions: Subscription[];
  addons: Addon[];
  penalties: PenaltyCatalogItem[];
  translations: Translation[];
  appConfig: AppConfigItem[];
  tutorials: Tutorial[];
  faq: FaqItem[];
  heatCells: HeatCell[];
  revenueByDay: RevenueByDay[];
  cohorts: CohortRow[];
  funnel: FunnelStep[];
  demandCells: DemandCell[];
  scanLog: ScanLogRow[];
  maintenanceLog: MaintenanceLogRow[];
  batterySwaps: BatterySwapRow[];
  auditLog: AuditLogEntry[];
}
