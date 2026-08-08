// Audit + notification helpers. Hard Rule #8: every admin/ops mutation writes audit_log.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AuditInput {
  staff_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

export async function writeAudit(admin: SupabaseClient, a: AuditInput): Promise<void> {
  const { error } = await admin.from('audit_log').insert({
    staff_id: a.staff_id,
    action: a.action,
    entity: a.entity,
    entity_id: a.entity_id,
    before: a.before ?? null,
    after: a.after ?? null,
    reason: a.reason ?? null,
    ip: a.ip ?? null,
  });
  if (error) console.error('audit_log insert failed:', error.message);
}

/** Fan a transactional notification into the user's in-app inbox + log row. */
export async function notifyUser(
  admin: SupabaseClient,
  userId: string,
  templateKey: string,
  title: string,
  body: string,
  deepLink?: string,
): Promise<void> {
  await admin.from('inbox_messages').insert({
    user_id: userId,
    title,
    body,
    deep_link: deepLink ?? null,
  });
  await admin.from('notification_log').insert({
    user_id: userId,
    channel: 'inbox',
    template_key: templateKey,
    status: 'sent',
    sent_at: new Date().toISOString(),
    payload: { title, body },
  });
}
