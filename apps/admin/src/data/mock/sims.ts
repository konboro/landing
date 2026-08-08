// Mock connectivity fleet (Truphone / 1GLOBAL).
//
// One SIM per seeded IoT device plus a handful of spares, each with 30 days of
// daily usage. The shapes are the `v_sim_*` views the backend agent is adding,
// so swapping MockDataSource → SupabaseDataSource is a data-source change only.
//
// docs/03: the SIM MSISDN is what the gateway sends SMS-fallback commands to,
// and outbound SMS volume drives the SMS-budget alarm — so SMS counters are
// part of the daily usage rows, not an afterthought.
import { Rng } from '@/lib/rng';
import { OVERAGE_CENTS_PER_MB, SIM_PLANS, type SimPlan } from '@/lib/simPlans';
import type { Device } from '@penny/db-types';
import type {
  SimAlert,
  SimCostSummary,
  SimEvent,
  SimHealth,
  SimInventoryRow,
  SimUsageDay,
  VehicleRow,
} from '@/types/domain';

const NETWORKS = ['COSMOTE', 'Vodafone GR', 'Nova'] as const;
const PROVIDER = 'Truphone / 1GLOBAL';

export interface SimSeed {
  sims: SimInventoryRow[];
  usage: Record<string, SimUsageDay[]>;
  events: Record<string, SimEvent[]>;
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}

/** Truphone-style 19-digit ICCID: 8944 (MII+CC+issuer) + 15 digits. */
function iccid(rng: Rng, seq: number): string {
  return `8944${pad(rng.int(1000, 9999), 4)}${pad(seq, 5)}${pad(rng.int(0, 999999), 6)}`;
}

/** 15-digit IMSI on Truphone's UK MCC/MNC (234-03). */
function imsi(rng: Rng): string {
  return `23403${pad(rng.int(0, 9999999999), 10)}`;
}

/** Truphone global MSISDN range (+882 35 …). */
function msisdn(rng: Rng): string {
  return `+88235${pad(rng.int(0, 99999999), 8)}`;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string | null, to: number): number | null {
  if (!from) return null;
  return Math.max(0, Math.floor((to - new Date(from).getTime()) / 86400000));
}

/**
 * Health ladder used by `v_sim_inventory`. Kept as a pure function so the mock
 * source can recompute it after a lifecycle command without re-seeding.
 */
export function computeSimHealth(sim: SimInventoryRow): SimHealth {
  if (sim.status === 'inventory') return 'ok'; // a spare on the shelf is fine
  if (!sim.device_id) return 'unassigned'; // billed but not fitted to anything
  if (sim.status === 'terminated' || sim.status === 'suspended') return 'silent';
  if (sim.data_pct_used >= 100) return 'over_limit';
  if (sim.days_since_seen != null && sim.days_since_seen >= 7) return 'silent';
  if (sim.data_pct_used >= 80) return 'near_limit';
  if (sim.data_used_mb_cycle <= 0) return 'no_usage';
  return 'ok';
}

/** Recompute the derived columns of a row after usage/link/status changes. */
export function refreshSimDerived(sim: SimInventoryRow, now = Date.now()): SimInventoryRow {
  sim.data_pct_used = sim.plan_data_mb > 0 ? +((sim.data_used_mb_cycle / sim.plan_data_mb) * 100).toFixed(1) : 0;
  sim.days_since_seen = daysBetween(sim.last_seen_at, now);
  sim.health = computeSimHealth(sim);
  return sim;
}

interface SimShape {
  status: SimInventoryRow['status'];
  plan: SimPlan;
  /** Mean MB/day across the cycle. */
  mbPerDay: number;
  /** Days since the SIM last attached to a network. */
  silentDays: number;
  /** Force-unlink from the device (spares / unassigned). */
  detach?: boolean;
  /**
   * Pin cycle-to-date usage to this % of the plan allowance. Needed because a
   * billing cycle that started two days ago cannot organically reach 100% —
   * the demo outliers must be reproducible on any day of the month.
   */
  pinPctOfPlan?: number;
}

/**
 * Build the connectivity fleet from the already-seeded devices.
 *
 * The generated SIM is the source of truth for ICCID/MSISDN, so `buildSims`
 * writes them back onto the `Device` rows — the IoT registry, vehicle detail
 * and the SIM inventory must never disagree on an identifier.
 */
