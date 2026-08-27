// admin-messages — the staff side of the message centre.
//
// Three sections in one function, because they share the same permission check
// and row shaping:
//   list   → one row per rider with a conversation, newest activity first
//   thread → the full transcript for one rider
//   reply  → post a staff turn into that rider's thread
//
// Why staff replies come through here instead of a direct insert: writing to
// `inbox_messages` as `sender = 'staff'` is service_role-only on purpose (the
// rider's own RLS policy forbids it), so nobody can forge a message that looks
// like it came from support. This is the only door, and it stamps the author
// and writes the audit row (Hard Rule #8).
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

interface ChatRow {
  id: string;
  user_id: string;
  sender: string;
  body: string;
  created_at: string;
  read_at: string | null;
  staff_id: string | null;
}

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);

  const body = await readJson(req);
  const section = str(body, 'section', false) ?? 'list';

  /* ---------------------------------------------------------------- list -- */
  if (section === 'list') {
    await requireStaff(admin, callerId, 'messages.read');

    const limit = Math.min(num(body, 'limit', false) ?? 100, 300);
    // Read the recent chat traffic and fold it into one row per rider. The
    // volume here is a support queue, not a firehose, so folding in the
    // function is cheaper than adding a view + migration for it.
    const { data, error } = await admin
      .from('inbox_messages')
      .select('id, user_id, sender, body, created_at, read_at, staff_id')
      .eq('kind', 'chat')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw new EdgeError('db_error', error.message, 500);

    const rows = (data ?? []) as ChatRow[];
    const threads = new Map<string, {
      user_id: string;
      last_body: string;
      last_at: string;
      last_sender: string;
      unanswered: number;
    }>();

    for (const m of rows) {
      const t = threads.get(m.user_id);
      if (!t) {
        threads.set(m.user_id, {
          user_id: m.user_id,
          last_body: m.body,
          last_at: m.created_at,
          last_sender: m.sender,
          // "Waiting" = rider turns since the most recent staff turn. Rows
          // arrive newest-first, so counting until the first staff message
          // gives exactly that.
          unanswered: m.sender === 'rider' ? 1 : 0,
        });
        continue;
      }
      if (m.sender === 'rider' && t.last_sender === 'rider') t.unanswered += 1;
    }

    const ids = [...threads.keys()];
    const names = new Map<string, { full_name: string | null; phone: string | null }>();
    if (ids.length) {
      const { data: users } = await admin
        .from('users')
        .select('id, full_name, phone')
        .in('id', ids);
      for (const u of users ?? []) {
        names.set(u.id as string, { full_name: u.full_name, phone: u.phone });
      }
    }

    const out = [...threads.values()]
      .sort((a, b) => (a.last_at < b.last_at ? 1 : -1))
      .slice(0, limit)
      .map((t) => ({
        ...t,
        full_name: names.get(t.user_id)?.full_name ?? null,
        phone: names.get(t.user_id)?.phone ?? null,
      }));

    return json({ threads: out });
  }

  /* -------------------------------------------------------------- thread -- */
  if (section === 'thread') {
    await requireStaff(admin, callerId, 'messages.read');
    const userId = str(body, 'user_id')!;

    const { data, error } = await admin
      .from('inbox_messages')
      .select('id, user_id, sender, body, created_at, read_at, staff_id')
      .eq('user_id', userId)
      .eq('kind', 'chat')
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw new EdgeError('db_error', error.message, 500);

    return json({ messages: data ?? [] });
  }

  /* --------------------------------------------------------------- reply -- */
  if (section === 'reply') {
    const staff = await requireStaff(admin, callerId, 'messages.reply');
    const userId = str(body, 'user_id')!;
    const text = str(body, 'body')!;
    if (text.trim().length === 0) {
      throw new EdgeError('bad_request', 'message body is empty', 400);
    }

    const { data: user } = await admin.from('users').select('id').eq('id', userId).maybeSingle();
    if (!user) throw new EdgeError('not_found', 'user not found', 404);

    const { data: inserted, error } = await admin
      .from('inbox_messages')
      .insert({
        user_id: userId,
        kind: 'chat',
        sender: 'staff',
        staff_id: staff.staff_id,
        title: '',
        body: text,
      })
      .select('id, user_id, sender, body, created_at, staff_id')
      .single();
    if (error) throw new EdgeError('db_error', error.message, 500);

    // Mark the rider's outstanding turns as handled so the queue count clears.
    await admin
      .from('inbox_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('kind', 'chat')
      .eq('sender', 'rider')
      .is('read_at', null);

    await writeAudit(admin, {
      staff_id: staff.staff_id,
      action: 'messages.reply',
      entity: 'inbox_messages',
      entity_id: String(inserted!.id),
      after: { user_id: userId },
      reason: null,
      ip: req.headers.get('x-forwarded-for'),
    });

    return json({ message: inserted });
  }

  throw new EdgeError('bad_request', `unknown section: ${section}`, 400);
});

Deno.serve(handler);
