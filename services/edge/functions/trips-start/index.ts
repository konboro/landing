// trips-start — validate start preconditions, freeze pricing, create trip(unlocking),
// enqueue the unlock command. Idempotent by client_command_id.
//
// Hard Rule #1: we DO NOT charge here. Billing starts only after the gateway reports
// a DOUT unlock ACK (trip -> active); the final charge happens in trips-end. At most a
// pre-auth hold is placed downstream once ACK lands. No ACK => trip aborted, zero charge.
import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser } from '../../_shared/admin.ts';
import { readJson, str, lngLat, bool, distanceMeters } from '../../_shared/validate.ts';

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const userId = await requireUser(req, admin);
  const body = await readJson(req);

  const vehicleCode = str(body, 'vehicle_code')!;
  const clientCommandId = str(body, 'client_command_id')!;
  const pos = lngLat(body, 'pos');
  const addonInsurance = bool(body, 'addon_insurance') ?? false;
  const promoCode = str(body, 'promo_code', false);

  // ---- Idempotency: replay returns the same trip ----
  const { data: existing } = await admin
    .from('trips')
    .select('id, status, pricing_snapshot')
    .eq('client_command_id', clientCommandId)
    .maybeSingle();
  if (existing) {
    return json({ trip_id: existing.id, status: existing.status, pricing_snapshot: existing.pricing_snapshot });
  }

  // ---- Rider eligibility ----
  const { data: user } = await admin
    .from('users')
    .select('id, kyc_status, status')
    .eq('id', userId)
    .single();
  if (!user) throw new EdgeError('not_found', 'user not found', 404);
  if (user.status !== 'active') throw new EdgeError('account_blocked', `account ${user.status}`, 403);
  if (user.kyc_status !== 'approved') throw new EdgeError('kyc_required', 'KYC not approved', 403);

  const { data: openDebts } = await admin
    .from('debts')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['open', 'retrying']);
  if (openDebts && openDebts.length > 0) throw new EdgeError('open_debt', 'settle outstanding debt first', 402);

  const { data: liveTrip } = await admin
    .from('trips')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['reserved', 'unlocking', 'active', 'paused', 'ending'])
    .maybeSingle();
  if (liveTrip) throw new EdgeError('active_trip_exists', 'you already have a live trip', 409);

  // ---- Vehicle state / geofence (server authoritative — Hard Rule #3) ----
  const { data: snapRows } = await admin.rpc('vehicle_snapshot', { p_code: vehicleCode });
  const snap = Array.isArray(snapRows) ? snapRows[0] : snapRows;
  if (!snap) throw new EdgeError('vehicle_not_found', 'unknown vehicle code', 404);
  if (snap.status !== 'available') throw new EdgeError('vehicle_unavailable', `vehicle is ${snap.status}`, 409);
  if (!snap.session_online) throw new EdgeError('vehicle_offline', 'vehicle is offline', 409);

  const lastSeenMs = snap.last_seen ? Date.now() - new Date(snap.last_seen).getTime() : Infinity;
  if (lastSeenMs > 3 * 60 * 1000) throw new EdgeError('vehicle_offline', 'vehicle telemetry stale', 409);

  const minStartSoc = await configNum(admin, 'min_start_soc', 15);
  if ((snap.soc_pct ?? 0) < minStartSoc) throw new EdgeError('low_battery', `SoC below ${minStartSoc}%`, 409);

  if (snap.requires_licence) {
    const { data: doc } = await admin
      .from('user_documents')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', 'driving_licence')
      .maybeSingle();
    if (!doc) throw new EdgeError('licence_required', 'this model requires a licence on file', 403);
  }

  // Rider must be inside an operating zone OR within 150 m of the vehicle.
  const { data: zonesHere } = await admin.rpc('zones_at_point', {
    p_lng: pos[0], p_lat: pos[1], p_city: snap.city_id,
  });
  const inOperating = (zonesHere ?? []).some((z: { kind: string }) => z.kind === 'operating');
  const nearVehicle = snap.lng != null && snap.lat != null
    ? distanceMeters(pos, [snap.lng, snap.lat]) <= 150
    : false;
  if (!inOperating && !nearVehicle) {
    throw new EdgeError('outside_zone', 'you must be in the operating area or next to the vehicle', 409);
  }

  // ---- Payment capability: card, wallet balance, or active package ----
  const [{ data: pm }, { data: wallet }, { data: pkg }] = await Promise.all([
    admin.from('payment_methods').select('id').eq('user_id', userId).eq('status', 'active').limit(1),
    admin.from('v_user_wallet_balance').select('balance_cents').eq('user_id', userId).maybeSingle(),
    admin.from('package_purchases').select('id').eq('user_id', userId).gt('minutes_left', 0).limit(1),
  ]);
  const hasCard = (pm ?? []).length > 0;
  const hasWallet = (wallet?.balance_cents ?? 0) > 0;
  const hasPackage = (pkg ?? []).length > 0;
  if (!hasCard && !hasWallet && !hasPackage) {
    throw new EdgeError('no_payment_method', 'add a card, top up your wallet, or buy a package', 402);
  }

  // ---- Freeze pricing snapshot ----
  const { data: plan } = await admin
    .from('pricing_plans')
    .select('unlock_cents, per_min_cents, pause_per_min_cents, day_cap_cents')
    .eq('city_id', snap.city_id)
    .eq('model_id', snap.model_id)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan) throw new EdgeError('no_pricing', 'no pricing plan for this vehicle', 500);

  const addons: { kind: string; price_cents: number }[] = [];
  if (addonInsurance) {
    const { data: ins } = await admin
      .from('addons').select('kind, price_cents')
      .eq('kind', 'insurance').eq('per', 'trip').eq('active', true).maybeSingle();
    if (ins) addons.push({ kind: 'insurance', price_cents: ins.price_cents });
  }

  const pricingSnapshot = {
    unlock_cents: plan.unlock_cents,
    per_min_cents: plan.per_min_cents,
    pause_per_min_cents: plan.pause_per_min_cents,
    day_cap_cents: plan.day_cap_cents,
    currency: 'EUR',
    multiplier: 1, // demand multiplier resolved here in production; capped at 1.5x
    addons,
    promo_code: promoCode ?? null,
  };

  // ---- Create trip(unlocking) + first trip_event + unlock command ----
  const { data: trip, error: tErr } = await admin
    .from('trips')
    .insert({
      user_id: userId,
      vehicle_id: snap.vehicle_id,
      status: 'unlocking',
      client_command_id: clientCommandId,
      start_pos: `SRID=4326;POINT(${pos[0]} ${pos[1]})`,
      pricing_snapshot: pricingSnapshot,
      currency: 'EUR',
    })
    .select('id')
    .single();
  if (tErr || !trip) {
    if (tErr?.code === '23505') throw new EdgeError('active_trip_exists', 'you already have a live trip', 409);
    throw new EdgeError('trip_create_failed', tErr?.message ?? 'insert failed', 500);
  }

  await admin.from('trip_events').insert({
    trip_id: trip.id, from_status: null, to_status: 'unlocking', actor: 'user',
    meta: { vehicle_code: vehicleCode },
  });

  const { data: cmd } = await admin
    .from('commands')
    .insert({
      vehicle_id: snap.vehicle_id,
      device_id: snap.device_id,
      kind: 'unlock',
      status: 'queued',
      channel: 'gprs',
      requested_by: userId,
      trip_id: trip.id,
      client_command_id: clientCommandId,
      payload: { reason: 'trip_start' },
    })
    .select('id')
    .single();
  if (cmd) await admin.rpc('enqueue_vehicle_command', { p_command_id: cmd.id });

  // Reserve the vehicle so nobody else can start on it.
  await admin.from('vehicles').update({ status: 'in_trip' }).eq('id', snap.vehicle_id);

  return json({ trip_id: trip.id, status: 'unlocking', pricing_snapshot: pricingSnapshot });
});

async function configNum(admin: ReturnType<typeof adminClient>, key: string, dflt: number): Promise<number> {
  const { data } = await admin.from('app_config').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

Deno.serve(handler);
