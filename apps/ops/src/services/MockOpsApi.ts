// In-memory mock backend. Realistic Athens fleet. Applies outbox rows
// idempotently (dedupe by id) exactly like the real edge sync endpoint will,
// and enforces the conflict rule (server wins on vehicle status). A reviewer
// can run the whole app against this with no Supabase project.
import type { OpsApi, PullDelta } from './OpsApi';
import type {
  Bootstrap,
  OutboxRow,
  SyncItemResult,
  StaffSession,
  OpsDamageReport,
  OpsShift,
  OpsVehicle,
  StatusChangePayload,
  TaskCompletePayload,
  TaskClaimPayload,
  TaskReleasePayload,
  DamageCreatePayload,
  DamageUpdatePayload,
  BatterySwapPayload,
  DeployDropPayload,
  ShiftEndPayload,
  ShiftStartPayload,
  VisibilityTogglePayload,
  CommandPayload,
  VehicleNote,
  VehicleNotePayload,
} from '../lib/types';
import type { OpsTask } from '@penny/db-types';
import { OpsTaskStatus, VehicleStatus, DamageStatus } from '@penny/db-types';
import { generateBootstrap } from './mockData';

interface ServerState {
  bootstrap: Bootstrap;
  vehicles: Map<string, OpsVehicle>;
  tasks: Map<string, OpsTask>;
  damage: Map<string, OpsDamageReport>;
  notes: Map<string, VehicleNote>;
  shifts: Map<string, OpsShift>;
  applied: Set<string>; // idempotency ledger
  changedVehicles: Map<string, string>; // id -> changed_at
  changedTasks: Map<string, string>;
  changedDamage: Map<string, string>;
  changedNotes: Map<string, string>;
  changedShifts: Map<string, string>;
}

let state: ServerState | null = null;

function ensureState(): ServerState {
  if (state) return state;
  const bootstrap = generateBootstrap();
  state = {
    bootstrap,
    vehicles: new Map(bootstrap.vehicles.map((v) => [v.id, v])),
    tasks: new Map(bootstrap.tasks.map((t) => [t.id, t])),
    damage: new Map(bootstrap.damageReports.map((d) => [d.id, d])),
    notes: new Map((bootstrap.vehicleNotes ?? []).map((n) => [n.id, n])),
    shifts: new Map((bootstrap.shifts ?? []).map((s) => [s.id, s])),
    applied: new Set(),
    changedVehicles: new Map(),
    changedTasks: new Map(),
    changedDamage: new Map(),
    changedNotes: new Map(),
    changedShifts: new Map(),
  };
  return state;
}

export class MockOpsApi implements OpsApi {
  async login(phone: string, otp: string): Promise<StaffSession> {
    await delay(300);
    if (otp !== '000000' && otp.length !== 6) {
      throw new Error('Invalid OTP. Use 000000 in mock mode.');
    }
    // Mock staff-role check: any 6-digit OTP for a known demo phone passes.
    return {
      staff_id: 'staff000-0000-4000-8000-000000000001',
      user_id: 'user0000-0000-4000-8000-000000000001',
      name: 'Nikos (Ops)',
      role: 'ops',
      city_scope: ['city0000-0000-4000-8000-000000000001'],
      phone: phone || '+306900000000',
    };
  }

  async getBootstrap(_session: StaffSession): Promise<Bootstrap> {
    await delay(400);
    const s = ensureState();
    // Return a fresh snapshot reflecting any already-applied server changes.
    return {
      ...s.bootstrap,
      server_time: new Date().toISOString(),
      vehicles: [...s.vehicles.values()],
      tasks: [...s.tasks.values()],
      damageReports: [...s.damage.values()],
      vehicleNotes: [...s.notes.values()],
      shifts: [...s.shifts.values()],
    };
  }

  async syncPush(items: OutboxRow[]): Promise<SyncItemResult[]> {
    await delay(250);
    // Simulate an intermittent network wobble ~8% to exercise retry/backoff.
    if (Math.random() < 0.08) {
      throw new Error('mock network error (transient)');
    }
    const s = ensureState();
    const results: SyncItemResult[] = [];
    for (const item of items) {
      if (s.applied.has(item.id)) {
        results.push({ id: item.id, status: 'duplicate' });
        continue;
      }
      try {
        const patch = this.apply(s, item);
        s.applied.add(item.id);
        results.push({ id: item.id, status: 'applied', server_patch: patch });
      } catch (e) {
        results.push({ id: item.id, status: 'rejected', error: String((e as Error).message) });
      }
    }
    return results;
  }

