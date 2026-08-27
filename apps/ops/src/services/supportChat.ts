// Live chat between a crew member in the field and dispatch/support.
//
// It is the EXISTING message centre, not a second chat system: `inbox_messages`
// rows with `kind = 'chat'` (migration 00280), keyed on the staff member's own
// `users.id`. That buys per-user RLS, realtime, the unread index and — the point
// — the admin panel's Message centre already lists and answers these threads, so
// this is two-way from day one with no admin work.
//
// Direction is carried by `sender`:
//   'rider' — written here, by the crew member, under their own user_id. The RLS
//             WITH CHECK pins user_id/sender/kind, so nobody can forge support.
//   'staff' — dispatch's reply, service_role-only through `admin-messages`.
// The enum label is 'rider' because the table was built for riders first; here
// it just means "the person whose thread this is".
//
// DELIBERATELY NOT IN THE OFFLINE OUTBOX. Everything else this app writes is
// queued and flushed later, which is right for a status change. It is wrong for
// a conversation: "the brake is gone and I'm on the road" delivered an hour
// after the crew member walked away is worse than an honest "couldn't send —
// retry". So chat is online-only and fails loudly.
import { env } from '../lib/env';
import { isSqliteAvailable, metaGet, metaSet } from '../offline/db';

type PennyClient = import('@penny/api-client').PennyClient;

export type ChatSender = 'system' | 'rider' | 'staff';

export interface ChatMessage {
  id: string;
  /** 'rider' = this crew member, 'staff' = dispatch. */
  sender: ChatSender;
  body: string;
  created_at: string;
  /** Who at dispatch answered. Null on our own turns. */
  staff_id: string | null;
}

export type SupportChatCode =
  | 'unavailable' // mock build, or no Supabase config
  | 'not_signed_in' // no Supabase session on this device
  | 'load_failed'
  | 'send_failed';

export class SupportChatError extends Error {
  constructor(readonly code: SupportChatCode, message: string) {
    super(message);
    this.name = 'SupportChatError';
  }
}

/** A thread is a support conversation, not a mailbox — the tail is what matters. */
const MAX_MESSAGES = 200;

/** Mock builds have no backend to talk to; the screen says so instead of failing. */
export function isAvailable(): boolean {
  return env.dataSource === 'supabase' && !!env.supabaseUrl && !!env.supabaseAnonKey;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Supabase auth session storage, backed by the offline DB's `meta` table.
 *
 * `createPennyClient` passes no `storage`, and React Native has no
 * `localStorage`, so supabase-js falls back to a PER-INSTANCE in-memory store:
 * the session dies with the app and is invisible to any other client object.
 * Persisting it here means the signed-in session survives a restart (a crew
 * member should not re-OTP at the start of every shift) and, more importantly,
 * that two client objects configured with the same `storageKey` genuinely share
 * one session.
 *
 * >>> Wire-up: pass this same object as `auth.storage` where `SupabaseOpsApi`
 * builds its client and the two are one session. Until then a chat call can
 * legitimately answer `not_signed_in` even though the app looks logged in. <<<
 *
 * The value is a JWT + refresh token, so it stays in the app's private SQLite
 * file and is never logged (Hard Rule #11).
 */
const memoryFallback = new Map<string, string>();
export const opsAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isSqliteAvailable()) return memoryFallback.get(key) ?? null;
    // metaSet writes '' to delete, so an empty string means "absent".
    const raw = await metaGet(`auth:${key}`);
    return raw ? raw : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    memoryFallback.set(key, value);
    if (isSqliteAvailable()) await metaSet(`auth:${key}`, value);
  },
  async removeItem(key: string): Promise<void> {
    memoryFallback.delete(key);
    if (isSqliteAvailable()) await metaSet(`auth:${key}`, '');
  },
};

// Built here rather than imported from `SupabaseOpsApi`: that file is the
// offline-sync adapter and is being rewritten, and chat must not be coupled to
// it. Same URL, same anon key, same storageKey — same session. The end state is
// one shared client module; this is four lines until that exists.
let clientPromise: Promise<PennyClient> | null = null;
async function getClient(): Promise<PennyClient> {
  if (!isAvailable()) {
    throw new SupportChatError('unavailable', 'Chat needs the live backend (this is a mock build).');
  }
  if (!clientPromise) {
    // Dynamic import so a mock-only build never pulls supabase-js into its
    // eval path — the same guard SupabaseOpsApi uses.
    clientPromise = (async () => {
      const { createPennyClient } = await import('@penny/api-client');
      return createPennyClient({
        url: env.supabaseUrl,
        anonKey: env.supabaseAnonKey,
        auth: { storage: opsAuthStorage, storageKey: 'penny-ops-auth' },
      });
    })();
  }
  return clientPromise;
}

