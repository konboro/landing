// sumsub-applicant — pull (and cache) a rider's Sumsub applicant + documents so
// the admin panel can render the KYC profile automatically.
//
// Flow: resolve applicant id → call Sumsub REST (HMAC-signed) → upsert into
// sumsub_applicants / sumsub_documents / sumsub_review_history → mirror the
// document images into the private `kyc-docs` bucket → return the normalized
// profile with short-lived signed URLs.
//
// Degrades gracefully: without SUMSUB_APP_TOKEN/SUMSUB_SECRET_KEY it returns the
// cached DB copy with { live: false }, so demo/offline environments still render.
//
// Hard Rule #11 (PII minimization): never log tokens, signatures, document bytes
// or full applicant payloads. Only ids and status strings may be logged.

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { writeAudit } from '../../_shared/audit.ts';
import { readJson, str } from '../../_shared/validate.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUMSUB_BASE = Deno.env.get('SUMSUB_BASE_URL') ?? 'https://api.sumsub.com';
const APP_TOKEN = Deno.env.get('SUMSUB_APP_TOKEN') ?? '';
const SECRET_KEY = Deno.env.get('SUMSUB_SECRET_KEY') ?? '';
const BUCKET = 'kyc-docs';
const SIGNED_URL_TTL_S = 300;

/* ---------------- Sumsub signed request ---------------- */

async function hmacHex(secret: string, message: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, message.buffer as ArrayBuffer);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sumsub signature: HMAC_SHA256(secret, ts + METHOD + path + body) as hex,
 * sent alongside the app token and the timestamp used to build it.
 */
async function sumsubFetch(method: string, path: string, body?: string): Promise<Response> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const enc = new TextEncoder();
  const payload = new Uint8Array([
    ...enc.encode(ts + method.toUpperCase() + path),
    ...(body ? enc.encode(body) : []),
  ]);
  const sig = await hmacHex(SECRET_KEY, payload);
  return fetch(`${SUMSUB_BASE}${path}`, {
    method,
    headers: {
      'X-App-Token': APP_TOKEN,
      'X-App-Access-Sig': sig,
      'X-App-Access-Ts': ts,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  });
}

/* ---------------- normalization ---------------- */

interface SumsubInfo {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dob?: string;
  nationality?: string;
  country?: string;
  placeOfBirth?: string;
  gender?: string;
  phone?: string;
  email?: string;
  idDocs?: Array<{
    idDocType?: string;
    country?: string;
    number?: string;
    validUntil?: string;
    firstName?: string;
    lastName?: string;
    dob?: string;
  }>;
}

interface SumsubApplicantPayload {
  id?: string;
  externalUserId?: string;
  inspectionId?: string;
  createdAt?: string;
  info?: SumsubInfo;
  fixedInfo?: SumsubInfo;
  email?: string;
  phone?: string;
  review?: {
    levelName?: string;
    reviewStatus?: string;
    createdDate?: string;
    reviewDate?: string;
    reviewResult?: {
      reviewAnswer?: string;
      reviewRejectType?: string;
      rejectLabels?: string[];
      moderationComment?: string;
      clientComment?: string;
    };
  };
}

