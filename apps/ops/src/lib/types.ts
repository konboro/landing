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

/** A completed ride on a vehicle, mirrored for the field history screen.
 *  Rider identity is masked — ops never needs the full number. */
export interface VehicleRide {
  id: UUID;
  vehicle_id: UUID;
  rider_masked: string;
  status: string;
  started_at: ISOTimestamp | null;
  ended_at: ISOTimestamp | null;
  duration_s: number;
  distance_m: number;
  cost_cents: number;
  currency: string;
  photo_review: string | null;
  end_zone_name: string | null;
  /**
   * The ride's real GPS trace, oldest point first, when the mirror has it
   * (`trip_routes.path`). Optional because a ride pulled before the route was
   * written, or one whose route row never arrived, legitimately has none.
   *
   * The last-ride playback MUST prefer this over any reconstruction: an
   * operator reading an invented line as "where the scooter went" is worse
   * than showing no line at all.
   */
  track?: LngLat[] | null;
  /** Battery at the start/end of the ride, when telemetry covered it. */
  soc_start_pct?: number | null;
  soc_end_pct?: number | null;
}

/** A damage report as the ops app models it locally.
 *  `part` mirrors `damage_reports.part` (migration 00370) — the component the
 *  damage is filed against. It is optional so every existing DamageReport (and
 *  anything the server hands back without one) stays assignable. */
export interface OpsDamageReport extends DamageReport {
  part?: string | null;
}

/** One entry in a vehicle's note thread (`vehicle_notes`, migration 00370).
 *  Distinct from `OpsVehicle.notes`, which is a single overwritable field: the
 *  thread keeps WHO wrote WHAT and WHEN, so the second mechanic on a vehicle
 *  does not erase the first one's observation.
 *  `pending` is local-only: true until the outbox row for it has synced. */
export interface VehicleNote {
  id: UUID;
  vehicle_id: UUID;
  staff_id: UUID | null;
  staff_name: string | null;
  body: string;
  photos: string[];
  created_at: ISOTimestamp;
  pending?: boolean;
}

/** A work shift (`ops_shifts`, migration 00370). At most one open shift per
 *  staff member — the server enforces it with a partial unique index, and the
 *  local actions mirror that rule so an offline device cannot open a second. */
export interface OpsShift {
  id: UUID;
  staff_id: UUID;
  started_at: ISOTimestamp;
  ended_at: ISOTimestamp | null;
  tasks_completed: number;
  note: string | null;
}

/** Counters the shift sheet shows. Derived from the mirror, never stored. */
export interface ShiftStats {
  openTasks: number;
  completedThisShift: number;
  /** Time since the open shift started; null when no shift is running. */
  elapsedMs: number | null;
}

/** Who a task belongs to, resolved for display. `assignee_name` is only known
 *  for the signed-in user — the app never syncs a staff directory (PII). */
export interface TaskAssignment {
  task_id: UUID;
  assignee: UUID | null;
  assignee_name: string | null;
  is_mine: boolean;
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
  rides: VehicleRide[];
  heat: HeatCell[];
  /** Optional: a backend that predates the note thread / shifts simply omits
   *  these, and the seeder leaves the local tables empty rather than failing. */
  vehicleNotes?: VehicleNote[];
  shifts?: OpsShift[];
}

// ---------------------------------------------------------------------------
// OUTBOX — every mutating action becomes one of these rows.
// ---------------------------------------------------------------------------
export type OutboxKind =
  | 'task_claim'
  | 'task_release'
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
  | 'shift_start'
  | 'shift_end'
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
/** `assignee` is who HELD the task, so the server can reject a release from
 *  someone who no longer owns it instead of silently unassigning. */
export interface TaskReleasePayload { task_id: UUID; assignee: UUID | null; }
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
  /** Optional so rows queued before the part catalogue existed still flush. */
  part?: string | null;
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
/** `note_id`/`staff_id` are optional only so outbox rows enqueued by an older
 *  build (which had neither) still flush; new rows always carry both. The id
 *  doubles as the `vehicle_notes` primary key, which is what makes the insert
 *  idempotent and lets sync clear the local `pending` flag on the right row. */
export interface VehicleNotePayload {
  vehicle_id: UUID;
  note: string;
  photos: string[];
  note_id?: UUID;
  staff_id?: UUID | null;
}
export interface DeviceSwapPayload {
  vehicle_id: UUID;
  old_imei: string | null;
  new_imei: string;
  tests: { online: boolean; gps: boolean; unlock: boolean };
}
export interface DecommissionPayload { vehicle_id: UUID; reason: string; photos: string[]; }
export interface ShiftStartPayload { shift_id: UUID; staff_id: UUID; started_at: ISOTimestamp; }
export interface ShiftEndPayload {
  shift_id: UUID;
  ended_at: ISOTimestamp;
  tasks_completed: number;
  note: string | null;
}
export interface PhotoUploadPayload { local_uri: string; remote_path: string; bytes: number; }

// Sync result the (mock or edge) server returns per outbox row.
export interface SyncItemResult {
  id: UUID;
  status: 'applied' | 'duplicate' | 'rejected';
  error?: string;
  // server-authoritative echo (e.g. corrected vehicle status) — conflict rule
  server_patch?: Partial<OpsVehicle> & { vehicle_id?: UUID };
}