/** The thread is keyed on the crew member's own user id — auth.uid() under RLS. */
async function session(): Promise<{ client: PennyClient; userId: string }> {
  const client = await getClient();
  const { data } = await client.supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) {
    throw new SupportChatError('not_signed_in', 'Sign in again to reach dispatch.');
  }
  return { client, userId };
}

/* -------------------------------------------------------------------------- */
/* Reads and writes                                                           */
/* -------------------------------------------------------------------------- */

interface ChatRow {
  id: string;
  sender: string;
  body: string;
  created_at: string;
  staff_id: string | null;
}

function toMessage(row: ChatRow): ChatMessage {
  return {
    id: String(row.id),
    sender: (row.sender === 'staff' || row.sender === 'rider' ? row.sender : 'system') as ChatSender,
    body: String(row.body ?? ''),
    created_at: String(row.created_at),
    staff_id: row.staff_id ?? null,
  };
}

/** The transcript, oldest first. */
export async function getChat(): Promise<ChatMessage[]> {
  const { client, userId } = await session();
  // Ordered DESC and reversed, not ASC: on a long thread `order asc limit 200`
  // returns the two hundred OLDEST turns — the ones nobody needs — and hides
  // today's conversation.
  const { data, error } = await client.supabase
    .from('inbox_messages')
    .select('id, sender, body, created_at, staff_id')
    .eq('user_id', userId)
    .eq('kind', 'chat')
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES);
  if (error) throw new SupportChatError('load_failed', error.message);
  return ((data ?? []) as ChatRow[]).map(toMessage).reverse();
}

export async function sendChatMessage(body: string): Promise<ChatMessage> {
  const text = body.trim();
  if (!text) throw new SupportChatError('send_failed', 'Message is empty.');
  const { client, userId } = await session();
  // sender/kind are pinned here AND by the RLS WITH CHECK; `title` is '' because
  // a chat turn has no headline (00280 defaulted the column for exactly this).
  const { data, error } = await client.supabase
    .from('inbox_messages')
    .insert({ user_id: userId, kind: 'chat', sender: 'rider', title: '', body: text })
    .select('id, sender, body, created_at, staff_id')
    .single();
  if (error) throw new SupportChatError('send_failed', error.message);
  return toMessage(data as ChatRow);
}

/**
 * Live replies. Returns an unsubscribe the caller MUST run on unmount —
 * a channel left open outlives the screen and keeps firing into a dead setState.
 */
let channelSeq = 0;
export function subscribeChat(onMessage: (m: ChatMessage) => void): () => void {
  let cancelled = false;
  let teardown: (() => void) | null = null;

  void (async () => {
    try {
      const { client, userId } = await session();
      if (cancelled) return;
      const channel = client.supabase
        // Unique topic per subscription: supabase-js keys channels by topic, so
        // two screens sharing one name would fight over the same socket.
        .channel(`ops-support-chat-${userId}-${(channelSeq += 1)}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'inbox_messages',
            // Filtered server-side so notifications and other users' traffic
            // never reach this device's socket at all.
            filter: `user_id=eq.${userId}`,
          },
          (payload: { new?: Record<string, unknown> }) => {
            const row = payload.new;
            if (!row || row.kind !== 'chat') return;
            onMessage(
              toMessage({
                id: String(row.id),
                sender: String(row.sender),
                body: String(row.body ?? ''),
                created_at: String(row.created_at),
                staff_id: row.staff_id == null ? null : String(row.staff_id),
              }),
            );
          },
        )
        .subscribe();

      teardown = () => {
        void client.supabase.removeChannel(channel);
      };
      // Unmounted while the socket was still connecting.
      if (cancelled) {
        teardown();
        teardown = null;
      }
    } catch {
      // Signed out or offline: getChat() has already told the screen why, and a
      // failed subscription must not crash the render.
    }
  })();

  return () => {
    cancelled = true;
    teardown?.();
    teardown = null;
  };
}

/** Clear the badge: only dispatch's turns can be unread for us. */
export async function markRead(): Promise<void> {
  const { client, userId } = await session();
  const { error } = await client.supabase
    .from('inbox_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('kind', 'chat')
    .eq('sender', 'staff')
    .is('read_at', null);
  if (error) throw new SupportChatError('load_failed', error.message);
}

/** Unanswered replies waiting for this crew member. 0 when chat is unavailable. */
export async function getUnreadCount(): Promise<number> {
  if (!isAvailable()) return 0;
  const { client, userId } = await session();
  // head:true — the badge needs the number, not the rows.
  const { count, error } = await client.supabase
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('kind', 'chat')
    .eq('sender', 'staff')
    .is('read_at', null);
  if (error) throw new SupportChatError('load_failed', error.message);
  return count ?? 0;
}
