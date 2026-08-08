// trips-pause — pause/resume an active trip. Pause engages the lock at a reduced
// tariff; resume re-unlocks. pause_s accumulates so end-billing stays accurate.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);
  const tripId = str(body, 'trip_id')!;
  const action = str(body, 'action')!;
  if (action !== 'pause' && action !== 'resume') {
    throw new EdgeError('bad_request', "action must be 'pause' or 'resume'", 400);
  }

  const { data: trip } = await admin
    .from('trips').select('id, user_id, vehicle_id, status, pause_s').eq('id', tripId).single();
  if (!trip) throw new EdgeError('not_found', 'trip not found', 404);
  if (trip.user_id !== userId) throw new EdgeError('forbidden', 'not your trip', 403);

  const { data: dev } = await admin
    .from('devices').select('id').eq('vehicle_id', trip.vehicle_id).eq('status', 'active').maybeSingle();

  let toStatus: 'paused' | 'active';
  let cmdKind: 'lock' | 'unlock';
  let updatePauseS = trip.pause_s ?? 0;

  if (action === 'pause') {
    if (trip.status !== 'active') throw new EdgeError('bad_state', `cannot pause from ${trip.status}`, 409);
    toStatus = 'paused';
    cmdKind = 'lock';
  } else {
    if (trip.status !== 'paused') throw new EdgeError('bad_state', `cannot resume from ${trip.status}`, 409);
    toStatus = 'active';
    cmdKind = 'unlock';
    // Add the elapsed pause window (since the last 'paused' event) to pause_s.
    const { data: lastPause } = await admin
      .from('trip_events').select('at').eq('trip_id', tripId).eq('to_status', 'paused')
      .order('at', { ascending: false }).limit(1).maybeSingle();
    if (lastPause?.at) {
      updatePauseS += Math.round((Date.now() - new Date(lastPause.at).getTime()) / 1000);
    }
  }

  await admin.rpc('trip_transition', { trip: tripId, to_st: toStatus, actor: 'user', meta: { action } });
  if (action === 'resume') await admin.from('trips').update({ pause_s: updatePauseS }).eq('id', tripId);

  const { data: cmd } = await admin.from('commands').insert({
    vehicle_id: trip.vehicle_id, device_id: dev?.id ?? null, kind: cmdKind,
    status: 'queued', channel: 'gprs', requested_by: userId, trip_id: tripId,
    payload: { reason: `trip_${action}` },
  }).select('id').single();
  if (cmd) await admin.rpc('enqueue_vehicle_command', { p_command_id: cmd.id });

  return json({ trip_id: tripId, status: toStatus });
});

Deno.serve(handler);
