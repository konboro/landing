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

/* ---- myDATA (AADE) receipt transmission — see docs/18-mydata.md ---- */

export type MydataStatus =
  | 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'skipped';
export type MydataMode = 'dry_run' | 'sandbox' | 'live';

export interface MydataSubmission {
  id: UUID;
  source: 'platform' | 'legacy';
  series: string;
  aa: number;
  issue_date: string;                 // YYYY-MM-DD
  gross_cents: number | null;         // null for imported legacy rows
  net_cents: number | null;
  vat_cents: number | null;
  mode: MydataMode;
  status: MydataStatus;
  mark: string | null;
  attempts: number;
  last_error: string | null;
  stripe_charge_id: string | null;
  payment_id: UUID | null;
  created_at: ISOTimestamp;
  sent_at: ISOTimestamp | null;
  /** Set when a person filed this through the AADE portal instead. */
  filed_manually: boolean;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: ISOTimestamp | null;
}

/**
 * A submission plus its evidence. Only ever fetched one at a time — the stored
 * document and response run to a couple of KB each, and there are 20 months of
 * them, so the list deliberately leaves them behind.
 */
export interface MydataSubmissionFull extends MydataSubmission {
  request_xml: string | null;
  response_body: string | null;
}

/** A number in an issued range that carries no MARK at AADE. */
export interface MydataGap {
  series: string;
  aa: number;
  reason: 'never_issued' | 'cancelled' | 'failed' | 'skipped';
  issue_date: string | null;
}

export interface MydataSeriesState {
  series: string;
  next_aa: number;
  floor_aa: number;
  active: boolean;
}

export type MydataIssueKind = 'failed' | 'no_receipt' | 'duplicate' | 'gap' | 'stalled';

/** One unit of work for the person reviewing myDATA. */
export interface MydataIssue {
  kind: MydataIssueKind;
  severity: 'high' | 'medium';
  submission_id: UUID | null;
  series: string | null;
  aa: number | null;
  issue_date: string | null;
  stripe_charge_id: string | null;
  gross_cents: number | null;
  detail: string;
  reviewed_at: ISOTimestamp | null;
  /**
   * Stable identity, present on every issue including the kinds with no receipt
   * row (`gap:ΑΠΥ:20676`, `payment:<uuid>`). This is what lets an issue be
   * acknowledged even when there is nothing to attach a note to.
   */
  issue_key: string;
  review_note: string | null;
}

/** A day's filing, as the emailed CSV used to report it. */
export interface MydataDailyRow {
  issue_date: string;
  series: string;
  mode: MydataMode;
  receipts: number;
  sent: number;
  filed_by_hand: number;
  failed: number;
  in_flight: number;
  cancelled: number;
  gross_cents: number;
  net_cents: number;
  vat_cents: number;
  first_aa: number;
  last_aa: number;
}

/**
 * What happened to one payment's tax receipt, as every screen renders it.
 *
 * `practice` is not a flavour of "done": it means the receipt was built while
 * the system was in dry_run or sandbox and has provably never reached AADE.
 */
export type ReceiptState =
  | 'filed'
  | 'in_flight'
  | 'failed'
  | 'practice'
  | 'not_filed'
  | 'missing'
  | 'not_chargeable'
  | 'unknown';

export interface PaymentReceipt {
  payment_id: UUID;
  trip_id: UUID | null;
  user_id: UUID | null;
  amount_cents: number;
  payment_status: string;
  submission_id: UUID | null;
  series: string | null;
  aa: number | null;
  receipt_status: MydataStatus | null;
  receipt_mode: MydataMode | null;
  receipt_state: ReceiptState;
  mark: string | null;
  filed_manually: boolean | null;
  last_error: string | null;
}

/** Single-row myDATA rollup for the dashboard. */
export interface MydataHealth {
  mode: MydataMode | null;
  enabled: boolean;
  today_receipts: number;
  today_filed: number;
  today_failed: number;
  today_gross_cents: number;
  h24_receipts: number;
  h24_filed: number;
  h24_failed: number;
  h24_gross_cents: number;
  d7_receipts: number;
  d7_filed: number;
  d7_failed: number;
  d7_by_hand: number;
  d7_gross_cents: number;
  in_flight: number;
  open_issues: number;
  payments_without_receipt: number;
  series_synced_at: ISOTimestamp | null;
}

