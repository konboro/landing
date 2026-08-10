// expo-sqlite offline store. Mirrors the server tables the ops app needs so
// EVERYTHING works with no network: reads come from here, writes go to `outbox`.
// The native module is guarded so import never crashes in a non-RN context.
import type { SQLiteDatabase } from 'expo-sqlite';

let SQLite: typeof import('expo-sqlite') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SQLite = require('expo-sqlite');
} catch {
  SQLite = null;
}

const DB_NAME = 'penny-ops.db';
const SCHEMA_VERSION = 2;

// Schema mirrors: vehicles-in-scope, assigned tasks, zones, checklists (kept
// inside tasks json), damage reports, status log, battery swaps, maintenance,
// heat cells, vehicle note threads, shifts, meta, and the outbox.
//
// Every table stores its row as `json` plus the few columns we filter/sort on.
// That is what makes additive server changes (e.g. `damage_reports.part` from
// migration 00370) need no local migration at all: the new field rides inside
// the json blob. Genuinely new TABLES are also free — the whole schema is
// re-applied with IF NOT EXISTS on every open, so an app that upgrades gets
// them on next launch with its existing rows untouched.
const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS vehicles (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL,
  status    TEXT NOT NULL,
  visible   INTEGER NOT NULL DEFAULT 1,
  json      TEXT NOT NULL,          -- full OpsVehicle
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_code ON vehicles(code);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  vehicle_id TEXT,
  assignee   TEXT,
  priority   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'admin',
  json       TEXT NOT NULL,          -- full OpsTask
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_kind ON tasks(kind);

CREATE TABLE IF NOT EXISTS zones (
  id   TEXT PRIMARY KEY,
  json TEXT NOT NULL              -- RebalanceZone
);

CREATE TABLE IF NOT EXISTS damage_reports (
  id         TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  status     TEXT NOT NULL,
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_log (
  id         TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  at         TEXT NOT NULL,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_statuslog_vehicle ON status_log(vehicle_id);

CREATE TABLE IF NOT EXISTS battery_swaps (
  id         TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  at         TEXT NOT NULL,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swaps_vehicle ON battery_swaps(vehicle_id);

CREATE TABLE IF NOT EXISTS maintenance (
  id         TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  at         TEXT NOT NULL,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_vehicle ON maintenance(vehicle_id);

CREATE TABLE IF NOT EXISTS rides (
  id         TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  started_at TEXT,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rides_vehicle ON rides(vehicle_id, started_at DESC);

-- Per-vehicle note thread. pending=1 while the outbox row for the note is still
-- queued, so the UI can mark it "not synced yet" without inspecting the outbox.
-- The note id IS the outbox row id, which keeps the insert idempotent.
CREATE TABLE IF NOT EXISTS vehicle_notes (
  id         TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  pending    INTEGER NOT NULL DEFAULT 0,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vnotes_vehicle ON vehicle_notes(vehicle_id, created_at DESC);

-- Shifts. ended_at IS NULL is the "open shift" marker, mirroring the server's
-- partial unique index (ops_shifts_one_open_per_staff).
CREATE TABLE IF NOT EXISTS ops_shifts (
  id         TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shifts_staff ON ops_shifts(staff_id, started_at DESC);

CREATE TABLE IF NOT EXISTS heat_cells (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY,   -- client uuid = idempotency key
  kind            TEXT NOT NULL,
  payload         TEXT NOT NULL,      -- json
  created_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|syncing|done|error
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox(created_at);

CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,       -- remote_path
  local_uri  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued', -- queued|uploaded
  created_at TEXT NOT NULL
);
`;

let dbPromise: Promise<SQLiteDatabase> | null = null;

export function isSqliteAvailable(): boolean {
  return !!SQLite;
}

export async function getDb(): Promise<SQLiteDatabase> {
  if (!SQLite) {
    throw new Error(
      'expo-sqlite native module unavailable. Run in Expo Go / dev client, not plain Node.',
    );
  }
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite!.openDatabaseAsync(DB_NAME);
      await db.execAsync(SCHEMA);
      await db.runAsync(
        `INSERT INTO meta(key,value) VALUES('schema_version',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [String(SCHEMA_VERSION)],
      );
      return db;
    })();
  }
  return dbPromise;
}

export async function metaGet(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key=?',
    [key],
  );
  return row?.value ?? null;
}

export async function metaSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO meta(key,value) VALUES(?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, value],
  );
}

/** Wipe all tables (used by dev menu "reset & reseed"). */
export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM vehicles; DELETE FROM tasks; DELETE FROM zones;
    DELETE FROM damage_reports; DELETE FROM status_log; DELETE FROM battery_swaps;
    DELETE FROM maintenance; DELETE FROM heat_cells; DELETE FROM outbox;
    DELETE FROM photos; DELETE FROM vehicle_notes; DELETE FROM ops_shifts;
    DELETE FROM rides;
    DELETE FROM meta WHERE key='seeded';
  `);
}
