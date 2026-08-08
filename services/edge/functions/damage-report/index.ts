// damage-report — a rider (or staff) files a damage report against a vehicle.
// Referenced by @penny/api-client createEdgeApi().reportDamage.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str, strArray, lngLat } from '../../_shared/validate.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);

  const vehicleCode = str(body, 'vehicle_code')!;
  const description = str(body, 'description')!;
  const photos = strArray(body, 'photos') ?? [];
  const pos = body.pos ? lngLat(body, 'pos') : null;

  const { data: veh } = await admin.from('vehicles').select('id').eq('code', vehicleCode).maybeSingle();
  if (!veh) throw new EdgeError('vehicle_not_found', 'unknown vehicle code', 404);

  // If the reporter is on an active/recent trip with this vehicle, link it.
  const { data: trip } = await admin
    .from('trips').select('id').eq('user_id', userId).eq('vehicle_id', veh.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const { data: report, error } = await admin.from('damage_reports').insert({
    vehicle_id: veh.id, reporter: 'rider', user_id: userId, trip_id: trip?.id ?? null,
    description, photos, severity: 'low', status: 'new',
  }).select('id').single();
  if (error || !report) throw new EdgeError('report_failed', error?.message ?? 'insert failed', 500);

  // Raise a fleet error alert so ops sees it (payload carries coarse position if given).
  await admin.from('vehicle_alerts').insert({
    vehicle_id: veh.id, kind: 'error',
    payload: { source: 'damage_report', report_id: report.id, pos },
  });

  return json({ id: report.id });
});

Deno.serve(handler);
