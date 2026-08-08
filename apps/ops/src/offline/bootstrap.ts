// First-run + login bootstrap. Seeds SQLite from the backend snapshot once,
// then starts the sync worker. Safe to call repeatedly.
import { getOpsApi } from '../services';
import { isSeeded, seedFromBootstrap } from './repo';
import { startSync } from './sync';
import { resetDb } from './db';
import { useOps } from '../lib/store';
import type { StaffSession } from '../lib/types';

export async function bootstrapAfterLogin(session: StaffSession): Promise<void> {
  const store = useOps.getState();
  const api = getOpsApi();
  if (!(await isSeeded())) {
    const snapshot = await api.getBootstrap(session);
    await seedFromBootstrap(snapshot);
  }
  store.setBootstrapped(true);
  startSync();
}

/** Dev menu: wipe local mirror + outbox and re-seed from the backend. */
export async function resetAndReseed(): Promise<void> {
  const store = useOps.getState();
  const session = store.session;
  if (!session) return;
  await resetDb();
  const snapshot = await getOpsApi().getBootstrap(session);
  await seedFromBootstrap(snapshot);
  store.bumpRev();
}
