// Hand-written domain models used across apps/services.
// When Supabase generates `database.types.ts`, these can be derived from it;
// until then these are the source of truth for the shared client + UI.

import type {
  KycStatus,
  UserStatus,
  VehicleKind,
  VehicleStatus,
  DeviceModel,
  DeviceStatus,
  ServerProfile,
  ZoneKind,
  TripStatus,
  PhotoReview,
  CommandKind,
  CommandStatus,
  CommandChannel,
  AlertKind,
  PaymentKind,
  PaymentStatus,
  DebtStatus,
  OpsTaskKind,
  OpsTaskStatus,
  DamageSeverity,
  DamageStatus,
  StaffRole,
  Lang,
} from './enums.js';

export type UUID = string;
export type ISOTimestamp = string;
/** [lng, lat] — GeoJSON order. */
export type LngLat = [number, number];

export interface GeoPoint {
  type: 'Point';
  coordinates: LngLat;
}
export interface GeoPolygon {
  type: 'Polygon';
  coordinates: LngLat[][];
}

export interface City {
  id: UUID;
  name: string;
  tz: string;
  currency: string;
  center: GeoPoint;
  default_zoom: number;
}

export interface User {
  id: UUID;
  phone: string;
  email: string | null;
  full_name: string | null;
  legacy_atom_user_id: string | null;
  sumsub_applicant_id: string | null;
  kyc_status: KycStatus;
  customer_group_id: UUID | null;
  status: UserStatus;
  blocked_reason: string | null;
  marketing_consent: boolean;
  tos_accepted_at: ISOTimestamp | null;
  privacy_accepted_at: ISOTimestamp | null;
  score: number;
  emergency_contact: string | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;

  // Extended profile (migration 00180). Nullable — older/migrated rows may not
  // have them, and riders are never forced to supply them.
  date_of_birth: string | null;
  nationality: string | null;
  gender: string | null;
  address_line: string | null;
  address_city: string | null;
  address_postcode: string | null;
  address_country: string | null;
  avatar_url: string | null;
  preferred_lang: Lang | null;
  email_verified: boolean;
  phone_verified: boolean;
  signup_source: string | null;
  signup_city_id: UUID | null;
  last_active_at: ISOTimestamp | null;
  risk_score: number;
  tags: string[];
  internal_notes: string | null;
  deleted_at: ISOTimestamp | null;
}

export interface VehicleModel {
  id: UUID;
  name: string;
  kind: VehicleKind;
  battery_curve_id: UUID | null;
  max_speed_kmh: number;
  deposit_cents: number;
  requires_licence: boolean;
  photo_url: string | null;
}

export interface Vehicle {
  id: UUID;
  code: string;
  model_id: UUID;
  status: VehicleStatus;
  visible: boolean;
  plate: string | null;
  vin: string | null;
  city_id: UUID | null;
  notes: string | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
}

export interface Device {
  id: UUID;
  imei: string;
  /**
   * The ICCID printed on the SIM fitted in this device — the label of record, kept
   * exactly as entered (Hard Rule #10). `sim_id` is the managed relational link.
   */
  iccid: string | null;
  phone_number: string | null;
  model: DeviceModel;
  fw_version: string | null;
  vehicle_id: UUID | null;
  server_profile: ServerProfile;
  added_by: UUID | null;
  status: DeviceStatus;
  /** The device's current managed SIM (migration 00210). Null until sim-sync links it. */
  sim_id: UUID | null;
}

/** The ONLY table apps subscribe to for live vehicle data. */
export interface VehicleState {
  vehicle_id: UUID;
  pos: GeoPoint | null;
  soc_pct: number | null;
  speed_kmh: number | null;
  ignition: boolean;
  locked: boolean;
  last_seen: ISOTimestamp | null;
  session_online: boolean;
  fall: boolean;
  power_cut: boolean;
  moved_while_locked: boolean;
  zone_cache: Record<string, unknown> | null;
}