export function buildSims(devices: Device[], vehicles: VehicleRow[], rng: Rng): SimSeed {
  const now = Date.now();
  const cycleStartDate = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const cycleEndDate = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0);
  const cycle_start = dayKey(cycleStartDate);
  const cycle_end = dayKey(cycleEndDate);

  const sims: SimInventoryRow[] = [];
  const usage: Record<string, SimUsageDay[]> = {};
  const events: Record<string, SimEvent[]> = {};

  // Deliberate outliers so the alerts strip is never empty in a demo.
  const OVER_LIMIT_AT = 0; // runaway device chewing through a 50MB test plan
  const SILENT_AT = 1; // dead device, no attach for 12 days
  const NEAR_LIMIT_AT = 2;
  const SUSPENDED_AT = 3;
  const TERMINATED_AT = 5; // terminated but still fitted → must be pulled
  const NO_USAGE_AT = 7; // attaches fine but the device never sends anything

  const shapeFor = (i: number, hasVehicle: boolean): SimShape => {
    if (i === OVER_LIMIT_AT) return { status: 'active', plan: SIM_PLANS[0]!, mbPerDay: 4.6, silentDays: 0, pinPctOfPlan: 238 };
    if (i === SILENT_AT) return { status: 'active', plan: SIM_PLANS[2]!, mbPerDay: 1.4, silentDays: 12 };
    if (i === NEAR_LIMIT_AT) return { status: 'active', plan: SIM_PLANS[1]!, mbPerDay: 3.1, silentDays: 0, pinPctOfPlan: 88 };
    if (i === SUSPENDED_AT) return { status: 'suspended', plan: SIM_PLANS[1]!, mbPerDay: 0.4, silentDays: 9 };
    if (i === TERMINATED_AT) return { status: 'terminated', plan: SIM_PLANS[1]!, mbPerDay: 0.1, silentDays: 21 };
    if (i === NO_USAGE_AT) return { status: 'active', plan: SIM_PLANS[2]!, mbPerDay: 0, silentDays: 0 };
    if (!hasVehicle) return { status: 'test', plan: SIM_PLANS[0]!, mbPerDay: 0.6, silentDays: rng.int(0, 3) };
    return {
      status: 'active',
      plan: rng.pick([SIM_PLANS[1]!, SIM_PLANS[2]!, SIM_PLANS[2]!, SIM_PLANS[3]!]),
      mbPerDay: +rng.float(0.6, 6.5).toFixed(2),
      silentDays: rng.bool(0.12) ? rng.int(3, 6) : 0,
    };
  };

  const makeSim = (seq: number, device: Device | null, shape: SimShape): SimInventoryRow => {
    const vehicle = device?.vehicle_id ? vehicles.find((v) => v.id === device.vehicle_id) ?? null : null;
    const id = `sim-${pad(seq + 1, 3)}`;
    const card = iccid(rng, seq + 1);
    const number = msisdn(rng);
    const attached = shape.status === 'inventory' ? null : new Date(now - shape.silentDays * 86400000 - rng.int(0, 3600000)).toISOString();
    const detached = shape.detach || !device;

    const sim: SimInventoryRow = {
      id,
      iccid: card,
      imsi: imsi(rng),
      msisdn: number,
      provider: PROVIDER,
      provider_sim_id: `tp_${pad(rng.int(100000, 999999), 6)}`,
      status: shape.status,
      plan_name: shape.plan.name,
      plan_data_mb: shape.plan.data_mb,
      cycle_start,
      cycle_end,
      monthly_cost_cents: shape.plan.cost_cents,
      device_id: detached ? null : device!.id,
      device_imei: detached ? null : device!.imei,
      vehicle_id: detached ? null : vehicle?.id ?? null,
      vehicle_code: detached ? null : vehicle?.code ?? null,
      vehicle_status: detached ? null : vehicle?.status ?? null,
      label: vehicle ? `${vehicle.code} · ${vehicle.model_name}` : device ? `Bench ${device.imei.slice(-4)}` : `Spare ${pad(seq + 1, 3)}`,
      notes: null,
      last_seen_at: attached,
      network: shape.status === 'inventory' ? null : rng.pick(NETWORKS),
      country: shape.status === 'inventory' ? null : 'GR',
      data_used_mb_cycle: 0,
      data_pct_used: 0,
      cost_mtd_cents: 0,
      days_since_seen: null,
      health: 'ok',
    };

    // ---- 30 days of daily usage ----
    const days: SimUsageDay[] = [];
    const cycleFirst = cycleStartDate.getTime();
    for (let d = 29; d >= 0; d--) {
      const ts = now - d * 86400000;
      const date = new Date(ts);
      const silent = d < shape.silentDays || shape.status === 'inventory';
      const mb = silent ? 0 : Math.max(0, +(shape.mbPerDay * rng.float(0.45, 1.6)).toFixed(3));
      // SMS only happens when the GPRS session was unavailable — rare, and the
      // signal the SMS-budget alarm watches for.
      const smsOut = silent ? 0 : rng.bool(0.06) ? rng.int(1, 3) : 0;
      days.push({
        day: dayKey(date),
        data_mb: mb,
        sms_out: smsOut,
        sms_in: smsOut > 0 && rng.bool(0.3) ? 1 : 0,
        cost_cents: Math.round((shape.plan.cost_cents / 30) * (silent ? 0 : 1)) + smsOut * 6,
        network: sim.network ?? '—',
        country: sim.country ?? '—',
      });
    }
    usage[id] = days;

    // Cycle-to-date usage only counts days inside the current billing cycle.
    const inCycle = days.filter((u) => new Date(`${u.day}T00:00:00Z`).getTime() >= cycleFirst);
    if (shape.pinPctOfPlan != null && inCycle.length > 0) {
      // Rewrite the in-cycle days so the row lands exactly on the intended
      // percentage regardless of how far into the month "today" is.
      const target = (shape.plan.data_mb * shape.pinPctOfPlan) / 100;
      const perDay = +(target / inCycle.length).toFixed(3);
      for (const u of inCycle) u.data_mb = perDay;
    }
    sim.data_used_mb_cycle = +inCycle.reduce((s, u) => s + u.data_mb, 0).toFixed(2);
    const overageMb = Math.max(0, sim.data_used_mb_cycle - sim.plan_data_mb);
    sim.cost_mtd_cents =
      shape.status === 'inventory'
        ? 0
        : Math.round(shape.plan.cost_cents * (inCycle.length / 30)) +
          Math.ceil(overageMb) * OVERAGE_CENTS_PER_MB +
          inCycle.reduce((s, u) => s + u.sms_out * 6, 0);

    // ---- lifecycle event history ----
    const log: SimEvent[] = [
      {
        at: new Date(now - rng.int(120, 400) * 86400000).toISOString(),
        kind: 'imported',
        detail: `Imported from ${PROVIDER} — ${shape.plan.name}`,
        staff_id: null,
        reason: null,
      },
    ];
    if (shape.status !== 'inventory') {
      log.push({
        at: new Date(now - rng.int(60, 119) * 86400000).toISOString(),
        kind: 'activated',
        detail: `Activated on ${shape.plan.name}`,
        staff_id: 'staff-owner',
        reason: null,
      });
    }
    if (device && !detached) {
      log.push({
        at: new Date(now - rng.int(20, 59) * 86400000).toISOString(),
        kind: 'linked',
        detail: `Linked to device ${device.imei}${vehicle ? ` (${vehicle.code})` : ''}`,
        staff_id: 'staff-owner',
        reason: null,
      });
    }
    if (shape.status === 'suspended') {
      log.push({
        at: new Date(now - 9 * 86400000).toISOString(),
        kind: 'suspended',
        detail: 'Suspended by ops',
        staff_id: 'staff-opsmgr',
        reason: 'Device removed from service pending repair',
      });
    }
    if (shape.status === 'terminated') {
      log.push({
        at: new Date(now - 21 * 86400000).toISOString(),
        kind: 'terminated',
        detail: 'Terminated with the provider',
        staff_id: 'staff-owner',
        reason: 'Contract ended — SIM to be recovered from the device',
      });
    }
    if (shape.silentDays >= 7 && shape.status === 'active') {
      log.push({
        at: new Date(now - shape.silentDays * 86400000).toISOString(),
        kind: 'last_attach',
        detail: `Last network attach on ${sim.network ?? 'unknown network'}`,
        staff_id: null,
        reason: null,
      });
    }
    events[id] = log.sort((a, b) => b.at.localeCompare(a.at));

    return refreshSimDerived(sim, now);
  };

  devices.forEach((device, i) => {
    const shape = shapeFor(i, Boolean(device.vehicle_id));
    const sim = makeSim(i, device, shape);
    // The SIM row is authoritative for the connectivity identifiers.
    device.iccid = sim.iccid;
    device.phone_number = sim.msisdn;
    device.sim_id = sim.device_id ? sim.id : null;
    sims.push(sim);
  });

  // Spares on the shelf (no device) + one active-but-unlinked SIM that is
  // quietly being billed for nothing.
  const spareBase = devices.length;
  for (let i = 0; i < 5; i++) {
    sims.push(
      makeSim(spareBase + i, null, {
        status: i === 4 ? 'active' : 'inventory',
        plan: i === 4 ? SIM_PLANS[2]! : SIM_PLANS[1]!,
        mbPerDay: 0,
        silentDays: i === 4 ? 30 : 0,
        detach: true,
      }),
    );
  }

  return { sims, usage, events };
}

