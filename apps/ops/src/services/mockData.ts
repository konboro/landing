// Realistic Athens fleet generator for the standalone (mock) backend.
// Deterministic-ish (seeded PRNG) so the demo is stable across reloads.
import { OpsTaskKind, OpsTaskStatus, VehicleStatus, DamageSeverity, DamageStatus } from '@penny/db-types';
import type { OpsTask, DamageReport } from '@penny/db-types';
import type {
  Bootstrap,
  OpsVehicle,
  RebalanceZone,
  StatusLogEntry,
  BatterySwap,
  MaintenanceEntry,
  HeatCell,
  VehicleError,
} from '../lib/types';
import { buildChecklist } from '../lib/checklists';

// --- tiny seeded PRNG (mulberry32) -----------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260808);
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const between = (a: number, b: number) => a + rnd() * (b - a);
const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000).toISOString();

// stable pseudo-uuid
let counter = 0;
function id(prefix: string): string {
  counter += 1;
  const h = (counter * 2654435761) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  return `${prefix}0000-0000-4000-8000-${hex}0000${(counter % 100).toString().padStart(4, '0')}`;
}

export const ATHENS_CENTER: [number, number] = [23.7275, 37.9838];

const NEIGHBORHOODS: { name: string; c: [number, number]; demand: 'low' | 'medium' | 'high' }[] = [
  { name: 'Syntagma', c: [23.7348, 37.9755], demand: 'high' },
  { name: 'Kolonaki', c: [23.744, 37.9793], demand: 'high' },
  { name: 'Exarchia', c: [23.733, 37.9865], demand: 'medium' },
  { name: 'Koukaki', c: [23.727, 37.9645], demand: 'medium' },
  { name: 'Monastiraki', c: [23.7255, 37.976], demand: 'high' },
  { name: 'Pagkrati', c: [23.748, 37.97], demand: 'low' },
  { name: 'Kipseli', c: [23.735, 37.998], demand: 'low' },
];

const MODEL = { id: 'model000-0000-4000-8000-000000000001', name: 'Okai ES600', kind: 'scooter' };

const ERROR_CODES: VehicleError[] = [
  { code: 'E12', label: 'Controller over-temperature', at: iso(-120) },
  { code: 'E07', label: 'Throttle signal fault', at: iso(-320) },
  { code: 'E21', label: 'BMS communication lost', at: iso(-90) },
  { code: 'E03', label: 'Brake sensor open', at: iso(-500) },
];

function socToVoltage(soc: number): number {
  // rough 10s Li-ion pack: 33.0V empty -> 42.0V full
  return Math.round((33.0 + (soc / 100) * 9.0) * 1000);
}

function makeVehicle(i: number): OpsVehicle {
  const n = pick(NEIGHBORHOODS);
  const jitter = () => between(-0.006, 0.006);
  const pos: [number, number] = [n.c[0] + jitter(), n.c[1] + jitter()];
  const roll = rnd();
  let status: OpsVehicle['status'];
  if (roll < 0.55) status = VehicleStatus.available;
  else if (roll < 0.66) status = VehicleStatus.in_trip;
  else if (roll < 0.75) status = VehicleStatus.low_battery;
  else if (roll < 0.83) status = VehicleStatus.maintenance;
  else if (roll < 0.89) status = VehicleStatus.offline;
  else if (roll < 0.94) status = VehicleStatus.transport;
  else if (roll < 0.97) status = VehicleStatus.reserved;
  else status = VehicleStatus.stolen;

  const soc =
    status === VehicleStatus.low_battery ? Math.round(between(3, 18))
    : status === VehicleStatus.offline ? Math.round(between(0, 60))
    : Math.round(between(20, 100));
  const online = status !== VehicleStatus.offline && status !== VehicleStatus.stolen;
  const idleMin = status === VehicleStatus.available ? Math.round(between(5, 6000)) : 0;
  const visible = status === VehicleStatus.available || status === VehicleStatus.low_battery
    ? rnd() > 0.08
    : false;

  return {
    id: id('veh1'),
    code: `ATH-${(1000 + i).toString()}`,
    model_id: MODEL.id,
    model_name: MODEL.name,
    kind: MODEL.kind,
    status,
    visible,
    soc_pct: online ? soc : null,
    voltage_mv: online ? socToVoltage(soc) : null,
    pos,
    speed_kmh: status === VehicleStatus.in_trip ? Math.round(between(5, 24)) : 0,
    ignition: status === VehicleStatus.in_trip,
    locked: status !== VehicleStatus.in_trip,
    online,
    last_seen: online ? iso(-Math.round(between(0, 8))) : iso(-Math.round(between(120, 3000))),
    fall: status === VehicleStatus.in_trip && rnd() > 0.95,
    power_cut: status === VehicleStatus.stolen || (rnd() > 0.97),
    moved_while_locked: status === VehicleStatus.stolen,
    idle_since: idleMin > 0 ? iso(-idleMin) : null,
    last_errors:
      status === VehicleStatus.maintenance || status === VehicleStatus.offline
        ? [pick(ERROR_CODES)]
        : rnd() > 0.85
          ? [pick(ERROR_CODES)]
          : [],
    city_id: 'city0000-0000-4000-8000-000000000001',
    notes: null,
  };
}

