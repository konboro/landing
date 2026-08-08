// Ops-app domain types. Extends @penny/db-types with rows the ops app needs
// locally (telemetry, service history, battery swaps, status log) and the
// outbox mutation envelope.
import type {
  UUID,
  ISOTimestamp,
  OpsTask,
  DamageReport,
  Vehicle,
  Zone,
  VehicleStatus,
  LngLat,
} from '@penny/db-types';
import type { ChecklistState } from './checklists';

// --- Enriched vehicle the ops map/sheet renders (mirror of vehicle_state) ---
export interface OpsVehicle {
  id: UUID;
  code: string;
  model_id: UUID;
  model_name: string;
  kind: string;
  status: VehicleStatus;
  visible: boolean;
  soc_pct: number | null;
  voltage_mv: number | null;
  pos: LngLat | null;
  speed_kmh: number | null;
  ignition: boolean;
  locked: boolean;
  online: boolean;
  last_seen: ISOTimestamp | null;
  // alarm flags
  fall: boolean;
  power_cut: boolean;
  moved_while_locked: boolean;
  // idle tracking (for heatmap + rebalance rules)
  idle_since: ISOTimestamp | null;
  last_errors: VehicleError[];
  city_id: UUID | null;
  notes: string | null;
}

export interface VehicleError {
  code: string;
  label: string;
  at: ISOTimestamp;
}

// --- Rebalancing zone with target counts (docs/07 feature 1) ---
export interface RebalanceZone {
  id: UUID;
  name: string;
  geom: Zone['geom'];
  target_count: number;
  current_count: number;
  demand: 'low' | 'medium' | 'high';
}

// --- Idle heatmap cell ---
export interface HeatCell {
  center: LngLat;
  weight: number; // 0..1
  idle_count: number;
}

// --- Service history / maintenance_log ---
export interface MaintenanceEntry {
  id: UUID;
  vehicle_id: UUID;
  task_id: UUID | null;
  kind: string;
  parts: { name: string; qty: number }[];
  cost_cents: number;
  notes: string | null;
  by: string;
  at: ISOTimestamp;
}

// --- battery_swaps ---
export interface BatterySwap {
  id: UUID;
  vehicle_id: UUID;
  by: string;
  at: ISOTimestamp;
  voltage_before: number | null;
  voltage_after: number | null;
}

// --- vehicle_status_log ---
export interface StatusLogEntry {
  id: UUID;
  vehicle_id: UUID;
  from_status: VehicleStatus | null;
  to_status: VehicleStatus;
  by: string;
  role: string;
  reason: string | null;
  photos: string[];
  pos: LngLat | null;
  at: ISOTimestamp;
}

// --- Staff session ---
export interface StaffSession {
  staff_id: UUID;
  user_id: UUID;
  name: string;
  role: 'ops' | 'ops_manager' | 'admin';
  city_scope: UUID[] | null;
  phone: string;
}

// --- Bootstrap payload used to seed SQLite on first run ---
export interface Bootstrap {
  server_time: ISOTimestamp;
  vehicles: OpsVehicle[];
  tasks: OpsTask[];
  zones: RebalanceZone[];
  damageReports: DamageReport[];
  statusLog: StatusLogEntry[];
  batterySwaps: BatterySwap[];
  maintenance: MaintenanceEntry[];
  heat: HeatCell[];
}

// ---------------------------------------------------------------------------
// OUTBOX — every mutating action becomes one of these rows.
// ---------------------------------------------------------------------------
export type OutboxKind =
  | 'task_claim'
  | 'task_progress'
  | 'task_complete'
  | 'status_change'
  | 'visibility_toggle'
  | 'command'
  | 'damage_create'
  | 'damage_update'
  | 'battery_swap'
  | 'deploy_drop'
  | 'vehicle_note'
  | 'device_swap'
  | 'decommission'
  | 'photo_upload';

export type OutboxStatus = 'pending' | 'syncing' | 'done' | 'error';

export interface OutboxRow<P = Record<string, unknown>> {
  id: UUID; // idempotency key
  kind: OutboxKind;
  payload: P;
  created_at: ISOTimestamp;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: ISOTimestamp | null;
}

// Payload shapes (kept explicit for the sync worker + mock server) -----------
export interface TaskClaimPayload { task_id: UUID; assignee: UUID; }
export interface TaskProgressPayload { task_id: UUID; status: 'in_progress'; }
export interface TaskCompletePayload {
  task_id: UUID;
  vehicle_id: UUID | null;
  kind: string;
  checklist: ChecklistState[];
  photos: string[];
  notes: string | null;
  voltage_before?: number | null;
  voltage_after?: number | null;
  completed_at: ISOTimestamp;
  pos: LngLat | null;
}
export interface StatusChangePayload {
  vehicle_id: UUID;
  from_status: VehicleStatus;
  to_status: VehicleStatus;
  reason: string | null;
  photos: string[];
  pos: LngLat | null;
  admin_review: boolean;
  police_report?: string | null;
}
export interface VisibilityTogglePayload { vehicle_id: UUID; visible: boolean; reason: string | null; }
export interface CommandPayload {
  command_id: UUID;
  vehicle_id: UUID;
  kind: 'unlock' | 'lock' | 'locate' | 'reboot' | 'ring' | 'alarm_on' | 'alarm_off';
  payload: Record<string, unknown>;
  service_mode: boolean; // ops unlock/lock never bills
}
export interface DamageCreatePayload {
  damage_id: UUID;
  vehicle_id: UUID;
  description: string;
  severity: string;
  photos: string[];
  linked_task_id: UUID | null;
  pos: LngLat | null;
}
export interface DamageUpdatePayload {
  damage_id: UUID;
  action: 'confirm' | 'resolve' | 'reject' | 'escalate_penalty';
  photos?: string[];
  penalty_cents?: number;
  note?: string | null;
}
export interface BatterySwapPayload {
  swap_id: UUID;
  vehicle_id: UUID;
  voltage_before: number | null;
  voltage_after: number | null;
  task_id: UUID | null;
  photos: string[];
}
export interface DeployDropPayload {
  vehicle_id: UUID;
  pos: LngLat;
  photos: string[];
}
export interface VehicleNotePayload { vehicle_id: UUID; note: string; photos: string[]; }
export interface DeviceSwapPayload {
  vehicle_id: UUID;
  old_imei: string | null;
  new_imei: string;
  tests: { online: boolean; gps: boolean; unlock: boolean };
}
export interface DecommissionPayload { vehicle_id: UUID; reason: string; photos: string[]; }
export interface PhotoUploadPayload { local_uri: string; remote_path: string; bytes: number; }

// Sync result the (mock or edge) server returns per outbox row.
export interface SyncItemResult {
  id: UUID;
  status: 'applied' | 'duplicate' | 'rejected';
  error?: string;
  // server-authoritative echo (e.g. corrected vehicle status) — conflict rule
  server_patch?: Partial<OpsVehicle> & { vehicle_id?: UUID };
}