export interface MydataState {
  mode: MydataMode;
  enabled: boolean;
  series: MydataSeriesState[];
  /** One page of receipts, newest number first — NOT the whole table. */
  submissions: MydataSubmission[];
  gaps: MydataGap[];
  issues: MydataIssue[];
  daily: MydataDailyRow[];
  /**
   * Counts from the database, covering every row rather than the page above.
   * With 20 months of history loaded, `submissions.length` is a page size and
   * showing it as a total would understate the table by an order of magnitude.
   */
  totals: { receipts: number; by_status: Record<string, number> };
  /** Succeeded payments with no submission row at all. */
  payments_without_receipt: number;
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

/* =========================================================================
   Connectivity — SIM cards (provider: Truphone / 1GLOBAL behind an adapter)

   Declared locally on purpose: the `sims` / `sim_usage_daily` / `sim_events`
   tables and the `v_sim_*` views land in a parallel backend change, so the
   panel must not depend on @penny/db-types gaining these names yet. The
   shapes mirror the views 1:1 — when db-types catches up these can be
   re-exported instead of re-declared.

   ICCID / IMSI / MSISDN / IMEI are stored and rendered EXACTLY as provided
   by the provider (Hard Rule #10) — never reformatted, never grouped.
   ========================================================================= */

export type SimStatus = 'inventory' | 'active' | 'suspended' | 'terminated' | 'test';

/** Derived per-SIM health, computed by `v_sim_inventory`. */
export type SimHealth = 'ok' | 'near_limit' | 'over_limit' | 'no_usage' | 'silent' | 'unassigned';

/** One row of `v_sim_inventory` (SIM joined to device → vehicle + cycle usage). */
export interface SimInventoryRow {
  id: UUID;
  /** Integrated Circuit Card ID — the physical SIM identity. Exact text. */
  iccid: string;
  imsi: string;
  /** The number the gateway sends SMS-fallback commands to (docs/03). */
  msisdn: string;
  provider: string;
  /** Provider-side primary key, used by the sync adapter. */
  provider_sim_id: string;
  status: SimStatus;

  plan_name: string;
  plan_data_mb: number;
  /** Billing cycle bounds (date-only, YYYY-MM-DD). */
  cycle_start: string;
  cycle_end: string;
  monthly_cost_cents: number;

  device_id: UUID | null;
  device_imei: string | null;
  vehicle_id: UUID | null;
  vehicle_code: string | null;
  vehicle_status: string | null;

  label: string;
  notes: string | null;

  last_seen_at: ISOTimestamp | null;
  network: string | null;
  country: string | null;

