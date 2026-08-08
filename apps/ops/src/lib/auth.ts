// Session persistence via the SQLite meta table so a field tech stays logged
// in across app restarts (they work offline for a whole shift).
import { metaGet, metaSet, isSqliteAvailable } from '../offline/db';
import type { StaffSession } from './types';

export async function saveSession(s: StaffSession): Promise<void> {
  if (!isSqliteAvailable()) return;
  await metaSet('session', JSON.stringify(s));
}

export async function loadSession(): Promise<StaffSession | null> {
  if (!isSqliteAvailable()) return null;
  const raw = await metaGet('session');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffSession;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  if (!isSqliteAvailable()) return;
  await metaSet('session', '');
}

export async function isOnboarded(): Promise<boolean> {
  if (!isSqliteAvailable()) return false;
  return (await metaGet('onboarded')) === '1';
}

export async function setOnboarded(): Promise<void> {
  if (!isSqliteAvailable()) return;
  await metaSet('onboarded', '1');
}