/** `v_sim_alerts` — everything an operator must act on, worst first. */
export function buildSimAlerts(sims: SimInventoryRow[]): SimAlert[] {
  const out: SimAlert[] = [];
  const push = (sim: SimInventoryRow, severity: SimAlert['severity'], reason: string) =>
    out.push({ sim_id: sim.id, iccid: sim.iccid, severity, reason, vehicle_code: sim.vehicle_code });

  for (const sim of sims) {
    if (sim.status === 'terminated' && sim.device_id) {
      push(sim, 'critical', `Terminated but still fitted to device ${sim.device_imei ?? '—'} — recover the SIM`);
      continue;
    }
    if (sim.status === 'suspended' && sim.device_id) {
      push(sim, 'warning', `Suspended while still fitted to ${sim.vehicle_code ?? sim.device_imei ?? 'a device'} — no commands can reach it`);
      continue;
    }
    if (sim.health === 'unassigned') {
      push(sim, 'warning', `${sim.status === 'test' ? 'Test' : 'Active'} SIM is not linked to any device — billed with no traffic`);
      continue;
    }
    if (sim.health === 'over_limit') {
      push(sim, 'critical', `Over plan limit — ${sim.data_used_mb_cycle.toFixed(1)} MB of ${sim.plan_data_mb} MB (${sim.data_pct_used}%)`);
      continue;
    }
    if (sim.health === 'silent') {
      const d = sim.days_since_seen ?? 0;
      push(sim, d >= 14 ? 'critical' : 'warning', `No network attach for ${d} day${d === 1 ? '' : 's'}`);
      continue;
    }
    if (sim.health === 'near_limit') {
      push(sim, 'warning', `Near plan limit — ${sim.data_pct_used}% of ${sim.plan_data_mb} MB used`);
      continue;
    }
    if (sim.health === 'no_usage') {
      push(sim, 'info', 'Active SIM with zero data this cycle');
    }
  }

  const rank: Record<SimAlert['severity'], number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.iccid.localeCompare(b.iccid));
}

