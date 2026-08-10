// admin-user-profile — everything the Customers → detail page needs in one call.
//
// Returns: profile (v_user_profile_full, incl. KYC summary + lifetime stats),
// cached Sumsub applicant + documents + review history, ride history, payments,
// ledger, debts, penalties, disputes, devices used, referrals, loyalty and the
// merged activity timeline.
//
// Staff reading a rider's PII is itself auditable (Hard Rules #8 + #11): we log
// that the profile was viewed, never the contents.

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { writeAudit } from '../../_shared/audit.ts';
import { readJson, str, num } from '../../_shared/validate.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'kyc-docs';
const SIGNED_URL_TTL_S = 300;

type Section =
  | 'kyc'
  | 'rides'
  | 'payments'
  | 'ledger'
  | 'debts'
  | 'timeline'
  | 'referrals'
  | 'devices'
  | 'loyalty';

const ALL_SECTIONS: Section[] = [
  'kyc',
  'rides',
  'payments',
  'ledger',
  'debts',
  'timeline',
  'referrals',
  'devices',
  'loyalty',
];

/** Cached Sumsub bundle with freshly signed document URLs. */
async function kycBundle(admin: SupabaseClient, userId: string) {
  const { data: applicant } = await admin
    .from('sumsub_applicants')
    // `raw` excluded on purpose — full PII payload stays server-side.
    .select(
      'id, applicant_id, external_user_id, level_name, inspection_id, review_status, review_answer,' +
        ' review_reject_type, reject_labels, moderation_comment, client_comment, first_name, last_name,' +
        ' middle_name, dob, nationality, country, place_of_birth, gender, id_doc_type, id_doc_number,' +
        ' id_doc_expiry, id_doc_country, phone, email, applicant_created_at, reviewed_at, synced_at',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (!applicant) {
    return { live: false, reason: 'no_applicant', applicant: null, documents: [], review_history: [], synced_at: null };
  }
  const row = applicant as unknown as Record<string, unknown> & { id: string; synced_at: string | null };

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

  const documents = [];
  for (const d of (docs ?? []) as Array<Record<string, unknown>>) {
    const path = d.storage_path as string | null;
    let url: string | null = null;
    if (path) {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(path.replace(`${BUCKET}/`, ''), SIGNED_URL_TTL_S);
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

  // `live:false` here means "served from cache" — call sumsub-applicant to refresh.
  return {
    live: false,
    reason: 'cached',
    applicant: row,
    documents,
    review_history: history ?? [],
    synced_at: row.synced_at ?? null,
  };
}

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  const staff = await requireStaff(admin, callerId, 'customers.read');

  const body = await readJson(req);
  const userId = str(body, 'user_id')!;
  const limit = Math.min(num(body, 'limit', false) ?? 50, 200);
  const offset = num(body, 'offset', false) ?? 0;
  const include = Array.isArray(body.include) && body.include.length
    ? (body.include as Section[])
    : ALL_SECTIONS;
  const want = (s: Section) => include.includes(s);

  /* ---------- profile (the header) ---------- */
  const { data: profile, error: pErr } = await admin
    .from('v_user_profile_full')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (pErr) throw new EdgeError('db_error', pErr.message, 500);
  if (!profile) throw new EdgeError('not_found', 'user not found', 404);

  /* ---------- everything else, in parallel ---------- */
  const [
    kyc,
    ridesRes,
    ridesCount,
    paymentsRes,
    ledgerRes,
    debtsRes,
    timelineRes,
    referralsRes,
    loyaltyRes,
    devicesRes,
    paymentMethodsRes,
    loyaltyEventsRes,
    notifPrefsRes,
    tiersRes,
  ] = await Promise.all([
    want('kyc') ? kycBundle(admin, userId) : Promise.resolve(null),
    want('rides')
      ? admin
          .from('v_user_ride_history')
          .select('*')
          .eq('user_id', userId)
          .order('started_at', { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1)
      : Promise.resolve({ data: [] }),
    want('rides')
      ? admin.from('v_user_ride_history').select('trip_id', { count: 'exact', head: true }).eq('user_id', userId)
      : Promise.resolve({ count: 0 }),
    want('payments')
      ? admin
          .from('payments')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] }),
    want('ledger')
      ? admin
          .from('ledger_entries')
          .select('id, txn_id, account_id, delta_cents, currency, memo, created_at, ledger_accounts!inner(kind, owner_id)')
          .eq('ledger_accounts.owner_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] }),
    want('debts')
      ? admin.from('debts').select('*').eq('user_id', userId).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    want('timeline')
      ? admin
          .from('v_user_timeline')
          .select('*')
          .eq('user_id', userId)
          .order('at', { ascending: false })
          .range(offset, offset + limit - 1)
      : Promise.resolve({ data: [] }),
    want('referrals')
      ? admin
          .from('referrals')
          .select('*')
          .or(`referrer_id.eq.${userId},referee_id.eq.${userId}`)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    want('loyalty')
      ? admin.from('loyalty_accounts').select('*').eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
    want('devices')
      ? admin
          .from('push_tokens')
          .select('platform, last_seen')
          .eq('user_id', userId)
          .order('last_seen', { ascending: false })
      : Promise.resolve({ data: [] }),
    // The rider's saved cards. Support's first question on a failed unlock is
    // "do they even have a card on file", and the panel had no way to answer
    // it. Only brand/last4/expiry/status — never a full number (Hard Rule #11).
    want('payments')
      ? admin
          .from('payment_methods')
          .select('id, brand, last4, exp, status, is_default, created_at')
          .eq('user_id', userId)
          .order('is_default', { ascending: false })
      : Promise.resolve({ data: [] }),
    want('loyalty')
      ? admin
          .from('loyalty_events')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] }),
    // What the rider agreed to receive. Support needs it before promising
    // someone a push notification they have switched off.
    admin.from('user_notification_prefs').select('*').eq('user_id', userId).maybeSingle(),
    // The tier catalogue, so the rider's tier can be named rather than left as
    // a bare point count.
    admin.from('loyalty_tiers').select('name, min_points').eq('active', true).order('min_points', { ascending: true }),
  ]);

  const payments = (paymentsRes.data ?? []) as Array<Record<string, unknown>>;

  await writeAudit(admin, {
    staff_id: staff.staff_id,
    action: 'user.profile_viewed',
    entity: 'users',
    entity_id: userId,
    after: { sections: include },
  });

  return json({
    profile,
    kyc,
    stats: profile, // v_user_profile_full already carries the lifetime aggregates
    rides: ridesRes.data ?? [],
    total_rides: (ridesCount as { count?: number }).count ?? (ridesRes.data ?? []).length,
    payments,
    // Flattened: the join nests the account under `ledger_accounts`, while the
    // panel's LedgerEntry type reads a plain `account_kind`. Handing over the
    // nested shape made the customer's Ledger tab throw on titleCase(undefined)
    // — the same crash that blanked the Finance page.
    ledger: (ledgerRes.data ?? []).map((e: Record<string, unknown>) => {
      const { ledger_accounts: acct, ...rest } = e;
      return { ...rest, account_kind: (acct as { kind?: string } | null)?.kind ?? null };
    }),
    debts: debtsRes.data ?? [],
    penalties: payments.filter((p) => p.kind === 'penalty'),
    disputes: (ridesRes.data ?? []).filter((r: Record<string, unknown>) => r.has_dispute === true),
    devices_used: devicesRes.data ?? [],
    referrals: referralsRes.data ?? [],
    loyalty: loyaltyRes.data ?? null,
    payment_methods: paymentMethodsRes.data ?? [],
    loyalty_events: loyaltyEventsRes.data ?? [],
    notification_prefs: notifPrefsRes.data ?? null,
    // Highest tier whose threshold the rider has reached.
    loyalty_tier: ((tiersRes.data ?? []) as Array<{ name: string; min_points: number }>)
      .filter((t) => t.min_points <= Number((profile as Record<string, unknown>).loyalty_points ?? 0))
      .at(-1)?.name ?? null,
    timeline: timelineRes.data ?? [],
  });
});

Deno.serve(handler);
