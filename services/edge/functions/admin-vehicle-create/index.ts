// admin-vehicle-create — add a vehicle to the fleet from the panel (docs/08).
//
// Hard Rule #6: the panel never inserts into `vehicles` itself — RLS gives the
// anon key read-only access, so the insert has to happen here under
// service_role, behind a staff permission check.
//
// Hard Rule #7: IMEI is the *device* identity, `vehicles.id` the business one.
// An IMEI passed here therefore never lands on the vehicle row; it links an
// existing `devices` row through `devices.vehicle_id`, exactly like a device
// swap does, so the same scooter can be re-fitted later without touching the
// business record.
//
// Hard Rule #10: code / plate / vin / imei are stored as typed, only trimmed.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

/** Statuses a brand-new vehicle may be created in. `offline` is the default —
 *  nothing has been heard from the device yet, which is exactly what offline
 *  means. `in_trip` / `reserved` belong to the trip engine. */
const INITIAL_STATUSES = new Set(['offline', 'maintenance', 'transport', 'available']);

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'vehicles.manage');

  const body = await readJson(req);
  const code = str(body, 'code')!.trim();
  const modelId = str(body, 'model_id')!;
  const cityId = str(body, 'city_id', false)?.trim() || null;
  const plate = str(body, 'plate', false)?.trim() || null;
  const vin = str(body, 'vin', false)?.trim() || null;
  const notes = str(body, 'notes', false)?.trim() || null;
  const imei = str(body, 'imei', false)?.trim() || null;
  const status = str(body, 'status', false)?.trim() || 'offline';

  if (code.length < 2) throw new EdgeError('bad_request', 'code must be at least 2 characters', 400);
  if (!INITIAL_STATUSES.has(status)) {
    throw new EdgeError('bad_request', `a new vehicle cannot start as ${status}`, 400);
  }

  // Unique constraint on `code` would surface as a raw 23505; answer plainly.
  const { data: clash } = await admin.from('vehicles').select('id').eq('code', code).maybeSingle();
  if (clash) throw new EdgeError('conflict', `vehicle code ${code} is already taken`, 409);

  const { data: model } = await admin.from('vehicle_models').select('id').eq('id', modelId).maybeSingle();
  if (!model) throw new EdgeError('bad_request', 'unknown model_id', 400);

  if (cityId) {
    const { data: city } = await admin.from('cities').select('id').eq('id', cityId).maybeSingle();
    if (!city) throw new EdgeError('bad_request', 'unknown city_id', 400);
  }

  // Resolve the device BEFORE inserting the vehicle, so a bad IMEI does not
  // leave a half-provisioned vehicle behind.
  let device: { id: string; vehicle_id: string | null } | null = null;
  if (imei) {
    const { data } = await admin.from('devices').select('id, vehicle_id').eq('imei', imei).maybeSingle();
    if (!data) throw new EdgeError('not_found', `no device with IMEI ${imei} — provision it first`, 404);
    if (data.vehicle_id) {
      throw new EdgeError('conflict', `IMEI ${imei} is already fitted to another vehicle`, 409);
    }
    device = data as { id: string; vehicle_id: string | null };
  }

  const { data: created, error } = await admin
    .from('vehicles')
    .insert({ code, model_id: modelId, city_id: cityId, plate, vin, notes, status, visible: status === 'available' })
    .select('id, code, status, visible, city_id, model_id')
    .single();
  if (error) throw new EdgeError('db_error', error.message, 500);

  if (device) {
    const { error: linkErr } = await admin
      .from('devices')
      .update({ vehicle_id: created.id, updated_at: new Date().toISOString() })
      .eq('id', device.id);
    if (linkErr) throw new EdgeError('db_error', `vehicle created but device link failed: ${linkErr.message}`, 500);
  }

  // Give it a live-state row immediately. The gateway would create one on the
  // first AVL packet, but until then the vehicle joins to nothing: the ops app
  // renders it with no battery, no lock state and no "last seen", and every
  // read that inner-joins state skips it entirely. An explicit offline row is
  // the honest starting state — we genuinely have not heard from it yet.
  const { error: stateErr } = await admin
    .from('vehicle_state')
    .upsert({ vehicle_id: created.id, session_online: false, locked: true, ignition: false }, { onConflict: 'vehicle_id' });
  if (stateErr) console.error('vehicle_state seed failed:', stateErr.message);

  // The per-vehicle history has to start somewhere, and ops reads this log
  // instead of the global audit stream.
  await admin.from('vehicle_status_log').insert({
    vehicle_id: created.id,
    from_status: null,
    to_status: status,
    by: callerId,
    role: staff.role,
    reason: 'vehicle created',
  });

  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: 'vehicles.create',
    entity: 'vehicles',
    entity_id: created.id,
    before: null,
    after: { code, model_id: modelId, city_id: cityId, plate, vin, status, imei },
    reason: str(body, 'reason', false) ?? 'vehicle added from admin panel',
    ip: req.headers.get('x-forwarded-for'),
  });

  return json({ vehicle: created, device_linked: device ? imei : null }, 201);
});

Deno.serve(handler);
