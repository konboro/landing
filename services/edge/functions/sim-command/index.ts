// sim-command — staff lifecycle actions on a SIM.
//
//   { sim_id, action: 'activate'|'suspend'|'resume'|'terminate'|'set_plan',
//     reason, plan?: { plan_name?, plan_data_mb?, monthly_cost_cents? } }
//
// Order of operations: validate → guard → call the provider → persist → append
// `sim_events` → write `audit_log` (Hard Rule #8). The provider call comes first so
// we never record a state the operator did not actually reach; if the provider is
// not configured the local row is still updated and the response says
// `provider_applied:false` with the reason, so the panel can show it honestly.
//
// `reason` is mandatory for suspend and terminate: both cost money to reverse and
// a suspended SIM means a scooter that cannot be commanded over SMS (docs/03).

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';
import { getSimProvider, type SimLifecycleStatus, type SimStatus } from '../../_shared/simprovider.ts';

type Action = 'activate' | 'suspend' | 'resume' | 'terminate' | 'set_plan';

const ACTIONS: Action[] = ['activate', 'suspend', 'resume', 'terminate', 'set_plan'];
const REASON_REQUIRED: Action[] = ['suspend', 'terminate'];

/** action → the sims.status it lands on (set_plan does not move the status). */
const TARGET_STATUS: Record<Exclude<Action, 'set_plan'>, SimStatus> = {
  activate: 'active',
  resume: 'active',
  suspend: 'suspended',
  terminate: 'terminated',
};

/** action → what the provider is asked to do. */
const PROVIDER_STATUS: Record<Exclude<Action, 'set_plan'>, SimLifecycleStatus> = {
  activate: 'active',
  resume: 'active',
  suspend: 'suspended',
  terminate: 'terminated',
};

/** action → sim_events.kind. */
const EVENT_KIND: Record<Action, string> = {
  activate: 'activated',
  resume: 'resumed',
  suspend: 'suspended',
  terminate: 'terminated',
  set_plan: 'plan_changed',
};

/** Legal transitions. Keeps the row honest without needing a DB state machine. */
const ALLOWED_FROM: Record<Action, SimStatus[]> = {
  activate: ['inventory', 'test', 'suspended'],
  resume: ['suspended'],
  suspend: ['active', 'test'],
  terminate: ['inventory', 'active', 'suspended', 'test'],
  set_plan: ['inventory', 'active', 'suspended', 'test'],
};

interface SimRecord {
  id: string;
  iccid: string;
  msisdn: string | null;
  provider: string;
  provider_sim_id: string | null;
  status: SimStatus;
  plan_name: string | null;
  plan_data_mb: number | null;
  monthly_cost_cents: number;
  device_id: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  terminated_at: string | null;
}

interface DeviceRef {
  id: string;
  imei: string;
  vehicle_id: string | null;
}

