// Real backend adapter. Uses @penny/api-client (anon key + RLS; ops mutations
// land in audit_log via edge functions on sync — CLAUDE.md Hard Rule #8).
// Selected via EXPO_PUBLIC_DATA_SOURCE=supabase. The mock remains the default
// so the app runs standalone. This adapter is intentionally thin: the offline
// outbox is the source of truth and this only bridges it to edge functions.
import type { OpsApi, PullDelta } from './OpsApi';
import type {
  Bootstrap,
  DamageCreatePayload,
  OpsVehicle,
  OutboxKind,
  OutboxRow,
  ShiftEndPayload,
  ShiftStartPayload,
  StaffSession,
  SyncItemResult,
  VehicleNotePayload,
} from '../lib/types';
import type { LngLat, OpsTask } from '@penny/db-types';
import {
  buildHeat,
  buildVehicles,
  buildZones,
  toDamage,
  toMaintenance,
  toNote,
  toRide,
  toShift,
  toStatusLog,
  toSwap,
  toTask,
  toTrack,
  type BatterySwapRow,
  type DamageRow,
  type HeatRow,
  type MaintenanceRow,
  type RideHistoryRow,
  type ShiftRow,
  type StatusLogRow,
  type TripRouteRow,
  type VehicleAlertRow,
  type VehicleModelRow,
  type VehicleNoteRow,
  type VehicleRow,
  type VehicleStateRow,
  type ZoneRow,
} from './supabaseMappers';
import { env } from '../lib/env';

// Guard the supabase-js import so a mock-only build never pulls native deps it
// doesn't need at runtime.
type PennyClient = import('@penny/api-client').PennyClient;

let clientPromise: Promise<PennyClient> | null = null;
async function getClient(): Promise<PennyClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createPennyClient } = await import('@penny/api-client');
      const { opsAuthStorage } = await import('./supportChat');
      return createPennyClient({
        url: env.supabaseUrl,
        anonKey: env.supabaseAnonKey,
        // Without an explicit storage, supabase-js falls back to an in-memory
        // store in React Native — so the session died on every app restart and
        // a crew member had to re-enter an OTP each morning, offline-first app
        // or not. It also meant a second client (the support chat) came up
        // signed out. Backed by the SQLite meta table the app already opens.
        auth: { storage: opsAuthStorage, storageKey: 'penny-ops-auth' },
      });
    })();
  }
  return clientPromise;
}

// Rows the app writes straight to Postgres with the anon key. Migration 00370
// gave staff explicit insert/select policies on exactly these tables (guarded
// by public.is_staff()), so they need no elevated rights and therefore
// no edge function — Hard Rule #6 is about service_role, not about RLS-safe
// writes. Everything else (vehicle state, commands, task lifecycle, money)
// still goes through `ops-sync`, which is where the audit_log entry is written
// (Hard Rule #8).
const DIRECT_KINDS: ReadonlySet<OutboxKind> = new Set<OutboxKind>([
  'vehicle_note',
  'shift_start',
  'shift_end',
  'damage_create',
]);

interface PgError { code?: string; message: string }

/** Turn one PostgREST error into a per-row verdict.
 *
 *  The distinction matters because these rows travel in the same batch as the
 *  edge-function ones: a THROWN error backs the whole batch off (right for a
 *  dropped tunnel — nobody's offline note is lost), while a returned verdict
 *  only settles this row and lets the rest of the batch through. So anything
 *  carrying a real SQLSTATE is permanent and settles here; anything without
 *  one is transport and gets thrown.
 *
 *  23505 (unique_violation) is a duplicate, not a failure: the row id is the
 *  primary key, so a replay hits it, and so does a second open shift racing
 *  the partial unique index. Either way the intent already holds. */
function verdict(id: string, e: PgError | null): SyncItemResult | null {
  if (!e) return { id, status: 'applied' };
  if (e.code === '23505') return { id, status: 'duplicate' };
  if (e.code && e.code.length === 5) return { id, status: 'rejected', error: e.message };
  return null; // caller throws — transport failure, keep it queued
}

