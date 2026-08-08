// vehicle-command — two callers:
//   rider ring: { vehicle_code, kind:'ring', pos }  (rate-limited, must be within 100 m)
//   staff cmd:  { vehicle_id, kind, payload? }       (permission-checked + audit_log)
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, lngLat, distanceMeters } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

const STAFF_KINDS = ['unlock', 'lock', 'locate', 'reboot', 'ring', 'alarm_on', 'alarm_off', 'setparam', 'custom'];

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);

  const vehicleId = str(body, 'vehicle_id', false);
  const kind = str(body, 'kind')!;

  // ---------- Rider ring ----------
  if (!vehicleId) {
    if (kind !== 'ring') throw new EdgeError('forbidden', 'riders may only ring a vehicle', 403);
    const vehicleCode = str(body, 'vehicle_code')!;
    const pos = lngLat(body, 'pos');

    const { data: snapRows } = await admin.rpc('vehicle_snapshot', { p_code: vehicleCode });
    const snap = Array.isArray(snapRows) ? snapRows[0] : snapRows;
    if (!snap) throw new EdgeError('vehicle_not_found', 'unknown vehicle code', 404);
    if (snap.lng == null || snap.lat == null) throw new EdgeError('no_position', 'vehicle has no position', 409);
    if (distanceMeters(pos, [snap.lng, snap.lat]) > 100) {
      throw new EdgeError('too_far', 'you must be within 100 m to ring', 409);
    }

    // Rate limit: one ring per vehicle per 30 s from this user.
    const since = new Date(Date.now() - 30 * 1000).toISOString();
    const { data: recent } = await admin
      .from('commands').select('id')
      .eq('vehicle_id', snap.vehicle_id).eq('kind', 'ring').eq('requested_by', userId)
      .gt('created_at', since).limit(1);
    if (recent && recent.length > 0) throw new EdgeError('rate_limited', 'please wait before ringing again', 429);

    const { data: cmd } = await admin.from('commands').insert({
      vehicle_id: snap.vehicle_id, device_id: snap.device_id, kind: 'ring',
      status: 'queued', channel: 'gprs', requested_by: userId, payload: { source: 'rider' },
    }).select('id').single();
    if (cmd) await admin.rpc('enqueue_vehicle_command', { p_command_id: cmd.id });
    return json({ ok: true });
  }

  // ---------- Staff command ----------
  if (!STAFF_KINDS.includes(kind)) throw new EdgeError('bad_request', `unknown command kind: ${kind}`, 400);
  const staff = await requireStaff(admin, userId, 'vehicle.command');

  const payload = (body.payload && typeof body.payload === 'object') ? body.payload as Record<string, unknown> : {};
  const { data: dev } = await admin
    .from('devices').select('id').eq('vehicle_id', vehicleId).eq('status', 'active').maybeSingle();

  const { data: cmd, error } = await admin.from('commands').insert({
    vehicle_id: vehicleId, device_id: dev?.id ?? null, kind,
    status: 'queued', channel: 'gprs', requested_by: userId, payload,
  }).select('id').single();
  if (error || !cmd) throw new EdgeError('command_failed', error?.message ?? 'insert failed', 500);

  await admin.rpc('enqueue_vehicle_command', { p_command_id: cmd.id });

  // Hard Rule #8: staff command send is audited.
  await writeAudit(admin, {
    staff_id: staff.staff_id, action: 'vehicle.command', entity: 'vehicles', entity_id: vehicleId,
    after: { kind, payload }, ip: req.headers.get('x-forwarded-for'),
  });

  return json({ command_id: cmd.id });
});

Deno.serve(handler);
