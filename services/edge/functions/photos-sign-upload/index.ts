// photos-sign-upload — mint a short-TTL SIGNED UPLOAD url for a trip's end-of-ride
// parking photo (docs/04, zone workflows M1). The rider PUTs the JPEG bytes straight
// to Storage with this url, then calls trips-end with the returned `path`.
//
// Hard Rule #6: the bucket is private and the service_role never leaves the edge;
// the rider only ever holds a single-use signed url scoped to one object path. The
// caller must own the trip and it must still be in progress — you cannot re-write the
// evidence photo of a trip that already ended/charged.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { RIDE_PHOTOS_BUCKET, endPhotoPath } from '../../_shared/photos.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);
  const tripId = str(body, 'trip_id')!;

  const { data: trip } = await admin
    .from('trips').select('id, user_id, status').eq('id', tripId).single();
  if (!trip) throw new EdgeError('not_found', 'trip not found', 404);
  if (trip.user_id !== userId) throw new EdgeError('forbidden', 'not your trip', 403);
  if (!['active', 'paused', 'ending'].includes(trip.status)) {
    throw new EdgeError('bad_state', `cannot upload a photo for a trip in status ${trip.status}`, 409);
  }

  const path = endPhotoPath(tripId);
  // upsert:true so a retried capture overwrites the previous attempt at the same path.
  const { data, error } = await admin.storage
    .from(RIDE_PHOTOS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new EdgeError('sign_failed', error?.message ?? 'could not sign upload url', 502);
  }

  // `path` is what the client passes back to trips-end as end_photo_url.
  return json({ path, token: data.token, signed_url: data.signedUrl });
});

Deno.serve(handler);
