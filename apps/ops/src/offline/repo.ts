// Read/write layer over the SQLite mirror. UI reads exclusively from here so
// it always renders instantly, online or offline. Optimistic local writes keep
// the mirror in sync with what the outbox will eventually push to the server.
import { getDb, metaGet, metaSet } from './db';
import type {
  Bootstrap,
  OpsVehicle,
  OpsDamageReport,
  OpsShift,
  RebalanceZone,
  ShiftStats,
  StatusLogEntry,
  BatterySwap,
  MaintenanceEntry,
  HeatCell,
  TaskAssignment,
  VehicleNote,
  VehicleRide,
} from '../lib/types';
import type { OpsTask, UUID, VehicleStatus } from '@penny/db-types';
import { OpsTaskStatus } from '@penny/db-types';
import { useOps } from '../lib/store';
import { nowIso } from '../lib/ids';

// Shifts and task assignment are inherently "mine" — the screens ask for the
// open shift, not for a staff id they would have to carry around. So this one
// read layer knows who is signed in; everything else here stays pure SQL.
function currentStaff(): { id: UUID; name: string } | null {
  const s = useOps.getState().session;
  return s ? { id: s.staff_id, name: s.name } : null;
}

// ---- Seeding ---------------------------------------------------------------
export async function isSeeded(): Promise<boolean> {
  return (await metaGet('seeded')) === '1';
}

