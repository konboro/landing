// admin-mydata — the panel's window onto myDATA, and the cutover controls.
//
// Replaces weekly_email.py / csv_converter.py: instead of a CSV mailed to one
// address the morning after, the state is queryable, and the things that used to
// be invisible (holes in the series, payments with no receipt, failures with no
// diagnosis) are first-class.
//
// Every mutation writes audit_log (Hard Rule #8). Mode changes require a reason:
// switching to live is the single most consequential button in the panel.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireStaff, requireUser } from '../../_shared/admin.ts';
import { writeAudit } from '../../_shared/audit.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Action =
  | 'summary' | 'list' | 'gaps' | 'missing' | 'issues' | 'daily' | 'duplicates' | 'detail'
  | 'health' | 'for_trips' | 'shadow_compare'
  | 'retry' | 'cancel' | 'set_mode' | 'mark_filed' | 'review'
  | 'ack_issue' | 'ack_gap_range' | 'issue_receipt';

const MUTATIONS: Action[] = [
  'retry', 'cancel', 'set_mode', 'mark_filed', 'review',
  'ack_issue', 'ack_gap_range', 'issue_receipt',
];

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);

  const body = req.method === 'POST'
    ? await req.json().catch(() => ({}))
    : Object.fromEntries(new URL(req.url).searchParams);
  const action = (body.action ?? 'summary') as Action;

  const staff = await requireStaff(
    admin,
    userId,
    MUTATIONS.includes(action) ? 'mydata.manage' : 'mydata.read',
  );

  switch (action) {
    case 'summary':     return json(await summary(admin));
    case 'list':        return json(await list(admin, body));
    case 'gaps':        return json(await gaps(admin, body));
    case 'missing':     return json(await missing(admin));
    case 'issues':      return json(await issues(admin, body));
    case 'daily':       return json(await daily(admin, body));
    case 'duplicates':  return json(await duplicates(admin));
    case 'detail':      return json(await detail(admin, body));
    case 'health':      return json(await health(admin));
    case 'shadow_compare': return json(await shadowCompare(admin, body));
    case 'for_trips':   return json(await forTrips(admin, body));
    case 'retry':       return json(await retry(admin, staff.staff_id, body));
    case 'cancel':      return json(await cancel(admin, staff.staff_id, body));
    case 'set_mode':    return json(await setMode(admin, staff.staff_id, body));
    case 'mark_filed':  return json(await markFiled(admin, staff.staff_id, body));
    case 'review':      return json(await review(admin, staff.staff_id, body));
    case 'ack_issue':     return json(await ackIssue(admin, staff.staff_id, body));
    case 'ack_gap_range': return json(await ackGapRange(admin, staff.staff_id, body));
    case 'issue_receipt': return json(await issueReceipt(admin, staff.staff_id, body));
    default:
      throw new EdgeError('bad_request', `unknown action: ${action}`, 400);
  }
});

async function summary(admin: SupabaseClient) {
  const { data: cfgRow } = await admin
    .from('app_config').select('value').eq('key', 'mydata').maybeSingle();
  const { data: series } = await admin
    .from('mydata_series').select('series, next_aa, floor_aa, active');

  // Counts come from the database, NOT from counting fetched rows.
  //
  // This previously did `select('status, mode, source, gross_cents')` and tallied
  // in JS. PostgREST caps an unbounded select at 1000 rows, so the moment the 20
  // months of imported history landed every figure on the page would have frozen
  // at 1000 — silently, with no error, on a page about tax filings. Exactly the
  // swallowed-failure shape this platform has been bitten by before.
  const statuses = ['pending', 'sending', 'sent', 'failed', 'cancelled', 'skipped'] as const;
  const countOf = async (
    table: string,
    where?: (q: ReturnType<SupabaseClient['from']>) => unknown,
  ): Promise<number> => {
    let q = admin.from(table).select('*', { count: 'exact', head: true });
    if (where) q = where(q) as typeof q;
    const { count, error } = await q;
    if (error) throw new EdgeError('db_error', `${table}: ${error.message}`, 500);
    return count ?? 0;
  };

  const [total, gapCount, missingCount, ...statusCounts] = await Promise.all([
    countOf('mydata_submissions'),
    countOf('v_mydata_series_gaps'),
    countOf('v_mydata_missing'),
    ...statuses.map((s) => countOf('mydata_submissions', (q) => (q as { eq: (a: string, b: string) => unknown }).eq('status', s))),
  ]);

  const byStatus: Record<string, number> = {};
  statuses.forEach((s, i) => { byStatus[s] = statusCounts[i] ?? 0; });

  return {
    config: cfgRow?.value ?? {},
    series: series ?? [],
    totals: { receipts: total, by_status: byStatus },
    gaps: gapCount,
    payments_without_receipt: missingCount,
  };
}