const TASK_KINDS = [
  OpsTaskKind.battery_swap,
  OpsTaskKind.rebalance,
  OpsTaskKind.repair,
  OpsTaskKind.inspect,
  OpsTaskKind.pickup,
  OpsTaskKind.deploy,
];

function makeTask(kind: OpsTask['kind'], vehicles: OpsVehicle[], zones: RebalanceZone[]): OpsTask {
  const systemGen = rnd() > 0.4; // many are auto-generated by pg_cron rules
  const v = pick(vehicles);
  const statusRoll = rnd();
  const status =
    statusRoll < 0.6 ? OpsTaskStatus.open
    : statusRoll < 0.8 ? OpsTaskStatus.assigned
    : statusRoll < 0.92 ? OpsTaskStatus.in_progress
    : OpsTaskStatus.done;
  const checklist = buildChecklist(kind).map((c) => ({
    key: c.key,
    label: c.label,
    required_photo: c.requiresBeforePhoto || c.requiresAfterPhoto,
    done: status === OpsTaskStatus.done,
  }));
  return {
    id: id('task'),
    kind,
    vehicle_id: kind === OpsTaskKind.rebalance ? v.id : v.id,
    zone_id: kind === OpsTaskKind.rebalance ? pick(zones).id : null,
    priority: v.status === VehicleStatus.stolen ? 9 : Math.round(between(1, 7)),
    status,
    assignee: status === OpsTaskStatus.open ? null : 'staff000-0000-4000-8000-000000000001',
    due_at: iso(Math.round(between(-120, 600))),
    checklist,
    photos: [],
    notes: systemGen
      ? kind === OpsTaskKind.battery_swap
        ? 'Auto: SoC below threshold'
        : kind === OpsTaskKind.inspect
          ? 'Auto: offline > 24h'
          : kind === OpsTaskKind.rebalance
            ? 'Auto: idle > 72h in low-demand cell'
            : 'Auto rule'
      : null,
    created_by: systemGen ? 'system_rule' : 'admin',
    completed_at: status === OpsTaskStatus.done ? iso(-Math.round(between(10, 400))) : null,
    created_at: iso(-Math.round(between(30, 2000))),
  };
}

function ring(center: [number, number], r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let a = 0; a <= 360; a += 45) {
    const rad = (a * Math.PI) / 180;
    pts.push([center[0] + Math.cos(rad) * r, center[1] + Math.sin(rad) * r * 0.8]);
  }
  return pts;
}

function makeZones(vehicles: OpsVehicle[]): RebalanceZone[] {
  return NEIGHBORHOODS.slice(0, 5).map((n) => {
    const geom = { type: 'Polygon' as const, coordinates: [ring(n.c, 0.004)] };
    const current = vehicles.filter(
      (v) => v.pos && Math.abs(v.pos[0] - n.c[0]) < 0.004 && Math.abs(v.pos[1] - n.c[1]) < 0.004,
    ).length;
    const target = n.demand === 'high' ? 25 : n.demand === 'medium' ? 15 : 6;
    return { id: id('zone'), name: n.name, geom, target_count: target, current_count: current, demand: n.demand };
  });
}

