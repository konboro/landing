// vehicle-status — staff changes a vehicle's status (and optionally its map
// visibility) from the panel or the ops app. docs/07 defines the transition
// matrix; the trail lands in `vehicle_status_log` (with photos) as well as
// audit_log, because ops needs the per-vehicle history without reading the
// global audit stream.
//
// Hard Rule #8: reason is mandatory — a status change is what hides a vehicle
// from riders or takes it out of revenue, so "who and why" has to be answerable.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, bool, strArray } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

/** vehicle_status enum (migration 00020). Kept in step by hand — an unknown
 *  value would otherwise reach Postgres as a cast error rather than a 400. */
const STATUSES = new Set([
  'available', 'reserved', 'in_trip', 'maintenance', 'transport',
  'low_battery', 'offline', 'stolen', 'decommissioned',
]);

/** Statuses the trip engine owns. Staff must not hand-set these: `in_trip` /
 *  `reserved` are set and cleared by trips-start / trips-end, and forcing them
 *  would strand a vehicle no rider can release. */
const ENGINE_OWNED = new Set(['in_trip', 'reserved']);

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'vehicles.status');

  const body = await readJson(req);
  const vehicleId = str(body, 'vehicle_id')!;
  const status = str(body, 'status')!;
  const reason = str(body, 'reason')!;
  const visible = bool(body, 'visible');
  const photos = strArray(body, 'photos') ?? [];

  if (!STATUSES.has(status)) {
    throw new EdgeError('bad_request', `unknown vehicle status: ${status}`, 400);
  }
  if (ENGINE_OWNED.has(status)) {
    throw new EdgeError('bad_state', `${status} is set by the trip engine, not by staff`, 409);
  }
  if (reason.trim().length < 3) {
    throw new EdgeError('reason_required', 'a reason is required', 400);
  }

  const { data: vehicle } = await admin
    .from('vehicles')
    .select('id, status, visible')
    .eq('id', vehicleId)
    .maybeSingle();
  if (!vehicle) throw new EdgeError('not_found', 'vehicle not found', 404);

  // A vehicle under a live rider is not ours to move.
  if (ENGINE_OWNED.has(vehicle.status as string)) {
    throw new EdgeError('bad_state', `vehicle is ${vehicle.status}; end the trip first`, 409);
  }

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (visible !== undefined) patch.visible = visible;

  const { error } = await admin.from('vehicles').update(patch).eq('id', vehicleId);
  if (error) throw new EdgeError('db_error', error.message, 500);

  await admin.from('vehicle_status_log').insert({
    vehicle_id: vehicleId,
    from_status: vehicle.status,
    to_status: status,
    by: callerId,
    role: staff.role,
    reason,
    photos,
  });

  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: 'vehicles.status',
    entity: 'vehicles',
    entity_id: vehicleId,
    before: { status: vehicle.status, visible: vehicle.visible },
    after: { status, visible: visible ?? vehicle.visible },
    reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  return json({ vehicle_id: vehicleId, status, visible: visible ?? vehicle.visible });
});

Deno.serve(handler);
