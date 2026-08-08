// Read/write layer over the SQLite mirror. UI reads exclusively from here so
// it always renders instantly, online or offline. Optimistic local writes keep
// the mirror in sync with what the outbox will eventually push to the server.
import { getDb, metaGet, metaSet } from './db';
import type {
  Bootstrap,
  OpsVehicle,
  RebalanceZone,
  StatusLogEntry,
  BatterySwap,
  MaintenanceEntry,
  HeatCell,
  VehicleRide,
} from '../lib/types';
import type { OpsTask, DamageReport, UUID, VehicleStatus } from '@penny/db-types';
import { nowIso } from '../lib/ids';

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

export async function getDamageReports(): Promise<DamageReport[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM damage_reports ORDER BY updated_at DESC',
  );
  return rows.map((r) => parse<DamageReport>(r.json));
}

export async function getDamageReport(id: UUID): Promise<DamageReport | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM damage_reports WHERE id=?', [id]);
  return row ? parse<DamageReport>(row.json) : null;
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

export async function upsertDamage(d: DamageReport): Promise<void> {
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
