// Row shapes returned by PostgREST for the tables the ops app reads, and the
// pure functions that turn them into the app's domain objects.
//
// Kept out of SupabaseOpsApi.ts so that file stays a list of queries: what is
// read, in what order, with what fallback. Everything here is pure — no client,
// no I/O — so the shape of a row and the shape of the screen can be compared
// side by side.
//
// Geometry: PostgREST serialises PostGIS `geometry` columns as GeoJSON, with an
// extra `crs` member PostGIS adds and we ignore. A null geometry (a vehicle the
// gateway has never had a fix for) arrives as null, so every read of a position
// has to survive that.
import { pointInPolygon } from '@penny/geo';
import type {
  DamageReport,
  LngLat,
  OpsTask,
  VehicleStatus,
} from '@penny/db-types';
import type {
  BatterySwap,
  HeatCell,
  MaintenanceEntry,
  OpsDamageReport,
  OpsShift,
  OpsVehicle,
  RebalanceZone,
  StatusLogEntry,
  VehicleError,
  VehicleNote,
  VehicleRide,
} from '../lib/types';

// --- raw row shapes -------------------------------------------------------

interface GeoJson {
  type: string;
  coordinates: unknown;
}

export interface VehicleRow {
  id: string;
  code: string;
  model_id: string;
  status: VehicleStatus;
  visible: boolean;
  plate: string | null;
  vin: string | null;
  city_id: string | null;
  notes: string | null;
}

export interface VehicleStateRow {
  vehicle_id: string;
  pos: GeoJson | null;
  soc_pct: number | null;
  speed_kmh: number | null;
  ignition: boolean;
  locked: boolean;
  last_seen: string | null;
  session_online: boolean;
  fall: boolean;
  power_cut: boolean;
  moved_while_locked: boolean;
}

export interface VehicleModelRow {
  id: string;
  name: string;
  kind: string;
}

export interface VehicleAlertRow {
  id: string;
  vehicle_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface ZoneRow {
  id: string;
  city_id: string;
  kind: string;
  name: string | null;
  geom: GeoJson | null;
  rules: Record<string, unknown> | null;
  active: boolean;
}

export interface StatusLogRow {
  id: string;
  vehicle_id: string;
  from_status: VehicleStatus | null;
  to_status: VehicleStatus;
  by: string | null;
  role: string | null;
  reason: string | null;
  photos: string[] | null;
  pos: GeoJson | null;
  at: string;
}

export interface BatterySwapRow {
  id: string;
  vehicle_id: string;
  by: string | null;
  at: string;
  voltage_before: number | null;
  voltage_after: number | null;
}

export interface MaintenanceRow {
  id: string;
  vehicle_id: string;
  task_id: string | null;
  parts: unknown;
  cost_cents: number | null;
  notes: string | null;
  created_at: string;
  /** Embedded `ops_tasks(kind)` — null when the entry has no linked task. */
  task: { kind: string } | null;
}

export interface RideHistoryRow {
  trip_id: string;
  vehicle_id: string;
  rider_phone_masked: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  distance_m: number | null;
  cost_cents: number | null;
  currency: string | null;
  photo_review: string | null;
  end_zone_name: string | null;
}

export interface HeatRow {
  cell: GeoJson | null;
  idle_vehicles: number | null;
}

export interface TripRouteRow {
  trip_id: string;
  /** `geometry(LineString,4326)` — the whole ride in ONE row, not one row per fix. */
  path: GeoJson | null;
}

export interface DamageRow extends DamageReport {
  part?: string | null;
}

export interface VehicleNoteRow {
  id: string;
  vehicle_id: string;
  staff_id: string | null;
  body: string;
  photos: string[] | null;
  created_at: string;
}

export interface ShiftRow {
  id: string;
  staff_id: string;
  started_at: string;
  ended_at: string | null;
  tasks_completed: number;
  note: string | null;
}

// --- geometry -------------------------------------------------------------

/** GeoJSON Point (as PostgREST renders a `geometry(Point,4326)`) → [lng,lat]. */
export function toLngLat(g: GeoJson | null | undefined): LngLat | null {
  const c = g?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lng, lat] = c as unknown[];
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return [lng, lat];
}

