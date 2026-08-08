// Admin-panel domain types. Reuses @penny/db-types where possible and adds
// the extra shapes the panel needs (pricing, marketing, finance, notifications,
// analytics) that aren't yet in the shared model layer.
import type {
  UUID,
  ISOTimestamp,
  GeoPoint,
  Lang,
  StaffRole,
  NotificationChannel,
  Vehicle,
  Trip,
  User,
} from '@penny/db-types';

export type {
  UUID,
  ISOTimestamp,
  Debt,
  AuditLogEntry,
  Payment,
  DamageReport,
  OpsTask,
  ChecklistItem,
} from '@penny/db-types';

/* ---------- Battery curves ---------- */
export interface BatteryCurve {
  id: UUID;
  model_id: UUID;
  name: string;
  points: Array<[number, number]>; // [voltage_mv, soc_pct]
}

/* ---------- Telemetry sample (for charts / IoT log) ---------- */
export interface TelemetrySample {
  device_ts: ISOTimestamp;
  server_ts: ISOTimestamp;
  pos: GeoPoint;
  speed_kmh: number;
  ext_voltage_mv: number;
  batt_voltage_mv: number;
  soc_pct: number;
  din1: boolean;
  dout1: boolean;
  dout2: boolean;
  gsm_signal: number;
  sats: number;
}

/* ---------- Pricing ---------- */
export interface PricingPlan {
  id: UUID;
  city_id: UUID;
  model_id: UUID;
  unlock_cents: number;
  per_min_cents: number;
  pause_per_min_cents: number;
  day_cap_cents: number | null;
  valid_from: ISOTimestamp | null;
  valid_to: ISOTimestamp | null;
  active: boolean;
  dynamic: {
    happy_hours: Array<{ dow: number; from: string; to: string; multiplier: number }>;
    demand: { enabled: boolean; cell_size_m: number; cap: number };
  };
}

export interface Package {
  id: UUID;
  name: string;
  minutes: number;
  price_cents: number;
  validity_days: number;
  active: boolean;
  sold: number;
}

export interface Subscription {
  id: UUID;
  name: string;
  stripe_price_id: string;
  price_cents: number;
  perks: string[];
  active: boolean;
  active_subs: number;
}

export interface Addon {
  id: UUID;
  name: string;
  kind: 'insurance' | 'helmet' | 'other';
  price_cents: number;
  per: 'trip' | 'month';
  active: boolean;
}

export interface PenaltyCatalogItem {
  id: UUID;
  code: string;
  label: string;
  tiers_cents: number[];
  requires_photo: boolean;
  appealable: boolean;
  active: boolean;
}

/* ---------- Marketing ---------- */
export interface PromoCode {
  id: UUID;
  code: string;
  kind: 'percent' | 'fixed' | 'free_minutes';
  value: number;
  max_uses: number;
  used: number;
  per_user_limit: number;
  valid_from: ISOTimestamp | null;
  valid_to: ISOTimestamp | null;
  new_users_only: boolean;
  city_id: UUID | null;
  active: boolean;
}

export interface CustomerGroup {
  id: UUID;
  name: string;
  kind: 'manual' | 'rule';
  rules: Array<{ field: string; op: string; value: string }>;
  member_count: number;
}

export interface PushCampaign {
  id: UUID;
  title: string;
  body: string;
  segment: string;
  scheduled_at: ISOTimestamp | null;
  sent_count: number;
  status: 'draft' | 'scheduled' | 'sending' | 'sent';
  channel: 'push' | 'email';
  open_rate: number;
}

export interface LoyaltyTier {
  id: UUID;
  name: string;
  min_points: number;
  perks: string[];
}

export interface Referral {
  id: UUID;
  referrer_id: UUID;
  referrer_name: string;
  referee_id: UUID;
  referee_name: string;
  status: 'pending' | 'qualified' | 'rewarded';
  reward_cents: number;
  created_at: ISOTimestamp;
}

/* ---------- Finance / ledger ---------- */
export interface LedgerAccount {
  id: UUID;
  kind: 'user_wallet' | 'penny_revenue' | 'stripe_clearing' | 'debt' | 'bonus' | 'corporate';
  owner_id: UUID | null;
  owner_label: string;
  balance_cents: number;
}

export interface LedgerEntry {
  id: UUID;
  txn_id: UUID;
  account_id: UUID;
  account_kind: LedgerAccount['kind'];
  delta_cents: number;
  currency: string;
  created_at: ISOTimestamp;
  memo: string;
}

