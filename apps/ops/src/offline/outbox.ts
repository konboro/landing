// The mutation queue. EVERY mutating action in the app enqueues exactly one
// outbox row with a client-generated uuid (the idempotency key). The sync
// worker (sync.ts) flushes these to the server, which dedupes by id.
import { getDb } from './db';
import { uuid, nowIso } from '../lib/ids';
import type { OutboxKind, OutboxRow, OutboxStatus } from '../lib/types';

export interface EnqueueOptions {
  /** Provide the id when it must match a row already written to the mirror
   *  (e.g. a command_id / damage_id), so retries stay idempotent. */
  id?: string;
}

export async function enqueue<P extends Record<string, unknown>>(
  kind: OutboxKind,
  payload: P,
  opts: EnqueueOptions = {},
): Promise<OutboxRow<P>> {
  const db = await getDb();
  const row: OutboxRow<P> = {
    id: opts.id ?? uuid(),
    kind,
    payload,
    created_at: nowIso(),
    status: 'pending',
    attempts: 0,
    last_error: null,
    next_attempt_at: null,
  };
  await db.runAsync(
    `INSERT OR IGNORE INTO outbox(id,kind,payload,created_at,status,attempts,last_error,next_attempt_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    [row.id, row.kind, JSON.stringify(row.payload), row.created_at, row.status, 0, null, null],
  );
  return row;
}

/** Queue a captured photo for resumable upload; returns the remote path that
 *  callers embed in photos[] arrays so it resolves once uploaded. */
export async function queuePhoto(localUri: string, vehicleId: string): Promise<string> {
  const db = await getDb();
  const name = `${Date.now()}-${uuid().slice(0, 8)}.jpg`;
  const remotePath = `ops-photos/${vehicleId}/${name}`;
  await db.runAsync(
    `INSERT OR REPLACE INTO photos(id,local_uri,status,created_at) VALUES(?,?,?,?)`,
    [remotePath, localUri, 'queued', nowIso()],
  );
  await enqueue('photo_upload', { local_uri: localUri, remote_path: remotePath, bytes: 0 }, { id: `photo:${remotePath}` });
  return remotePath;
}

// ---- Queries ---------------------------------------------------------------
function rowFrom(r: {
  id: string; kind: string; payload: string; created_at: string;
  status: string; attempts: number; last_error: string | null; next_attempt_at: string | null;
}): OutboxRow {
  return {
    id: r.id,
    kind: r.kind as OutboxKind,
    payload: JSON.parse(r.payload),
    created_at: r.created_at,
    status: r.status as OutboxStatus,
    attempts: r.attempts,
    last_error: r.last_error,
    next_attempt_at: r.next_attempt_at,
  };
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM outbox WHERE status IN ('pending','syncing','error')`,
  );
  return row?.n ?? 0;
}

export async function allOutbox(limit = 200): Promise<OutboxRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(rowFrom);
}

/** Rows eligible to send now: pending, or errored past their backoff window. */
export async function dueRows(limit = 25): Promise<OutboxRow[]> {
  const db = await getDb();
  const now = nowIso();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM outbox
     WHERE status='pending'
        OR (status='error' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
     ORDER BY created_at ASC LIMIT ?`,
    [now, limit],
  );
  return rows.map(rowFrom);
}

export async function markSyncing(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE outbox SET status='syncing' WHERE id IN (${placeholders})`, ids);
}

export async function markDone(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET status='done', last_error=NULL WHERE id=?`, [id]);
}

export async function markError(id: string, error: string, attempts: number, nextAttemptAt: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status='error', last_error=?, attempts=?, next_attempt_at=? WHERE id=?`,
    [error, attempts, nextAttemptAt, id],
  );
}

export async function clearDone(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox WHERE status='done'`);
}

/** Requeue rows left mid-flight if the app was killed during a sync. */
export async function resetStuckSyncing(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET status='pending' WHERE status='syncing'`);
}