function toPolygon(g: GeoJson | null | undefined): { type: 'Polygon'; coordinates: LngLat[][] } | null {
  if (!g || g.type !== 'Polygon' || !Array.isArray(g.coordinates)) return null;
  return { type: 'Polygon', coordinates: g.coordinates as LngLat[][] };
}

/** Points kept per ride track. Playback needs the SHAPE of the route, not every
 *  fix a 40-minute ride produced, and the mirror is a phone's SQLite file. */
const MAX_TRACK_POINTS = 500;

/** GeoJSON LineString (`trip_routes.path`) → the ride's real trace, oldest
 *  point first. Null when there is no route row, no geometry, or nothing
 *  usable in it — the caller then leaves `track` undefined, and the playback
 *  shows no line rather than an invented one.
 *
 *  Over-long traces are decimated evenly (first and last fix always kept)
 *  instead of truncated: a clipped line would end the ride somewhere the
 *  scooter never stopped. */
export function toTrack(g: GeoJson | null | undefined): LngLat[] | null {
  if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates)) return null;
  const pts: LngLat[] = [];
  for (const c of g.coordinates as unknown[]) {
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
    pts.push([c[0], c[1]]);
  }
  if (pts.length === 0) return null;
  if (pts.length <= MAX_TRACK_POINTS) return pts;
  const step = (pts.length - 1) / (MAX_TRACK_POINTS - 1);
  const out: LngLat[] = [];
  for (let i = 0; i < MAX_TRACK_POINTS; i++) out.push(pts[Math.round(i * step)]!);
  return out;
}

// --- vehicles -------------------------------------------------------------

const ALERT_LABELS: Record<string, string> = {
  fall: 'Fall detected',
  power_cut: 'Main power cut',
  moved_locked: 'Moved while locked',
  geofence_exit: 'Left the operating zone',
  offline: 'Offline',
  low_batt: 'Low battery',
  error: 'Device error',
};

function toError(r: VehicleAlertRow): VehicleError {
  return { code: r.kind, label: ALERT_LABELS[r.kind] ?? r.kind, at: r.created_at };
}

/** A vehicle is idle from the moment its last ride ended — but only while it is
 *  parked. In trip or reserved, "idle since" is meaningless. */
const IN_USE: ReadonlySet<string> = new Set(['in_trip', 'reserved']);

export interface FleetSources {
  vehicles: VehicleRow[];
  states: VehicleStateRow[];
  models: VehicleModelRow[];
  /** Open (unacked) alerts only — an acknowledged one is history, not a fault. */
  alerts: VehicleAlertRow[];
  /** Used only to derive `idle_since`, so the delta path may pass a narrower
   *  projection than the full ride row. */
  rides: { vehicle_id: string; ended_at: string | null }[];
}

/** Join `vehicles` + `vehicle_state` + `vehicle_models` (+ alerts, rides) into
 *  the enriched row the map and the vehicle sheet render.
 *
 *  Every source is optional: a vehicle whose state row is missing (or whose
 *  state read failed) still appears on the list with an unknown position rather
 *  than vanishing from the fleet. */
