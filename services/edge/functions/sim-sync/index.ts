// sim-sync — reconcile the local SIM inventory with the connectivity provider.
//
// Pulls the SIM list + daily usage from the provider (Truphone/1GLOBAL today, see
// _shared/simprovider.ts), upserts them into `sims` / `sim_usage_daily`, links each
// SIM to the device whose printed ICCID matches EXACTLY, and appends a `synced`
// row to `sim_events`.
//
// Idempotent by construction:
//   * sims           — conflict target `iccid` (unique)
//   * sim_usage_daily — conflict target (sim_id, day) (unique)
//   * linking        — only fills a NULL link, never re-points an existing one
// Running it twice in a row changes nothing.
//
// Degrades gracefully (Hard Rule: nothing here needs the integration to be wired).
// With no `TRUPHONE_API_TOKEN` the provider reports `live:false, reason:'no_credentials'`;
// this function then still performs the ICCID linking pass over the cached rows and
// returns the same summary shape with zero provider counters.
//
// Read-level permission on purpose: sync only mirrors provider state into our cache,
// it never changes anything AT the provider. Lifecycle changes go through sim-command
// (`sims.manage`, audited).

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str, num } from '../../_shared/validate.ts';
import { getSimProvider, type ProviderSim, type ProviderUsageRow } from '../../_shared/simprovider.ts';

/** How far back to ask for usage when the caller does not say. */
const DEFAULT_USAGE_DAYS = 30;
const MAX_USAGE_DAYS = 120;
/** Update batch size — keeps the number of in-flight PostgREST calls bounded. */
const BATCH = 20;

interface SimRow {
  id: string;
  iccid: string;
  provider_sim_id: string | null;
  status: string;
  device_id: string | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

const handler = withErrors(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);
  await requireStaff(admin, callerId, 'sims.read');

  const body = await readJson(req).catch(() => ({} as Record<string, unknown>));
  const days = Math.min(num(body, 'days', false) ?? DEFAULT_USAGE_DAYS, MAX_USAGE_DAYS);
  const to = str(body, 'to', false) ?? ymd(new Date());
  const from = str(body, 'from', false) ?? ymd(new Date(Date.now() - days * 86400_000));

  const provider = getSimProvider(str(body, 'provider', false) ?? 'truphone');

  /* ---------- what we already know ---------- */
  const { data: existingRows, error: exErr } = await admin
    .from('sims')
    .select('id, iccid, provider_sim_id, status, device_id');
  if (exErr) throw new EdgeError('db_error', exErr.message, 500);

  const byIccid = new Map<string, SimRow>();
  const byProviderId = new Map<string, SimRow>();
  for (const s of (existingRows ?? []) as SimRow[]) {
    byIccid.set(s.iccid, s);
    if (s.provider_sim_id) byProviderId.set(s.provider_sim_id, s);
  }

  /* ---------- pull from the provider ---------- */
  let remoteSims: ProviderSim[] = [];
  let remoteUsage: ProviderUsageRow[] = [];
  if (provider.live) {
    remoteSims = await provider.listSims();
    remoteUsage = await provider.getUsage(from, to);
  }