async function list(admin: SupabaseClient, body: Record<string, unknown>) {
  const limit = Math.min(Number(body.limit ?? 100) || 100, 500);
  let q = admin
    .from('mydata_submissions')
    // Deliberately omits request_xml / response_body: a couple of KB each across
    // 20 months of receipts is not something to send to a browser building a
    // table. The detail action fetches them one row at a time.
    .select(
      'id, source, series, aa, issue_date, gross_cents, net_cents, vat_cents, mode, status, mark, ' +
        'attempts, last_error, stripe_charge_id, payment_id, created_at, sent_at, ' +
        'filed_manually, review_note, reviewed_by, reviewed_at',
    )
    .order('aa', { ascending: false })
    .limit(limit);

  if (body.status) q = q.eq('status', String(body.status));
  if (body.mode) q = q.eq('mode', String(body.mode));
  if (body.source) q = q.eq('source', String(body.source));
  if (body.from) q = q.gte('issue_date', String(body.from));
  if (body.to) q = q.lte('issue_date', String(body.to));
  if (body.search) {
    const s = String(body.search);
    q = q.or(`stripe_charge_id.ilike.%${s}%,mark.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { rows: data ?? [] };
}

async function gaps(admin: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await admin
    .from('v_mydata_series_gaps')
    .select('*')
    .order('aa', { ascending: true })
    .limit(Math.min(Number(body.limit ?? 500) || 500, 2000));
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { rows: data ?? [] };
}

async function missing(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('v_mydata_missing').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { rows: data ?? [] };
}

/**
 * Single-row rollup for the dashboard.
 *
 * Separate from `summary` because the dashboard is loaded by roles that have
 * `dashboard.read` but not necessarily `mydata.read` — the caller is expected to
 * treat a 403 here as "hide the tile", not as an error worth showing.
 */
async function health(admin: SupabaseClient) {
  const { data, error } = await admin.from('v_mydata_health').select('*').maybeSingle();
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { health: data };
}

/**
 * Day-by-day coverage comparison for the shadow run: did this platform record
 * the same charges the old pipeline filed?
 */
async function shadowCompare(admin: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await admin
    .from('v_mydata_shadow_compare')
    .select('*')
    .limit(Math.min(Number(body.limit ?? 60) || 60, 400));
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { rows: data ?? [] };
}

/**
 * Receipt state for a page of rides, in one round trip.
 *
 * The rides table renders 25–100 rows; asking per row would be 100 requests for
 * a column. Callers pass the trip ids they are about to draw.
 */
async function forTrips(admin: SupabaseClient, body: Record<string, unknown>) {
  const ids = Array.isArray(body.trip_ids) ? (body.trip_ids as string[]).filter(Boolean) : [];
  if (ids.length === 0) return { rows: [] };
  if (ids.length > 500) throw new EdgeError('bad_request', 'at most 500 trip ids', 400);

  const { data, error } = await admin
    .from('v_mydata_by_payment')
    .select('payment_id, trip_id, user_id, amount_cents, payment_status, submission_id, series, aa, receipt_status, receipt_mode, receipt_state, mark, filed_manually, last_error')
    .in('trip_id', ids);
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { rows: data ?? [] };
}

/** The work queue: everything needing a person, newest and most severe first. */
async function issues(admin: SupabaseClient, body: Record<string, unknown>) {
  let q = admin.from('v_mydata_issues').select('*');
  if (body.kind) q = q.eq('kind', String(body.kind));
  // Reviewed items stay available but are out of the way by default.
  if (body.include_reviewed !== true) q = q.is('reviewed_at', null);

  const { data, error } = await q
    .order('severity', { ascending: true })   // 'high' sorts before 'medium'
    .order('issue_date', { ascending: false })
    .limit(Math.min(Number(body.limit ?? 500) || 500, 2000));
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { rows: data ?? [] };
}

/** The daily rollup that replaces the emailed CSV. */
async function daily(admin: SupabaseClient, body: Record<string, unknown>) {
  let q = admin.from('v_mydata_daily_review').select('*');
  if (body.from) q = q.gte('issue_date', String(body.from));
  if (body.to) q = q.lte('issue_date', String(body.to));
  const { data, error } = await q
    .order('issue_date', { ascending: false })
    .limit(Math.min(Number(body.limit ?? 120) || 120, 400));
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { rows: data ?? [] };
}

async function duplicates(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('v_mydata_duplicates').select('*').order('aa', { ascending: false }).limit(500);
  if (error) throw new EdgeError('db_error', error.message, 500);
  return { rows: data ?? [] };
}

/**
 * Everything about one receipt, including the exact document sent and the exact
 * response. The legacy pipeline overwrote a single `edited_invoice.xml` on every
 * run, so by the time anyone looked at a failure the evidence was gone.
 */
async function detail(admin: SupabaseClient, body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  if (!id) throw new EdgeError('bad_request', 'id is required', 400);

  const { data: row, error } = await admin
    .from('mydata_submissions').select('*').eq('id', id).maybeSingle();
  if (error) throw new EdgeError('db_error', error.message, 500);
  if (!row) throw new EdgeError('not_found', `no submission ${id}`, 404);

  // The payment behind it, when there is one (imported rows have no link).
  let payment = null;
  if (row.payment_id) {
    const { data: p } = await admin
      .from('payments')
      .select('id, user_id, trip_id, amount_cents, currency, kind, status, created_at')
      .eq('id', row.payment_id).maybeSingle();
    payment = p ?? null;
  }

  // What else has been done to this receipt, and by whom.
  const { data: audit } = await admin
    .from('audit_log')
    .select('action, staff_id, reason, created_at')
    .eq('entity', 'mydata_submissions').eq('entity_id', id)
    .order('created_at', { ascending: false }).limit(20);

  return { row, payment, audit: audit ?? [] };
}

/**
 * Record a MARK the employee obtained outside the platform — normally by filing
 * through the AADE portal after a failure. This is the loop the CSV-and-email
 * process had and the first cut of this feature did not: without it a
 * hand-filed receipt stays 'failed' forever and leaves a false hole in the
 * series.
 */
async function markFiled(admin: SupabaseClient, staffId: string, body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  const mark = String(body.mark ?? '').trim();
  const note = String(body.note ?? '').trim();
  if (!id) throw new EdgeError('bad_request', 'id is required', 400);
  if (!/^\d+$/.test(mark)) {
    throw new EdgeError('bad_request', 'a MARK is all digits — copy it from the AADE response', 400);
  }
  if (note.length < 3) {
    throw new EdgeError('bad_request', 'a note is required — say where this MARK came from', 400);
  }

  const { data: before } = await admin
    .from('mydata_submissions').select('*').eq('id', id).maybeSingle();
  if (!before) throw new EdgeError('not_found', `no submission ${id}`, 404);

  const { data: after, error } = await admin.rpc('mydata_mark_filed', {
    p_id: id, p_mark: mark, p_staff: staffId, p_note: note,
  });
  // The function raises on a duplicate MARK or an already-filed receipt; both
  // are user errors, not server faults.
  if (error) throw new EdgeError('conflict', error.message, 409);

  await writeAudit(admin, {
    staff_id: staffId, action: 'mydata.mark_filed', entity: 'mydata_submissions', entity_id: id,
    before, after, reason: note,
  });
  return { ok: true, row: after };
}

/**
 * Record a decision about an issue that has no receipt row — a series gap, or a
 * payment with no submission. Without this the queue's two largest categories
 * could never be dismissed, so it would only ever grow.
 */
async function ackIssue(admin: SupabaseClient, staffId: string, body: Record<string, unknown>) {
  const kind = String(body.kind ?? '');
  const key = String(body.key ?? '');
  const note = String(body.note ?? '').trim();
  if (!kind || !key) throw new EdgeError('bad_request', 'kind and key are required', 400);
  if (note.length < 3) throw new EdgeError('bad_request', 'a note is required — say what was decided', 400);

  const { data, error } = await admin.rpc('mydata_ack_issue', {
    p_kind: kind, p_key: key, p_staff: staffId, p_note: note,
  });
  if (error) throw new EdgeError('db_error', error.message, 500);

  await writeAudit(admin, {
    staff_id: staffId, action: 'mydata.ack_issue', entity: 'mydata_issue', entity_id: key,
    after: data, reason: note,
  });
  return { ok: true, row: data };
}

/**
 * Acknowledge a whole range of gaps at once.
 *
 * The imported history carries 578 of them, including one contiguous block of
 * 538. That is one accountant's decision, not 578 — and a queue that demanded
 * 578 clicks would simply be abandoned.
 */
async function ackGapRange(admin: SupabaseClient, staffId: string, body: Record<string, unknown>) {
  const series = String(body.series ?? '');
  const from = Number(body.from);
  const to = Number(body.to);
  const note = String(body.note ?? '').trim();
  if (!series) throw new EdgeError('bad_request', 'series is required', 400);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new EdgeError('bad_request', 'from and to must be numbers', 400);
  }
  if (to < from) throw new EdgeError('bad_request', `${to} is below ${from}`, 400);
  if (note.length < 3) throw new EdgeError('bad_request', 'a note is required', 400);

  const { data, error } = await admin.rpc('mydata_ack_gap_range', {
    p_series: series, p_from: from, p_to: to, p_staff: staffId, p_note: note,
  });
  if (error) throw new EdgeError('db_error', error.message, 500);

  await writeAudit(admin, {
    staff_id: staffId, action: 'mydata.ack_gap_range', entity: 'mydata_issue',
    entity_id: `gap:${series}:${from}-${to}`, after: { acknowledged: data }, reason: note,
  });
  return { ok: true, acknowledged: Number(data ?? 0) };
}

/**
 * Create the receipt for a payment that never got one — the actual fix for a
 * `no_receipt` issue, as opposed to merely acknowledging it.
 */
async function issueReceipt(admin: SupabaseClient, staffId: string, body: Record<string, unknown>) {
  const paymentId = String(body.payment_id ?? '');
  if (!paymentId) throw new EdgeError('bad_request', 'payment_id is required', 400);

  const { data, error } = await admin.rpc('mydata_issue_receipt', {
    p_payment: paymentId, p_staff: staffId,
  });
  // Already has a receipt, wrong currency, not succeeded — all user errors that
  // deserve their reason rather than a 500.
  if (error) throw new EdgeError('conflict', error.message, 409);

  await writeAudit(admin, {
    staff_id: staffId, action: 'mydata.issue_receipt', entity: 'mydata_submissions',
    entity_id: (data as { id?: string })?.id ?? paymentId, after: data,
    reason: 'issued by hand from the review queue',
  });
  return { ok: true, row: data };
}

/** Acknowledge an issue without changing its filing state. */
async function review(admin: SupabaseClient, staffId: string, body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  const note = String(body.note ?? '').trim();
  if (!id) throw new EdgeError('bad_request', 'id is required', 400);
  if (note.length < 3) throw new EdgeError('bad_request', 'a note is required', 400);

  const { data: before } = await admin
    .from('mydata_submissions').select('*').eq('id', id).maybeSingle();
  if (!before) throw new EdgeError('not_found', `no submission ${id}`, 404);

  const { data: after, error } = await admin.rpc('mydata_review', {
    p_id: id, p_staff: staffId, p_note: note,
  });
  if (error) throw new EdgeError('db_error', error.message, 500);

  await writeAudit(admin, {
    staff_id: staffId, action: 'mydata.review', entity: 'mydata_submissions', entity_id: id,
    before, after, reason: note,
  });
  return { ok: true, row: after };
}

/**
 * Requeue a failed row. Deliberately does NOT allocate a new AA: the receipt
 * keeps the number it was issued, which is what stops a retry from punching
 * another hole in the series.
 */
async function retry(admin: SupabaseClient, staffId: string, body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  if (!id) throw new EdgeError('bad_request', 'id is required', 400);

  const { data: before } = await admin
    .from('mydata_submissions').select('*').eq('id', id).maybeSingle();
  if (!before) throw new EdgeError('not_found', `no submission ${id}`, 404);
  if (before.status === 'sent') {
    throw new EdgeError('conflict', 'already filed at AADE — retrying would double-file it', 409);
  }

  const { data: after, error } = await admin
    .from('mydata_submissions')
    .update({ status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
    .eq('id', id).select().single();
  if (error) throw new EdgeError('db_error', error.message, 500);

  await writeAudit(admin, {
    staff_id: staffId, action: 'mydata.retry', entity: 'mydata_submissions', entity_id: id,
    before, after, reason: (body.reason as string) ?? null,
  });
  return { ok: true, row: after };
}

/** Withdraw a receipt before transmission, retiring its AA on purpose. */
async function cancel(admin: SupabaseClient, staffId: string, body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  const reason = String(body.reason ?? '');
  if (!id) throw new EdgeError('bad_request', 'id is required', 400);
  if (!reason) throw new EdgeError('bad_request', 'a reason is required to cancel a receipt', 400);

  const { data: before } = await admin
    .from('mydata_submissions').select('*').eq('id', id).maybeSingle();
  if (!before) throw new EdgeError('not_found', `no submission ${id}`, 404);
  if (before.status === 'sent') {
    throw new EdgeError(
      'conflict',
      'already filed at AADE — cancelling needs a credit note, not a status change',
      409,
    );
  }

  const { data: after, error } = await admin
    .from('mydata_submissions').update({ status: 'cancelled', last_error: reason })
    .eq('id', id).select().single();
  if (error) throw new EdgeError('db_error', error.message, 500);

  await writeAudit(admin, {
    staff_id: staffId, action: 'mydata.cancel', entity: 'mydata_submissions', entity_id: id,
    before, after, reason,
  });
  return { ok: true, row: after };
}

/**
 * The cutover switch. dry_run → sandbox → live.
 *
 * Existing rows keep the mode they were created under, so this only affects
 * receipts issued from now on. Going back to dry_run is a valid rollback and
 * leaves anything already transmitted alone.
 */
async function setMode(admin: SupabaseClient, staffId: string, body: Record<string, unknown>) {
  const mode = String(body.mode ?? '');
  const reason = String(body.reason ?? '');
  if (!['dry_run', 'sandbox', 'live'].includes(mode)) {
    throw new EdgeError('bad_request', `mode must be dry_run | sandbox | live, got ${mode}`, 400);
  }
  if (!reason) throw new EdgeError('bad_request', 'a reason is required to change mode', 400);

  const { data: row } = await admin
    .from('app_config').select('value').eq('key', 'mydata').maybeSingle();
  const before = (row?.value ?? {}) as Record<string, unknown>;

  // Going live means the platform, not PythonAnywhere, is the system of record.
  // Refuse if the series floor still looks unclaimed — a live run starting below
  // the legacy high-water mark would re-file numbers AADE already has.
  if (mode === 'live') {
    const series = String(before.series ?? 'ΑΠΥ');
    const { data: s } = await admin
      .from('mydata_series').select('next_aa, floor_aa').eq('series', series).maybeSingle();
    if (!s) throw new EdgeError('conflict', `series ${series} is not configured`, 409);
    if (Number(s.next_aa) < Number(s.floor_aa)) {
      throw new EdgeError(
        'conflict',
        `series ${series} would issue AA ${s.next_aa}, below the floor ${s.floor_aa}`,
        409,
      );
    }
  }

  const after = { ...before, mode };
  const { error } = await admin
    .from('app_config').update({ value: after, updated_at: new Date().toISOString() })
    .eq('key', 'mydata');
  if (error) throw new EdgeError('db_error', error.message, 500);

  await writeAudit(admin, {
    staff_id: staffId, action: 'mydata.set_mode', entity: 'app_config', entity_id: 'mydata',
    before, after, reason,
  });
  return { ok: true, config: after };
}

Deno.serve(handler);