export function buildVehicles(src: FleetSources): OpsVehicle[] {
  const stateBy = new Map(src.states.map((s) => [s.vehicle_id, s]));
  const modelBy = new Map(src.models.map((m) => [m.id, m]));

  const errorsBy = new Map<string, VehicleError[]>();
  for (const a of src.alerts) {
    const list = errorsBy.get(a.vehicle_id) ?? [];
    if (list.length < 5) list.push(toError(a));
    errorsBy.set(a.vehicle_id, list);
  }

  const lastRideEnd = new Map<string, string>();
  for (const r of src.rides) {
    if (!r.ended_at) continue;
    const cur = lastRideEnd.get(r.vehicle_id);
    if (!cur || r.ended_at > cur) lastRideEnd.set(r.vehicle_id, r.ended_at);
  }

  return src.vehicles.map((v) => {
    const s = stateBy.get(v.id);
    const m = modelBy.get(v.model_id);
    const end = lastRideEnd.get(v.id) ?? null;
    return {
      id: v.id,
      code: v.code,
      model_id: v.model_id,
      model_name: m?.name ?? 'Unknown model',
      kind: m?.kind ?? 'scooter',
      status: v.status,
      visible: v.visible,
      soc_pct: s?.soc_pct ?? null,
      // No source: the gateway stores raw pack voltage in `telemetry`, which the
      // ops app has no read policy for (00380 granted history tables, not the
      // raw stream). SoC is the calibrated number every screen shows anyway.
      voltage_mv: null,
      pos: toLngLat(s?.pos),
      speed_kmh: s?.speed_kmh ?? null,
      ignition: s?.ignition ?? false,
      locked: s?.locked ?? true,
      online: s?.session_online ?? false,
      last_seen: s?.last_seen ?? null,
      fall: s?.fall ?? false,
      power_cut: s?.power_cut ?? false,
      moved_while_locked: s?.moved_while_locked ?? false,
      // Derived, not stored: `vehicle_state` has no idle column, so idleness is
      // measured from the end of the last completed ride. Null for a vehicle
      // that has never been ridden or is out right now.
      idle_since: IN_USE.has(v.status) ? null : end,
      last_errors: errorsBy.get(v.id) ?? [],
      city_id: v.city_id,
      notes: v.notes,
    };
  });
}

// --- zones ----------------------------------------------------------------

const DEMANDS: ReadonlySet<string> = new Set(['low', 'medium', 'high']);

/** `zones` rows the ops app draws, with the rebalance counters it shows.
 *
 *  `kind` is not part of `RebalanceZone` but the Place screen reads it when it
 *  is there, so it is carried through rather than dropped. */
export function buildZones(rows: ZoneRow[], vehicles: OpsVehicle[]): (RebalanceZone & { kind: string })[] {
  const parked = vehicles.filter((v) => v.pos && !IN_USE.has(v.status));
  const out: (RebalanceZone & { kind: string })[] = [];
  for (const z of rows) {
    const geom = toPolygon(z.geom);
    if (!geom) continue; // a zone with no polygon cannot be drawn or counted
    const rules = z.rules ?? {};
    // Target headcount is an operator setting, kept in `zones.rules` — there is
    // no dedicated column. `station_capacity` is the documented key (docs/06);
    // `target_count` is accepted too. Absent = 0, i.e. "no target set".
    const target = Number(rules.target_count ?? rules.station_capacity ?? 0);
    const demandRaw = String(rules.demand ?? '');
    out.push({
      id: z.id,
      name: z.name ?? z.kind,
      geom,
      target_count: Number.isFinite(target) ? target : 0,
      // Counted here, client-side: nothing in the DB materialises "how many are
      // parked in this polygon right now".
      current_count: parked.filter((v) => pointInPolygon(v.pos as LngLat, geom)).length,
      // Demand tiers are not modelled server-side yet. Honour an explicit
      // `rules.demand` when an operator has set one; otherwise stay neutral
      // rather than inventing a tier from the current headcount.
      demand: (DEMANDS.has(demandRaw) ? demandRaw : 'medium') as RebalanceZone['demand'],
      kind: z.kind,
    });
  }
  return out;
}

// --- heat -----------------------------------------------------------------

/** `v_heatmap_idle` — one grid cell per snapped position, with how many idle
 *  vehicles sit in it. Weight is normalised against the busiest cell. */
export function buildHeat(rows: HeatRow[]): HeatCell[] {
  const cells = rows
    .map((r) => ({ center: toLngLat(r.cell), count: r.idle_vehicles ?? 0 }))
    .filter((c): c is { center: LngLat; count: number } => c.center !== null);
  const max = Math.max(1, ...cells.map((c) => c.count));
  return cells.map((c) => ({ center: c.center, weight: c.count / max, idle_count: c.count }));
}

// --- history --------------------------------------------------------------