export interface Invoice {
  id: UUID;
  number: string;
  user_id: UUID | null;
  corporate_id: UUID | null;
  party_label: string;
  amount_cents: number;
  mydata_mark: string | null;
  mydata_status: 'pending' | 'transmitted' | 'failed' | 'not_required';
  issued_at: ISOTimestamp;
  pdf_url: string;
}

export interface CorporateAccount {
  id: UUID;
  name: string;
  billing_email: string;
  monthly_invoicing: boolean;
  member_count: number;
  mtd_spend_cents: number;
  stripe_customer_id: string;
}

/* ---------- Team ---------- */
export interface StaffMember {
  id: UUID;
  user_id: UUID;
  name: string;
  email: string;
  role: StaffRole;
  city_scope: string[];
  active: boolean;
  last_active: ISOTimestamp;
}

/* ---------- Notifications ---------- */
export interface NotificationRule {
  id: UUID;
  event_kind: string;
  label: string;
  audience: 'staff' | 'rider';
  condition: Record<string, unknown>;
  channels: NotificationChannel[];
  recipients: string[];
  throttle_s: number;
  digest: 'none' | 'hourly' | 'daily';
  quiet_hours: { from: string; to: string } | null;
  active: boolean;
}

export interface NotificationLogEntry {
  id: UUID;
  rule_id: UUID | null;
  channel: NotificationChannel;
  template_key: string;
  target: string;
  status: 'queued' | 'sent' | 'failed' | 'suppressed';
  sent_at: ISOTimestamp;
}

/* ---------- Settings / content ---------- */
export interface Translation {
  ns: string;
  key: string;
  pl: string;
  en: string;
  el: string;
}

export interface AppConfigItem {
  key: string;
  label: string;
  group: string;
  value: string | number | boolean;
  kind: 'number' | 'text' | 'bool' | 'time';
  unit?: string;
}

export interface Tutorial {
  id: UUID;
  key: string;
  title: string;
  lang: Lang;
  slides: Array<{ title: string; body: string }>;
}

/* ---------- Analytics ---------- */
export interface KpiSnapshot {
  active_rides: number;
  today_revenue_cents: number;
  today_rides: number;
  new_users_today: number;
  open_debts_cents: number;
  open_debts_count: number;
  unlock_success_pct: number;
  fleet_by_status: Record<string, number>;
  spark_revenue: number[];
  spark_rides: number[];
  spark_users: number[];
  spark_unlock: number[];
}

export interface HeatCell {
  lng: number;
  lat: number;
  weight: number;
  hour: number;
  dow: number;
  kind: 'start' | 'end' | 'idle';
}

export interface RevenueByDay {
  date: string;
  trips_cents: number;
  packages_cents: number;
  subs_cents: number;
  penalties_cents: number;
  rides: number;
}

export interface CohortRow {
  cohort: string;
  size: number;
  ltv_cents: number;
  retention: number[]; // week 0..n retention %
}

export interface FunnelStep {
  step: string;
  count: number;
}

export interface DemandCell {
  id: string;
  label: string;
  demand: number;
  supply: number;
  lng: number;
  lat: number;
}

/* ---------- Denormalized "view" rows for tables ---------- */
export interface RideRow extends Trip {
  user_name: string;
  user_phone: string;
  vehicle_code: string;
  city_name: string;
  has_dispute: boolean;
  has_penalty: boolean;
}

export interface VehicleRow extends Vehicle {
  model_name: string;
  city_name: string;
  soc_pct: number | null;
  last_seen: ISOTimestamp | null;
  session_online: boolean;
  rides_today: number;
  idle_hours: number;
  imei: string | null;
  lng: number;
  lat: number;
}

export interface CustomerRow extends User {
  rides: number;
  spend_cents: number;
  debt_cents: number;
  city_name: string;
}

export interface ScanLogRow {
  id: UUID;
  user_id: UUID;
  user_name: string;
  vehicle_code_scanned: string;
  resolved_vehicle_id: UUID | null;
  result: 'ok' | 'not_found' | 'unavailable';
  created_at: ISOTimestamp;
}

export interface MaintenanceLogRow {
  id: UUID;
  vehicle_id: UUID;
  vehicle_code: string;
  task_id: UUID | null;
  parts: string;
  cost_cents: number;
  notes: string;
  created_at: ISOTimestamp;
}

export interface BatterySwapRow {
  id: UUID;
  vehicle_id: UUID;
  vehicle_code: string;
  by_name: string;
  at: ISOTimestamp;
  voltage_before: number;
  voltage_after: number;
}

/* Verification queue item */
export interface VerificationItem {
  trip: RideRow;
  ai_confidence: number;
  ai_verdict: 'auto_ok' | 'needs_review';
  photo_url: string;
  queued_at: ISOTimestamp;
}