// ---------------------------------------------------------------------------
// READS
//
// There is no `ops-bootstrap` / `ops-pull` edge function, and there never was:
// the snapshot is assembled here from the tables and views directly. Every one
// of them is SELECT-only under RLS with the anon key (migrations 00360/00370/
// 00380/00400), which is exactly what Hard Rule #6 asks for — service_role
// never leaves the edge functions. WRITES are untouched: they still go through
// the outbox, to `ops-sync` or to the four RLS-safe tables below.
//
// A city-scoped operator legitimately sees fewer rows than a national one, so a
// short list is not an error and is never reported as one.
// ---------------------------------------------------------------------------

/** Column lists, shared by the full snapshot and the delta so the two cannot
 *  drift into returning differently-shaped vehicles. */
const SEL = {
  vehicles: 'id,code,model_id,status,visible,plate,vin,city_id,notes',
  state:
    'vehicle_id,pos,soc_pct,speed_kmh,ignition,locked,last_seen,session_online,fall,power_cut,moved_while_locked',
  models: 'id,name,kind',
  alerts: 'id,vehicle_id,kind,payload,created_at',
  tasks:
    'id,kind,vehicle_id,zone_id,priority,status,assignee,due_at,checklist,photos,notes,created_by,completed_at,created_at',
  zones: 'id,city_id,kind,name,geom,rules,active,valid_from,valid_to',
  damage:
    'id,vehicle_id,reporter,user_id,trip_id,description,photos,severity,status,linked_task_id,penalty_payment_id,part,created_at',
  statusLog: 'id,vehicle_id,from_status,to_status,by,role,reason,photos,pos,at',
  swaps: 'id,vehicle_id,by,at,voltage_before,voltage_after',
  // `task:ops_tasks(kind)` is the only embed we use — maintenance_log has no
  // kind of its own, so it borrows the kind of the task that produced it.
  maintenance: 'id,vehicle_id,task_id,parts,cost_cents,notes,created_at,task:ops_tasks(kind)',
  rides:
    'trip_id,vehicle_id,rider_phone_masked,status,started_at,ended_at,duration_s,distance_m,cost_cents,currency,photo_review,end_zone_name',
  heat: 'cell,idle_vehicles',
  routes: 'trip_id,path',
  notes: 'id,vehicle_id,staff_id,body,photos,created_at',
  shifts: 'id,staff_id,started_at,ended_at,tasks_completed,note',
} as const;

/** Per-source row caps. The mirror is a working set for a shift, not an
 *  archive: history tables are capped hard so one busy vehicle cannot push the
 *  fleet itself out of a snapshot. */
const CAP = {
  vehicles: 2000,
  models: 200,
  alerts: 500,
  tasks: 1000,
  zones: 500,
  damage: 500,
  statusLog: 1000,
  swaps: 500,
  maintenance: 500,
  rides: 500,
  heat: 500,
  notes: 500,
  shifts: 50,
  /** Rides that finished since the last pull — a handful, by definition. */
  ridesDelta: 200,
  /** trip ids per `in(...)` request; more than this and the URL gets refused. */
  routeChunk: 100,
} as const;

type QueryResult = { data: unknown; error: { message: string } | null };

/** Await one source and degrade to an empty list if it fails.
 *
 *  This is the whole resilience story for the snapshot: the reads are fired in
 *  parallel and settled one by one, so a table that is missing a policy (the
 *  defect 00360/00380/00400 each fixed once) costs you that one list, not the
 *  entire fleet. The failure is logged with its source name so the next one is
 *  identified from a log line instead of a bisect. */
async function rows<T>(label: string, q: PromiseLike<QueryResult>): Promise<T[]> {
  try {
    const { data, error } = await q;
    if (error) {
      console.warn(`[ops] read failed: ${label} — ${error.message}`);
      return [];
    }
    return (data ?? []) as T[];
  } catch (e) {
    console.warn(`[ops] read failed: ${label} — ${(e as Error).message}`);
    return [];
  }
}

/**
 * The `zones` read, with all three filters in the query rather than in the app.
 *
 * `city_scope` is null for a national operator, which legitimately means "every
 * city" — so an empty scope adds no filter, and a set one restricts. The window
 * uses two `.or(...)` groups; PostgREST ANDs them, giving
 * (valid_from IS NULL OR valid_from <= now) AND (valid_to IS NULL OR valid_to >= now).
 */
