// zone-incident — record an operator-visible alert for a zone incident (zone
// workflows P2/P3):
//   • no_go       — the rider entered a no-go zone during an active ride (P3).
//   • no_parking  — the rider tried to end a ride inside a no-parking zone (P2);
//                   `attempts` accrues, and >3 raises the "repeated" flag.
//
// It writes a vehicle_alerts row (surfaced in the admin panel + ops app), deduped
// to ONE row per trip+kind so a stream of client pings does not spam operators.
// Per docs/04 this is the safe response: an ops alert + penalty flag, NOT an
// automatic ignition cut. Email fan-out is a later milestone.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str, lngLat } from '../../_shared/validate.ts';

const KINDS = new Set(['no_go', 'no_parking']);

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);

  const tripId = str(body, 'trip_id')!;
  const kind = str(body, 'kind')!;
  if (!KINDS.has(kind)) throw new EdgeError('bad_request', "kind must be 'no_go' or 'no_parking'", 400);
  const pos = lngLat(body, 'pos');

  const { data: trip } = await admin
    .from('trips').select('id, user_id, vehicle_id, status').eq('id', tripId).single();
  if (!trip) throw new EdgeError('not_found', 'trip not found', 404);
  if (trip.user_id !== userId) throw new EdgeError('forbidden', 'not your trip', 403);
  if (!['active', 'paused', 'ending'].includes(trip.status)) {
    throw new EdgeError('bad_state', `trip is ${trip.status}`, 409);
  }

  // Dedupe to one open alert per trip+kind; increment an attempt counter instead.
  const { data: existing } = await admin
    .from('vehicle_alerts')
    .select('id, payload')
    .eq('vehicle_id', trip.vehicle_id)
    .eq('kind', kind)
    .eq('payload->>trip_id', tripId)
    .is('ack_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const attempts = ((existing?.payload as { attempts?: number } | null)?.attempts ?? 0) + 1;
  // no_go is always critical; no_parking is "repeated" once the rider passes 3 tries.
  const flagged = kind === 'no_go' ? true : attempts > 3;
  const payload = {
    trip_id: tripId,
    user_id: userId,
    pos: { lng: pos[0], lat: pos[1] },
    attempts,
    flagged,
    source: 'rider_client',
    last_at: new Date().toISOString(),
  };

  if (existing) {
    await admin.from('vehicle_alerts').update({ payload }).eq('id', existing.id);
  } else {
    await admin.from('vehicle_alerts').insert({ vehicle_id: trip.vehicle_id, kind, payload });
  }

  return json({ alerted: true, kind, attempts, flagged });
});

Deno.serve(handler);
