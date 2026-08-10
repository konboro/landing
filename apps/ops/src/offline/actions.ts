// The single place mutations happen. Each action:
//   1. writes the mirror optimistically (UI updates instantly, offline or not)
//   2. enqueues ONE outbox row (client uuid = idempotency key)
//   3. nudges the sync worker
// Screens never touch the outbox or SQLite directly.
import { enqueue } from './outbox';
import { nudgeSync } from './sync';
import {
  getTask,
  upsertTask,
  patchVehicle,
  upsertDamage,
  getDamageReport,
  addStatusLog,
  addBatterySwap,
  upsertVehicleNote,
  getOpenShift,
  getShiftStats,
  upsertShift,
} from './repo';
import { uuid, nowIso } from '../lib/ids';
import { useOps } from '../lib/store';
import type { Transition } from '../lib/status-matrix';
import type { ChecklistState } from '../lib/checklists';
import { OpsTaskStatus, DamageStatus } from '@penny/db-types';
import type { OpsTask, UUID, VehicleStatus, LngLat } from '@penny/db-types';
import type { CommandPayload, OpsDamageReport, OpsVehicle } from '../lib/types';

function staffId(): UUID {
  return useOps.getState().session?.staff_id ?? 'unknown-staff';
}
function staffName(): string | null {
  return useOps.getState().session?.name ?? null;
}
function role(): string {
  return useOps.getState().session?.role ?? 'ops';
}

async function done() {
  useOps.getState().bumpRev();
  await nudgeSync();
}

// --- Tasks ------------------------------------------------------------------
export async function claimTask(taskId: UUID): Promise<void> {
  const t = await getTask(taskId);
  if (!t) return;
  const assignee = staffId();
  await upsertTask({ ...t, assignee, status: OpsTaskStatus.assigned });
  await enqueue('task_claim', { task_id: taskId, assignee });
  await done();
}

/** Hand a task back to the pool. The payload carries the PREVIOUS holder so the
 *  server can ignore a release that lost a race to someone else's claim —
 *  otherwise a queued release from yesterday would unassign today's owner. */
export async function releaseTask(taskId: UUID): Promise<void> {
  const t = await getTask(taskId);
  if (!t) return;
  const previous = t.assignee;
  await upsertTask({ ...t, assignee: null, status: OpsTaskStatus.open });
  await enqueue('task_release', { task_id: taskId, assignee: previous });
  await done();
}

export async function startTask(taskId: UUID): Promise<void> {
  const t = await getTask(taskId);
  if (!t) return;
  await upsertTask({ ...t, status: OpsTaskStatus.in_progress, assignee: t.assignee ?? staffId() });
  await enqueue('task_progress', { task_id: taskId, status: 'in_progress' });
  await done();
}

export async function completeTask(
  task: OpsTask,
  checklist: ChecklistState[],
  extraPhotos: string[],
  notes: string | null,
  voltages: { before?: number | null; after?: number | null },
  pos: LngLat | null,
): Promise<void> {
  const photos = [
    ...checklist.flatMap((c) => [c.beforePhoto, c.afterPhoto].filter(Boolean) as string[]),
    ...extraPhotos,
  ];
  const completed_at = nowIso();
  await upsertTask({
    ...task,
    status: OpsTaskStatus.done,
    completed_at,
    photos,
    notes,
    checklist: checklist.map((c) => ({
      key: c.key,
      label: c.label,
      required_photo: c.requiresBeforePhoto || c.requiresAfterPhoto,
      done: c.done,
    })),
  });
  await enqueue('task_complete', {
    task_id: task.id,
    vehicle_id: task.vehicle_id,
    kind: task.kind,
    checklist,
    photos,
    notes,
    voltage_before: voltages.before ?? null,
    voltage_after: voltages.after ?? null,
    completed_at,
    pos,
  });
  // battery_swap also writes a swap log row
  if (task.kind === 'battery_swap' && task.vehicle_id) {
    await logBatterySwap(task.vehicle_id, voltages.before ?? null, voltages.after ?? null, task.id, photos);
  }
  await done();
}