interface VehicleRef {
  id: string;
  code: string;
  status: string;
}

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'sims.manage');

  const body = await readJson(req);
  const simId = str(body, 'sim_id')!;
  const action = str(body, 'action')! as Action;
  if (!ACTIONS.includes(action)) {
    throw new EdgeError('bad_request', `unknown action: ${action}`, 400);
  }

  const reason = str(body, 'reason', REASON_REQUIRED.includes(action)) ?? null;

  /* ---------- load the SIM ---------- */
  const { data: sim, error: simErr } = await admin
    .from('sims')
    .select('id, iccid, msisdn, provider, provider_sim_id, status, plan_name, plan_data_mb, monthly_cost_cents, device_id, activated_at, suspended_at, terminated_at')
    .eq('id', simId)
    .maybeSingle();
  if (simErr) throw new EdgeError('db_error', simErr.message, 500);
  if (!sim) throw new EdgeError('not_found', 'sim not found', 404);
  const before = sim as unknown as SimRecord;

  if (!ALLOWED_FROM[action].includes(before.status)) {
    throw new EdgeError(
      'invalid_transition',
      `cannot ${action} a sim in status '${before.status}'`,
      409,
    );
  }

  /* ---------- plan payload ---------- */
  const planIn = (body.plan && typeof body.plan === 'object' && !Array.isArray(body.plan))
    ? body.plan as Record<string, unknown>
    : {};
  const planName = str(planIn, 'plan_name', false) ?? null;
  const planDataMb = num(planIn, 'plan_data_mb', false) ?? null;
  const planCostCents = num(planIn, 'monthly_cost_cents', false) ?? null;
  if (action === 'set_plan' && planName === null && planDataMb === null && planCostCents === null) {
    throw new EdgeError('bad_request', 'set_plan needs plan.plan_name, plan.plan_data_mb or plan.monthly_cost_cents', 400);
  }

  /* ---------- guard: never strand a scooter in service ----------
     Terminating the SIM kills both the GPRS session AND the SMS command fallback
     (docs/03), so the vehicle becomes uncommandable. Only allow it once the vehicle
     has been retired — or when the SIM is not fitted to anything at all. */
  let device: DeviceRef | null = null;
  let vehicle: VehicleRef | null = null;
  if (before.device_id) {
    const { data: dev } = await admin
      .from('devices')
      .select('id, imei, vehicle_id')
      .eq('id', before.device_id)
      .maybeSingle();
    device = (dev as DeviceRef | null) ?? null;
    if (device?.vehicle_id) {
      const { data: veh } = await admin
        .from('vehicles')
        .select('id, code, status')
        .eq('id', device.vehicle_id)
        .maybeSingle();
      vehicle = (veh as VehicleRef | null) ?? null;
    }
  }

  if (action === 'terminate' && vehicle && vehicle.status !== 'decommissioned') {
    throw new EdgeError(
      'sim_in_service',
      `SIM ${before.iccid} is fitted to device ${device?.imei ?? '?'} on vehicle ${vehicle.code} ` +
        `(status '${vehicle.status}'). Terminating it would remove both the GPRS session and the SMS ` +
        `command fallback. Decommission the vehicle or swap the SIM out first.`,
      409,
    );
  }

  /* ---------- provider ---------- */
  const provider = getSimProvider(before.provider);
  const ref = { iccid: before.iccid, provider_sim_id: before.provider_sim_id };
  let providerApplied = false;
  let providerEcho: unknown = null;

  if (provider.live) {
    if (action === 'set_plan') {
      if (!provider.setPlan) {
        throw new EdgeError('provider_unsupported', `${provider.name} adapter does not implement setPlan`, 501);
      }
      providerEcho = await provider.setPlan(ref, { plan_name: planName, plan_data_mb: planDataMb });
    } else {
      providerEcho = await provider.setStatus(ref, PROVIDER_STATUS[action]);
    }
    providerApplied = true;
  }

  /* ---------- persist ---------- */
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };

  if (action === 'set_plan') {
    if (planName !== null) patch.plan_name = planName;
    if (planDataMb !== null) patch.plan_data_mb = planDataMb;
    if (planCostCents !== null) patch.monthly_cost_cents = planCostCents;
  } else {
    patch.status = TARGET_STATUS[action];
    if (action === 'activate' || action === 'resume') {
      patch.activated_at = before.activated_at ?? now;
      patch.suspended_at = null;
    }
    if (action === 'suspend') patch.suspended_at = now;
    if (action === 'terminate') patch.terminated_at = now;
  }

  const { data: after, error: upErr } = await admin
    .from('sims')
    .update(patch)
    .eq('id', before.id)
    .select('*')
    .single();
  if (upErr) throw new EdgeError('db_error', upErr.message, 500);

  /* ---------- sim_events ---------- */
  const { error: evErr } = await admin.from('sim_events').insert({
    sim_id: before.id,
    kind: EVENT_KIND[action],
    reason,
    staff_id: staff.staff_id,
    detail: {
      action,
      from_status: before.status,
      to_status: action === 'set_plan' ? before.status : TARGET_STATUS[action],
      provider: provider.name,
      provider_applied: providerApplied,
      ...(providerApplied ? {} : { provider_reason: provider.reason }),
      ...(action === 'set_plan'
        ? {
          from: { plan_name: before.plan_name, plan_data_mb: before.plan_data_mb, monthly_cost_cents: before.monthly_cost_cents },
          to: { plan_name: planName, plan_data_mb: planDataMb, monthly_cost_cents: planCostCents },
        }
        : {}),
      device_id: before.device_id,
      vehicle_code: vehicle?.code ?? null,
    },
  });
  if (evErr) console.error(`sim-command: sim_events insert failed: ${evErr.message}`);

  /* ---------- audit (Hard Rule #8) ---------- */
  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: `sim.${action}`,
    entity: 'sims',
    entity_id: before.id,
    before: {
      status: before.status,
      plan_name: before.plan_name,
      plan_data_mb: before.plan_data_mb,
      monthly_cost_cents: before.monthly_cost_cents,
      iccid: before.iccid,
      device_id: before.device_id,
    },
    after: {
      status: after.status,
      plan_name: after.plan_name,
      plan_data_mb: after.plan_data_mb,
      monthly_cost_cents: after.monthly_cost_cents,
      provider_applied: providerApplied,
    },
    reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  return json({
    ok: true,
    sim: after,
    action,
    live: provider.live,
    provider_applied: providerApplied,
    ...(providerApplied ? {} : { reason: provider.reason }),
    provider_echo: providerEcho,
  });
});

Deno.serve(handler);