  /* ---------- upsert sims ---------- */
  const now = new Date().toISOString();
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: string; patch: Record<string, unknown> }> = [];

  for (const r of remoteSims) {
    const existing = byIccid.get(r.iccid);

    // Only carry over the fields the provider actually told us about — a null in the
    // payload means "not reported", never "clear our value".
    const patch: Record<string, unknown> = { updated_at: now };
    if (r.imsi !== null) patch.imsi = r.imsi;
    if (r.msisdn !== null) patch.msisdn = r.msisdn;
    if (r.provider_sim_id !== null) patch.provider_sim_id = r.provider_sim_id;
    if (r.status !== null) patch.status = r.status;
    if (r.plan_name !== null) patch.plan_name = r.plan_name;
    if (r.plan_data_mb !== null) patch.plan_data_mb = r.plan_data_mb;
    if (r.cycle_start !== null) patch.cycle_start = r.cycle_start;
    if (r.cycle_end !== null) patch.cycle_end = r.cycle_end;
    if (r.monthly_cost_cents !== null) patch.monthly_cost_cents = r.monthly_cost_cents;
    if (r.last_seen_at !== null) patch.last_seen_at = r.last_seen_at;
    if (r.network !== null) patch.network = r.network;
    if (r.country !== null) patch.country = r.country;

    // Lifecycle timestamps follow the status the provider reports.
    if (r.status === 'active' && existing?.status !== 'active') patch.activated_at = now;
    if (r.status === 'suspended' && existing?.status !== 'suspended') patch.suspended_at = now;
    if (r.status === 'terminated' && existing?.status !== 'terminated') patch.terminated_at = now;

    if (existing) {
      toUpdate.push({ id: existing.id, patch });
    } else {
      // Uniform key set across the bulk insert — PostgREST derives the column list
      // from the payload, so every row must carry every key.
      toInsert.push({
        iccid: r.iccid, // exact text — Hard Rule #10
        provider: provider.name,
        status: r.status ?? 'inventory',
        imsi: r.imsi,
        msisdn: r.msisdn,
        provider_sim_id: r.provider_sim_id,
        plan_name: r.plan_name,
        plan_data_mb: r.plan_data_mb,
        cycle_start: r.cycle_start,
        cycle_end: r.cycle_end,
        monthly_cost_cents: r.monthly_cost_cents ?? 0,
        last_seen_at: r.last_seen_at,
        network: r.network,
        country: r.country,
        activated_at: patch.activated_at ?? null,
        suspended_at: patch.suspended_at ?? null,
        terminated_at: patch.terminated_at ?? null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  let simsCreated = 0;
  if (toInsert.length > 0) {
    const { data, error } = await admin
      .from('sims')
      .upsert(toInsert, { onConflict: 'iccid', ignoreDuplicates: false })
      .select('id, iccid, provider_sim_id, status, device_id');
    if (error) throw new EdgeError('db_error', `sims insert: ${error.message}`, 500);
    for (const s of (data ?? []) as SimRow[]) {
      byIccid.set(s.iccid, s);
      if (s.provider_sim_id) byProviderId.set(s.provider_sim_id, s);
    }
    simsCreated = (data ?? []).length;
  }

  let simsUpdated = 0;
  const updateErrors: string[] = [];
  await inBatches(toUpdate, BATCH, async (u) => {
    const { error } = await admin.from('sims').update(u.patch).eq('id', u.id);
    if (error) updateErrors.push(error.message);
    else simsUpdated++;
  });
  if (updateErrors.length > 0) {
    console.error(`sim-sync: ${updateErrors.length} sim updates failed, first: ${updateErrors[0]}`);
  }

  /* ---------- upsert usage ---------- */
  const usageRows: Record<string, unknown>[] = [];
  const dedupe = new Set<string>();
  let usageUnmatched = 0;
  for (const u of remoteUsage) {
    const sim = (u.iccid ? byIccid.get(u.iccid) : undefined) ??
      (u.provider_sim_id ? byProviderId.get(u.provider_sim_id) : undefined);
    if (!sim) {
      usageUnmatched++;
      continue;
    }
    const key = `${sim.id}:${u.day}`;
    if (dedupe.has(key)) continue; // provider split one day across records
    dedupe.add(key);
    usageRows.push({
      sim_id: sim.id,
      day: u.day,
      data_mb: u.data_mb,
      sms_out: u.sms_out,
      sms_in: u.sms_in,
      cost_cents: u.cost_cents,
      network: u.network,
      country: u.country,
    });
  }

  let usageWritten = 0;
  for (let i = 0; i < usageRows.length; i += 500) {
    const chunk = usageRows.slice(i, i + 500);
    const { error } = await admin
      .from('sim_usage_daily')
      .upsert(chunk, { onConflict: 'sim_id,day', ignoreDuplicates: false });
    if (error) throw new EdgeError('db_error', `sim_usage_daily upsert: ${error.message}`, 500);
    usageWritten += chunk.length;
  }

  /* ---------- auto-link SIM <-> device on an EXACT ICCID match ----------
     Hard Rule #10: the comparison is on the stored text, byte for byte. A SIM
     whose ICCID does not appear on any device is simply left unlinked; we never
     fuzzy-match (a trimmed or re-spaced ICCID would link the wrong scooter). */
  const { data: unlinked, error: ulErr } = await admin
    .from('sims')
    .select('id, iccid, device_id')
    .is('device_id', null);
  if (ulErr) throw new EdgeError('db_error', ulErr.message, 500);

  let linked = 0;
  const candidates = (unlinked ?? []) as Array<{ id: string; iccid: string }>;
  await inBatches(candidates, BATCH, async (s) => {
    const { data: dev } = await admin
      .from('devices')
      .select('id, sim_id')
      .eq('iccid', s.iccid)
      .maybeSingle();
    if (!dev) return;
    const { error: e1 } = await admin
      .from('sims')
      .update({ device_id: dev.id, updated_at: now })
      .eq('id', s.id)
      .is('device_id', null);
    if (e1) return;
    if (!dev.sim_id) {
      await admin.from('devices').update({ sim_id: s.id, updated_at: now }).eq('id', dev.id).is('sim_id', null);
    }
    linked++;
    await admin.from('sim_events').insert({
      sim_id: s.id,
      kind: 'linked',
      detail: { device_id: dev.id, matched_on: 'iccid', source: 'sim-sync' },
    });
  });

  // Devices that already carry the ICCID but whose sim_id was never filled in.
  const { data: orphanDevices } = await admin
    .from('devices')
    .select('id, iccid')
    .is('sim_id', null)
    .not('iccid', 'is', null);
  await inBatches((orphanDevices ?? []) as Array<{ id: string; iccid: string }>, BATCH, async (d) => {
    const sim = byIccid.get(d.iccid);
    if (!sim) return;
    const { error } = await admin
      .from('devices')
      .update({ sim_id: sim.id, updated_at: now })
      .eq('id', d.id)
      .is('sim_id', null);
    if (!error) linked++;
  });

  /* ---------- sim_events: one `synced` row per SIM the provider returned ---------- */
  if (remoteSims.length > 0) {
    const events = remoteSims
      .map((r) => {
        const sim = byIccid.get(r.iccid);
        if (!sim) return null;
        return {
          sim_id: sim.id,
          kind: 'synced',
          detail: {
            provider: provider.name,
            live: true,
            status: r.status,
            network: r.network,
            country: r.country,
            last_seen_at: r.last_seen_at,
            window: { from, to },
          },
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    for (let i = 0; i < events.length; i += 500) {
      const { error } = await admin.from('sim_events').insert(events.slice(i, i + 500));
      if (error) console.error(`sim-sync: sim_events insert failed: ${error.message}`);
    }
  }

  return json({
    live: provider.live,
    ...(provider.live ? {} : { reason: provider.reason }),
    provider: provider.name,
    window: { from, to },
    sims_seen: remoteSims.length,
    sims_created: simsCreated,
    sims_updated: simsUpdated,
    sims_failed: updateErrors.length,
    usage_rows: usageWritten,
    usage_unmatched: usageUnmatched,
    linked,
  });
});

Deno.serve(handler);