// --- Status + visibility ----------------------------------------------------
export async function changeStatus(
  vehicle: OpsVehicle,
  t: Transition,
  reason: string | null,
  photos: string[],
  pos: LngLat | null,
  policeReport?: string | null,
): Promise<void> {
  const from = vehicle.status;
  // Optimistic: apply locally UNLESS it's an admin-review flag (stolen), which
  // must wait for admin confirmation (server wins). We still log the request.
  if (!t.adminReview) {
    await patchVehicle(vehicle.id, { status: t.to });
  }
  await addStatusLog({
    id: uuid(),
    vehicle_id: vehicle.id,
    from_status: from,
    to_status: t.to,
    by: staffId(),
    role: role(),
    reason,
    photos,
    pos,
    at: nowIso(),
  });
  await enqueue('status_change', {
    vehicle_id: vehicle.id,
    from_status: from,
    to_status: t.to,
    reason,
    photos,
    pos,
    admin_review: t.adminReview,
    police_report: policeReport ?? null,
  });
  await done();
}

export async function toggleVisibility(vehicle: OpsVehicle, visible: boolean, reason: string | null): Promise<void> {
  await patchVehicle(vehicle.id, { visible });
  await enqueue('visibility_toggle', { vehicle_id: vehicle.id, visible, reason });
  await done();
}

// --- Commands (ring / siren / lock / unlock / locate / reboot) --------------
export async function sendCommand(
  vehicle: OpsVehicle,
  kind: CommandPayload['kind'],
  payload: Record<string, unknown> = {},
): Promise<UUID> {
  const command_id = uuid();
  // service_mode: ops lock/unlock NEVER bills (Hard Rule #1 is about riders).
  await enqueue(
    'command',
    { command_id, vehicle_id: vehicle.id, kind, payload, service_mode: true },
    { id: command_id },
  );
  if (kind === 'lock' || kind === 'unlock') {
    await patchVehicle(vehicle.id, { locked: kind === 'lock' });
  }
  await done();
  return command_id;
}

// --- Damage reports ---------------------------------------------------------
export async function createDamage(
  vehicleId: UUID,
  description: string,
  severity: string,
  photos: string[],
  linkedTaskId: UUID | null,
  pos: LngLat | null,
  // Trailing options object so the existing six-argument callers keep working.
  // `part` is the component chip (DAMAGE_PARTS) -> damage_reports.part.
  opts: { part?: string | null } = {},
): Promise<UUID> {
  const damage_id = uuid();
  const report: OpsDamageReport = {
    id: damage_id,
    vehicle_id: vehicleId,
    reporter: 'ops',
    user_id: null,
    trip_id: null,
    description,
    photos,
    severity: severity as OpsDamageReport['severity'],
    status: DamageStatus.new,
    linked_task_id: linkedTaskId,
    penalty_payment_id: null,
    part: opts.part ?? null,
    created_at: nowIso(),
  };
  await upsertDamage(report);
  await enqueue(
    'damage_create',
    { damage_id, vehicle_id: vehicleId, description, severity, photos, linked_task_id: linkedTaskId, pos, part: opts.part ?? null },
    { id: damage_id },
  );
  await done();
  return damage_id;
}

export async function updateDamage(
  damageId: UUID,
  action: 'confirm' | 'resolve' | 'reject' | 'escalate_penalty',
  opts: { photos?: string[]; penalty_cents?: number; note?: string | null } = {},
): Promise<void> {
  const d = await getDamageReport(damageId);
  if (d) {
    const nextStatus =
      action === 'confirm' ? DamageStatus.confirmed
      : action === 'resolve' ? DamageStatus.fixed
      : action === 'reject' ? DamageStatus.rejected
      : d.status;
    await upsertDamage({
      ...d,
      status: nextStatus,
      penalty_payment_id: action === 'escalate_penalty' ? 'review-pending' : d.penalty_payment_id,
      photos: opts.photos ? [...d.photos, ...opts.photos] : d.photos,
    });
  }
  await enqueue('damage_update', { damage_id: damageId, action, ...opts });
  await done();
}