  data_used_mb_cycle: number;
  data_pct_used: number;
  cost_mtd_cents: number;
  days_since_seen: number | null;
  health: SimHealth;
}

/** One row of `sim_usage_daily` / `v_sim_usage_30d`. */
export interface SimUsageDay {
  day: string; // YYYY-MM-DD
  data_mb: number;
  sms_out: number;
  sms_in: number;
  cost_cents: number;
  network: string;
  country: string;
}

/** One row of `sim_events` (append-only lifecycle log). */
export interface SimEvent {
  at: ISOTimestamp;
  kind: string;
  detail: string;
  staff_id: string | null;
  reason: string | null;
}

/** One row of `v_sim_alerts`. */
export interface SimAlert {
  sim_id: UUID;
  iccid: string;
  severity: 'info' | 'warning' | 'critical';
  reason: string;
  vehicle_code: string | null;
}

/** One row of `v_sim_cost_summary` (per calendar month). */
export interface SimCostSummary {
  month: string; // YYYY-MM
  sims_active: number;
  total_data_mb: number;
  total_cost_cents: number;
  avg_cost_cents: number;
  sms_total: number;
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

/* =========================================================================
   Sumsub KYC — admin-side view models.
   Shapes mirror the Sumsub applicant API (`/resources/applicants/...`) as it
   is proxied by the `sumsub-applicant` edge function. Declared locally on
   purpose: @penny/db-types must not gain KYC PII columns (Hard Rule #11) —
   nothing here is persisted in Penny tables, it is rendered straight from
   the provider response (or its short-lived server-side cache).
   ========================================================================= */

export type SumsubReviewStatus = 'init' | 'pending' | 'prechecked' | 'queued' | 'completed' | 'onHold';
export type SumsubReviewAnswer = 'GREEN' | 'RED' | null;
export type SumsubRejectType = 'FINAL' | 'RETRY' | null;
export type SumsubDocType = 'ID_CARD' | 'PASSPORT' | 'DRIVERS' | 'SELFIE' | 'RESIDENCE_PERMIT' | 'UTILITY_BILL';
export type SumsubDocSubType = 'FRONT_SIDE' | 'BACK_SIDE' | null;

export interface SumsubDocument {
  image_id: string;
  doc_type: SumsubDocType;
  doc_sub_type: SumsubDocSubType;
  country: string | null;
  valid_until: string | null;
  review_answer: SumsubReviewAnswer;
  reject_labels: string[];
  /** Data-URI in mock mode; short-lived signed URL from the edge fn in prod. */
  url: string;
  content_type: string;
  added_at: ISOTimestamp | null;
}

export interface SumsubReviewEvent {
  at: ISOTimestamp;
  review_status: SumsubReviewStatus;
  review_answer: SumsubReviewAnswer;
  reject_labels: string[];
  moderation_comment: string | null;
}

export interface SumsubProfile {
  applicant_id: string;
  level: string;
  inspection_id: string | null;
  external_user_id: string | null;

  review_status: SumsubReviewStatus;
  review_answer: SumsubReviewAnswer;
  review_reject_type: SumsubRejectType;
  reject_labels: string[];
  moderation_comment: string | null;
  client_comment: string | null;

  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  dob: string | null;
  nationality: string | null;
  country: string | null;
  place_of_birth: string | null;
  gender: 'M' | 'F' | 'X' | null;

  id_doc_type: SumsubDocType | null;
  id_doc_number: string | null;
  id_doc_expiry: string | null;
  id_doc_country: string | null;

  phone: string | null;
  email: string | null;

  applicant_created_at: ISOTimestamp | null;
  reviewed_at: ISOTimestamp | null;

