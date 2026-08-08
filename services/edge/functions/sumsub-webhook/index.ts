// sumsub-webhook — Sumsub pushes applicant review events here.
//
// Verifies the payload digest, is idempotent per event id, keeps
// users.kyc_status + sumsub_applicants + sumsub_review_history in sync, and
// notifies the rider (approved / rejected with reason + retry CTA).
//
// Sumsub sends:
//   x-payload-digest      hex digest of the RAW body
//   x-payload-digest-alg  HMAC_SHA1_HEX | HMAC_SHA256_HEX | HMAC_SHA512_HEX
// The shared secret is the webhook secret (SUMSUB_WEBHOOK_SECRET), which may
// differ from the API secret — fall back to the API secret if unset.
//
// Hard Rule #11: never log the raw payload or the digest.

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient } from '../../_shared/admin.ts';
import { notifyUser } from '../../_shared/audit.ts';

const WEBHOOK_SECRET =
  Deno.env.get('SUMSUB_WEBHOOK_SECRET') ?? Deno.env.get('SUMSUB_SECRET_KEY') ?? '';

const ALGS: Record<string, string> = {
  HMAC_SHA1_HEX: 'SHA-1',
  HMAC_SHA256_HEX: 'SHA-256',
  HMAC_SHA512_HEX: 'SHA-512',
};

async function digestHex(secret: string, alg: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: alg },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time-ish comparison so a bad digest can't be probed byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface SumsubWebhookPayload {
  applicantId?: string;
  inspectionId?: string;
  correlationId?: string;
  externalUserId?: string;
  levelName?: string;
  type?: string;
  reviewStatus?: string;
  createdAtMs?: string;
  reviewResult?: {
    reviewAnswer?: string;
    reviewRejectType?: string;
    rejectLabels?: string[];
    moderationComment?: string;
    clientComment?: string;
  };
}

