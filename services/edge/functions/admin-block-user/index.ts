// admin-block-user — staff blocks or unblocks a rider account (docs/08
// Customer detail). Blocking is what stops a rider from starting new trips;
// trips-start reads `users.status`.
//
// Hard Rule #8: reason mandatory both ways — an unblock needs justifying as
// much as a block does.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, bool } from '../../_shared/validate.ts';
import { writeAudit, notifyUser } from '../../_shared/audit.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'users.block');

  const body = await readJson(req);
  const userId = str(body, 'user_id')!;
  const blocked = bool(body, 'blocked');
  const reason = str(body, 'reason')!;

  if (blocked === undefined) throw new EdgeError('bad_request', 'missing field: blocked', 400);
  if (reason.trim().length < 3) throw new EdgeError('reason_required', 'a reason is required', 400);

  const { data: user } = await admin
    .from('users')
    .select('id, status, blocked_reason')
    .eq('id', userId)
    .maybeSingle();
  if (!user) throw new EdgeError('not_found', 'user not found', 404);
  if (user.status === 'deleted') {
    throw new EdgeError('bad_state', 'cannot change the status of a deleted user', 409);
  }

  // Only the blocked/active pair is ours to flip: shadow_banned is set by the
  // abuse tooling and unblocking must not silently clear it.
  if (!blocked && user.status !== 'blocked') {
    throw new EdgeError('bad_state', `user is ${user.status}, not blocked`, 409);
  }

  const nextStatus = blocked ? 'blocked' : 'active';
  const { error } = await admin
    .from('users')
    .update({
      status: nextStatus,
      blocked_reason: blocked ? reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw new EdgeError('db_error', error.message, 500);

  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: blocked ? 'users.block' : 'users.unblock',
    entity: 'users',
    entity_id: userId,
    before: { status: user.status, blocked_reason: user.blocked_reason },
    after: { status: nextStatus, blocked_reason: blocked ? reason : null },
    reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  await notifyUser(
    admin,
    userId,
    blocked ? 'account_blocked' : 'account_unblocked',
    blocked ? 'Your account has been blocked' : 'Your account is active again',
    blocked
      ? `Your account was blocked. Reason: ${reason}. Contact support if you believe this is a mistake.`
      : 'Your account has been reactivated. You can ride again.',
    'penny://support',
  );

  return json({ user_id: userId, status: nextStatus });
});

Deno.serve(handler);
