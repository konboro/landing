// mydata-shadow — records live Stripe charges for comparison, transmits nothing.
//
// This is the stage that actually proves the receiving path: real traffic, real
// amounts, real documents, while PythonAnywhere stays the system of record and
// this side sends nothing to AADE. See docs/18-mydata.md §6.
//
// It listens to `charge.succeeded`, which is exactly what the legacy Flask app
// listened to — so the two systems are being fed the same event, and any
// difference in what they record is a difference worth knowing about.
//
// Deliberately NOT part of payments-webhook: that function resolves the charge
// to a `payments` row and ignores anything it does not recognise, and the riders
// behind these charges do not exist in this database. Writing them to `payments`
// would mean inventing users.
//
// Nothing here can reach AADE. mydata_record_shadow writes mode='dry_run' with a
// terminal status, into a series no worker claims. This file never imports the
// transport at all — only the document builder.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors } from '../../_shared/responses.ts';
import { adminClient } from '../../_shared/admin.ts';
import { verifyStripeSignature } from '../../_shared/stripe.ts';
import { buildInvoicesDoc } from '../../invoicing/xml.ts';
import type { TaxProfile } from '../../invoicing/types.ts';

interface ShadowRow {
  id: string;
  series: string;
  aa: number;
  issue_date: string;
  gross_cents: number;
  net_cents: number;
  vat_cents: number;
  currency: string;
  tax_profile: TaxProfile;
  request_xml: string | null;
}

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  const secret = Deno.env.get('STRIPE_SHADOW_WEBHOOK_SECRET');

  // Fail *quietly* rather than loudly. A 4xx or 5xx makes Stripe retry for days
  // and eventually disable the endpoint; a 200 with a reason keeps the dashboard
  // clean and leaves the evidence in the logs. The visible symptom of a
  // misconfiguration is an empty shadow series, which the panel shows plainly.
  if (!secret) {
    console.error('mydata-shadow: STRIPE_SHADOW_WEBHOOK_SECRET is not set — ignoring delivery');
    return json({ received: true, skipped: 'not configured' });
  }
  if (!sig) {
    console.error('mydata-shadow: no stripe-signature header — ignoring delivery');
    return json({ received: true, skipped: 'unsigned' });
  }
  const check = await verifyStripeSignature(raw, sig, secret);
  if (!check.ok) {
    // The reason is logged, never returned — Stripe's delivery view is visible
    // to anyone with dashboard access, and an unauthenticated caller should not
    // learn why it failed. Read it in the Supabase function logs instead.
    console.error(
      `mydata-shadow: signature rejected (${check.reason})${check.detail ? ` — ${check.detail}` : ''}`,
    );
    return json({ code: 'bad_signature', message: 'invalid Stripe signature', status: 400 }, 400);
  }

  const event = JSON.parse(raw) as {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };

  if (event.type !== 'charge.succeeded') {
    // Acknowledge everything else so Stripe stops trying.
    return json({ received: true, ignored: event.type });
  }

  const charge = event.data.object;
  const chargeId = String(charge.id ?? '');
  const amount = Number(charge.amount ?? 0);
  const currency = String(charge.currency ?? 'eur').toUpperCase();
  const created = Number(charge.created ?? 0);

  if (!chargeId || amount <= 0) {
    return json({ received: true, skipped: 'no charge id or amount' });
  }
  if (currency !== 'EUR') {
    return json({ received: true, skipped: `currency ${currency}` });
  }

  // Stripe timestamps are epoch seconds, UTC. The legacy pipeline dated receipts
  // from this same field, so the comparison lines up day for day.
  const issueDate = new Date(created * 1000).toISOString().slice(0, 10);
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;

  const admin = adminClient();

  const { data: row, error } = await admin.rpc('mydata_record_shadow', {
    p_charge_id: chargeId,
    p_pi_id: piId,
    p_gross: amount,
    p_issue_date: issueDate,
    p_currency: 'EUR',
  });
  if (error) {
    console.error(`mydata-shadow: record failed for ${chargeId}: ${error.message}`);
    // 500 so Stripe retries — losing a charge silently is the one outcome that
    // would make the comparison lie.
    return json({ code: 'db_error', message: error.message, status: 500 }, 500);
  }

  const saved = row as ShadowRow | null;
  if (!saved) return json({ received: true, skipped: 'not recorded' });

  // Render the document against the number it was actually given, and store it.
  // This is the artefact the whole exercise exists to produce — without it there
  // is nothing to hold up against what the old system filed.
  //
  // Done here rather than by the worker on purpose: the worker is the thing that
  // talks to AADE, and a shadow receipt should never pass through it.
  if (!saved.request_xml) {
    try {
      const xml = buildInvoicesDoc({
        series: saved.series,
        aa: Number(saved.aa),
        issueDate: saved.issue_date,
        grossCents: saved.gross_cents,
        netCents: saved.net_cents,
        vatCents: saved.vat_cents,
        currency: saved.currency,
        tax: saved.tax_profile,
      });
      await admin.from('mydata_submissions').update({ request_xml: xml }).eq('id', saved.id);
    } catch (e) {
      // The receipt is recorded either way; a row with no document is visible and
      // fixable, and is a far better outcome than dropping the charge.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`mydata-shadow: could not render ${saved.series} ${saved.aa}: ${msg}`);
      await admin.from('mydata_submissions')
        .update({ last_error: `shadow: recorded, document could not be built — ${msg}` })
        .eq('id', saved.id);
    }
  }

  return json({ received: true, series: saved.series, aa: saved.aa });
});

Deno.serve(handler);