function zoneQuery(db: PennyClient['supabase'], session: StaffSession) {
  const nowIso = new Date().toISOString();
  let q = db.from('zones').select(SEL.zones).eq('active', true);
  const scope = session.city_scope;
  if (scope && scope.length > 0) q = q.in('city_id', scope);
  return q
    .or(`valid_from.is.null,valid_from.lte.${nowIso}`)
    .or(`valid_to.is.null,valid_to.gte.${nowIso}`)
    .limit(CAP.zones);
}

export class SupabaseOpsApi implements OpsApi {
  /** Resolved once per session; needed for note rows queued by a build that
   *  didn't stamp staff_id into the payload. */
  private staffIdPromise: Promise<string | null> | null = null;

  private async staffId(): Promise<string | null> {
    if (!this.staffIdPromise) {
      this.staffIdPromise = (async () => {
        const client = await getClient();
        const { data } = await client.supabase.auth.getUser();
        const uid = data.user?.id;
        if (!uid) return null;
        const res = await client.supabase.from('staff').select('id').eq('user_id', uid).maybeSingle();
        return (res.data as { id: string } | null)?.id ?? null;
      })();
    }
    return this.staffIdPromise;
  }

  async login(phone: string, otp: string): Promise<StaffSession> {
    const client = await getClient();
    const { error } = await client.supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' });
    if (error) throw new Error(error.message);
    const me = await client.repos.me();
    if (!me) throw new Error('No user profile');
    // Staff-role check happens server-side via RLS on the ops_staff view.
    const { data: staff, error: sErr } = await client.supabase
      .from('staff')
      .select('id,user_id,role,city_scope,active')
      .eq('user_id', me.id)
      .maybeSingle();
    if (sErr || !staff || !staff.active) throw new Error('Not an active staff account');
    if (!['ops', 'ops_manager', 'admin', 'owner'].includes(staff.role)) {
      throw new Error('Account lacks ops access');
    }
    return {
      staff_id: staff.id,
      user_id: me.id,
      name: me.full_name ?? 'Ops',
      role: (staff.role === 'owner' ? 'admin' : staff.role) as StaffSession['role'],
      city_scope: staff.city_scope,
      phone: me.phone,
    };
  }