  /** true = fetched live from Sumsub just now, false = served from cache. */
  live: boolean;
}

/** What `getSumsubProfile()` returns. `applicant === null` ⇒ no applicant yet. */
export interface SumsubProfileBundle {
  applicant: SumsubProfile | null;
  documents: SumsubDocument[];
  history: SumsubReviewEvent[];
  fetched_at: ISOTimestamp;
  /** Where the payload came from — surfaced as a "live / cached" chip. */
  source: 'live' | 'cache';
}

/* =========================================================================
   Exhaustive ride history (user + vehicle views)
   ========================================================================= */

export interface RideCostBreakdown {
  unlock_cents: number;
  minutes_cents: number;
  pause_cents: number;
  paid_parking_cents: number;
  bonus_cents: number;
  discount_cents: number;
  penalty_cents: number;
  total_cents: number;
  currency: string;
}

export interface RideHistoryBase {
  id: UUID;
  started_at: ISOTimestamp | null;
  ended_at: ISOTimestamp | null;
  status: string;
  duration_s: number;
  pause_s: number;
  distance_m: number;
  avg_speed_kmh: number;
  cost: RideCostBreakdown;
  cost_cents: number;
  currency: string;
  photo_review: string | null;
  rating: number | null;
  rating_tags: string[];
  start_zone_name: string | null;
  end_zone_name: string | null;
  start_lng: number;
  start_lat: number;
  end_lng: number | null;
  end_lat: number | null;
  route: Array<[number, number]>;
  payment_status: string | null;
  has_dispute: boolean;
  has_penalty: boolean;
  city_name: string;
}

/** One row of a *user's* ride history (vehicle is the "other side"). */
export interface UserRideHistoryRow extends RideHistoryBase {
  vehicle_id: UUID;
  vehicle_code: string;
  vehicle_model: string;
}

/** One row of a *vehicle's* ride history (rider is the "other side"). */
export interface VehicleRideHistoryRow extends RideHistoryBase {
  user_id: UUID;
  user_name: string;
  /** Masked for support screens — full number only on the customer page. */
  user_phone_masked: string;
}

/* =========================================================================
   Aggregates
   ========================================================================= */

export interface UserStats {
  total_rides: number;
  rides_7d: number;
  rides_30d: number;
  total_distance_m: number;
  total_duration_s: number;
  total_spend_cents: number;
  avg_ride_cost_cents: number;
  avg_distance_m: number;
  avg_duration_s: number;
  avg_rating: number | null;
  rating_count: number;
  co2_saved_kg: number;
  open_debt_cents: number;
  penalties_count: number;
  penalties_cents: number;
  disputes_count: number;
  refunds_cents: number;
  first_ride_at: ISOTimestamp | null;
  last_ride_at: ISOTimestamp | null;
  favourite_vehicle_code: string | null;
  favourite_end_zone: string | null;
  photo_reject_rate_pct: number;
}

export interface VehicleStats {
  total_rides: number;
  rides_7d: number;
  rides_30d: number;
  revenue_cents: number;
  revenue_30d_cents: number;
  avg_distance_m: number;
  avg_duration_s: number;
  total_distance_m: number;
  utilization_rides_per_day: number;
  unique_riders: number;
  avg_rating: number | null;
  last_ride_at: ISOTimestamp | null;
  first_ride_at: ISOTimestamp | null;
  penalties_count: number;
  damage_count: number;
  battery_swaps: number;
  maintenance_cost_cents: number;
}

/* =========================================================================
   Unified timeline (rides, money, KYC, commands, ops, alerts…)
   ========================================================================= */

export type TimelineKind =
  | 'ride'
  | 'payment'
  | 'refund'
  | 'penalty'
  | 'debt'
  | 'kyc'
  | 'command'
  | 'status'
  | 'alert'
  | 'damage'
  | 'battery_swap'
  | 'maintenance'
  | 'notification'
  | 'support'
  | 'loyalty'
  | 'referral'
  | 'account';

export interface TimelineEvent {
  id: string;
  at: ISOTimestamp;
  kind: TimelineKind;
  title: string;
  detail: string;
  ref_id: string | null;
  /** Optional in-panel deep link (e.g. `/rides/trip-0042`). */
  link?: string | null;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

/* =========================================================================
   Rich customer profile ("dokładne dane")
   ========================================================================= */

export interface UserAddress {
  line1: string;
  line2: string | null;
  city: string;
  postcode: string;
  country: string;
}

export interface UserConsents {
  tos_accepted_at: ISOTimestamp | null;
  tos_version: string;
  privacy_accepted_at: ISOTimestamp | null;
  privacy_version: string;
  marketing_consent: boolean;
  marketing_consent_at: ISOTimestamp | null;
  data_processing_at: ISOTimestamp | null;
  age_confirmed: boolean;
}

export interface UserNotificationPrefs {
  push_trip_receipts: boolean;
  push_promotions: boolean;
  email_receipts: boolean;
  email_newsletter: boolean;
  sms_critical: boolean;
}

export interface UserNote {
  id: UUID;
  at: ISOTimestamp;
  author: string;
  body: string;
}

export interface UserDevice {
  id: string;
  platform: 'ios' | 'android' | 'web';
  model: string;
  app_version: string;
  os_version: string;
  last_seen: ISOTimestamp;
  push_token_masked: string;
}

export interface UserPaymentMethod {
  id: UUID;
  brand: string;
  last4: string;
  exp: string;
  is_default: boolean;
  status: 'valid' | 'expired' | 'requires_action';
  added_at: ISOTimestamp;
}

export interface UserFormAnswer {
  question: string;
  answer: string;
}

export interface UserLoyaltyEvent {
  id: string;
  at: ISOTimestamp;
  points: number;
  reason: string;
}

/** Everything the customer detail page needs in one shot. */
export interface UserProfileFull {
  customer: CustomerRow;

