// admin-vehicle-delete — retire a vehicle, or erase one that was created by
// mistake (docs/08).
//
// Two different operations, deliberately behind one function:
//
//   mode=decommission (default) — status → 'decommissioned', hidden from the
//     rider map, device unfitted. The row stays, so every trip, payment and
//     telemetry record that points at it still resolves. This is what "remove a
//     vehicle from the fleet" means once the vehicle has carried anyone.
//
//   mode=purge — a real DELETE. Only allowed while the vehicle has no history
//     at all (no trips, no commands, no telemetry), i.e. a typo during
//     provisioning. Otherwise the FKs would either block the delete or cascade
//     away history that finance and disputes depend on, so we refuse with 409
//     and tell the caller to decommission instead.
//
// Hard Rule #8: reason mandatory in both modes, written to audit_log with the
// full before-image so a purge is still reconstructible from the log.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

/** A vehicle under a live rider is not ours to remove. */
const ENGINE_OWNED = new Set(['in_trip', 'reserved']);

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'vehicles.manage');

  const body = await readJson(req);
  const vehicleId = str(body, 'vehicle_id')!;
  const reason = str(body, 'reason')!;
  const mode = str(body, 'mode', false) ?? 'decommission';

  if (reason.trim().length < 3) throw new EdgeError('reason_required', 'a reason is required', 400);
  if (mode !== 'decommission' && mode !== 'purge') {
    throw new EdgeError('bad_request', "mode must be 'decommission' or 'purge'", 400);
  }

  const { data: vehicle } = await admin
    .from('vehicles')
    .select('id, code, status, visible, city_id, model_id, plate, vin, notes')
    .eq('id', vehicleId)
    .maybeSingle();
  if (!vehicle) throw new EdgeError('not_found', 'vehicle not found', 404);
  if (ENGINE_OWNED.has(vehicle.status as string)) {
    throw new EdgeError('bad_state', `vehicle is ${vehicle.status}; end the trip first`, 409);
  }

  // Unfit the device either way: a decommissioned scooter must not keep an
  // IMEI reserved, and a purge would orphan the link.
  const { data: devices } = await admin.from('devices').select('id, imei').eq('vehicle_id', vehicleId);
  const imeis = (devices ?? []).map((d: { imei: string }) => d.imei);

  if (mode === 'purge') {
    const { count: tripCount } = await admin
      .from('trips')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);
    if ((tripCount ?? 0) > 0) {
      throw new EdgeError(
        'has_history',
        `vehicle ${vehicle.code} has ${tripCount} trip(s) — decommission it instead of deleting, or the ride history loses its vehicle`,
        409,
      );
    }
  }

  if (devices?.length) {
    const { error: unlinkErr } = await admin
      .from('devices')
      .update({ vehicle_id: null, updated_at: new Date().toISOString() })
      .eq('vehicle_id', vehicleId);
    if (unlinkErr) throw new EdgeError('db_error', unlinkErr.message, 500);
  }

  if (mode === 'purge') {
    // vehicle_status_log cascades on delete; nothing else may reference the row
    // at this point (checked above).
    const { error } = await admin.from('vehicles').delete().eq('id', vehicleId);
    if (error) throw new EdgeError('db_error', error.message, 500);
  } else {
    const { error } = await admin
      .from('vehicles')
      .update({ status: 'decommissioned', visible: false, updated_at: new Date().toISOString() })
      .eq('id', vehicleId);
    if (error) throw new EdgeError('db_error', error.message, 500);

    await admin.from('vehicle_status_log').insert({
      vehicle_id: vehicleId,
      from_status: vehicle.status,
      to_status: 'decommissioned',
      by: callerId,
      role: staff.role,
      reason,
    });
  }

  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: mode === 'purge' ? 'vehicles.delete' : 'vehicles.decommission',
    entity: 'vehicles',
    entity_id: vehicleId,
    before: { ...vehicle, imeis },
    after: mode === 'purge' ? null : { status: 'decommissioned', visible: false },
    reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  return json({ vehicle_id: vehicleId, mode, devices_unlinked: imeis });
});

Deno.serve(handler);