/** `v_sim_cost_summary` — six rolling months, current month from real usage. */
export function buildSimCostSummary(
  sims: SimInventoryRow[],
  usage: Record<string, SimUsageDay[]>,
  rng: Rng,
): SimCostSummary[] {
  const billable = sims.filter((s) => s.status !== 'inventory');
  const month = (offset: number): string => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - offset);
    return d.toISOString().slice(0, 7);
  };

  const currentMonth = month(0);
  const rowsThisMonth = Object.values(usage)
    .flat()
    .filter((u) => u.day.startsWith(currentMonth));
  const current: SimCostSummary = {
    month: currentMonth,
    sims_active: billable.filter((s) => s.status === 'active').length,
    total_data_mb: +rowsThisMonth.reduce((s, u) => s + u.data_mb, 0).toFixed(1),
    total_cost_cents: billable.reduce((s, u) => s + u.cost_mtd_cents, 0),
    avg_cost_cents: 0,
    sms_total: rowsThisMonth.reduce((s, u) => s + u.sms_out + u.sms_in, 0),
  };
  current.avg_cost_cents = billable.length ? Math.round(current.total_cost_cents / billable.length) : 0;

  const out: SimCostSummary[] = [current];
  for (let m = 1; m < 6; m++) {
    const active = Math.max(1, current.sims_active - rng.int(0, 4));
    const cost = Math.round(current.total_cost_cents * rng.float(0.82, 1.12));
    out.push({
      month: month(m),
      sims_active: active,
      total_data_mb: +(current.total_data_mb * rng.float(0.8, 1.25)).toFixed(1),
      total_cost_cents: cost,
      avg_cost_cents: Math.round(cost / active),
      sms_total: Math.max(0, current.sms_total + rng.int(-8, 14)),
    });
  }
  return out;
}
