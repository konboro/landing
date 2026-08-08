// The "backend" seam. The app talks to an OpsApi implementation only through
// the sync worker + bootstrap. Swap MockOpsApi <-> SupabaseOpsApi via
// EXPO_PUBLIC_DATA_SOURCE without touching UI or offline code.
import type { Bootstrap, OutboxRow, SyncItemResult, StaffSession, OpsVehicle } from '../lib/types';
import type { OpsTask, DamageReport } from '@penny/db-types';

export interface PullDelta {
  server_time: string;
  vehicles: OpsVehicle[];
  tasks: OpsTask[];
  damageReports: DamageReport[];
}

export interface OpsApi {
  /** Mock staff login: OTP + staff-role check. */
  login(phone: string, otp: string): Promise<StaffSession>;

  /** First-run snapshot used to seed SQLite. */
  getBootstrap(session: StaffSession): Promise<Bootstrap>;

  /** Flush a batch of outbox rows. Server dedupes by row id (idempotent). */
  syncPush(items: OutboxRow[]): Promise<SyncItemResult[]>;

  /** Server-authoritative changes since `since` (server wins on status). */
  syncPull(since: string): Promise<PullDelta>;
}