export async function seedFromBootstrap(b: Bootstrap): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const v of b.vehicles) {
      await db.runAsync(
        `INSERT OR REPLACE INTO vehicles(id,code,status,visible,json,updated_at) VALUES(?,?,?,?,?,?)`,
        [v.id, v.code, v.status, v.visible ? 1 : 0, JSON.stringify(v), b.server_time],
      );
    }
    for (const t of b.tasks) {
      await db.runAsync(
        `INSERT OR REPLACE INTO tasks(id,kind,status,vehicle_id,assignee,priority,created_by,json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
        [t.id, t.kind, t.status, t.vehicle_id, t.assignee, t.priority, t.created_by, JSON.stringify(t), b.server_time],
      );
    }
    for (const z of b.zones) {
      await db.runAsync(`INSERT OR REPLACE INTO zones(id,json) VALUES(?,?)`, [z.id, JSON.stringify(z)]);
    }
    for (const d of b.damageReports) {
      await db.runAsync(
        `INSERT OR REPLACE INTO damage_reports(id,vehicle_id,status,json,updated_at) VALUES(?,?,?,?,?)`,
        [d.id, d.vehicle_id, d.status, JSON.stringify(d), b.server_time],
      );
    }
    for (const s of b.statusLog) {
      await db.runAsync(`INSERT OR REPLACE INTO status_log(id,vehicle_id,at,json) VALUES(?,?,?,?)`, [s.id, s.vehicle_id, s.at, JSON.stringify(s)]);
    }
    for (const sw of b.batterySwaps) {
      await db.runAsync(`INSERT OR REPLACE INTO battery_swaps(id,vehicle_id,at,json) VALUES(?,?,?,?)`, [sw.id, sw.vehicle_id, sw.at, JSON.stringify(sw)]);
    }
    for (const m of b.maintenance) {
      await db.runAsync(`INSERT OR REPLACE INTO maintenance(id,vehicle_id,at,json) VALUES(?,?,?,?)`, [m.id, m.vehicle_id, m.at, JSON.stringify(m)]);
    }
    for (const r of b.rides ?? []) {
      await db.runAsync(`INSERT OR REPLACE INTO rides(id,vehicle_id,started_at,json) VALUES(?,?,?,?)`, [r.id, r.vehicle_id, r.started_at, JSON.stringify(r)]);
    }
    // Notes and shifts are optional in the payload: a backend that predates
    // migration 00370 just doesn't send them, and the thread starts empty
    // instead of the seed blowing up.
    for (const n of b.vehicleNotes ?? []) {
      await db.runAsync(
        `INSERT OR REPLACE INTO vehicle_notes(id,vehicle_id,created_at,pending,json) VALUES(?,?,?,0,?)`,
        [n.id, n.vehicle_id, n.created_at, JSON.stringify({ ...n, pending: false })],
      );
    }
    for (const sh of b.shifts ?? []) {
      await db.runAsync(
        `INSERT OR REPLACE INTO ops_shifts(id,staff_id,started_at,ended_at,json) VALUES(?,?,?,?,?)`,
        [sh.id, sh.staff_id, sh.started_at, sh.ended_at, JSON.stringify(sh)],
      );
    }
    await db.runAsync(`DELETE FROM heat_cells`);
    for (const h of b.heat) {
      await db.runAsync(`INSERT INTO heat_cells(json) VALUES(?)`, [JSON.stringify(h)]);
    }
  });
  await metaSet('seeded', '1');
  await metaSet('last_pull_at', b.server_time);
}

// ---- Reads -----------------------------------------------------------------
function parse<T>(json: string): T {
  return JSON.parse(json) as T;
}

export async function getVehicles(): Promise<OpsVehicle[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM vehicles');
  return rows.map((r) => parse<OpsVehicle>(r.json));
}

export async function getVehicle(id: UUID): Promise<OpsVehicle | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM vehicles WHERE id=?', [id]);
  return row ? parse<OpsVehicle>(row.json) : null;
}

export async function findVehicleByCode(code: string): Promise<OpsVehicle | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM vehicles WHERE code=? COLLATE NOCASE',
    [code.trim()],
  );
  return row ? parse<OpsVehicle>(row.json) : null;
}

export async function getTasks(): Promise<OpsTask[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM tasks ORDER BY priority DESC',
  );
  return rows.map((r) => parse<OpsTask>(r.json));
}

export async function getTask(id: UUID): Promise<OpsTask | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM tasks WHERE id=?', [id]);
  return row ? parse<OpsTask>(row.json) : null;
}

export async function getZones(): Promise<RebalanceZone[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM zones');
  return rows.map((r) => parse<RebalanceZone>(r.json));
}

export async function getDamageReports(): Promise<OpsDamageReport[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM damage_reports ORDER BY updated_at DESC',
  );
  return rows.map((r) => parse<OpsDamageReport>(r.json));
}

export async function getDamageReport(id: UUID): Promise<OpsDamageReport | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM damage_reports WHERE id=?', [id]);
  return row ? parse<OpsDamageReport>(row.json) : null;
}

export async function getStatusLog(vehicleId: UUID): Promise<StatusLogEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM status_log WHERE vehicle_id=? ORDER BY at DESC',
    [vehicleId],
  );
  return rows.map((r) => parse<StatusLogEntry>(r.json));
}

export async function getBatterySwaps(vehicleId?: UUID): Promise<BatterySwap[]> {
  const db = await getDb();
  const rows = vehicleId
    ? await db.getAllAsync<{ json: string }>('SELECT json FROM battery_swaps WHERE vehicle_id=? ORDER BY at DESC', [vehicleId])
    : await db.getAllAsync<{ json: string }>('SELECT json FROM battery_swaps ORDER BY at DESC');
  return rows.map((r) => parse<BatterySwap>(r.json));
}

export async function getMaintenance(vehicleId: UUID): Promise<MaintenanceEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM maintenance WHERE vehicle_id=? ORDER BY at DESC',
    [vehicleId],
  );
  return rows.map((r) => parse<MaintenanceEntry>(r.json));
}

/** Completed rides on a vehicle, newest first — read from the local mirror. */
export async function getVehicleRides(vehicleId: UUID): Promise<VehicleRide[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM rides WHERE vehicle_id=? ORDER BY started_at DESC',
    [vehicleId],
  );
  return rows.map((r) => parse<VehicleRide>(r.json));
}

/** The vehicle's note thread, newest first. Includes not-yet-synced notes so a
 *  mechanic sees what they just wrote while still standing in a basement. */
export async function getVehicleNotes(vehicleId: UUID): Promise<VehicleNote[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string; pending: number }>(
    'SELECT json, pending FROM vehicle_notes WHERE vehicle_id=? ORDER BY created_at DESC',
    [vehicleId],
  );
  // `pending` lives in its own column so sync can clear it with one UPDATE;
  // it is re-projected onto the object here so the UI reads a single shape.
  return rows.map((r) => ({ ...parse<VehicleNote>(r.json), pending: r.pending === 1 }));
}

// ---- Shifts ----------------------------------------------------------------
/** The signed-in staff member's running shift, or null. */
export async function getOpenShift(): Promise<OpsShift | null> {
  const me = currentStaff();
  if (!me) return null;
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM ops_shifts WHERE staff_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [me.id],
  );
  return row ? parse<OpsShift>(row.json) : null;
}

/** Shift history for the signed-in staff member, newest first. */
export async function getShifts(limit = 30): Promise<OpsShift[]> {
  const me = currentStaff();
  if (!me) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM ops_shifts WHERE staff_id=? ORDER BY started_at DESC LIMIT ?',
    [me.id, limit],
  );
  return rows.map((r) => parse<OpsShift>(r.json));
}

/** Counters for the shift sheet. Derived on read rather than incremented on
 *  write: a counter column would drift every time a queued completion is
 *  retried, replayed, or arrives out of order. */
export async function getShiftStats(): Promise<ShiftStats> {
  const me = currentStaff();
  const shift = await getOpenShift();
  const elapsedMs = shift ? Math.max(0, Date.now() - Date.parse(shift.started_at)) : null;
  if (!me) return { openTasks: 0, completedThisShift: 0, elapsedMs };

  const db = await getDb();
  const open = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tasks WHERE assignee=? AND status IN (?,?,?)`,
    [me.id, OpsTaskStatus.open, OpsTaskStatus.assigned, OpsTaskStatus.in_progress],
  );
  // completed_at only exists inside the task json, so the window filter runs in
  // JS over the (small) set of tasks this staff member has already finished.
  const doneRows = await db.getAllAsync<{ json: string }>(
    `SELECT json FROM tasks WHERE assignee=? AND status=?`,
    [me.id, OpsTaskStatus.done],
  );
  const since = shift ? Date.parse(shift.started_at) : null;
  const completedThisShift =
    since === null
      ? 0
      : doneRows.filter((r) => {
          const t = parse<OpsTask>(r.json);
          return !!t.completed_at && Date.parse(t.completed_at) >= since;
        }).length;

  return { openTasks: open?.n ?? 0, completedThisShift, elapsedMs };
}