/**
 * Rider-facing projection of vehicle_state (no IMEI, no alarms) — a row of
 * `v_public_vehicles`, the only vehicle feed riders may read (`vehicle_state`
 * itself is default-deny; see migration 00140).
 *
 * The view projects the position as two plain numbers, not a GeoJSON point.
 * This type declared `pos: GeoPoint`, which nothing ever returned, so the map
 * threw "Cannot read property 'coordinates' of undefined" for every rider.
 * Keep these fields in step with the view definition.
 */
export interface PublicVehicle {
  vehicle_id: UUID;
  code: string;
  model_id: UUID;
  kind: VehicleKind;
  lng: number;
  lat: number;
  soc_pct: number;
  range_m: number;
  max_speed_kmh: number;
}

export interface VehicleAlert {
  id: UUID;
  vehicle_id: UUID;
  kind: AlertKind;
  payload: Record<string, unknown>;
  ack_by: UUID | null;
  ack_at: ISOTimestamp | null;
  created_at: ISOTimestamp;
}

export interface Command {
  id: UUID;
  vehicle_id: UUID;
  device_id: UUID;
  kind: CommandKind;
  payload: Record<string, unknown>;
  status: CommandStatus;
  channel: CommandChannel;
  requested_by: UUID | null;
  trip_id: UUID | null;
  sent_at: ISOTimestamp | null;
  acked_at: ISOTimestamp | null;
  error: string | null;
  created_at: ISOTimestamp;
}

export interface Zone {
  id: UUID;
  city_id: UUID;
  kind: ZoneKind;
  geom: GeoPolygon;
  rules: ZoneRules;
  active: boolean;
  valid_from: ISOTimestamp | null;
  valid_to: ISOTimestamp | null;
  version: number;
  created_by: UUID | null;
  name?: string | null;
}

export interface ZoneRules {
  bonus_cents?: number;
  fee_cents?: number;
  limit_kmh?: number;
  station_capacity?: number;
  [k: string]: unknown;
}

export interface PricingSnapshot {
  unlock_cents: number;
  per_min_cents: number;
  pause_per_min_cents: number;
  day_cap_cents: number | null;
  currency: string;
  multiplier: number;
  addons?: { kind: string; price_cents: number }[];
}

export interface Trip {
  id: UUID;
  user_id: UUID;
  vehicle_id: UUID;
  status: TripStatus;
  group_id: UUID | null;
  reserved_at: ISOTimestamp | null;
  started_at: ISOTimestamp | null;
  ended_at: ISOTimestamp | null;
  start_pos: GeoPoint | null;
  end_pos: GeoPoint | null;
  distance_m: number;
  duration_s: number;
  pause_s: number;
  pricing_snapshot: PricingSnapshot | null;
  cost_cents: number;
  discount_cents: number;
  bonus_cents: number;
  penalty_cents: number;
  currency: string;
  end_photo_url: string | null;
  photo_review: PhotoReview | null;
  end_zone_id: UUID | null;
  corporate_id: UUID | null;
  promo_redemption_id: UUID | null;
  created_at: ISOTimestamp;
}

export interface TripEvent {
  id: UUID;
  trip_id: UUID;
  from_status: TripStatus | null;
  to_status: TripStatus;
  at: ISOTimestamp;
  actor: 'user' | 'system' | 'admin' | 'ops';
  meta: Record<string, unknown>;
}

export interface PaymentMethod {
  id: UUID;
  user_id: UUID;
  stripe_pm_id: string;
  brand: string;
  last4: string;
  exp: string;
  status: string;
  is_default: boolean;
}

export interface Payment {
  id: UUID;
  user_id: UUID;
  trip_id: UUID | null;
  stripe_pi_id: string | null;
  amount_cents: number;
  kind: PaymentKind;
  status: PaymentStatus;
  failure_code: string | null;
  initiated_by: 'system' | 'user' | 'admin';
  admin_reason: string | null;
  created_at: ISOTimestamp;
}

export interface Debt {
  id: UUID;
  user_id: UUID;
  amount_cents: number;
  source: 'failed_trip_payment' | 'penalty' | 'chargeback';
  status: DebtStatus;
  next_retry_at: ISOTimestamp | null;
  attempts: number;
  created_at: ISOTimestamp;
}