  /** The full snapshot the mirror is seeded from, read straight from Postgres.
   *
   *  Fourteen independent reads, fired together and settled independently: the
   *  fleet does not wait on the heatmap, and the heatmap failing does not cost
   *  you the fleet. */
  async getBootstrap(session: StaffSession): Promise<Bootstrap> {
    const client = await getClient();
    const db = client.supabase;

    const [
      vehicles, states, models, alerts,
      taskRows, zoneRows, damageRows,
      statusRows, swapRows, mntRows, rideRows, heatRows,
      noteRows, shiftRows,
    ] = await Promise.all([
      rows<VehicleRow>('vehicles', db.from('vehicles').select(SEL.vehicles).order('code').limit(CAP.vehicles)),
      rows<VehicleStateRow>('vehicle_state', db.from('vehicle_state').select(SEL.state).limit(CAP.vehicles)),
      rows<VehicleModelRow>('vehicle_models', db.from('vehicle_models').select(SEL.models).limit(CAP.models)),
      // Open alarms only — an acknowledged alert is history, and the vehicle
      // card shows current faults.
      rows<VehicleAlertRow>('vehicle_alerts', db.from('vehicle_alerts').select(SEL.alerts)
        .is('ack_at', null).order('created_at', { ascending: false }).limit(CAP.alerts)),
      rows<OpsTask>('ops_tasks', db.from('ops_tasks').select(SEL.tasks)
        .order('priority', { ascending: false }).order('created_at', { ascending: false }).limit(CAP.tasks)),
      // Inactive zones are drafts and retired versions; drawing them would put
      // rules on the map that the server does not enforce. Same for a zone whose
      // validity window has not opened or has already closed, and for another
      // city's — a crew scoped to one city was downloading every city's
      // geometry and drawing it over their own.
      rows<ZoneRow>('zones', zoneQuery(db, session)),
      rows<DamageRow>('damage_reports', db.from('damage_reports').select(SEL.damage)
        .order('created_at', { ascending: false }).limit(CAP.damage)),
      rows<StatusLogRow>('vehicle_status_log', db.from('vehicle_status_log').select(SEL.statusLog)
        .order('at', { ascending: false }).limit(CAP.statusLog)),
      rows<BatterySwapRow>('battery_swaps', db.from('battery_swaps').select(SEL.swaps)
        .order('at', { ascending: false }).limit(CAP.swaps)),
      rows<MaintenanceRow>('maintenance_log', db.from('maintenance_log').select(SEL.maintenance)
        .order('created_at', { ascending: false }).limit(CAP.maintenance)),
      rows<RideHistoryRow>('v_vehicle_ride_history', db.from('v_vehicle_ride_history').select(SEL.rides)
        .order('started_at', { ascending: false, nullsFirst: false }).limit(CAP.rides)),
      rows<HeatRow>('v_heatmap_idle', db.from('v_heatmap_idle').select(SEL.heat).limit(CAP.heat)),
      rows<VehicleNoteRow>('vehicle_notes', db.from('vehicle_notes').select(SEL.notes)
        .order('created_at', { ascending: false }).limit(CAP.notes)),
      rows<ShiftRow>('ops_shifts', db.from('ops_shifts').select(SEL.shifts)
        .eq('staff_id', session.staff_id).order('started_at', { ascending: false }).limit(CAP.shifts)),
    ]);

    const fleet = buildVehicles({ vehicles, states, models, alerts, rides: rideRows });
    const tracks = await this.fetchTracks(rideRows.map((r) => r.trip_id));
    return {
      server_time: new Date().toISOString(),
      vehicles: fleet,
      tasks: taskRows.map(toTask),
      // Counts and demand are computed against the fleet we just read; see
      // buildZones for what the DB does and does not store. The scope and the
      // window are re-applied there so the mirrored copy carries the same rule.
      zones: buildZones(zoneRows, fleet, { cityScope: session.city_scope }),
      damageReports: damageRows.map(toDamage),
      statusLog: statusRows.map(toStatusLog),
      batterySwaps: swapRows.map(toSwap),
      maintenance: mntRows.map(toMaintenance),
      rides: rideRows.map((r) => toRide(r, tracks.get(r.trip_id))),
      heat: buildHeat(heatRows),
      vehicleNotes: noteRows.map(toNote),
      shifts: shiftRows.map(toShift),
    };
  }

  /** Real GPS traces for a set of trips, keyed by trip id.
   *
   *  `trip_routes` holds the whole ride in one row (`path`), so this is one
   *  request per batch of trips — never one per ride. Batched because the ids
   *  travel in the URL and a few hundred UUIDs overflow it. A trip with no
   *  route row simply has no entry, and its ride keeps `track` undefined. */
  private async fetchTracks(tripIds: string[]): Promise<Map<string, LngLat[]>> {
    const out = new Map<string, LngLat[]>();
    if (tripIds.length === 0) return out;
    const client = await getClient();
    const chunks: string[][] = [];
    for (let i = 0; i < tripIds.length; i += CAP.routeChunk) {
      chunks.push(tripIds.slice(i, i + CAP.routeChunk));
    }
    const results = await Promise.all(
      chunks.map((ids) =>
        rows<TripRouteRow>('trip_routes', client.supabase.from('trip_routes').select(SEL.routes).in('trip_id', ids)),
      ),
    );
    for (const r of results.flat()) {
      const track = toTrack(r.path);
      if (track) out.set(r.trip_id, track);
    }
    return out;
  }