  async syncPull(since: string): Promise<PullDelta> {
    await delay(200);
    const s = ensureState();
    const sinceT = Date.parse(since) || 0;
    const vehicles = [...s.changedVehicles.entries()]
      .filter(([, t]) => Date.parse(t) > sinceT)
      .map(([id]) => s.vehicles.get(id)!)
      .filter(Boolean);
    const tasks = [...s.changedTasks.entries()]
      .filter(([, t]) => Date.parse(t) > sinceT)
      .map(([id]) => s.tasks.get(id)!)
      .filter(Boolean);
    const damageReports = [...s.changedDamage.entries()]
      .filter(([, t]) => Date.parse(t) > sinceT)
      .map(([id]) => s.damage.get(id)!)
      .filter(Boolean);
    const vehicleNotes = [...s.changedNotes.entries()]
      .filter(([, t]) => Date.parse(t) > sinceT)
      .map(([id]) => s.notes.get(id)!)
      .filter(Boolean);
    const shifts = [...s.changedShifts.entries()]
      .filter(([, t]) => Date.parse(t) > sinceT)
      .map(([id]) => s.shifts.get(id)!)
      .filter(Boolean);
    return { server_time: new Date().toISOString(), vehicles, tasks, damageReports, vehicleNotes, shifts };
  }

