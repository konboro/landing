// admin-sim-detail — everything the panel's SIM detail drawer renders.
//
// Returns the `v_sim_inventory` row (status, plan, cycle consumption, health), the
// 30-day usage series for the chart, the event log, the fitted device + vehicle, the
// open alerts for this SIM, and — when credentials exist — the provider's own live
// view of the SIM so an operator can see at a glance whether our cache is stale.
//
// Hard Rule #6: the base tables are service_role-only; this function is the panel's
// only way in. Hard Rule #10: ICCID/IMSI/MSISDN are passed through untouched.

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num } from '../../_shared/validate.ts';
import { getSimProvider, type ProviderSim } from '../../_shared/simprovider.ts';

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  await requireStaff(admin, callerId, 'sims.read');

  const body = await readJson(req);
  // Either the uuid or the ICCID identifies the SIM — the panel has the uuid, an
  // operator reading a label has the ICCID.
  const simId = str(body, 'sim_id', false) ?? null;
  const iccid = str(body, 'iccid', false) ?? null;
  if (!simId && !iccid) throw new EdgeError('bad_request', 'missing field: sim_id (or iccid)', 400);
  const eventLimit = Math.min(num(body, 'event_limit', false) ?? 100, 500);

  /* ---------- the SIM (read model) ---------- */
  let simQuery = admin.from('v_sim_inventory').select('*');
  simQuery = simId ? simQuery.eq('sim_id', simId) : simQuery.eq('iccid', iccid!);
  const { data: sim, error: simErr } = await simQuery.maybeSingle();
  if (simErr) throw new EdgeError('db_error', simErr.message, 500);
  if (!sim) throw new EdgeError('not_found', 'sim not found', 404);

  const id = sim.sim_id as string;

  /* ---------- everything hanging off it ---------- */
  const [usageRes, eventsRes, alertsRes, rawRes] = await Promise.all([
    admin.from('v_sim_usage_30d').select('*').eq('sim_id', id).order('day', { ascending: true }),
    admin.from('sim_events').select('*').eq('sim_id', id).order('at', { ascending: false }).limit(eventLimit),
    admin.from('v_sim_alerts').select('*').eq('sim_id', id),
    admin.from('sims').select('provider, provider_sim_id, iccid, notes').eq('id', id).single(),
  ]);

  let device: Record<string, unknown> | null = null;
  let vehicle: Record<string, unknown> | null = null;
  if (sim.device_id) {
    const { data: dev } = await admin
      .from('devices')
      .select('id, imei, iccid, phone_number, model, fw_version, server_profile, status, vehicle_id, sim_id')
      .eq('id', sim.device_id as string)
      .maybeSingle();
    device = dev ?? null;
    if (device?.vehicle_id) {
      const { data: veh } = await admin
        .from('vehicles')
        .select('id, code, status, visible, city_id, model_id')
        .eq('id', device.vehicle_id as string)
        .maybeSingle();
      vehicle = veh ?? null;
    }
  }

  /* ---------- the provider's live view (optional) ---------- */
  const providerRow = rawRes.data as { provider: string; provider_sim_id: string | null; iccid: string } | null;
  const provider = getSimProvider(providerRow?.provider ?? 'truphone');
  let live: ProviderSim | null = null;
  let liveError: string | null = null;
  if (provider.live && providerRow) {
    try {
      live = await provider.getSim({
        iccid: providerRow.iccid,
        provider_sim_id: providerRow.provider_sim_id,
      });
    } catch (e) {
      // A provider outage must not blank the whole drawer — surface it as a field.
      liveError = e instanceof Error ? e.message : 'provider lookup failed';
    }
  }

  return json({
    sim,
    device,
    vehicle,
    usage_30d: usageRes.data ?? [],
    events: eventsRes.data ?? [],
    alerts: alertsRes.data ?? [],
    provider: {
      name: provider.name,
      live: provider.live,
      ...(provider.live ? {} : { reason: provider.reason }),
      sim: live,
      ...(liveError ? { error: liveError } : {}),
    },
  });
});

Deno.serve(handler);
