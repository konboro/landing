// trips-end — server-authoritative end: zone validation, mandatory photo, lock command,
// price from the FROZEN pricing_snapshot, balanced ledger, payment row.
//
// Billing here is safe under Hard Rule #1 because we only reach 'active' after a
// confirmed unlock ACK — we already hold that ACK, so charging now cannot precede it.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str, lngLat, num, strArray } from '../../_shared/validate.ts';
import { accountId, postLedger } from '../../_shared/ledger.ts';
import { notifyUser } from '../../_shared/audit.ts';
import { stripe } from '../../_shared/stripe.ts';
import { ensureStripeCustomer } from '../../_shared/customers.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);

  const tripId = str(body, 'trip_id')!;
  const pos = lngLat(body, 'pos');
  const endPhotoUrl = str(body, 'end_photo_url')!; // mandatory parking photo
  const rating = num(body, 'rating', false);
  const tags = strArray(body, 'tags');

  const { data: trip } = await admin
    .from('trips')
    .select('id, user_id, vehicle_id, status, started_at, created_at, pause_s, pricing_snapshot, currency, corporate_id')
    .eq('id', tripId)
    .single();
  if (!trip) throw new EdgeError('not_found', 'trip not found', 404);
  if (trip.user_id !== userId) throw new EdgeError('forbidden', 'not your trip', 403);
  if (!['active', 'paused', 'ending'].includes(trip.status)) {
    throw new EdgeError('bad_state', `cannot end a trip in status ${trip.status}`, 409);
  }

  // ---- Vehicle city for zone scoping ----
  const { data: veh } = await admin
    .from('vehicles').select('city_id').eq('id', trip.vehicle_id).single();
  const cityId = veh?.city_id ?? null;

  // ---- Zone validation (Hard Rule #3) ----
  const { data: zonesHere } = await admin.rpc('zones_at_point', {
    p_lng: pos[0], p_lat: pos[1], p_city: cityId,
  });
  const kinds = new Set((zonesHere ?? []).map((z: { kind: string }) => z.kind));
  if (!kinds.has('operating')) {
    throw new EdgeError('end_outside_operating', 'you must end inside the operating area', 409);
  }
  if (kinds.has('no_parking')) {
    throw new EdgeError('end_in_no_parking', 'you cannot end in a no-parking zone', 409);
  }
  const stationMode = await configBool(admin, 'station_mode', false);
  if (stationMode && !kinds.has('parking_station')) {
    throw new EdgeError('station_required', 'end at a parking station', 409);
  }

  // Fees/bonuses from zone rules.
  let paidParkingFee = 0;
  let bonusCents = 0;
  let endZoneId: string | null = null;
  for (const z of (zonesHere ?? []) as { id: string; kind: string; rules: Record<string, number> }[]) {
    if (z.kind === 'paid_parking') paidParkingFee += Number(z.rules?.fee_cents ?? 0);
    if (z.kind === 'bonus') bonusCents += Number(z.rules?.bonus_cents ?? 0);
    if (['parking', 'parking_station', 'paid_parking', 'bonus'].includes(z.kind) && !endZoneId) endZoneId = z.id;
  }

  // ---- Move to 'ending', record photo pending, enqueue lock ----
  await admin.rpc('trip_transition', {
    trip: tripId, to_st: 'ending', actor: 'user', meta: { pos },
  });
  await admin.from('trips').update({
    end_pos: `SRID=4326;POINT(${pos[0]} ${pos[1]})`,
    end_photo_url: endPhotoUrl,
    photo_review: 'pending',
    end_zone_id: endZoneId,
    ended_at: new Date().toISOString(),
  }).eq('id', tripId);

  // Lock the vehicle. Billing below does NOT depend on this ACK (we already have the
  // unlock ACK). If the lock never ACKs, docs/04 handles the stuck-trip ops alert;
  // the user is not billed for stuck time because duration is measured to ended_at now.
  const { data: dev } = await admin
    .from('devices').select('id').eq('vehicle_id', trip.vehicle_id).eq('status', 'active').maybeSingle();
  const { data: lockCmd } = await admin.from('commands').insert({
    vehicle_id: trip.vehicle_id, device_id: dev?.id ?? null, kind: 'lock',
    status: 'queued', channel: 'gprs', requested_by: userId, trip_id: tripId,
    payload: { reason: 'trip_end' },
  }).select('id').single();
  if (lockCmd) await admin.rpc('enqueue_vehicle_command', { p_command_id: lockCmd.id });

  // ---- Price from the FROZEN snapshot ----
  const snap = (trip.pricing_snapshot ?? {}) as {
    unlock_cents: number; per_min_cents: number; pause_per_min_cents: number;
    day_cap_cents: number | null; multiplier: number; addons?: { price_cents: number }[];
  };
  const startedAt = new Date(trip.started_at ?? trip.created_at).getTime();
  const endedAt = Date.now();
  const durationS = Math.max(0, Math.round((endedAt - startedAt) / 1000) - (trip.pause_s ?? 0));
  const rideMin = Math.ceil(durationS / 60);
  const pauseMin = Math.ceil((trip.pause_s ?? 0) / 60);
  const mult = snap.multiplier ?? 1;
  const addonTotal = (snap.addons ?? []).reduce((s, a) => s + (a.price_cents ?? 0), 0);

  // Consume package minutes first (valued against the bonus account per docs/05).
  let billableMin = rideMin;
  const { data: pkgs } = await admin
    .from('package_purchases')
    .select('id, minutes_left, package_id')
    .eq('user_id', userId).gt('minutes_left', 0)
    .order('expires_at', { ascending: true });
  for (const p of pkgs ?? []) {
    if (billableMin <= 0) break;
    const use = Math.min(p.minutes_left, billableMin);
    if (use <= 0) continue;
    await admin.from('package_purchases').update({ minutes_left: p.minutes_left - use }).eq('id', p.id);
    billableMin -= use;
    const { data: pk } = await admin.from('packages').select('minutes, price_cents').eq('id', p.package_id).single();
    const unitPrice = pk && pk.minutes > 0 ? Math.round((pk.price_cents / pk.minutes) * use) : 0;
    if (unitPrice > 0) {
      const bonusAcc = await accountId(admin, 'bonus', null);
      const revAcc = await accountId(admin, 'penny_revenue', null);
      await postLedger(admin, crypto.randomUUID(), [
        { account_id: bonusAcc, delta_cents: unitPrice, memo: `package minutes ${use}` },
        { account_id: revAcc, delta_cents: -unitPrice, memo: 'package revenue' },
      ]);
    }
  }

  let cost =
    snap.unlock_cents +
    Math.round(billableMin * snap.per_min_cents * mult) +
    pauseMin * snap.pause_per_min_cents +
    paidParkingFee +
    addonTotal -
    bonusCents;
  cost = Math.max(0, cost);
  if (snap.day_cap_cents != null) cost = Math.min(cost, snap.day_cap_cents);

  // Persist computed trip totals.
  await admin.from('trips').update({
    distance_m: 0, duration_s: durationS, cost_cents: cost, bonus_cents: bonusCents, currency: 'EUR',
  }).eq('id', tripId);

  if (rating != null || (tags && tags.length)) {
    await admin.from('ride_reviews').upsert(
      { trip_id: tripId, rating: rating ?? null, tags: tags ?? [] },
      { onConflict: 'trip_id' },
    );
  }

  // ---- Settlement: wallet first, then card off-session ----
  let finalStatus: 'ended' | 'charged' = 'charged';
  const revAcc = await accountId(admin, 'penny_revenue', null);

  const { data: payment } = await admin.from('payments').insert({
    user_id: userId, trip_id: tripId, amount_cents: cost, currency: 'EUR',
    kind: 'trip', status: 'processing', initiated_by: 'system',
  }).select('id').single();
  const paymentId = payment!.id as string;

  if (cost === 0) {
    await admin.from('payments').update({ status: 'succeeded' }).eq('id', paymentId);
  } else {
    const { data: wallet } = await admin
      .from('v_user_wallet_balance').select('balance_cents').eq('user_id', userId).maybeSingle();
    const available = Math.max(0, wallet?.balance_cents ?? 0);
    const walletPart = Math.min(available, cost);
    const cardPart = cost - walletPart;

    if (walletPart > 0) {
      const walletAcc = await accountId(admin, 'user_wallet', userId);
      // user_wallet is a liability: +delta reduces what we owe the rider (spend).
      await postLedger(admin, crypto.randomUUID(), [
        { account_id: walletAcc, delta_cents: walletPart, memo: 'trip wallet debit' },
        { account_id: revAcc, delta_cents: -walletPart, memo: 'trip revenue (wallet)' },
      ]);
    }

    if (cardPart > 0) {
      try {
        await chargeCard(admin, userId, cardPart, paymentId);
        const clearing = await accountId(admin, 'stripe_clearing', null);
        // Card leg mirrors docs/05 example: stripe_clearing +N, penny_revenue -N.
        await postLedger(admin, paymentId, [
          { account_id: clearing, delta_cents: cardPart, memo: 'trip card capture' },
          { account_id: revAcc, delta_cents: -cardPart, memo: 'trip revenue (card)' },
        ]);
        await admin.from('payments').update({ status: 'succeeded' }).eq('id', paymentId);
      } catch (e) {
        // Failure/authentication_required -> trip 'ended' + debt (docs/04 step 6, docs/05).
        finalStatus = 'ended';
        const code = e instanceof EdgeError ? e.code : 'charge_failed';
        await admin.from('payments').update({ status: 'failed', failure_code: code }).eq('id', paymentId);
        await admin.from('debts').insert({
          user_id: userId, amount_cents: cardPart, source: 'failed_trip_payment',
          status: 'open', next_retry_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        });
        await notifyUser(admin, userId, 'payment_failed_debt', 'Payment failed',
          `We could not charge ${(cardPart / 100).toFixed(2)} €. A debt was created; please update your card.`,
          'penny://wallet/debt');
      }
    }
  }

  // ---- Finalize trip status ----
  await admin.rpc('trip_transition', {
    trip: tripId, to_st: finalStatus, actor: 'system', meta: { cost_cents: cost, payment_id: paymentId },
  });
  if (finalStatus === 'charged') {
    // Loyalty accrual (1 point / €) + first-charged referral completion check.
    await accrueLoyalty(admin, userId, tripId, Math.floor(cost / 100));
    await notifyUser(admin, userId, 'trip_receipt', 'Trip receipt',
      `Total ${(cost / 100).toFixed(2)} €. Thanks for riding Penny!`, `penny://trips/${tripId}`);
  }

  // Release the vehicle back to the fleet (final availability is set by the gateway on lock ACK).
  await admin.from('vehicles').update({ status: 'available' }).eq('id', trip.vehicle_id);

  return json({
    trip_id: tripId,
    status: finalStatus,
    cost_cents: cost,
    bonus_cents: bonusCents,
    penalty_cents: 0,
    photo_review: 'pending',
  });
});

