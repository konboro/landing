// admin-vehicle-history — the exhaustive history of one vehicle.
//
// Returns: vehicle + linked device, lifetime/rolling stats, every ride (with the
// rider's phone masked), the merged timeline (rides, commands, status changes,
// alerts, damage, battery swaps, maintenance), a daily telemetry summary, and the
// raw sub-lists the panel tabs render.
//
// IMEI is the device identity, the code is the business identity (Hard Rule #7) —
// both are returned, kept in their own objects.

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num } from '../../_shared/validate.ts';

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  await requireStaff(admin, callerId, 'vehicles.read');

  const body = await readJson(req);
  const vehicleId = str(body, 'vehicle_id')!;
  const limit = Math.min(num(body, 'limit', false) ?? 50, 200);
  const offset = num(body, 'offset', false) ?? 0;
  const from = str(body, 'from', false) ?? null;
  const to = str(body, 'to', false) ?? null;

  /* ---------- the vehicle itself ---------- */
  const { data: vehicle, error: vErr } = await admin
    .from('vehicles')
    .select('*, vehicle_models(name, kind, max_speed_kmh), cities(name, tz)')
    .eq('id', vehicleId)
    .maybeSingle();
  if (vErr) throw new EdgeError('db_error', vErr.message, 500);
  if (!vehicle) throw new EdgeError('not_found', 'vehicle not found', 404);

  // Optional date window, applied inline below (kept untyped-generic-free so
  // supabase-js keeps inferring the row types).
  let ridesQuery = admin
    .from('v_vehicle_ride_history')
    .select('*')
    .eq('vehicle_id', vehicleId);
  if (from) ridesQuery = ridesQuery.gte('started_at', from);
  if (to) ridesQuery = ridesQuery.lte('started_at', to);

  let timelineQuery = admin.from('v_vehicle_timeline').select('*').eq('vehicle_id', vehicleId);
  if (from) timelineQuery = timelineQuery.gte('at', from);
  if (to) timelineQuery = timelineQuery.lte('at', to);

  const [
    device,
    stats,
    state,
    ridesRes,
    ridesCount,
    timelineRes,
    commandsRes,
    alertsRes,
    statusLogRes,
    damageRes,
    maintenanceRes,
    swapsRes,
    telemetryRes,
  ] = await Promise.all([
    admin
      .from('devices')
      .select('id, imei, iccid, phone_number, model, fw_version, server_profile, status')
      .eq('vehicle_id', vehicleId)
      .maybeSingle(),
    admin.from('v_vehicle_stats').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
    admin.from('vehicle_state').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
    ridesQuery.order('started_at', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1),
    admin
      .from('v_vehicle_ride_history')
      .select('trip_id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId),
    timelineQuery.order('at', { ascending: false }).range(offset, offset + limit - 1),
    admin
      .from('commands')
      .select('id, kind, status, channel, requested_by, trip_id, sent_at, acked_at, error, created_at')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('vehicle_alerts')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('vehicle_status_log')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('at', { ascending: false })
      .limit(limit),
    admin
      .from('damage_reports')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false }),
    admin
      .from('maintenance_log')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false }),
    admin
      .from('battery_swaps')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('at', { ascending: false }),
    // Daily telemetry rollup for the charts. Bounded to 30 days: the raw table
    // is partitioned and huge (docs/02 retention).
    admin.rpc('vehicle_telemetry_daily', { p_vehicle_id: vehicleId, p_days: 30 }),
  ]);

  // The RPC is optional — fall back to an empty summary if it isn't deployed.
  const telemetrySummary =
    telemetryRes && !('error' in telemetryRes && telemetryRes.error) ? (telemetryRes.data ?? []) : [];

  return json({
    vehicle,
    device: device.data ?? null,
    state: state.data ?? null,
    stats: stats.data ?? null,
    rides: ridesRes.data ?? [],
    total_rides: (ridesCount as { count?: number }).count ?? (ridesRes.data ?? []).length,
    timeline: timelineRes.data ?? [],
    commands: commandsRes.data ?? [],
    alerts: alertsRes.data ?? [],
    status_log: statusLogRes.data ?? [],
    damage: damageRes.data ?? [],
    maintenance: maintenanceRes.data ?? [],
    battery_swaps: swapsRes.data ?? [],
    telemetry_summary: telemetrySummary,
  });
});

Deno.serve(handler);
