// admin-credit-wallet — staff puts goodwill credit into a rider's wallet
// (docs/08 Customer detail: "credit wallet").
//
// Hard Rule #2: no balance column is touched. `v_user_wallet_balance` derives
// the balance as `-sum(delta_cents)` over the user_wallet account, so a CREDIT
// is a NEGATIVE leg on that account (the liability we owe the rider grows).
// The funding leg is `bonus` +amount — the same account packages and prepaid
// value are recognised against, since a goodwill credit moves no real cash.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num } from '../../_shared/validate.ts';
import { accountId, postLedger } from '../../_shared/ledger.ts';
import { writeAudit, notifyUser } from '../../_shared/audit.ts';

/** Guard-rail against a mistyped amount: 500 € in one manual credit. */
const MAX_CREDIT_CENTS = 50_000;

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'wallet.credit');

  const body = await readJson(req);
  const userId = str(body, 'user_id')!;
  const amount = num(body, 'amount_cents')!;
  const reason = str(body, 'reason')!;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new EdgeError('bad_request', 'amount_cents must be a positive integer', 400);
  }
  if (amount > MAX_CREDIT_CENTS) {
    throw new EdgeError('amount_too_large', `manual credit is capped at ${MAX_CREDIT_CENTS} cents`, 400);
  }
  if (reason.trim().length < 3) throw new EdgeError('reason_required', 'a reason is required', 400);

  const { data: user } = await admin.from('users').select('id, status').eq('id', userId).maybeSingle();
  if (!user) throw new EdgeError('not_found', 'user not found', 404);

  const wallet = await accountId(admin, 'user_wallet', userId);
  const bonus = await accountId(admin, 'bonus', null);
  const txn = crypto.randomUUID();
  await postLedger(admin, txn, [
    { account_id: wallet, delta_cents: -amount, memo: `goodwill credit: ${reason}` },
    { account_id: bonus, delta_cents: amount, memo: 'goodwill credit funding' },
  ]);

  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: 'wallet.credit',
    entity: 'users',
    entity_id: userId,
    after: { amount_cents: amount, txn_id: txn },
    reason,
    ip: req.headers.get('x-forwarded-for'),
  });

  await notifyUser(
    admin,
    userId,
    'wallet_credited',
    'Credit added to your wallet',
    `We added ${(amount / 100).toFixed(2)} € to your wallet. Reason: ${reason}.`,
    'penny://wallet',
  );

  const { data: balance } = await admin
    .from('v_user_wallet_balance')
    .select('balance_cents')
    .eq('user_id', userId)
    .maybeSingle();

  return json({ user_id: userId, credited_cents: amount, balance_cents: balance?.balance_cents ?? null });
});

Deno.serve(handler);
