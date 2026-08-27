// admin-broadcast — compose once, deliver to the in-app inbox, an interrupting
// pop-up and/or Expo push, for everyone / a customer group / named users
// (docs/12 §A fan-out, §C rider catalogue).
//
// Hard Rule #6: audience resolution and delivery run service_role-side. The
// panel may not read the user base with the anon key, let alone write into
// other people's inboxes.
//
// Hard Rule #8: every send is audited. A reason is mandatory whenever the blast
// radius is more than one person — "who decided to message 4 000 riders and
// why" has to be answerable months later.
//
// Consent (docs/12 §C): `category: 'marketing'` is filtered per recipient
// against users.marketing_consent, and push additionally against
// user_notification_prefs.push_marketing (opt-in, default false). Transactional
// sends skip the marketing gate but still honour push_transactional.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, bool, strArray } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

const CHANNELS = new Set(['inbox', 'popup', 'push']);
const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo rejects anything larger. */
const EXPO_CHUNK = 100;

interface Recipient {
  id: string;
  marketing_consent: boolean;
}

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'notifications.send');

  const body = await readJson(req);
  const title = (str(body, 'title', false) ?? '').trim();
  const message = (str(body, 'body')!).trim();
  const deepLink = str(body, 'deep_link', false)?.trim() || null;
  const category = str(body, 'category', false) ?? 'transactional';
  const expiresAt = str(body, 'expires_at', false) || null;
  const reason = (str(body, 'reason', false) ?? '').trim();
  const preview = bool(body, 'preview') ?? false;
  const channels = (strArray(body, 'channels') ?? []).filter((c) => CHANNELS.has(c));
  const audience = (body.audience ?? {}) as { kind?: string; group_id?: string; user_ids?: string[] };

  if (!channels.length) throw new EdgeError('bad_request', 'pick at least one channel: inbox, popup, push', 400);
  if (!message) throw new EdgeError('bad_request', 'body is required', 400);
  if (category !== 'transactional' && category !== 'marketing') {
    throw new EdgeError('bad_request', "category must be 'transactional' or 'marketing'", 400);
  }
  // A pop-up interrupts; without a headline it reads as an error dialog.
  if ((channels.includes('popup') || channels.includes('push')) && !title) {
    throw new EdgeError('bad_request', 'title is required for pop-up and push', 400);
  }

  /* ---------------- audience ---------------- */
  let recipients: Recipient[] = [];
  const kind = audience.kind;
  if (kind === 'all') {
    const { data, error } = await admin.from('users').select('id, marketing_consent').eq('status', 'active');
    if (error) throw new EdgeError('db_error', error.message, 500);
    recipients = (data ?? []) as Recipient[];
  } else if (kind === 'group') {
    if (!audience.group_id) throw new EdgeError('bad_request', 'audience.group_id is required', 400);
    const { data: group } = await admin.from('customer_groups').select('id, name').eq('id', audience.group_id).maybeSingle();
    if (!group) throw new EdgeError('not_found', 'customer group not found', 404);
    const { data, error } = await admin
      .from('users').select('id, marketing_consent')
      .eq('customer_group_id', audience.group_id).eq('status', 'active');
    if (error) throw new EdgeError('db_error', error.message, 500);
    recipients = (data ?? []) as Recipient[];
  } else if (kind === 'users') {
    const ids = Array.isArray(audience.user_ids) ? audience.user_ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) throw new EdgeError('bad_request', 'audience.user_ids is empty', 400);
    if (ids.length > 1000) throw new EdgeError('bad_request', 'too many explicit recipients (max 1000)', 400);
    const { data, error } = await admin.from('users').select('id, marketing_consent').in('id', ids);
    if (error) throw new EdgeError('db_error', error.message, 500);
    recipients = (data ?? []) as Recipient[];
    const missing = ids.filter((id) => !recipients.some((r) => r.id === id));
    if (missing.length) throw new EdgeError('not_found', `unknown user(s): ${missing.slice(0, 3).join(', ')}`, 404);
  } else {
    throw new EdgeError('bad_request', "audience.kind must be 'all', 'group' or 'users'", 400);
  }

  const massSend = kind !== 'users' || recipients.length > 1;
  if (massSend && reason.length < 3 && !preview) {
    throw new EdgeError('reason_required', 'a reason is required when messaging more than one person', 400);
  }

  // Marketing consent gate (in-app surfaces). Push is gated again below,
  // because push marketing is a separate opt-in.
  if (category === 'marketing') {
    recipients = recipients.filter((r) => r.marketing_consent);
  }
  const userIds = recipients.map((r) => r.id);

  /* ---------------- push eligibility ---------------- */
  // Resolved up front so `preview` can report a truthful reach per channel.
  let pushTargets: Array<{ user_id: string; token: string }> = [];
  if (channels.includes('push') && userIds.length) {
    const { data: tokens } = await admin.from('push_tokens').select('user_id, token').in('user_id', userIds);
    const { data: prefs } = await admin
      .from('user_notification_prefs').select('user_id, push_marketing, push_transactional').in('user_id', userIds);
    const prefOf = new Map((prefs ?? []).map((p: Record<string, unknown>) => [p.user_id as string, p]));
    pushTargets = (tokens ?? []).filter((t: { user_id: string }) => {
      const p = prefOf.get(t.user_id) as { push_marketing?: boolean; push_transactional?: boolean } | undefined;
      // No prefs row = table defaults: transactional on, marketing off.
      return category === 'marketing' ? (p?.push_marketing ?? false) : (p?.push_transactional ?? true);
    }) as Array<{ user_id: string; token: string }>;
  }

  if (preview) {
    return json({
      preview: true,
      recipients: userIds.length,
      reach: {
        inbox: channels.includes('inbox') ? userIds.length : 0,
        popup: channels.includes('popup') ? userIds.length : 0,
        push: channels.includes('push') ? pushTargets.length : 0,
      },
      push_devices: pushTargets.length,
    });
  }

  if (!userIds.length) {
    throw new EdgeError('empty_audience', 'the audience resolved to nobody — nothing was sent', 409);
  }

  /* ---------------- record the campaign header ---------------- */
  const { data: broadcast, error: bErr } = await admin
    .from('broadcasts')
    .insert({
      title, body: message, deep_link: deepLink, channels, category,
      audience, expires_at: expiresAt, status: 'sending',
      recipients: userIds.length, reason: reason || null, created_by: staff.staff_id,
    })
    .select('id')
    .single();
  if (bErr) throw new EdgeError('db_error', bErr.message, 500);
  const broadcastId = broadcast.id as string;

  /* ---------------- fan out ---------------- */
  let delivered = 0;
  let pushSent = 0;
  let pushFailed = 0;
  const errors: string[] = [];

  const inAppRows: Array<Record<string, unknown>> = [];
  for (const uid of userIds) {
    if (channels.includes('inbox')) {
      inAppRows.push({ user_id: uid, title, body: message, deep_link: deepLink, kind: 'notification', sender: 'system' });
    }
    if (channels.includes('popup')) {
      inAppRows.push({ user_id: uid, title, body: message, deep_link: deepLink, kind: 'popup', sender: 'system', expires_at: expiresAt });
    }
  }
  // Chunked: one 4 000-row insert is a single statement Postgres has to plan
  // and a payload Supabase may refuse.
  for (let i = 0; i < inAppRows.length; i += 500) {
    const chunk = inAppRows.slice(i, i + 500);
    const { error } = await admin.from('inbox_messages').insert(chunk);
    if (error) errors.push(`inbox: ${error.message}`);
    else delivered += chunk.length;
  }

  if (pushTargets.length) {
    for (let i = 0; i < pushTargets.length; i += EXPO_CHUNK) {
      const chunk = pushTargets.slice(i, i + EXPO_CHUNK);
      try {
        const res = await fetch(EXPO_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {}),
          },
          body: JSON.stringify(chunk.map((t) => ({
            to: t.token,
            title: title || 'Penny',
            body: message,
            data: { deep_link: deepLink, broadcast_id: broadcastId },
sound: 'default',
          }))),
        });
        const out = await res.json().catch(() => null) as { data?: Array<{ status?: string; message?: string }> } | null;
        const tickets = out?.data ?? [];
        chunk.forEach((t, idx) => {
          const ok = tickets[idx]?.status === 'ok';
          if (ok) pushSent++;
          else {
            pushFailed++;
            const m = tickets[idx]?.message ?? `expo http ${res.status}`;
            if (errors.length < 5) errors.push(`push ${t.user_id}: ${m}`);
          }
        });
      } catch (e) {
        pushFailed += chunk.length;
        errors.push(`push: ${e instanceof Error ? e.message : 'send failed'}`);
      }
    }
  }

  /* ---------------- per-recipient log (docs/12 §A) ---------------- */
  // `notification_channel` has no 'popup' member: a pop-up is delivered
  // in-app like an inbox message, and payload.surface says which it was.
  const logRows: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();
  for (const uid of userIds) {
    for (const ch of channels) {
      const isPush = ch === 'push';
      const hasToken = pushTargets.some((t) => t.user_id === uid);
      logRows.push({
        broadcast_id: broadcastId,
        user_id: uid,
        channel: isPush ? 'push' : 'inbox',
        template_key: `broadcast.${ch}`,
        payload: { surface: ch, title, broadcast_id: broadcastId },
        // A push to a rider with no registered device is suppressed, not failed:
        // nothing was wrong with the send, there was nowhere to send it.
        status: isPush ? (hasToken ? 'sent' : 'suppressed') : 'sent',
        sent_at: now,
      });
    }
  }
  for (let i = 0; i < logRows.length; i += 500) {
    const { error } = await admin.from('notification_log').insert(logRows.slice(i, i + 500));
    if (error) errors.push(`log: ${error.message}`);
  }

  const status = errors.length && delivered === 0 && pushSent === 0 ? 'failed' : 'sent';
  await admin.from('broadcasts').update({
    status, delivered, push_sent: pushSent, push_failed: pushFailed, sent_at: now,
  }).eq('id', broadcastId);

  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: 'notifications.broadcast',
    entity: 'broadcasts',
    entity_id: broadcastId,
    before: null,
    after: { title, channels, category, audience, recipients: userIds.length, delivered, push_sent: pushSent, push_failed: pushFailed },
    reason: reason || 'single-recipient message from the panel',
    ip: req.headers.get('x-forwarded-for'),
  });

  return json({
    broadcast_id: broadcastId,
    status,
    recipients: userIds.length,
    delivered,
    push_sent: pushSent,
    push_failed: pushFailed,
    push_devices: pushTargets.length,
    errors: errors.slice(0, 5),
  });
});

Deno.serve(handler);
