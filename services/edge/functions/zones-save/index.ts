// zones-save — write a NEW zone version (never mutate existing geometry). Supersedes the
// city's active zones and snapshots the full set into zone_versions. Permission + audit.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'zones.edit');

  const body = await readJson(req);
  const cityId = str(body, 'city_id')!;
  const reason = str(body, 'reason')!;
  const zones = body.zones;
  if (!Array.isArray(zones) || zones.length === 0) {
    throw new EdgeError('bad_request', 'zones must be a non-empty array', 400);
  }
  // Light shape check: each zone needs a kind + GeoJSON geom.
  for (const z of zones as Record<string, unknown>[]) {
    if (typeof z.kind !== 'string' || typeof z.geom !== 'object' || z.geom === null) {
      throw new EdgeError('bad_request', 'each zone needs { kind, geom (GeoJSON) }', 400);
    }
  }

  const { data: version, error } = await admin.rpc('apply_zone_version', {
    p_city: cityId, p_zones: zones, p_reason: reason, p_by: callerId,
  });
  if (error) throw new EdgeError('zone_save_failed', error.message, 500);

  await writeAudit(admin, {
    staff_id: staff.staff_id, action: 'zones.edit', entity: 'zone_versions', entity_id: `${cityId}:${version}`,
    after: { version, zone_count: (zones as unknown[]).length }, reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  return json({ version });
});

Deno.serve(handler);