export function toStatusLog(r: StatusLogRow): StatusLogEntry {
  return {
    id: r.id,
    vehicle_id: r.vehicle_id,
    from_status: r.from_status,
    to_status: r.to_status,
    // `by` is a user id; the app never mirrors a staff directory (PII, docs/10)
    // so the screens show the role and the reason, not a name.
    by: r.by ?? '',
    role: r.role ?? 'ops',
    reason: r.reason,
    photos: r.photos ?? [],
    pos: toLngLat(r.pos),
    at: r.at,
  };
}

export function toSwap(r: BatterySwapRow): BatterySwap {
  return {
    id: r.id,
    vehicle_id: r.vehicle_id,
    by: r.by ?? '',
    at: r.at,
    voltage_before: r.voltage_before,
    voltage_after: r.voltage_after,
  };
}

/** `maintenance_log.parts` is free-form jsonb; the seed writes `{sku,qty}` and
 *  the app renders `{name,qty}`. Accept either and drop anything unusable. */
function toParts(v: unknown): { name: string; qty: number }[] {
  if (!Array.isArray(v)) return [];
  const out: { name: string; qty: number }[] = [];
  for (const p of v) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const name = r.name ?? r.sku ?? r.part;
    if (typeof name !== 'string') continue;
    out.push({ name, qty: typeof r.qty === 'number' ? r.qty : 1 });
  }
  return out;
}

export function toMaintenance(r: MaintenanceRow): MaintenanceEntry {
  return {
    id: r.id,
    vehicle_id: r.vehicle_id,
    task_id: r.task_id,
    // `maintenance_log` has no kind column — the closest thing is the kind of
    // the task that produced the entry. Unlinked entries are plain repairs.
    kind: r.task?.kind ?? 'repair',
    parts: toParts(r.parts),
    cost_cents: r.cost_cents ?? 0,
    notes: r.notes,
    // No `by` column either (00090); the who lives in audit_log, which the app
    // does not read.
    by: '',
    at: r.created_at,
  };
}

/** `track` is passed in from the `trip_routes` read rather than joined onto the
 *  view, and stays undefined when that ride has no route row.
 *
 *  `soc_start_pct` / `soc_end_pct` are left undefined on purpose: neither
 *  `trips` nor `v_vehicle_ride_history` records battery at the ride's edges —
 *  it only exists in the raw telemetry stream, which the ops app has no read
 *  policy for. A guess there would read as a measurement. */
export function toRide(r: RideHistoryRow, track?: LngLat[] | null): VehicleRide {
  return {
    id: r.trip_id,
    ...(track && track.length > 0 ? { track } : {}),
    vehicle_id: r.vehicle_id,
    rider_masked: r.rider_phone_masked ?? '•••',
    status: r.status,
    started_at: r.started_at,
    ended_at: r.ended_at,
    duration_s: r.duration_s ?? 0,
    distance_m: r.distance_m ?? 0,
    cost_cents: r.cost_cents ?? 0,
    currency: r.currency ?? 'EUR',
    photo_review: r.photo_review,
    end_zone_name: r.end_zone_name,
  };
}

export function toDamage(r: DamageRow): OpsDamageReport {
  return { ...r, photos: r.photos ?? [], part: r.part ?? null };
}

export function toTask(r: OpsTask): OpsTask {
  // ops_tasks maps 1:1 onto OpsTask; only the array columns can arrive null.
  return { ...r, checklist: r.checklist ?? [], photos: r.photos ?? [] };
}

export function toNote(r: VehicleNoteRow): VehicleNote {
  // staff_name is not joined: the app never mirrors a staff directory (PII
  // minimization, docs/10). The UI falls back to "Ops" for other people.
  return {
    id: r.id,
    vehicle_id: r.vehicle_id,
    staff_id: r.staff_id,
    staff_name: null,
    body: r.body,
    photos: r.photos ?? [],
    created_at: r.created_at,
  };
}

export function toShift(r: ShiftRow): OpsShift {
  return {
    id: r.id,
    staff_id: r.staff_id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    tasks_completed: r.tasks_completed,
    note: r.note,
  };
}
