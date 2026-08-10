// admin-app-config — staff edits an `app_config` row (feature flags, tunables,
// and the white-label `brand` blob the panel's Branding editor writes).
//
// `app_config` is service_role-only, so this is the only write path. Hard Rule
// #8: before/after both land in audit_log, which is what makes a bad flag flip
// diagnosable after the fact.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

/** Keys reachable from the panel. An allowlist rather than a free-for-all: this
 *  function runs as service_role, and `app_config` also carries operational
 *  tunables that the trip engine reads on every ride. */
const WRITABLE_KEYS = new Set([
  'brand',              // white-label tokens, written by the Branding editor
  'reservation_ttl_min',
  'reserve_free_min',
  'min_start_soc',
  'night_hours',
  'photo_ai_threshold',
  'hold_cents',
  // 'penalties' lived here until migration 00490 and is now its own table,
  // edited through admin-write. Left out deliberately: re-adding the key would
  // recreate a second catalogue that nothing reads.
  'station_mode',
]);

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'settings.edit');

  const body = await readJson(req);
  const key = str(body, 'key')!;
  const reason = str(body, 'reason')!;

  if (!WRITABLE_KEYS.has(key)) {
    throw new EdgeError('bad_request', `app_config key not writable from the panel: ${key}`, 400);
  }
  if (reason.trim().length < 3) throw new EdgeError('reason_required', 'a reason is required', 400);
  if (!('value' in body) || body.value === undefined) {
    throw new EdgeError('bad_request', 'missing field: value', 400);
  }
  const value = body.value;

  const { data: existing } = await admin
    .from('app_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  const { error } = await admin
    .from('app_config')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new EdgeError('db_error', error.message, 500);

  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: 'settings.app_config',
    entity: 'app_config',
    entity_id: key,
    before: existing?.value ?? null,
    after: value,
    reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  return json({ key, value });
});

Deno.serve(handler);