// ---- Task assignment -------------------------------------------------------
/** Who holds a task. The name resolves only for the signed-in user: the app
 *  deliberately never mirrors a staff directory (PII minimization, docs/10). */
export async function getTaskAssignment(taskId: UUID): Promise<TaskAssignment | null> {
  const t = await getTask(taskId);
  if (!t) return null;
  const me = currentStaff();
  const is_mine = !!t.assignee && t.assignee === me?.id;
  return {
    task_id: t.id,
    assignee: t.assignee,
    assignee_name: is_mine ? (me?.name ?? null) : null,
    is_mine,
  };
}

/** Tasks currently on the signed-in staff member's plate. */
export async function getMyTasks(): Promise<OpsTask[]> {
  const me = currentStaff();
  if (!me) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM tasks WHERE assignee=? ORDER BY priority DESC',
    [me.id],
  );
  return rows.map((r) => parse<OpsTask>(r.json));
}

export async function getHeatCells(): Promise<HeatCell[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM heat_cells');
  return rows.map((r) => parse<HeatCell>(r.json));
}

// ---- Optimistic local writes (mirror the pending outbox effect) ------------
export async function upsertVehicle(v: OpsVehicle): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO vehicles(id,code,status,visible,json,updated_at) VALUES(?,?,?,?,?,?)`,
    [v.id, v.code, v.status, v.visible ? 1 : 0, JSON.stringify(v), nowIso()],
  );
}

export async function patchVehicle(id: UUID, patch: Partial<OpsVehicle>): Promise<OpsVehicle | null> {
  const cur = await getVehicle(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await upsertVehicle(next);
  return next;
}

export async function setVehicleStatus(id: UUID, status: VehicleStatus): Promise<void> {
  await patchVehicle(id, { status });
}

export async function upsertTask(t: OpsTask): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO tasks(id,kind,status,vehicle_id,assignee,priority,created_by,json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [t.id, t.kind, t.status, t.vehicle_id, t.assignee, t.priority, t.created_by, JSON.stringify(t), nowIso()],
  );
}

export async function upsertDamage(d: OpsDamageReport): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO damage_reports(id,vehicle_id,status,json,updated_at) VALUES(?,?,?,?,?)`,
    [d.id, d.vehicle_id, d.status, JSON.stringify(d), nowIso()],
  );
}