/** Map the Sumsub payload onto our `sumsub_applicants` row shape. */
function toApplicantRow(userId: string, p: SumsubApplicantPayload) {
  const info: SumsubInfo = { ...(p.info ?? {}), ...(p.fixedInfo ?? {}) };
  const doc = info.idDocs?.[0];
  const rr = p.review?.reviewResult;
  return {
    user_id: userId,
    applicant_id: p.id ?? '',
    external_user_id: p.externalUserId ?? userId,
    level_name: p.review?.levelName ?? null,
    inspection_id: p.inspectionId ?? null,
    review_status: p.review?.reviewStatus ?? null,
    review_answer: rr?.reviewAnswer ?? null,
    review_reject_type: rr?.reviewRejectType ?? null,
    reject_labels: rr?.rejectLabels ?? [],
    moderation_comment: rr?.moderationComment ?? null,
    client_comment: rr?.clientComment ?? null,
    first_name: info.firstName ?? doc?.firstName ?? null,
    last_name: info.lastName ?? doc?.lastName ?? null,
    middle_name: info.middleName ?? null,
    dob: info.dob ?? doc?.dob ?? null,
    nationality: info.nationality ?? null,
    country: info.country ?? doc?.country ?? null,
    place_of_birth: info.placeOfBirth ?? null,
    gender: info.gender ?? null,
    id_doc_type: doc?.idDocType ?? null,
    id_doc_number: doc?.number ?? null,
    id_doc_expiry: doc?.validUntil ?? null,
    id_doc_country: doc?.country ?? null,
    phone: info.phone ?? p.phone ?? null,
    email: info.email ?? p.email ?? null,
    applicant_created_at: p.createdAt ?? null,
    reviewed_at: p.review?.reviewDate ?? null,
    raw: p as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

interface DocStatusEntry {
  imageIds?: (string | number)[];
  idDocType?: string;
  country?: string;
  reviewResult?: { reviewAnswer?: string; rejectLabels?: string[] };
}

/* ---------------- read cached copy ---------------- */

async function readCached(admin: SupabaseClient, userId: string) {
  const { data: applicant } = await admin
    .from('sumsub_applicants')
    // `raw` is deliberately excluded — it is the full PII payload.
    .select(
      'id, applicant_id, external_user_id, level_name, inspection_id, review_status, review_answer,' +
        ' review_reject_type, reject_labels, moderation_comment, client_comment, first_name, last_name,' +
        ' middle_name, dob, nationality, country, place_of_birth, gender, id_doc_type, id_doc_number,' +
        ' id_doc_expiry, id_doc_country, phone, email, applicant_created_at, reviewed_at, synced_at',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (!applicant) {
    return { applicant: null, documents: [], review_history: [], synced_at: null };
  }
  // The select list is explicit, so narrow away supabase-js's error union.
  const row = applicant as unknown as { id: string; synced_at: string | null };

  const [{ data: docs }, { data: history }] = await Promise.all([
    admin
      .from('sumsub_documents')
      .select('image_id, doc_type, doc_sub_type, country, valid_until, review_answer, reject_labels, storage_path, content_type')
      .eq('applicant_row_id', row.id)
      .order('added_at', { ascending: true }),
    admin
      .from('sumsub_review_history')
      .select('at, review_status, review_answer, review_reject_type, reject_labels, moderation_comment')
      .eq('applicant_row_id', row.id)
      .order('at', { ascending: false }),
  ]);

  // Sign each cached image so the panel can render it inline.
  const documents = [];
  for (const d of docs ?? []) {
    let url: string | null = null;
    if (d.storage_path) {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(d.storage_path.replace(`${BUCKET}/`, ''), SIGNED_URL_TTL_S);
      url = signed?.signedUrl ?? null;
    }
    documents.push({
      image_id: d.image_id,
      doc_type: d.doc_type,
      doc_sub_type: d.doc_sub_type,
      country: d.country,
      valid_until: d.valid_until,
      review_answer: d.review_answer,
      reject_labels: d.reject_labels ?? [],
      content_type: d.content_type,
      url,
    });
  }

  return {
    applicant,
    documents,
    review_history: history ?? [],
    synced_at: row.synced_at ?? null,
  };
}

/* ---------------- live sync ---------------- */

async function syncFromSumsub(admin: SupabaseClient, userId: string, applicantId: string) {
  const res = await sumsubFetch('GET', `/resources/applicants/${applicantId}/one`);
  if (!res.ok) {
    throw new EdgeError('sumsub_error', `applicant fetch failed (${res.status})`, 502);
  }
  const payload = (await res.json()) as SumsubApplicantPayload;
  const row = toApplicantRow(userId, payload);

  const { data: upserted, error } = await admin
    .from('sumsub_applicants')
    .upsert(row, { onConflict: 'user_id' })
    .select('id')
    .single();
  if (error) throw new EdgeError('db_error', error.message, 500);
  const applicantRowId = upserted.id as string;

  // Keep our own kyc_status in step with Sumsub's verdict.
  const kyc =
    row.review_answer === 'GREEN'
      ? 'approved'
      : row.review_answer === 'RED'
        ? 'rejected'
        : row.review_status === 'completed'
          ? 'pending'
          : 'pending';
  await admin
    .from('users')
    .update({ kyc_status: kyc, sumsub_applicant_id: row.applicant_id })
    .eq('id', userId);

  // Append a review-history entry when the verdict changed.
  const { data: last } = await admin
    .from('sumsub_review_history')
    .select('review_status, review_answer')
    .eq('applicant_row_id', applicantRowId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last || last.review_status !== row.review_status || last.review_answer !== row.review_answer) {
    await admin.from('sumsub_review_history').insert({
      applicant_row_id: applicantRowId,
      at: row.reviewed_at ?? new Date().toISOString(),
      review_status: row.review_status,
      review_answer: row.review_answer,
      review_reject_type: row.review_reject_type,
      reject_labels: row.reject_labels,
      moderation_comment: row.moderation_comment,
    });
  }

  await syncDocuments(admin, applicantRowId, applicantId, payload.inspectionId ?? null);
  return applicantRowId;
}

/** Fetch the doc-status map, mirror each image into private storage, upsert rows. */
async function syncDocuments(
  admin: SupabaseClient,
  applicantRowId: string,
  applicantId: string,
  inspectionId: string | null,
) {
  const res = await sumsubFetch('GET', `/resources/applicants/${applicantId}/requiredIdDocsStatus`);
  if (!res.ok) return; // non-fatal: profile still renders without images
  const statusMap = (await res.json()) as Record<string, DocStatusEntry>;

  for (const [docSubType, entry] of Object.entries(statusMap)) {
    for (const rawId of entry.imageIds ?? []) {
      const imageId = String(rawId);
      let storagePath: string | null = null;
      let contentType: string | null = null;
      let bytes: number | null = null;

      if (inspectionId) {
        try {
          const imgRes = await sumsubFetch(
            'GET',
            `/resources/inspections/${inspectionId}/resources/${imageId}`,
          );
          if (imgRes.ok) {
            const buf = new Uint8Array(await imgRes.arrayBuffer());
            contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
            bytes = buf.byteLength;
            const ext = contentType.includes('png') ? 'png' : 'jpg';
            const path = `${applicantId}/${imageId}.${ext}`;
            const { error: upErr } = await admin.storage
              .from(BUCKET)
              .upload(path, buf, { contentType, upsert: true });
            if (!upErr) storagePath = `${BUCKET}/${path}`;
          }
        } catch {
          // Image mirroring is best-effort; the metadata row is still useful.
        }
      }

      await admin.from('sumsub_documents').upsert(
        {
          applicant_row_id: applicantRowId,
          image_id: imageId,
          doc_type: entry.idDocType ?? null,
          doc_sub_type: docSubType,
          country: entry.country ?? null,
          review_answer: entry.reviewResult?.reviewAnswer ?? null,
          reject_labels: entry.reviewResult?.rejectLabels ?? [],
          storage_path: storagePath,
          content_type: contentType,
          bytes,
        },
        { onConflict: 'applicant_row_id,image_id,doc_sub_type' },
      );
    }
  }
}

/* ---------------- handler ---------------- */

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'customers.read');

  const body = await readJson(req);
  const userId = str(body, 'user_id')!;
  const refresh = body.refresh !== false;

  const { data: user } = await admin
    .from('users')
    .select('id, sumsub_applicant_id')
    .eq('id', userId)
    .maybeSingle();
  if (!user) throw new EdgeError('not_found', 'user not found', 404);

  let live = false;
  let reason: string | undefined;

  if (!APP_TOKEN || !SECRET_KEY) {
    reason = 'no_credentials';
  } else if (!refresh) {
    reason = 'cache_requested';
  } else {
    let applicantId: string | null = user.sumsub_applicant_id ?? null;

    // No stored id? Ask Sumsub by externalUserId (our user id — docs/09 mapping).
    if (!applicantId) {
      const lookup = await sumsubFetch('GET', `/resources/applicants/-;externalUserId=${userId}/one`);
      if (lookup.ok) {
        const found = (await lookup.json()) as SumsubApplicantPayload;
        applicantId = found.id ?? null;
      }
    }

    if (!applicantId) {
      reason = 'no_applicant';
    } else {
      try {
        await syncFromSumsub(admin, userId, applicantId);
        live = true;
      } catch (e) {
        // Never fail the panel because Sumsub is down — fall back to cache.
        reason = 'sumsub_unavailable';
        console.error('sumsub sync failed for user', userId, (e as Error).message);
      }
    }
  }

  const cached = await readCached(admin, userId);

  // Staff viewing identity documents is itself auditable (Hard Rule #8/#11).
  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: 'kyc.profile_viewed',
    entity: 'users',
    entity_id: userId,
    after: { live, reason: reason ?? null, documents: cached.documents.length },
  });

  return json({ live, reason, ...cached });
});

Deno.serve(handler);
