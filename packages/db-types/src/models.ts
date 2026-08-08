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
  iccid: string | null;
  phone_number: string | null;
  model: DeviceModel;
  fw_version: string | null;
  vehicle_id: UUID | null;
  server_profile: ServerProfile;
  added_by: UUID | null;
  status: DeviceStatus;
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

/** Rider-facing projection of vehicle_state (no IMEI, no alarms). */
export interface PublicVehicle {
  vehicle_id: UUID;
  code: string;
  model_id: UUID;
  kind: VehicleKind;
  pos: GeoPoint;
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