export interface OpsTask {
  id: UUID;
  kind: OpsTaskKind;
  vehicle_id: UUID | null;
  zone_id: UUID | null;
  priority: number;
  status: OpsTaskStatus;
  assignee: UUID | null;
  due_at: ISOTimestamp | null;
  checklist: ChecklistItem[];
  photos: string[];
  notes: string | null;
  created_by: 'admin' | 'system_rule';
  completed_at: ISOTimestamp | null;
  created_at: ISOTimestamp;
}

export interface ChecklistItem {
  key: string;
  label: string;
  required_photo: boolean;
  done: boolean;
}

export interface DamageReport {
  id: UUID;
  vehicle_id: UUID;
  reporter: 'rider' | 'ops' | 'admin';
  user_id: UUID | null;
  trip_id: UUID | null;
  description: string;
  photos: string[];
  severity: DamageSeverity;
  status: DamageStatus;
  linked_task_id: UUID | null;
  penalty_payment_id: UUID | null;
  created_at: ISOTimestamp;
}

export interface Staff {
  id: UUID;
  user_id: UUID;
  role: StaffRole;
  city_scope: UUID[] | null;
  active: boolean;
}

export interface AuditLogEntry {
  id: UUID;
  staff_id: UUID | null;
  action: string;
  entity: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  at: ISOTimestamp;
}

export interface InboxMessage {
  id: UUID;
  user_id: UUID;
  title: string;
  body: string;
  deep_link: string | null;
  read_at: ISOTimestamp | null;
  created_at: ISOTimestamp;
  /** notification = one-way system message, chat = a support conversation
   *  turn, popup = a notification rendered as an interrupting modal. */
  kind?: 'notification' | 'chat' | 'popup';
  sender?: 'system' | 'rider' | 'staff';
  /** Pop-ups only: stop showing after this instant. */
  expires_at?: ISOTimestamp | null;
}

export interface AppConfig {
  key: string;
  value: unknown;
}

export interface FaqItem {
  id: UUID;
  lang: Lang;
  question: string;
  answer: string;
  sort: number;
}