/** Map a Sumsub verdict onto our users.kyc_status enum. */
function mapKycStatus(type: string, answer?: string): string | null {
  switch (type) {
    case 'applicantReviewed':
      return answer === 'GREEN' ? 'approved' : answer === 'RED' ? 'rejected' : 'pending';
    case 'applicantPending':
    case 'applicantOnHold':
    case 'applicantCreated':
      return 'pending';
    case 'applicantReset':
      return 'none';
    case 'applicantDeleted':
      return 'none';
    default:
      return null;
  }
}

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') throw new EdgeError('method_not_allowed', 'POST only', 405);

  const raw = await req.text();

  // ---- signature verification ----
  const provided = req.headers.get('x-payload-digest') ?? '';
  const algHeader = req.headers.get('x-payload-digest-alg') ?? 'HMAC_SHA256_HEX';
  const alg = ALGS[algHeader];
  if (!WEBHOOK_SECRET) {
    throw new EdgeError('config_error', 'SUMSUB_WEBHOOK_SECRET not set', 500);
  }
  if (!alg) throw new EdgeError('bad_request', `unsupported digest alg`, 400);
  const expected = await digestHex(WEBHOOK_SECRET, alg, raw);
  if (!provided || !safeEqual(provided.toLowerCase(), expected)) {
    throw new EdgeError('bad_signature', 'payload digest mismatch', 401);
  }

  const payload = JSON.parse(raw) as SumsubWebhookPayload;
  const admin = adminClient();

  const type = payload.type ?? 'unknown';
  const applicantId = payload.applicantId ?? '';
  // Sumsub has no single event-id header; correlationId + type + applicant is
  // the stable dedupe key they recommend.
  const eventId = `${payload.correlationId ?? applicantId}:${type}:${payload.createdAtMs ?? ''}`;

  // ---- idempotency ----
  const { data: seen } = await admin
    .from('sumsub_review_history')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle();
  if (seen) return json({ ok: true, deduped: true });

  // ---- resolve the user ----
  let userId: string | null = null;
  if (payload.externalUserId) {
    const { data } = await admin
      .from('users')
      .select('id')
      .eq('id', payload.externalUserId)
      .maybeSingle();
    userId = (data as { id: string } | null)?.id ?? null;
    if (!userId) {
      // Migrated riders are matched on their legacy Atom id (docs/09).
      const { data: legacy } = await admin
        .from('users')
        .select('id')
        .eq('legacy_atom_user_id', payload.externalUserId)
        .maybeSingle();
      userId = (legacy as { id: string } | null)?.id ?? null;
    }
  }
  if (!userId && applicantId) {
    const { data } = await admin
      .from('users')
      .select('id')
      .eq('sumsub_applicant_id', applicantId)
      .maybeSingle();
    userId = (data as { id: string } | null)?.id ?? null;
  }
  if (!userId) {
    // Acknowledge so Sumsub stops retrying, but record nothing we can't attach.
    console.error('sumsub webhook: no matching user for applicant', applicantId, 'type', type);
    return json({ ok: true, matched: false });
  }

  const rr = payload.reviewResult ?? {};
  const nowIso = new Date().toISOString();
  const at = payload.createdAtMs ? new Date(Number(payload.createdAtMs)).toISOString() : nowIso;

  // ---- upsert applicant snapshot ----
  const { data: applicantRow, error: upErr } = await admin
    .from('sumsub_applicants')
    .upsert(
      {
        user_id: userId,
        applicant_id: applicantId,
        external_user_id: payload.externalUserId ?? userId,
        level_name: payload.levelName ?? null,
        inspection_id: payload.inspectionId ?? null,
        review_status: payload.reviewStatus ?? null,
        review_answer: rr.reviewAnswer ?? null,
        review_reject_type: rr.reviewRejectType ?? null,
        reject_labels: rr.rejectLabels ?? [],
        moderation_comment: rr.moderationComment ?? null,
        client_comment: rr.clientComment ?? null,
        reviewed_at: type === 'applicantReviewed' ? at : null,
        synced_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' },
    )
    .select('id')
    .single();
  if (upErr) throw new EdgeError('db_error', upErr.message, 500);
  const applicantRowId = (applicantRow as unknown as { id: string }).id;

  // ---- append review history (also our idempotency ledger) ----
  await admin.from('sumsub_review_history').insert({
    applicant_row_id: applicantRowId,
    at,
    review_status: payload.reviewStatus ?? null,
    review_answer: rr.reviewAnswer ?? null,
    review_reject_type: rr.reviewRejectType ?? null,
    reject_labels: rr.rejectLabels ?? [],
    moderation_comment: rr.moderationComment ?? null,
    event_id: eventId,
    raw: payload as unknown as Record<string, unknown>,
  });

  // ---- sync our own status ----
  const kyc = mapKycStatus(type, rr.reviewAnswer);
  if (kyc) {
    await admin
      .from('users')
      .update({ kyc_status: kyc, sumsub_applicant_id: applicantId })
      .eq('id', userId);
  }

  // ---- notify the rider (docs/12 C transactional catalogue) ----
  if (type === 'applicantReviewed') {
    if (rr.reviewAnswer === 'GREEN') {
      await notifyUser(
        admin,
        userId,
        'kyc_approved',
        'You are verified',
        'Your identity check passed — unlock your first scooter now.',
        'penny://profile/kyc',
      );
    } else if (rr.reviewAnswer === 'RED') {
      const final = rr.reviewRejectType === 'FINAL';
      const why = rr.moderationComment ?? (rr.rejectLabels ?? []).join(', ') ?? '';
      await notifyUser(
        admin,
        userId,
        final ? 'kyc_rejected_final' : 'kyc_rejected_retry',
        final ? 'Verification declined' : 'Verification needs another try',
        why || (final ? 'We could not verify your identity.' : 'Please retake your documents.'),
        'penny://profile/kyc',
      );
    }
  }

  return json({ ok: true, type, kyc_status: kyc });
});

Deno.serve(handler);