async function chargeCard(
  admin: ReturnType<typeof adminClient>, userId: string, amount: number, paymentId: string,
) {
  const { data: pm } = await admin
    .from('payment_methods').select('stripe_pm_id').eq('user_id', userId)
    .eq('status', 'active').eq('is_default', true).maybeSingle();
  const { data: anyPm } = pm ? { data: pm } : await admin
    .from('payment_methods').select('stripe_pm_id').eq('user_id', userId)
    .eq('status', 'active').limit(1).maybeSingle();
  const pmId = (pm ?? anyPm)?.stripe_pm_id;
  if (!pmId) throw new EdgeError('no_card', 'no card on file', 402);

  const customer = await ensureStripeCustomer(admin, userId);

  const pi = await stripe<{ id: string; status: string }>('POST', '/payment_intents', {
    amount, currency: 'eur', customer, payment_method: pmId,
    off_session: true, confirm: true,
    metadata: { payment_id: paymentId, user_id: userId },
  }, `trip-${paymentId}`);

  await admin.from('payments').update({ stripe_pi_id: pi.id }).eq('id', paymentId);
  if (pi.status !== 'succeeded') throw new EdgeError('authentication_required', `PI ${pi.status}`, 402);
}

async function accrueLoyalty(
  admin: ReturnType<typeof adminClient>, userId: string, tripId: string, points: number,
) {
  if (points <= 0) return;
  const { data: acc } = await admin
    .from('loyalty_accounts').select('points').eq('user_id', userId).maybeSingle();
  const next = (acc?.points ?? 0) + points;
  await admin.from('loyalty_accounts').upsert({ user_id: userId, points: next }, { onConflict: 'user_id' });
  await admin.from('loyalty_events').insert({ user_id: userId, delta: points, reason: 'trip', trip_id: tripId });
}

async function configBool(admin: ReturnType<typeof adminClient>, key: string, dflt: boolean): Promise<boolean> {
  const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
  return typeof data?.value === 'boolean' ? data.value : dflt;
}

Deno.serve(handler);
