// ride-photo-url — mint a short-TTL SIGNED DOWNLOAD url for a trip's end-of-ride
// parking photo, for staff surfaces that read it on demand (the ops field app's
// vehicle / last-ride view, docs/07). The ride-photos bucket is private, so the app
// cannot sign urls itself — it asks here with the caller's staff JWT.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { signRidePhoto } from '../../_shared/photos.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  await requireStaff(admin, callerId, 'vehicles.read');

  const body = await readJson(req);
  const tripId = str(body, 'trip_id')!;

  const { data: trip } = await admin
    .from('trips').select('id, end_photo_url, photo_review').eq('id', tripId).maybeSingle();
  if (!trip) throw new EdgeError('not_found', 'trip not found', 404);

  const url = await signRidePhoto(admin, trip.end_photo_url, 600);
  return json({ trip_id: tripId, url, photo_review: trip.photo_review ?? null });
});

Deno.serve(handler);