  avatar_url: string;
  date_of_birth: string | null;
  nationality: string;
  gender: 'M' | 'F' | 'X' | null;
  address: UserAddress;
  preferred_lang: Lang;
  email_verified: boolean;
  phone_verified: boolean;
  signup_source: 'ios' | 'android' | 'web' | 'referral';
  signup_at: ISOTimestamp;
  last_active_at: ISOTimestamp;
  risk_score: number;
  risk_reasons: string[];
  tags: string[];
  notes: UserNote[];
  customer_group_name: string | null;
  corporate_id: UUID | null;
  corporate_name: string | null;
  loyalty_tier: string;
  loyalty_points: number;
  loyalty_events: UserLoyaltyEvent[];
  referrals_sent: number;
  referrals_qualified: number;
  referral_code: string;
  wallet_balance_cents: number;
  /** Pre-migration Atom history — counted in CustomerRow.rides, not in stats. */
  legacy_rides: number;
  legacy_spend_cents: number;
  emergency_contact_name: string | null;
  consents: UserConsents;
  notification_prefs: UserNotificationPrefs;
  payment_methods: UserPaymentMethod[];
  devices: UserDevice[];
  form_answers: UserFormAnswer[];
  stats: UserStats;
}

/* =========================================================================
   Broadcasts — staff-composed sends to inbox / pop-up / push (docs/12).
   Mirrors `v_admin_broadcasts`.
   ========================================================================= */

export interface BroadcastRow {
  id: UUID;
  title: string;
  body: string;
  channels: string[];
  category: 'transactional' | 'marketing';
  status: 'draft' | 'sending' | 'sent' | 'failed';
  /** Rendered server-side: "Everyone" / "Group: Students" / "Users: 3". */
  audience_label: string;
  recipients: number;
  delivered: number;
  push_sent: number;
  push_failed: number;
  expires_at: ISOTimestamp | null;
  reason: string | null;
  created_by_name: string;
  created_at: ISOTimestamp;
  sent_at: ISOTimestamp | null;
}

export interface CustomerGroupRow {
  id: UUID;
  name: string;
  members: number;
}

/** One telemetry frame's digital lines, as `v_vehicle_io` reports them.
 *  A line is `null` unless its AVL element was actually present in the frame —
 *  `*_reported` is what distinguishes "low" from "never measured". */
export interface VehicleIoFrame {
  vehicle_id: UUID;
  device_id: UUID | null;
  device_ts: ISOTimestamp | null;
  at: ISOTimestamp;
  din1: boolean | null;
  dout1: boolean | null;
  dout2: boolean | null;
  din1_reported: boolean;
  dout1_reported: boolean;
  dout2_reported: boolean;
  speed_kmh: number | null;
  ext_voltage_mv: number | null;
  batt_voltage_mv: number | null;
  gsm_signal: number | null;
  io: Record<string, number>;
}

/** Exactly what `admin-vehicle-history` returns: one flat snapshot, no paging.
 *  Declared so the panel stops guessing that endpoint's shape — the previous
 *  guess (`Page<T>` with a `section` argument) is what blanked the Rides,
 *  Timeline and Damage tabs. */
export interface VehicleHistorySnapshot {
  vehicle: VehicleRow;
  device: unknown;
  state: unknown;
  stats: VehicleStats | null;
  /** RAW view rows — run them through toVehicleRideRow() before rendering. */
  rides: Array<Record<string, unknown>>;
  total_rides: number;
  /** RAW view rows —  is jsonb; map with toTimelineEvent(). */
  timeline: Array<Record<string, unknown>>;
  commands: unknown[];
  alerts: unknown[];
  status_log: unknown[];
  damage: unknown[];
  maintenance: unknown[];
  battery_swaps: unknown[];
  telemetry_summary: unknown[];
}
