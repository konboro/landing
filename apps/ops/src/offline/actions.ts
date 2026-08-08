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
  getVehicle,
  patchVehicle,
  upsertDamage,
  getDamageReport,
  addStatusLog,
  addBatterySwap,
} from './repo';
import { uuid, nowIso } from '../lib/ids';
import { useOps } from '../lib/store';
import type { Transition } from '../lib/status-matrix';
import type { ChecklistState } from '../lib/checklists';
import { OpsTaskStatus, DamageStatus } from '@penny/db-types';
import type { OpsTask, DamageReport, UUID, VehicleStatus, LngLat } from '@penny/db-types';
import type { CommandPayload, OpsVehicle } from '../lib/types';

function staffId(): UUID {
  return useOps.getState().session?.staff_id ?? 'unknown-staff';
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
): Promise<UUID> {
  const damage_id = uuid();
  const report: DamageReport = {
    id: damage_id,
    vehicle_id: vehicleId,
    reporter: 'ops',
    user_id: null,
    trip_id: null,
    description,
    photos,
    severity: severity as DamageReport['severity'],
    status: DamageStatus.new,
    linked_task_id: linkedTaskId,
    penalty_payment_id: null,
    created_at: nowIso(),
  };
  await upsertDamage(report);
  await enqueue('damage_create', { damage_id, vehicle_id: vehicleId, description, severity, photos, linked_task_id: linkedTaskId, pos }, { id: damage_id });
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
export async function addVehicleNote(vehicle: OpsVehicle, note: string, photos: string[]): Promise<void> {
  await patchVehicle(vehicle.id, { notes: note });
  await enqueue('vehicle_note', { vehicle_id: vehicle.id, note, photos });
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