  /** Re-read the enriched vehicle rows for a specific set of ids (the delta
   *  path) or for the whole fleet. Same five sources as the snapshot, same
   *  per-source degradation. */
  private async fetchVehicles(ids: string[]): Promise<OpsVehicle[]> {
    if (ids.length === 0) return [];
    const client = await getClient();
    const db = client.supabase;
    const [vehicles, states, models, alerts, rides] = await Promise.all([
      rows<VehicleRow>('vehicles(delta)', db.from('vehicles').select(SEL.vehicles).in('id', ids)),
      rows<VehicleStateRow>('vehicle_state(delta)', db.from('vehicle_state').select(SEL.state).in('vehicle_id', ids)),
      rows<VehicleModelRow>('vehicle_models(delta)', db.from('vehicle_models').select(SEL.models).limit(CAP.models)),
      rows<VehicleAlertRow>('vehicle_alerts(delta)', db.from('vehicle_alerts').select(SEL.alerts)
        .in('vehicle_id', ids).is('ack_at', null).order('created_at', { ascending: false }).limit(CAP.alerts)),
      // Only feeds `idle_since`, which is derived from the last completed ride,
      // so this projection is deliberately narrower than the snapshot's.
      rows<{ vehicle_id: string; ended_at: string | null }>('v_vehicle_ride_history(delta)',
        db.from('v_vehicle_ride_history').select('vehicle_id,ended_at').in('vehicle_id', ids)
          .order('ended_at', { ascending: false, nullsFirst: false }).limit(CAP.rides)),
    ]);
    return buildVehicles({ vehicles, states, models, alerts, rides });
  }

  async syncPush(items: OutboxRow[]): Promise<SyncItemResult[]> {
    const client = await getClient();
    const direct = items.filter((i) => DIRECT_KINDS.has(i.kind));
    const viaEdge = items.filter((i) => !DIRECT_KINDS.has(i.kind));

    const results: SyncItemResult[] = [];
    for (const item of direct) {
      results.push(await this.pushDirect(item));
    }

    if (viaEdge.length > 0) {
      // The `ops-sync` edge function dedupes by row id and writes audit_log.
      const data = await client.supabase.functions.invoke('ops-sync', {
        body: { items: viaEdge },
      });
      if (data.error) throw new Error(data.error.message);
      results.push(...(data.data as { results: SyncItemResult[] }).results);
    }
    return results;
  }

  /** Apply one RLS-safe row against its table. Settles business conflicts as a
   *  per-row verdict (see `verdict`) and throws only on transport failure, so
   *  a blipped tunnel keeps the row queued instead of losing an offline note. */
  private async pushDirect(item: OutboxRow): Promise<SyncItemResult> {
    const client = await getClient();
    const settle = (e: PgError | null): SyncItemResult => {
      const v = verdict(item.id, e);
      if (!v) throw new Error(`${item.kind}: ${e?.message ?? 'network error'}`);
      return v;
    };
    switch (item.kind) {
      case 'vehicle_note': {
        const p = item.payload as unknown as VehicleNotePayload;
        const { error } = await client.supabase.from('vehicle_notes').insert({
          // The client id is the primary key, which is what makes a replayed
          // row a duplicate instead of a second copy of the same note.
          id: p.note_id ?? item.id,
          vehicle_id: p.vehicle_id,
          staff_id: p.staff_id ?? (await this.staffId()),
          body: p.note,
          photos: p.photos,
        });
        return settle(error as PgError | null);
      }
      case 'shift_start': {
        const p = item.payload as unknown as ShiftStartPayload;
        const { error } = await client.supabase.from('ops_shifts').insert({
          id: p.shift_id,
          staff_id: p.staff_id,
          started_at: p.started_at,
        });
        return settle(error as PgError | null);
      }
      case 'shift_end': {
        const p = item.payload as unknown as ShiftEndPayload;
        const { error } = await client.supabase
          .from('ops_shifts')
          .update({ ended_at: p.ended_at, tasks_completed: p.tasks_completed, note: p.note })
          .eq('id', p.shift_id)
          .is('ended_at', null); // idempotent: a re-sent close is a no-op
        return settle(error as PgError | null);
      }
      case 'damage_create': {
        const p = item.payload as unknown as DamageCreatePayload;
        const { error } = await client.supabase.from('damage_reports').insert({
          id: p.damage_id,
          vehicle_id: p.vehicle_id,
          reporter: 'ops',
          description: p.description,
          photos: p.photos,
          severity: p.severity,
          status: 'new',
          linked_task_id: p.linked_task_id,
          part: p.part ?? null,
        });
        return settle(error as PgError | null);
      }
      default:
        return { id: item.id, status: 'rejected', error: `unroutable kind ${item.kind}` };
    }
  }