export async function addStatusLog(e: StatusLogEntry): Promise<void> {
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO status_log(id,vehicle_id,at,json) VALUES(?,?,?,?)`, [e.id, e.vehicle_id, e.at, JSON.stringify(e)]);
}

export async function addBatterySwap(s: BatterySwap): Promise<void> {
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO battery_swaps(id,vehicle_id,at,json) VALUES(?,?,?,?)`, [s.id, s.vehicle_id, s.at, JSON.stringify(s)]);
}

export async function upsertVehicleNote(n: VehicleNote): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO vehicle_notes(id,vehicle_id,created_at,pending,json) VALUES(?,?,?,?,?)`,
    [n.id, n.vehicle_id, n.created_at, n.pending ? 1 : 0, JSON.stringify(n)],
  );
}

/** Called by the sync worker once the note's outbox row is accepted. */
export async function clearVehicleNotePending(id: UUID): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE vehicle_notes SET pending=0 WHERE id=?', [id]);
}

export async function upsertShift(s: OpsShift): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO ops_shifts(id,staff_id,started_at,ended_at,json) VALUES(?,?,?,?,?)`,
    [s.id, s.staff_id, s.started_at, s.ended_at, JSON.stringify(s)],
  );
}

/**
 * Local file URI for a photo we have queued for upload, or null once it is
 * only on the server.
 *
 * Every screen stores the REMOTE path (`ops-photos/<vehicle>/<file>.jpg`) on
 * the record, because that is what the server will know it by. Until the
 * upload lands, that path resolves to nothing — so damage thumbnails and note
 * attachments rendered as blank tiles for exactly the period the crew most
 * wants to look at them: right after taking the photo, in the field, offline.
 * The `photos` table already holds the mapping; nothing exposed it.
 */
export async function getPhotoLocalUri(remotePath: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ local_uri: string }>(
    'SELECT local_uri FROM photos WHERE id=?',
    [remotePath],
  );
  return row?.local_uri ?? null;
}

/**
 * Batch form of {@link getPhotoLocalUri} — a damage list renders dozens of
 * thumbnails, and one query beats one query per tile.
 * Returns only the paths we hold locally; callers fall back to the remote URL.
 */
export async function getPhotoLocalUris(remotePaths: string[]): Promise<Record<string, string>> {
  if (!remotePaths.length) return {};
  const db = await getDb();
  const holes = remotePaths.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ id: string; local_uri: string }>(
    `SELECT id, local_uri FROM photos WHERE id IN (${holes})`,
    remotePaths,
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id] = r.local_uri;
  return out;
}

/**
 * Mirror one completed ride. Used by the sync delta so a freshly pulled ride —
 * and, more to the point, its real GPS `track` — reaches the local database.
 * Without this the last-ride screen keeps drawing the reconstruction until the
 * next full bootstrap.
 */
export async function upsertRide(r: VehicleRide): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO rides(id,vehicle_id,started_at,json) VALUES(?,?,?,?)',
    [r.id, r.vehicle_id, r.started_at, JSON.stringify(r)],
  );
}
