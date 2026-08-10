// The "backend" seam. The app talks to an OpsApi implementation only through
// the sync worker + bootstrap. Swap MockOpsApi <-> SupabaseOpsApi via
// EXPO_PUBLIC_DATA_SOURCE without touching UI or offline code.
import type {
  Bootstrap,
  OutboxRow,
  SyncItemResult,
  StaffSession,
  OpsDamageReport,
  OpsShift,
  OpsVehicle,
  VehicleNote,
  VehicleRide,
} from '../lib/types';
import type { OpsTask } from '@penny/db-types';

export interface PullDelta {
  server_time: string;
  vehicles: OpsVehicle[];
  tasks: OpsTask[];
  damageReports: OpsDamageReport[];
  /** Optional: a backend without the 00370 tables simply omits them. */
  vehicleNotes?: VehicleNote[];
  shifts?: OpsShift[];
  /** Rides that FINISHED since the last pull, with their real GPS trace, so the
   *  "Last ride" screen does not stay a bootstrap stale. Optional: a backend
   *  that cannot serve them omits the field.
   *
   *  NOTE: the sync worker does not persist these yet — it applies vehicles,
   *  tasks, damage, notes and shifts. Wiring it is one `upsertRide` loop in
   *  `src/offline/sync.ts`, whose owner is not this file. */
  rides?: VehicleRide[];
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
