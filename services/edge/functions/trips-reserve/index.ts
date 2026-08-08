// trips-reserve — reserve a vehicle (trip status=reserved, pg_cron auto-expires) or
// cancel an existing reservation.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str, lngLat } from '../../_shared/validate.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);
  const action = str(body, 'action', false);

  // ---- Cancel ----
  if (action === 'cancel') {
    const tripId = str(body, 'trip_id')!;
    const { data: trip } = await admin
      .from('trips').select('id, user_id, vehicle_id, status').eq('id', tripId).single();
    if (!trip) throw new EdgeError('not_found', 'reservation not found', 404);
    if (trip.user_id !== userId) throw new EdgeError('forbidden', 'not your reservation', 403);
    if (trip.status !== 'reserved') throw new EdgeError('bad_state', `cannot cancel from ${trip.status}`, 409);

    await admin.rpc('trip_transition', { trip: tripId, to_st: 'aborted', actor: 'user', meta: { reason: 'cancel' } });
    await admin.from('vehicles').update({ status: 'available' }).eq('id', trip.vehicle_id);
    return json({ ok: true });
  }

  // ---- Reserve ----
  const vehicleCode = str(body, 'vehicle_code')!;
  const pos = lngLat(body, 'pos');

  const { data: liveTrip } = await admin
    .from('trips').select('id').eq('user_id', userId)
    .in('status', ['reserved', 'unlocking', 'active', 'paused', 'ending']).maybeSingle();
  if (liveTrip) throw new EdgeError('active_trip_exists', 'you already have a live trip', 409);

  const { data: snapRows } = await admin.rpc('vehicle_snapshot', { p_code: vehicleCode });
  const snap = Array.isArray(snapRows) ? snapRows[0] : snapRows;
  if (!snap) throw new EdgeError('vehicle_not_found', 'unknown vehicle code', 404);
  if (snap.status !== 'available') throw new EdgeError('vehicle_unavailable', `vehicle is ${snap.status}`, 409);
  if (!snap.session_online) throw new EdgeError('vehicle_offline', 'vehicle is offline', 409);

  const ttlMin = await configNum(admin, 'reservation_ttl_min', 15);
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

  const { data: trip, error } = await admin.from('trips').insert({
    user_id: userId, vehicle_id: snap.vehicle_id, status: 'reserved',
    reserved_at: new Date().toISOString(),
    start_pos: `SRID=4326;POINT(${pos[0]} ${pos[1]})`,
  }).select('id').single();
  if (error || !trip) {
    if (error?.code === '23505') throw new EdgeError('active_trip_exists', 'you already have a live trip', 409);
    throw new EdgeError('reserve_failed', error?.message ?? 'insert failed', 500);
  }

  await admin.from('trip_events').insert({
    trip_id: trip.id, from_status: null, to_status: 'reserved', actor: 'user', meta: { expires_at: expiresAt },
  });
  await admin.from('vehicles').update({ status: 'reserved' }).eq('id', snap.vehicle_id);

  return json({ trip_id: trip.id, expires_at: expiresAt });
});

async function configNum(admin: ReturnType<typeof adminClient>, key: string, dflt: number): Promise<number> {
  const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

Deno.serve(handler);
