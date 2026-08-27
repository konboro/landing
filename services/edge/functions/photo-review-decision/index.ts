// photo-review-decision — the HUMAN verdict on an end-parking photo (docs/08
// "Ride verification"). Distinct from `photo-review`, which is the AI pre-screen
// that decides whether a human has to look at all: that one may set `auto_ok`,
// this one is the only path to `approved` / `rejected`.
//
// Hard Rule #8: staff mutation, so permission check + audit_log. A rejection
// carries a mandatory reason because it is what a later penalty is justified by
// — the penalty itself is a separate `admin-charge` call, deliberately not
// bundled here (money never moves as a side effect of a review).
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { writeAudit, notifyUser } from '../../_shared/audit.ts';

const VERDICTS = new Set(['approved', 'rejected']);

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'rides.verify');

  const body = await readJson(req);
  const tripId = str(body, 'trip_id')!;
  const verdict = str(body, 'verdict')!;
  const reason = str(body, 'reason', false) ?? null;

  if (!VERDICTS.has(verdict)) {
    throw new EdgeError('bad_request', `verdict must be approved|rejected, got ${verdict}`, 400);
  }
  if (verdict === 'rejected' && (reason ?? '').trim().length < 3) {
    throw new EdgeError('reason_required', 'a reason is required to reject a photo', 400);
  }

  const { data: trip } = await admin
    .from('trips')
    .select('id, user_id, photo_review, end_photo_url')
    .eq('id', tripId)
    .maybeSingle();
  if (!trip) throw new EdgeError('not_found', 'trip not found', 404);
  if (!trip.end_photo_url) throw new EdgeError('no_photo', 'trip has no end photo', 409);

  const { error } = await admin
    .from('trips')
    .update({ photo_review: verdict })
    .eq('id', tripId);
  if (error) throw new EdgeError('db_error', error.message, 500);

  // No trip_events row on purpose: that table records TRIP STATE transitions
  // (`to_status` is a non-null trip_status and `trips.status` is a cache of the
  // last event, Hard Rule #4). A photo verdict changes no trip state, so the
  // staff trail belongs in audit_log alone (Hard Rule #8).
  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: 'rides.photo_review',
    entity: 'trips',
    entity_id: tripId,
    before: { photo_review: trip.photo_review },
    after: { photo_review: verdict },
    reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  if (verdict === 'rejected') {
    await notifyUser(
      admin,
      trip.user_id as string,
      'parking_photo_rejected',
      'Parking photo rejected',
      `Your parking photo was rejected. Reason: ${reason}. Please park inside a permitted area next time.`,
      'penny://parking-school',
    );
  }

  return json({ trip_id: tripId, photo_review: verdict });
});

Deno.serve(handler);