export interface Poi {
  id: UUID;
  city_id: UUID;
  name: string;
  kind: string;
  pos: GeoPoint;
  icon: string | null;
  active: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   KYC (Sumsub) — migration 00180.
   Service-role only in the DB; apps receive these through edge functions.
   `raw` is never sent to a client (Hard Rule #11: PII minimization).
   ═══════════════════════════════════════════════════════════════════════════ */

export type SumsubReviewStatus =
  | 'init'
  | 'pending'
  | 'prechecked'
  | 'queued'
  | 'completed'
  | 'onHold';

export type SumsubReviewAnswer = 'GREEN' | 'RED';
export type SumsubRejectType = 'FINAL' | 'RETRY';

export interface SumsubApplicant {
  id: UUID;
  user_id: UUID;
  applicant_id: string;
  external_user_id: string | null;
  level_name: string | null;
  inspection_id: string | null;
  review_status: SumsubReviewStatus | null;
  review_answer: SumsubReviewAnswer | null;
  review_reject_type: SumsubRejectType | null;
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
  gender: string | null;
  id_doc_type: string | null;
  /** Masked before it leaves the server. */
  id_doc_number: string | null;
  id_doc_expiry: string | null;
  id_doc_country: string | null;
  phone: string | null;
  email: string | null;
  applicant_created_at: ISOTimestamp | null;
  reviewed_at: ISOTimestamp | null;
  synced_at: ISOTimestamp | null;
}

export interface SumsubDocument {
  image_id: string;
  doc_type: string | null;
  doc_sub_type: string | null;
  country: string | null;
  valid_until: string | null;
  review_answer: SumsubReviewAnswer | null;
  reject_labels: string[];
  content_type: string | null;
  /** Short-lived signed URL into the private `kyc-docs` bucket. */
  url: string | null;
}

export interface SumsubReviewHistoryEntry {
  at: ISOTimestamp;
  review_status: SumsubReviewStatus | null;
  review_answer: SumsubReviewAnswer | null;
  review_reject_type: SumsubRejectType | null;
  reject_labels: string[];
  moderation_comment: string | null;
}

/** What `sumsub-applicant` / the kyc section of `admin-user-profile` return. */
export interface SumsubProfileBundle {
  /** true = just refreshed from Sumsub; false = served from our cache. */
  live: boolean;
  reason?: 'no_credentials' | 'no_applicant' | 'sumsub_unavailable' | 'cache_requested' | 'cached';
  applicant: SumsubApplicant | null;
  documents: SumsubDocument[];
  review_history: SumsubReviewHistoryEntry[];
  synced_at: ISOTimestamp | null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ride history, stats and timelines — views from migration 00180.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface UserRideHistoryRow {
  user_id: UUID;
  trip_id: UUID;
  status: TripStatus;
  reserved_at: ISOTimestamp | null;
  started_at: ISOTimestamp | null;
  ended_at: ISOTimestamp | null;
  vehicle_id: UUID;
  vehicle_code: string;
  vehicle_model: string;
  vehicle_kind: VehicleKind;
  distance_m: number;
  duration_s: number;
  pause_s: number;
  cost_cents: number;
  discount_cents: number;
  bonus_cents: number;
  penalty_cents: number;
  net_cents: number;
  currency: string;
  photo_review: PhotoReview | null;
  end_photo_url: string | null;
  rating: number | null;
  review_tags: string[] | null;
  review_comment: string | null;
  start_lng: number | null;
  start_lat: number | null;
  end_lng: number | null;
  end_lat: number | null;
  start_zone_name: string | null;
  end_zone_name: string | null;
  end_zone_id: UUID | null;
  payment_id: UUID | null;
  payment_status: PaymentStatus | null;
  has_dispute: boolean;
  has_penalty: boolean;
  corporate_id: UUID | null;
  created_at: ISOTimestamp;
}

export interface VehicleRideHistoryRow {
  vehicle_id: UUID;
  vehicle_code: string;
  trip_id: UUID;
  rider_id: UUID;
  /** e.g. `+30••••1234` — full number stays server-side. */
  rider_phone_masked: string;
  rider_name: string | null;
  status: TripStatus;
  started_at: ISOTimestamp | null;
  ended_at: ISOTimestamp | null;
  distance_m: number;
  duration_s: number;
  pause_s: number;
  cost_cents: number;
  penalty_cents: number;
  currency: string;
  photo_review: PhotoReview | null;
  rating: number | null;
  end_zone_name: string | null;
  end_lng: number | null;
  end_lat: number | null;
  has_dispute: boolean;
  has_penalty: boolean;
  created_at: ISOTimestamp;
}

export interface UserStats {
  user_id: UUID;
  total_rides: number;
  total_distance_m: number;
  total_duration_s: number;
  total_spent_cents: number;
  avg_rating_given: number | null;
  reviews_count: number;
  first_ride_at: ISOTimestamp | null;
  last_ride_at: ISOTimestamp | null;
  disputes_count: number;
  penalties_count: number;
  penalties_cents: number;
  open_debt_cents: number;
  co2_saved_kg: number;
  favourite_city: string | null;
  rides_last_30d: number;
}

export interface VehicleStats {
  vehicle_id: UUID;
  vehicle_code: string;
  status: VehicleStatus;
  total_rides: number;
  rides_last_7d: number;
  rides_last_30d: number;
  total_distance_m: number;
  total_revenue_cents: number;
  avg_trip_distance_m: number;
  avg_trip_duration_s: number;
  utilization_rides_per_day: number;
  last_ride_at: ISOTimestamp | null;
  idle_hours: number;
  damage_reports_count: number;
  battery_swaps_count: number;
  maintenance_count: number;
  unlock_failures_24h: number;
}

/** One row of `v_user_timeline` / `v_vehicle_timeline`. */
export interface TimelineEvent {
  at: ISOTimestamp;
  kind: string;
  title: string;
  detail: Record<string, unknown> | null;
  ref_id: string | null;
}

/** `v_user_profile_full` — the customer-detail header, one row per user. */
export interface UserProfileFull extends UserStats {
  phone: string;
  phone_masked: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  gender: string | null;
  address_line: string | null;
  address_city: string | null;
  address_postcode: string | null;
  address_country: string | null;
  preferred_lang: Lang | null;
  email_verified: boolean;
  phone_verified: boolean;
  signup_source: string | null;
  signup_city_id: UUID | null;
  signup_city: string | null;
  last_active_at: ISOTimestamp | null;
  risk_score: number;
  rider_score: number;
  tags: string[];
  internal_notes: string | null;
  emergency_contact: string | null;
  deleted_at: ISOTimestamp | null;
  legacy_atom_user_id: string | null;
  sumsub_applicant_id: string | null;
  kyc_status: KycStatus;
  status: UserStatus;
  blocked_reason: string | null;
  marketing_consent: boolean;
  tos_accepted_at: ISOTimestamp | null;
  privacy_accepted_at: ISOTimestamp | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  customer_group: string | null;
  customer_group_id: UUID | null;
  corporate_id: UUID | null;
  corporate_name: string | null;
  corporate_limit_cents: number | null;
  // KYC summary (denormalized from sumsub_applicants)
  sumsub_applicant: string | null;
  kyc_level: string | null;
  kyc_review_status: SumsubReviewStatus | null;
  kyc_review_answer: SumsubReviewAnswer | null;
  kyc_reject_type: SumsubRejectType | null;
  kyc_reject_labels: string[] | null;
  kyc_moderation_comment: string | null;
  kyc_first_name: string | null;
  kyc_last_name: string | null;
  kyc_dob: string | null;
  kyc_nationality: string | null;
  kyc_doc_type: string | null;
  kyc_doc_number_masked: string | null;
  kyc_doc_expiry: string | null;
  kyc_doc_country: string | null;
  kyc_reviewed_at: ISOTimestamp | null;
  kyc_synced_at: ISOTimestamp | null;
  kyc_documents_count: number;
  // wallet / engagement
  loyalty_points: number;
  wallet_balance_cents: number;
  referrals_sent: number;
  referrals_completed: number;
  cards_count: number;
  default_card_brand: string | null;
  default_card_last4: string | null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Edge-function response envelopes.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AdminUserProfileResponse {
  profile: UserProfileFull;
  kyc: SumsubProfileBundle | null;
  stats: UserStats;
  rides: UserRideHistoryRow[];
  total_rides: number;
  payments: Payment[];
  ledger: Record<string, unknown>[];
  debts: Debt[];
  penalties: Payment[];
  disputes: UserRideHistoryRow[];
  devices_used: Array<{ platform: string; last_seen: ISOTimestamp }>;
  referrals: Record<string, unknown>[];
  loyalty: { user_id: UUID; points: number } | null;
  timeline: TimelineEvent[];
}

export interface VehicleTelemetryDay {
  day: string;
  samples: number;
  avg_speed_kmh: number | null;
  max_speed_kmh: number | null;
  distance_m: number;
  avg_batt_mv: number | null;
  min_batt_mv: number | null;
  avg_gsm: number | null;
  online_minutes: number;
}

export interface AdminVehicleHistoryResponse {
  vehicle: Vehicle;
  device: Device | null;
  state: VehicleState | null;
  stats: VehicleStats | null;
  rides: VehicleRideHistoryRow[];
  total_rides: number;
  timeline: TimelineEvent[];
  commands: Command[];
  alerts: VehicleAlert[];
  status_log: Record<string, unknown>[];
  damage: DamageReport[];
  maintenance: Record<string, unknown>[];
  battery_swaps: Record<string, unknown>[];
  telemetry_summary: VehicleTelemetryDay[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   SIM / connectivity management (migration 00210, docs/15).

   `sims.status` and the computed `health` are plain text in Postgres, not enums:
   MNO state machines change and a new state must not need a migration. They are
   modelled here as string unions so the panel still gets exhaustive switches.
   ═══════════════════════════════════════════════════════════════════════════ */

export type SimStatus = 'inventory' | 'active' | 'suspended' | 'terminated' | 'test';

/** The `health` verdict computed by `v_sim_inventory` (first match wins, see docs/15). */
export type SimHealth =
  | 'ok'
  | 'no_usage'
  | 'over_limit'
  | 'near_limit'
  | 'unassigned'
  | 'silent';

export type SimEventKind =
  | 'created'
  | 'activated'
  | 'suspended'
  | 'resumed'
  | 'terminated'
  | 'plan_changed'
  | 'synced'
  | 'linked'
  | 'unlinked'
  | 'alert';

export type SimAlertKind =
  | 'sim_over_limit'
  | 'sim_near_limit'
  | 'sim_silent'
  | 'sim_unassigned'
  | 'sim_terminated_still_linked';

export type SimAlertSeverity = 'critical' | 'warning' | 'info';

/** Lifecycle actions accepted by the `sim-command` edge function. */
export type SimCommandAction = 'activate' | 'suspend' | 'resume' | 'terminate' | 'set_plan';

/** A row of the `sims` table. */
export interface Sim {
  id: UUID;
  /** SIM identity — EXACT printed text, never reformatted (Hard Rule #10). */
  iccid: string;
  imsi: string | null;
  /** The SMS-fallback number (docs/03); equals `devices.phone_number` for the fitted device. */
  msisdn: string | null;
  /** 'truphone' | 'other' — free text, operators get renamed. */
  provider: string;
  provider_sim_id: string | null;
  status: SimStatus;
  activated_at: ISOTimestamp | null;
  suspended_at: ISOTimestamp | null;
  terminated_at: ISOTimestamp | null;
  plan_name: string | null;
  /** Bundle allowance per cycle, in MB. */
  plan_data_mb: number | null;
  /** YYYY-MM-DD. */
  cycle_start: string | null;
  cycle_end: string | null;
  monthly_cost_cents: number;
  /** The device this SIM physically sits in; null for a spare. */
  device_id: UUID | null;
  label: string | null;
  notes: string | null;
  last_seen_at: ISOTimestamp | null;
  network: string | null;
  country: string | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
}

/** A row of `sim_usage_daily` (also the shape returned inside `v_sim_usage_30d`). */
export interface SimUsageDay {
  id: UUID;
  sim_id: UUID;
  /** YYYY-MM-DD (UTC). */
  day: string;
  data_mb: number;
  sms_out: number;
  sms_in: number;
  cost_cents: number;
  network: string | null;
  country: string | null;
  created_at: ISOTimestamp;
}

/** One row of `v_sim_usage_30d` — the detail-drawer chart series. */
export interface SimUsageChartPoint {
  sim_id: UUID;
  iccid: string;
  label: string | null;
  device_imei: string | null;
  vehicle_code: string | null;
  day: string;
  data_mb: number;
  sms_out: number;
  sms_in: number;
  cost_cents: number;
  network: string | null;
  country: string | null;
  data_mb_cum: number;
  cost_cents_cum: number;
}

/** A row of `sim_events` — what the SIM did, complementing `audit_log` (who did it). */
export interface SimEvent {
  id: UUID;
  sim_id: UUID;
  at: ISOTimestamp;
  kind: SimEventKind;
  detail: Record<string, unknown>;
  staff_id: UUID | null;
  reason: string | null;
}

/** One row of `v_sim_inventory` — the admin Connectivity table. */
export interface SimInventoryRow {
  sim_id: UUID;
  iccid: string;
  imsi: string | null;
  msisdn: string | null;
  provider: string;
  provider_sim_id: string | null;
  status: SimStatus;
  activated_at: ISOTimestamp | null;
  suspended_at: ISOTimestamp | null;
  terminated_at: ISOTimestamp | null;
  plan_name: string | null;
  plan_data_mb: number | null;
  cycle_start: string | null;
  cycle_end: string | null;
  monthly_cost_cents: number;
  device_id: UUID | null;
  label: string | null;
  notes: string | null;
  last_seen_at: ISOTimestamp | null;
  network: string | null;
  country: string | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  // fitted device + its vehicle
  device_imei: string | null;
  device_status: DeviceStatus | null;
  device_phone_number: string | null;
  /** True when `devices.iccid` and `sims.iccid` disagree — the panel shows a badge. */
  iccid_mismatch: boolean | null;
  vehicle_id: UUID | null;
  vehicle_code: string | null;
  vehicle_status: VehicleStatus | null;
  // current billing cycle (falls back to the calendar month)
  cycle_from: string;
  cycle_to: string;
  data_used_mb_cycle: number;
  sms_out_cycle: number;
  sms_in_cycle: number;
  usage_cost_cycle_cents: number;
  // month to date
  data_mtd_mb: number;
  /** Usage this month + the recurring bundle fee for an active SIM. */
  cost_mtd_cents: number;
  usage_cost_mtd_cents: number;
  days_since_seen: number | null;
  /** Null when the SIM has no bundle assigned. */
  data_pct_used: number | null;
  health: SimHealth;
}

/** One row of `v_sim_alerts`. */
export interface SimAlert {
  sim_id: UUID;
  iccid: string;
  msisdn: string | null;
  label: string | null;
  status: SimStatus;
  provider: string;
  device_id: UUID | null;
  device_imei: string | null;
  vehicle_id: UUID | null;
  vehicle_code: string | null;
  kind: SimAlertKind;
  severity: SimAlertSeverity;
  /** 1 = critical, 2 = warning, 3 = info. Sort key. */
  severity_rank: number;
  /** Human-readable, already formatted for the panel. */
  reason: string;
  data_used_mb_cycle: number;
  plan_data_mb: number | null;
  data_pct_used: number | null;
  last_seen_at: ISOTimestamp | null;
  days_since_seen: number | null;
  cost_mtd_cents: number;
}

/** One row of `v_sim_cost_summary` — monthly connectivity spend. */
export interface SimCostSummary {
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  sims_active: number;
  sims_with_usage: number;
  peak_sims_seen: number;
  total_data_mb: number;
  total_sms_out: number;
  total_sms_in: number;
  usage_cost_cents: number;
  subscription_cost_cents: number;
  total_cost_cents: number;
  avg_cost_per_active_sim_cents: number | null;
  avg_data_mb_per_active_sim: number | null;
  /** Highest fleet-wide outbound SMS count on any single day of the month. */
  peak_sms_out_day: number;
  peak_sms_out_on: string | null;
  /** Threshold read live from the `sms_budget` notification rule (docs/03). */
  sms_budget_per_day: number | null;
  sms_budget_breach_days: number;
}

/** The provider's own live view of a SIM, as normalized by the SimProvider adapter. */
export interface SimProviderView {
  iccid: string;
  imsi: string | null;
  msisdn: string | null;
  provider_sim_id: string | null;
  status: SimStatus | null;
  plan_name: string | null;
  plan_data_mb: number | null;
  cycle_start: string | null;
  cycle_end: string | null;
  monthly_cost_cents: number | null;
  last_seen_at: ISOTimestamp | null;
  network: string | null;
  country: string | null;
  raw: Record<string, unknown>;
}

/** `admin-sim-detail` response. */
export interface AdminSimDetailResponse {
  sim: SimInventoryRow;
  device: Device | null;
  vehicle: Vehicle | null;
  usage_30d: SimUsageChartPoint[];
  events: SimEvent[];
  alerts: SimAlert[];
  provider: {
    name: string;
    /** False when no credentials are configured — everything above is still valid cache. */
    live: boolean;
    /** Present only when `live` is false: 'no_credentials' | 'no_base_url' | … */
    reason?: string;
    sim: SimProviderView | null;
    /** Present when the provider was reachable-but-failing. */
    error?: string;
  };
}

/** `sim-sync` response. */
export interface SimSyncResponse {
  live: boolean;
  reason?: string;
  provider: string;
  window: { from: string; to: string };
  sims_seen: number;
  sims_created: number;
  sims_updated: number;
  sims_failed: number;
  usage_rows: number;
  /** Provider usage records whose ICCID matched no known SIM. */
  usage_unmatched: number;
  linked: number;
}

/** `sim-command` response. */
export interface SimCommandResponse {
  ok: true;
  sim: Sim;
  action: SimCommandAction;
  live: boolean;
  /** False when the change was recorded locally but not pushed to the provider. */
  provider_applied: boolean;
  reason?: string;
  provider_echo: SimProviderView | null;
}
