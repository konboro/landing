// The sync worker — the heart of the offline-first design.
//
//  * Flushes the outbox to the backend when online (NetInfo or dev override).
//  * Server dedupes by row id (idempotent); applied server patches are written
//    back to the mirror (conflict rule: server wins on vehicle status).
//  * Exponential backoff per row on transient failure.
//  * Also pulls server-authoritative deltas so the mirror stays fresh.
//  * Drives the "N pending • syncing…" pill via the store.
//
// Runs on a foreground timer AND immediately on connectivity change.
import { net } from '../lib/net';
import { getOpsApi } from '../services';
import { useOps } from '../lib/store';
import { metaGet, metaSet } from './db';
import {
  dueRows,
  markSyncing,
  markDone,
  markError,
  pendingCount,
} from './outbox';
import { getVehicle, upsertVehicle, upsertTask, upsertDamage } from './repo';
import type { OutboxRow, SyncItemResult } from '../lib/types';

const FLUSH_INTERVAL_MS = 8000;
const PULL_INTERVAL_MS = 20000;
const MAX_BACKOFF_MS = 5 * 60_000;
const BATCH = 20;

let timer: ReturnType<typeof setInterval> | null = null;
let lastPullAt = 0;
let running = false;
let unsub: (() => void) | null = null;

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 8));
}

async function refreshPending() {
  useOps.getState().setPending(await pendingCount());
}

/** Flush one batch. Returns true if it did work. */
export async function flushOnce(): Promise<boolean> {
  if (running) return false;
  if (!net.online) return false;
  running = true;
  const store = useOps.getState();
  try {
    const rows = await dueRows(BATCH);
    if (rows.length === 0) {
      running = false;
      return false;
    }
    store.setSyncing(true);
    await markSyncing(rows.map((r) => r.id));

    const api = getOpsApi();
    let results: SyncItemResult[];
    try {
      results = await api.syncPush(rows);
    } catch (e) {
      // Whole-batch transient failure -> back every row off, keep them queued.
      const msg = (e as Error).message;
      for (const r of rows) {
        const attempts = r.attempts + 1;
        await markError(r.id, msg, attempts, new Date(Date.now() + backoffMs(attempts)).toISOString());
      }
      store.setLastError(msg);
      store.setSyncing(false);
      await refreshPending();
      running = false;
      return true;
    }

    const byId = new Map(rows.map((r) => [r.id, r] as const));
    for (const res of results) {
      const row = byId.get(res.id);
      if (res.status === 'applied' || res.status === 'duplicate') {
        await markDone(res.id);
        if (res.server_patch?.vehicle_id) {
          await applyServerPatch(res.server_patch);
        }
      } else {
        // rejected — a real business conflict. Keep it visible with the error,
        // long backoff so it doesn't spin. (Task completion is never rejected.)
        const attempts = (row?.attempts ?? 0) + 1;
        await markError(
          res.id,
          res.error ?? 'rejected',
          attempts,
          new Date(Date.now() + MAX_BACKOFF_MS).toISOString(),
        );
        store.setLastError(res.error ?? 'rejected');
      }
    }

    store.setLastSyncAt(new Date().toISOString());
    store.setLastError(null);
    store.bumpRev();
    store.setSyncing(false);
    await refreshPending();
    running = false;
    return true;
  } catch (e) {
    store.setLastError((e as Error).message);
    store.setSyncing(false);
    running = false;
    return false;
  }
}

async function applyServerPatch(patch: NonNullable<SyncItemResult['server_patch']>) {
  const id = patch.vehicle_id!;
  const v = await getVehicle(id);
  if (!v) return;
  await upsertVehicle({ ...v, ...patch, id });
}

/** Pull server-authoritative deltas into the mirror. */
export async function pullOnce(): Promise<void> {
  if (!net.online) return;
  const api = getOpsApi();
  const since = (await metaGet('last_pull_at')) ?? new Date(0).toISOString();
  try {
    const delta = await api.syncPull(since);
    for (const v of delta.vehicles) await upsertVehicle(v);
    for (const t of delta.tasks) await upsertTask(t);
    for (const d of delta.damageReports) await upsertDamage(d);
    await metaSet('last_pull_at', delta.server_time);
    if (delta.vehicles.length || delta.tasks.length || delta.damageReports.length) {
      useOps.getState().bumpRev();
    }
  } catch {
    /* offline / transient — try again next tick */
  }
}

async function tick() {
  const online = net.online;
  useOps.getState().setOnline(online);
  if (!online) return;
  await flushOnce();
  if (Date.now() - lastPullAt > PULL_INTERVAL_MS) {
    lastPullAt = Date.now();
    await pullOnce();
  }
}

export function startSync() {
  net.start();
  useOps.getState().setOnline(net.online);
  refreshPending();
  if (!timer) timer = setInterval(() => void tick(), FLUSH_INTERVAL_MS);
  if (!unsub) {
    unsub = net.subscribe((online) => {
      useOps.getState().setOnline(online);
      if (online) void tick(); // drain immediately when connectivity returns
    });
  }
  // kick once on start
  void tick();
}

export function stopSync() {
  if (timer) clearInterval(timer);
  timer = null;
  if (unsub) unsub();
  unsub = null;
}

/** Called right after any enqueue so the pill updates and we try to drain. */
export async function nudgeSync() {
  await refreshPending();
  if (net.online) void flushOnce();
}
