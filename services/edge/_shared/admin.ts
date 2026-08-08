// Supabase admin client (service_role). Hard Rule #6: the service_role key exists
// ONLY inside edge functions and the gateway. Never expose it to apps.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { EdgeError } from './responses.ts';

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new EdgeError('config_error', 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set', 500);
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolve the calling user from the Authorization: Bearer <jwt> header using the
 * anon-verified getUser call. Returns the auth user id or throws 401.
 */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) throw new EdgeError('unauthenticated', 'missing bearer token', 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new EdgeError('unauthenticated', 'invalid token', 401);
  return data.user.id;
}

/** Resolve the staff row for the caller, asserting a required permission. */
export async function requireStaff(
  admin: SupabaseClient,
  userId: string,
  permission: string,
): Promise<{ staff_id: string; role: string; city_scope: string[] | null }> {
  const { data: staff } = await admin
    .from('staff')
    .select('id, role, city_scope, active')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();
  if (!staff) throw new EdgeError('forbidden', 'not a staff member', 403);

  const { data: perms } = await admin
    .from('role_permissions')
    .select('permission')
    .eq('role', staff.role);
  const granted = new Set((perms ?? []).map((p: { permission: string }) => p.permission));
  if (!granted.has('*') && !granted.has(permission)) {
    throw new EdgeError('forbidden', `missing permission: ${permission}`, 403);
  }
  return { staff_id: staff.id, role: staff.role, city_scope: staff.city_scope };
}