function makeDamage(vehicles: OpsVehicle[]): DamageReport[] {
  const descs = [
    'Bent handlebar after fall',
    'Front brake lever cracked',
    'Rear fender loose / rattling',
    'Deck grip tape peeling',
    'Kickstand broken',
    'Display flickering',
    'Throttle sticky',
    'Missing bell',
  ];
  const out: DamageReport[] = [];
  for (let i = 0; i < 12; i++) {
    const v = pick(vehicles);
    const st = pick([DamageStatus.new, DamageStatus.new, DamageStatus.confirmed, DamageStatus.fixed]);
    out.push({
      id: id('dmg1'),
      vehicle_id: v.id,
      reporter: pick(['rider', 'ops', 'admin']) as DamageReport['reporter'],
      user_id: null,
      trip_id: null,
      description: pick(descs),
      photos: [],
      severity: pick([DamageSeverity.low, DamageSeverity.medium, DamageSeverity.high, DamageSeverity.critical]),
      status: st,
      linked_task_id: null,
      penalty_payment_id: null,
      created_at: iso(-Math.round(between(60, 4000))),
    });
  }
  return out;
}

function makeHeat(vehicles: OpsVehicle[]): HeatCell[] {
  const idle = vehicles.filter((v) => v.idle_since);
  const map = new Map<string, { center: [number, number]; count: number }>();
  for (const v of idle) {
    if (!v.pos) continue;
    const key = `${v.pos[0].toFixed(3)},${v.pos[1].toFixed(3)}`;
    const cur = map.get(key) ?? { center: [Number(v.pos[0].toFixed(3)), Number(v.pos[1].toFixed(3))], count: 0 };
    cur.count += 1;
    map.set(key, cur);
  }
  const max = Math.max(1, ...[...map.values()].map((m) => m.count));
  return [...map.values()].map((m) => ({ center: m.center, weight: m.count / max, idle_count: m.count }));
}

export function generateBootstrap(): Bootstrap {
  counter = 0;
  const vehicles: OpsVehicle[] = [];
  for (let i = 0; i < 130; i++) vehicles.push(makeVehicle(i));
  const zones = makeZones(vehicles);

  const tasks: OpsTask[] = [];
  for (const kind of TASK_KINDS) {
    for (let i = 0; i < 20; i++) tasks.push(makeTask(kind, vehicles, zones));
  }

  const damageReports = makeDamage(vehicles);

  // seed a couple of status log + swap + maintenance rows for history views
  const statusLog: StatusLogEntry[] = [];
  const batterySwaps: BatterySwap[] = [];
  const maintenance: MaintenanceEntry[] = [];
  for (const v of vehicles.slice(0, 30)) {
    statusLog.push({
      id: id('slog'),
      vehicle_id: v.id,
      from_status: VehicleStatus.available,
      to_status: v.status,
      by: 'staff000-0000-4000-8000-000000000001',
      role: 'ops',
      reason: 'field action',
      photos: [],
      pos: v.pos,
      at: iso(-Math.round(between(30, 3000))),
    });
    if (rnd() > 0.6) {
      batterySwaps.push({
        id: id('bswp'),
        vehicle_id: v.id,
        by: 'staff000-0000-4000-8000-000000000001',
        at: iso(-Math.round(between(60, 5000))),
        voltage_before: socToVoltage(between(4, 15)),
        voltage_after: socToVoltage(between(90, 100)),
      });
    }
    if (rnd() > 0.7) {
      maintenance.push({
        id: id('mnt1'),
        vehicle_id: v.id,
        task_id: null,
        kind: 'repair',
        parts: [{ name: 'Brake lever', qty: 1 }],
        cost_cents: Math.round(between(500, 4000)),
        notes: 'Replaced worn part',
        by: 'staff000-0000-4000-8000-000000000001',
        at: iso(-Math.round(between(200, 8000))),
      });
    }
  }

  return {
    server_time: new Date().toISOString(),
    vehicles,
    tasks,
    zones,
    damageReports,
    statusLog,
    batterySwaps,
    maintenance,
    heat: makeHeat(vehicles),
  };
}