  /** Server-authoritative changes since `since`.
   *
   *  A real delta wherever the table carries a timestamp, so a poll on a live
   *  fleet moves a handful of rows instead of the whole snapshot. Two waves:
   *  find WHICH vehicles changed (either their business row or their live
   *  state), then re-read those in full. */
  async syncPull(since: string): Promise<PullDelta> {
    const client = await getClient();
    const db = client.supabase;
    const staffId = await this.staffId();

    const [vehChanged, stateChanged, taskRows, damageRows, rideRows, noteRows, shiftRows] = await Promise.all([
      rows<{ id: string }>('vehicles(changed)', db.from('vehicles').select('id')
        .gt('updated_at', since).limit(CAP.vehicles)),
      // The live mirror is what actually moves between polls: position, SoC,
      // lock, online. Its `updated_at` is the one the gateway bumps.
      rows<{ vehicle_id: string }>('vehicle_state(changed)', db.from('vehicle_state').select('vehicle_id')
        .gt('updated_at', since).limit(CAP.vehicles)),
      rows<OpsTask>('ops_tasks(delta)', db.from('ops_tasks').select(SEL.tasks)
        .gt('updated_at', since).order('priority', { ascending: false }).limit(CAP.tasks)),
      // damage_reports has no updated_at (00090) — a report edited server-side
      // after `since` is missed here and only corrected on the next bootstrap.
      rows<DamageRow>('damage_reports(delta)', db.from('damage_reports').select(SEL.damage)
        .gt('created_at', since).order('created_at', { ascending: false }).limit(CAP.damage)),
      // A ride enters the mirror when it FINISHES, so `ended_at` is the delta
      // key — not created_at, which is when the trip started.
      rows<RideHistoryRow>('v_vehicle_ride_history(delta)', db.from('v_vehicle_ride_history').select(SEL.rides)
        .gt('ended_at', since).order('ended_at', { ascending: false }).limit(CAP.ridesDelta)),
      rows<VehicleNoteRow>('vehicle_notes(delta)', db.from('vehicle_notes').select(SEL.notes)
        .gt('created_at', since).order('created_at', { ascending: false }).limit(CAP.notes)),
      // ops_shifts has no updated_at either, and filtering on started_at would
      // miss the shift that was CLOSED after `since` — which is the change that
      // matters. The list is one staff member's last 50 rows, so read it whole.
      rows<ShiftRow>('ops_shifts(delta)', staffId
        ? db.from('ops_shifts').select(SEL.shifts).eq('staff_id', staffId)
            .order('started_at', { ascending: false }).limit(CAP.shifts)
        : db.from('ops_shifts').select(SEL.shifts)
            .order('started_at', { ascending: false }).limit(CAP.shifts)),
    ]);

    const ids = [...new Set([...vehChanged.map((v) => v.id), ...stateChanged.map((s) => s.vehicle_id)])];
    const [fleet, tracks] = await Promise.all([
      this.fetchVehicles(ids),
      this.fetchTracks(rideRows.map((r) => r.trip_id)),
    ]);
    return {
      server_time: new Date().toISOString(),
      vehicles: fleet,
      tasks: taskRows.map(toTask),
      damageReports: damageRows.map(toDamage),
      // Rides that ended since the last pull, each with its real GPS trace, so
      // "Last ride" is current between bootstraps instead of a day stale.
      rides: rideRows.map((r) => toRide(r, tracks.get(r.trip_id))),
      vehicleNotes: noteRows.map(toNote),
      shifts: shiftRows.map(toShift),
    };
  }

  async getRidePhotoUrl(tripId: string): Promise<string | null> {
    // The ride-photos bucket is private; the app cannot sign urls itself, so it
    // asks the staff-gated ride-photo-url edge fn (docs/07). Any failure (offline,
    // no photo) degrades to null and the screen shows a placeholder.
    try {
      const client = await getClient();
      const { data, error } = await client.supabase.functions.invoke('ride-photo-url', {
        body: { trip_id: tripId },
      });
      if (error) return null;
      return (data as { url?: string | null })?.url ?? null;
    } catch {
      return null;
    }
  }
}
