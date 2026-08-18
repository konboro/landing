// mydata-submit — drains pending myDATA receipts to AADE.
//
// Replaces the inline POST that invoice_sender.py did on the Stripe webhook
// thread. Decoupling matters: when AADE was slow the old handler timed out,
// Stripe retried the webhook, and the retry filed a SECOND receipt under a new
// AA. That is the origin of all 32 double-filings in the legacy log.
//
// Invocation: pg_cron (or Supabase scheduled functions) every minute, plus an
// on-demand call from the panel. It is safe to run concurrently — mydata_claim
// uses FOR UPDATE SKIP LOCKED.
//
// Auth: service_role only. Callers present the cron secret; there is no user
// context and nothing here is reachable with an anon key (Hard Rule #6).
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient } from '../../_shared/admin.ts';
import { AadeAdapter } from '../../invoicing/aade.ts';
import { checkReceipt } from '../../invoicing/guards.ts';
import type { ReceiptInput, SendMode, TaxProfile } from '../../invoicing/types.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface SubmissionRow {
  id: string;
  series: string;
  aa: number;
  issue_date: string;
  gross_cents: number;
  net_cents: number;
  vat_cents: number;
  currency: string;
  mode: SendMode;
  attempts: number;
  tax_profile: TaxProfile;
}

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  // The worker is not user-facing. A shared secret keeps it that way even if the
  // function is deployed without --no-verify-jwt.
  const expected = Deno.env.get('MYDATA_CRON_SECRET');
  if (expected) {
    const got = req.headers.get('x-cron-secret');
    if (got !== expected) throw new EdgeError('forbidden', 'bad cron secret', 403);
  }

  const admin = adminClient();
  const cfg = await loadConfig(admin);

  if (!cfg.enabled) {
    return json({ skipped: 'mydata.enabled is false', processed: 0 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '25') || 25, 200);

  // Claim only rows created in the CURRENT mode. A dry_run row stays a dry_run
  // row forever — flipping the switch to live never retro-transmits the
  // shadow-mode backlog, which is what makes the cutover safe to rehearse.
  const { data: claimed, error } = await admin
    .rpc('mydata_claim', { p_mode: cfg.mode, p_limit: limit });
  if (error) throw new EdgeError('db_error', error.message, 500);

  const rows = (claimed ?? []) as SubmissionRow[];
  if (rows.length === 0) return json({ processed: 0, mode: cfg.mode });

  const adapter = new AadeAdapter({
    mode: cfg.mode,
    credentials: {
      userId: Deno.env.get('AADE_USER_ID') ?? '',
      subscriptionKey: Deno.env.get('AADE_SUBSCRIPTION_KEY') ?? '',
    },
  });

  let sent = 0, failed = 0, blocked = 0;

  for (const row of rows) {
    const input: ReceiptInput = {
      series: row.series,
      aa: Number(row.aa),
      issueDate: row.issue_date,
      grossCents: row.gross_cents,
      netCents: row.net_cents,
      vatCents: row.vat_cents,
      currency: row.currency,
      tax: row.tax_profile,
    };

    // Controls run before every transmission, not only on the first attempt —
    // config can change between attempts.
    const guard = checkReceipt(input, {
      maxGrossCents: cfg.max_gross_cents,
      floorAa: await seriesFloor(admin, row.series),
    });
    if (!guard.ok) {
      blocked++;
      await settle(admin, row.id, false, {
        error: `blocked by control: ${guard.violations.join('; ')}`,
        // Not retryable: a control violation needs a human, and burning the
        // attempt budget on it only delays them.
        permanent: true,
        request: adapter.render(input),
      });
      continue;
    }

    if (cfg.mode === 'dry_run') {
      // Render, store, and park. Nothing is transmitted, and the row stays
      // visible in the panel next to what the legacy system filed for the same
      // charge — that comparison is the whole point of shadow mode.
      await admin.from('mydata_submissions')
        .update({
          status: 'skipped',
          request_xml: adapter.render(input),
          last_error: 'dry_run: rendered, not transmitted',
        })
        .eq('id', row.id);
      blocked++;
      continue;
    }

    const out = await adapter.send(input);
    if (out.ok) {
      sent++;
      await settle(admin, row.id, true, {
        mark: out.mark, uid: out.uid, auth: out.authCode,
        request: adapter.render(input), response: out.raw,
      });
    } else {
      failed++;
      await settle(admin, row.id, false, {
        error: out.error,
        permanent: !out.retryable,
        request: adapter.render(input),
        response: out.raw,
      });
    }
  }

  return json({ processed: rows.length, sent, failed, blocked, mode: cfg.mode });
});

interface Config {
  enabled: boolean;
  mode: SendMode;
  max_gross_cents: number;
  max_attempts: number;
}

async function loadConfig(admin: SupabaseClient): Promise<Config> {
  const { data } = await admin.from('app_config').select('value').eq('key', 'mydata').maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return {
    enabled: v.enabled === true,
    mode: (v.mode as SendMode) ?? 'dry_run',
    max_gross_cents: Number(v.max_gross_cents ?? 20_000),
    max_attempts: Number(v.max_attempts ?? 8),
  };
}

async function seriesFloor(admin: SupabaseClient, series: string): Promise<number> {
  const { data } = await admin
    .from('mydata_series').select('floor_aa').eq('series', series).maybeSingle();
  return Number(data?.floor_aa ?? 1);
}

async function settle(
  admin: SupabaseClient,
  id: string,
  ok: boolean,
  o: {
    mark?: string; uid?: string; auth?: string;
    error?: string; permanent?: boolean; request?: string; response?: string;
  },
): Promise<void> {
  const { error } = await admin.rpc('mydata_settle', {
    p_id: id,
    p_ok: ok,
    p_mark: o.mark ?? null,
    p_uid: o.uid ?? null,
    p_auth: o.auth ?? null,
    p_error: o.error ?? null,
    p_request: o.request ?? null,
    p_response: o.response ?? null,
  });
  if (error) console.error(`mydata_settle(${id}) failed: ${error.message}`);

  // A permanent failure should not sit in the retry loop pretending it might
  // recover. Park it for a human immediately.
  if (!ok && o.permanent) {
    await admin.from('mydata_submissions').update({ status: 'failed' }).eq('id', id);
  }
}

Deno.serve(handler);