  // --- apply a single outbox row to server state ---------------------------
  private apply(s: ServerState, item: OutboxRow): SyncItemResult['server_patch'] {
    const now = new Date().toISOString();
    switch (item.kind) {
      case 'status_change': {
        const p = item.payload as unknown as StatusChangePayload;
        const v = s.vehicles.get(p.vehicle_id);
        if (!v) throw new Error('vehicle not found');
        // Conflict rule: server wins on status. Stolen flags need admin
        // confirmation, so they DO NOT change status server-side here.
        if (!p.admin_review) {
          v.status = p.to_status as OpsVehicle['status'];
        }
        s.vehicles.set(v.id, v);
        s.changedVehicles.set(v.id, now);
        return { vehicle_id: v.id, status: v.status };
      }
      case 'visibility_toggle': {
        const p = item.payload as unknown as VisibilityTogglePayload;
        const v = s.vehicles.get(p.vehicle_id);
        if (!v) throw new Error('vehicle not found');
        v.visible = p.visible;
        s.changedVehicles.set(v.id, now);
        return { vehicle_id: v.id, visible: v.visible };
      }
      case 'task_claim': {
        const p = item.payload as unknown as TaskClaimPayload;
        const t = s.tasks.get(p.task_id);
        if (!t) throw new Error('task not found');
        if (t.assignee && t.assignee !== p.assignee) throw new Error('task already claimed');
        t.assignee = p.assignee;
        t.status = OpsTaskStatus.assigned;
        s.changedTasks.set(t.id, now);
        return undefined;
      }
      case 'task_release': {
        const p = item.payload as unknown as TaskReleasePayload;
        const t = s.tasks.get(p.task_id);
        if (!t) throw new Error('task not found');
        // Someone else has since claimed it — the queued release is stale, so
        // drop it silently rather than stealing the task from its new owner.
        if (t.assignee && p.assignee && t.assignee !== p.assignee) return undefined;
        t.assignee = null;
        t.status = OpsTaskStatus.open;
        s.changedTasks.set(t.id, now);
        return undefined;
      }
      case 'task_progress': {
        const t = s.tasks.get((item.payload as any).task_id);
        if (!t) throw new Error('task not found');
        t.status = OpsTaskStatus.in_progress;
        s.changedTasks.set(t.id, now);
        return undefined;
      }
      case 'task_complete': {
        const p = item.payload as unknown as TaskCompletePayload;
        const t = s.tasks.get(p.task_id);
        if (!t) throw new Error('task not found');
        // task completion never lost (idempotent apply)
        t.status = OpsTaskStatus.done;
        t.completed_at = p.completed_at;
        t.photos = p.photos;
        t.notes = p.notes;
        s.changedTasks.set(t.id, now);
        // auto status update on completion (e.g. battery_swap clears low_battery)
        if (p.vehicle_id) {
          const v = s.vehicles.get(p.vehicle_id);
          if (v && (v.status === VehicleStatus.low_battery || t.kind === 'battery_swap')) {
            if (typeof p.voltage_after === 'number') v.voltage_mv = p.voltage_after;
            v.status = VehicleStatus.available;
            s.changedVehicles.set(v.id, now);
          }
        }
        return undefined;
      }
      case 'battery_swap': {
        const p = item.payload as unknown as BatterySwapPayload;
        const v = s.vehicles.get(p.vehicle_id);
        if (v && typeof p.voltage_after === 'number') {
          v.voltage_mv = p.voltage_after;
          s.changedVehicles.set(v.id, now);
        }
        return undefined;
      }
      case 'deploy_drop': {
        const p = item.payload as unknown as DeployDropPayload;
        const v = s.vehicles.get(p.vehicle_id);
        if (!v) throw new Error('vehicle not found');
        v.pos = p.pos;
        v.status = VehicleStatus.available;
        v.visible = true;
        s.changedVehicles.set(v.id, now);
        return { vehicle_id: v.id, status: v.status };
      }
      case 'damage_create': {
        const p = item.payload as unknown as DamageCreatePayload;
        const report: OpsDamageReport = {
          id: p.damage_id,
          vehicle_id: p.vehicle_id,
          reporter: 'ops',
          user_id: null,
          trip_id: null,
          description: p.description,
          photos: p.photos,
          severity: p.severity as OpsDamageReport['severity'],
          status: DamageStatus.new,
          linked_task_id: p.linked_task_id,
          penalty_payment_id: null,
          part: p.part ?? null,
          created_at: now,
        };
        s.damage.set(report.id, report);
        s.changedDamage.set(report.id, now);
        return undefined;
      }
      case 'damage_update': {
        const p = item.payload as unknown as DamageUpdatePayload;
        const d = s.damage.get(p.damage_id);
        if (!d) throw new Error('damage report not found');
        if (p.action === 'confirm') d.status = DamageStatus.confirmed;
        else if (p.action === 'resolve') d.status = DamageStatus.fixed;
        else if (p.action === 'reject') d.status = DamageStatus.rejected;
        else if (p.action === 'escalate_penalty') {
          // sends to admin review, NOT a direct charge
          d.penalty_payment_id = 'review-pending';
        }
        s.changedDamage.set(d.id, now);
        return undefined;
      }
      case 'command': {
        const p = item.payload as unknown as CommandPayload;
        // ring/siren/unlock etc. Just acknowledge; audit-logged server-side.
        const v = s.vehicles.get(p.vehicle_id);
        if (v && (p.kind === 'lock' || p.kind === 'unlock')) {
          v.locked = p.kind === 'lock';
          s.changedVehicles.set(v.id, now);
        }
        return undefined;
      }
      case 'vehicle_note': {
        const p = item.payload as unknown as VehicleNotePayload;
        // Append to the thread, keyed by the client's note id so a retry is a
        // no-op instead of a second copy of the same observation.
        const noteId = p.note_id ?? item.id;
        s.notes.set(noteId, {
          id: noteId,
          vehicle_id: p.vehicle_id,
          staff_id: p.staff_id ?? 'staff000-0000-4000-8000-000000000001',
          staff_name: 'Nikos (Ops)',
          body: p.note,
          photos: p.photos,
          created_at: now,
        });
        s.changedNotes.set(noteId, now);
        const v = s.vehicles.get(p.vehicle_id);
        if (v) {
          v.notes = p.note; // the sheet's "latest word" summary field
          s.changedVehicles.set(v.id, now);
        }
        return undefined;
      }
      case 'shift_start': {
        const p = item.payload as unknown as ShiftStartPayload;
        // Mirrors the server's partial unique index: one open shift per staff.
        const alreadyOpen = [...s.shifts.values()].some(
          (sh) => sh.staff_id === p.staff_id && !sh.ended_at && sh.id !== p.shift_id,
        );
        if (alreadyOpen) throw new Error('a shift is already open');
        s.shifts.set(p.shift_id, {
          id: p.shift_id,
          staff_id: p.staff_id,
          started_at: p.started_at,
          ended_at: null,
          tasks_completed: 0,
          note: null,
        });
        s.changedShifts.set(p.shift_id, now);
        return undefined;
      }
      case 'shift_end': {
        const p = item.payload as unknown as ShiftEndPayload;
        const sh = s.shifts.get(p.shift_id);
        if (!sh) throw new Error('shift not found');
        sh.ended_at = p.ended_at;
        sh.tasks_completed = p.tasks_completed;
        sh.note = p.note;
        s.changedShifts.set(sh.id, now);
        return undefined;
      }
      case 'device_swap':
      case 'decommission': {
        const v = s.vehicles.get((item.payload as any).vehicle_id);
        if (v && item.kind === 'decommission') {
          v.status = VehicleStatus.decommissioned;
          v.visible = false;
          s.changedVehicles.set(v.id, now);
        }
        return undefined;
      }
      case 'photo_upload': {
        // resumable-upload placeholder: pretend the object landed in storage.
        return undefined;
      }
      default:
        throw new Error(`unknown outbox kind ${item.kind}`);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
