// Central enum definitions — mirrors Postgres enum types in supabase/migrations.
// Kept as `as const` objects so both values and union types are available.

export const KycStatus = {
  none: 'none',
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  expired: 'expired',
} as const;
export type KycStatus = (typeof KycStatus)[keyof typeof KycStatus];

export const UserStatus = {
  active: 'active',
  blocked: 'blocked',
  shadow_banned: 'shadow_banned',
  deleted: 'deleted',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const VehicleKind = {
  scooter: 'scooter',
  ebike: 'ebike',
  moped: 'moped',
} as const;
export type VehicleKind = (typeof VehicleKind)[keyof typeof VehicleKind];

export const VehicleStatus = {
  available: 'available',
  reserved: 'reserved',
  in_trip: 'in_trip',
  maintenance: 'maintenance',
  transport: 'transport',
  low_battery: 'low_battery',
  offline: 'offline',
  stolen: 'stolen',
  decommissioned: 'decommissioned',
  // Field-service states (migration 00390). Every rider-facing surface is an
  // allowlist on `available`, so these are unrentable and invisible by
  // construction — see the migration for why that matters.
  charging: 'charging',
  storage: 'storage',
  not_ready: 'not_ready',
  /** A human flagged it; the fault is not identified yet. Distinct from
   *  `offline`, which only means the device has not reported. */
  needs_investigation: 'needs_investigation',
} as const;
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

export const DeviceModel = {
  fmb930: 'fmb930',
} as const;
export type DeviceModel = (typeof DeviceModel)[keyof typeof DeviceModel];

export const DeviceStatus = {
  active: 'active',
  bench: 'bench',
  faulty: 'faulty',
  retired: 'retired',
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

export const ServerProfile = {
  atom: 'atom',
  penny: 'penny',
} as const;
export type ServerProfile = (typeof ServerProfile)[keyof typeof ServerProfile];

export const ZoneKind = {
  operating: 'operating',
  parking: 'parking',
  paid_parking: 'paid_parking',
  parking_station: 'parking_station',
  charging_station: 'charging_station',
  no_parking: 'no_parking',
  bonus: 'bonus',
  speed_limit: 'speed_limit',
  no_go: 'no_go',
  rebalancing: 'rebalancing',
} as const;
export type ZoneKind = (typeof ZoneKind)[keyof typeof ZoneKind];

export const TripStatus = {
  reserved: 'reserved',
  unlocking: 'unlocking',
  active: 'active',
  paused: 'paused',
  ending: 'ending',
  ended: 'ended',
  charged: 'charged',
  aborted: 'aborted',
  disputed: 'disputed',
} as const;
export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

export const PhotoReview = {
  pending: 'pending',
  auto_ok: 'auto_ok',
  approved: 'approved',
  rejected: 'rejected',
} as const;
export type PhotoReview = (typeof PhotoReview)[keyof typeof PhotoReview];

export const CommandKind = {
  unlock: 'unlock',
  lock: 'lock',
  locate: 'locate',
  reboot: 'reboot',
  setparam: 'setparam',
  ring: 'ring',
  alarm_on: 'alarm_on',
  alarm_off: 'alarm_off',
  custom: 'custom',
} as const;
export type CommandKind = (typeof CommandKind)[keyof typeof CommandKind];

export const CommandStatus = {
  queued: 'queued',
  sent: 'sent',
  acked: 'acked',
  failed: 'failed',
  expired: 'expired',
} as const;
export type CommandStatus = (typeof CommandStatus)[keyof typeof CommandStatus];

export const CommandChannel = {
  gprs: 'gprs',
  sms: 'sms',
} as const;
export type CommandChannel = (typeof CommandChannel)[keyof typeof CommandChannel];

export const AlertKind = {
  fall: 'fall',
  power_cut: 'power_cut',
  moved_locked: 'moved_locked',
  geofence_exit: 'geofence_exit',
  offline: 'offline',
  low_batt: 'low_batt',
  error: 'error',
} as const;
export type AlertKind = (typeof AlertKind)[keyof typeof AlertKind];

export const PaymentKind = {
  trip: 'trip',
  topup: 'topup',
  package: 'package',
  subscription: 'subscription',
  addon: 'addon',
  debt: 'debt',
  penalty: 'penalty',
  manual: 'manual',
} as const;
export type PaymentKind = (typeof PaymentKind)[keyof typeof PaymentKind];

export const PaymentStatus = {
  requires_action: 'requires_action',
  processing: 'processing',
  succeeded: 'succeeded',
  failed: 'failed',
  refunded: 'refunded',
  partially_refunded: 'partially_refunded',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const LedgerAccountKind = {
  user_wallet: 'user_wallet',
  penny_revenue: 'penny_revenue',
  stripe_clearing: 'stripe_clearing',
  debt: 'debt',
  bonus: 'bonus',
  corporate: 'corporate',
} as const;
export type LedgerAccountKind = (typeof LedgerAccountKind)[keyof typeof LedgerAccountKind];

export const DebtStatus = {
  open: 'open',
  retrying: 'retrying',
  paid: 'paid',
  written_off: 'written_off',
} as const;
export type DebtStatus = (typeof DebtStatus)[keyof typeof DebtStatus];

export const OpsTaskKind = {
  rebalance: 'rebalance',
  battery_swap: 'battery_swap',
  pickup: 'pickup',
  repair: 'repair',
  inspect: 'inspect',
  deploy: 'deploy',
} as const;
export type OpsTaskKind = (typeof OpsTaskKind)[keyof typeof OpsTaskKind];

export const OpsTaskStatus = {
  open: 'open',
  assigned: 'assigned',
  in_progress: 'in_progress',
  done: 'done',
  cancelled: 'cancelled',
} as const;
export type OpsTaskStatus = (typeof OpsTaskStatus)[keyof typeof OpsTaskStatus];

export const DamageSeverity = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
} as const;
export type DamageSeverity = (typeof DamageSeverity)[keyof typeof DamageSeverity];

export const DamageStatus = {
  new: 'new',
  confirmed: 'confirmed',
  fixed: 'fixed',
  rejected: 'rejected',
} as const;
export type DamageStatus = (typeof DamageStatus)[keyof typeof DamageStatus];

export const StaffRole = {
  owner: 'owner',
  admin: 'admin',
  support: 'support',
  ops_manager: 'ops_manager',
  ops: 'ops',
  accountant: 'accountant',
  readonly: 'readonly',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

export const NotificationChannel = {
  email: 'email',
  push: 'push',
  sms: 'sms',
  telegram: 'telegram',
  panel: 'panel',
  inbox: 'inbox',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const Lang = {
  pl: 'pl',
  en: 'en',
  el: 'el',
} as const;
export type Lang = (typeof Lang)[keyof typeof Lang];