// --- Battery swap -----------------------------------------------------------
export async function logBatterySwap(
  vehicleId: UUID,
  before: number | null,
  after: number | null,
  taskId: UUID | null,
  photos: string[],
): Promise<void> {
  const swap_id = uuid();
  await addBatterySwap({ id: swap_id, vehicle_id: vehicleId, by: staffId(), at: nowIso(), voltage_before: before, voltage_after: after });
  if (after != null) await patchVehicle(vehicleId, { voltage_mv: after });
  await enqueue('battery_swap', { swap_id, vehicle_id: vehicleId, voltage_before: before, voltage_after: after, task_id: taskId, photos }, { id: swap_id });
  await done();
}

// --- Deploy mode ------------------------------------------------------------
export async function deployDrop(vehicle: OpsVehicle, pos: LngLat, photos: string[]): Promise<void> {
  await patchVehicle(vehicle.id, { pos, status: 'available' as VehicleStatus, visible: true });
  await enqueue('deploy_drop', { vehicle_id: vehicle.id, pos, photos });
  await done();
}

// --- Free-form note ---------------------------------------------------------
/** Appends to the vehicle's note thread (`vehicle_notes`). The note is written
 *  to the local thread immediately with pending=true, so the mechanic sees it
 *  in a basement with no signal; sync clears the flag when the row lands.
 *  `vehicles.notes` is still patched because the map/sheet renders that single
 *  field as the "latest word" summary — the thread is the record, that is the
 *  headline. Returns the note id (= the outbox row id, hence idempotent). */
export async function addVehicleNote(vehicle: OpsVehicle, note: string, photos: string[]): Promise<UUID> {
  const note_id = uuid();
  const staff_id = staffId();
  await upsertVehicleNote({
    id: note_id,
    vehicle_id: vehicle.id,
    staff_id,
    staff_name: staffName(),
    body: note,
    photos,
    created_at: nowIso(),
    pending: true,
  });
  await patchVehicle(vehicle.id, { notes: note });
  await enqueue('vehicle_note', { note_id, vehicle_id: vehicle.id, note, photos, staff_id }, { id: note_id });
  await done();
  return note_id;
}

// --- Shifts -----------------------------------------------------------------
/** Clock in. Idempotent by design: if a shift is already open locally we return
 *  its id instead of enqueuing a second one, because the server has a partial
 *  unique index (one open shift per staff) that would reject the duplicate and
 *  leave a permanently errored row in the outbox. */
export async function startShift(): Promise<UUID> {
  const open = await getOpenShift();
  if (open) return open.id;
  const shift_id = uuid();
  const staff_id = staffId();
  const started_at = nowIso();
  await upsertShift({ id: shift_id, staff_id, started_at, ended_at: null, tasks_completed: 0, note: null });
  await enqueue('shift_start', { shift_id, staff_id, started_at }, { id: shift_id });
  await done();
  return shift_id;
}

/** Clock out. `tasks_completed` is snapshotted from the mirror at close time —
 *  the server column is a report of what this shift did, not a live counter. */
export async function endShift(note?: string): Promise<void> {
  const open = await getOpenShift();
  if (!open) return;
  const { completedThisShift } = await getShiftStats();
  const ended_at = nowIso();
  await upsertShift({ ...open, ended_at, tasks_completed: completedThisShift, note: note ?? null });
  await enqueue(
    'shift_end',
    { shift_id: open.id, ended_at, tasks_completed: completedThisShift, note: note ?? null },
    // Distinct from the shift_start row (which uses the shift id) but still
    // stable, so a retried close is deduped rather than applied twice.
    { id: `${open.id}:end` },
  );
  await done();
}

// --- Device swap wizard -----------------------------------------------------
export async function swapDevice(
  vehicle: OpsVehicle,
  oldImei: string | null,
  newImei: string,
  tests: { online: boolean; gps: boolean; unlock: boolean },
): Promise<void> {
  await enqueue('device_swap', { vehicle_id: vehicle.id, old_imei: oldImei, new_imei: newImei, tests });
  await done();
}

// --- Decommission -----------------------------------------------------------
export async function decommission(vehicle: OpsVehicle, reason: string, photos: string[]): Promise<void> {
  await patchVehicle(vehicle.id, { status: 'decommissioned' as VehicleStatus, visible: false });
  await enqueue('decommission', { vehicle_id: vehicle.id, reason, photos });
  await done();
}
