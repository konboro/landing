// admin-me — who is the signed-in staff member, and what may they do?
//
// The panel calls this right after sign-in. `staff` and `role_permissions` are
// not readable with the anon key (Hard Rule #6), so the resolved role and the
// flattened permission list come from here instead.
//
// Returns 403 for a valid Supabase user who is not staff — that is the check
// stopping a rider account from opening the panel.

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);

  const { data: staff } = await admin
    .from('staff')
    .select('id, role, city_scope, active, user_id')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (!staff) throw new EdgeError('forbidden', 'this account is not an active staff member', 403);
  const row = staff as unknown as {
    id: string; role: string; city_scope: string[] | null;
  };

  const [{ data: perms }, { data: profile }, { data: cities }] = await Promise.all([
    admin.from('role_permissions').select('permission').eq('role', row.role),
    admin.from('users').select('full_name, email, phone, avatar_url').eq('id', userId).maybeSingle(),
    admin.from('cities').select('id, name'),
  ]);

  const permissions = (perms ?? []).map((p: { permission: string }) => p.permission);
  const p = (profile ?? {}) as { full_name?: string; email?: string; phone?: string; avatar_url?: string };

  return json({
    staff: {
      id: row.id,
      user_id: userId,
      name: p.full_name ?? p.email ?? 'Staff',
      email: p.email ?? null,
      phone: p.phone ?? null,
      avatar_url: p.avatar_url ?? null,
      role: row.role,
      city_scope: row.city_scope ?? [],
    },
    // '*' means every permission (owner).
    permissions,
    cities: cities ?? [],
  });
});

Deno.serve(handler);
