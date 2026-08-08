// Central mock "database" for the Admin panel. Deterministically generated
// so the panel behaves like a real operating Athens fleet without Supabase.
import { Rng } from '@/lib/rng';
import { ATHENS_CENTER, jitterPoint, boxPolygon, buildRoute } from './geoutil';
import { ATHENS_AREAS, RATING_TAGS, type RideExtra } from './history';
import { buildSumsubBundle } from './sumsub';
import { buildUserProfile, buildUserTimeline, buildVehicleTimeline, type ProfileCtx } from './profiles';
import type { LngLat } from '@penny/db-types';
import type {
  City,
  VehicleModel,
  Zone,
  VehicleAlert,
  Command,
  Device,
  OpsTask,
  DamageReport,
  TripEvent,
  Poi,
  FaqItem,
} from '@penny/db-types';
import type {
  BatteryCurve,
  PricingPlan,
  Package,
  Subscription,
  Addon,
  PenaltyCatalogItem,
  PromoCode,
  CustomerGroup,
  PushCampaign,
  LoyaltyTier,
  Referral,
  LedgerAccount,
  LedgerEntry,
  Invoice,
  CorporateAccount,
  StaffMember,
  NotificationRule,
  NotificationLogEntry,
  Translation,
  AppConfigItem,
  Tutorial,
  KpiSnapshot,
  HeatCell,
  RevenueByDay,
  CohortRow,
  FunnelStep,
  DemandCell,
  RideRow,
  VehicleRow,
  CustomerRow,
  ScanLogRow,
  MaintenanceLogRow,
  BatterySwapRow,
  Payment,
  Debt,
  AuditLogEntry,
  SumsubProfileBundle,
  TimelineEvent,
  UserProfileFull,
} from '@/types/domain';

export interface MockDb {
  cities: City[];
  models: VehicleModel[];
  batteryCurves: BatteryCurve[];
  vehicles: VehicleRow[];
  devices: Device[];
  customers: CustomerRow[];
  rides: RideRow[];
  /** Per-ride detail behind the exhaustive user/vehicle ride tables. */
  rideExtras: Record<string, RideExtra>;
  /** Rich customer profiles ("dokładne dane"), keyed by user id. */
  userProfiles: Record<string, UserProfileFull>;
  /** Sumsub applicant bundles, keyed by user id. */
  sumsub: Record<string, SumsubProfileBundle>;
  /** Merged activity timelines, keyed by user id / vehicle id. */
  userTimelines: Record<string, TimelineEvent[]>;
  vehicleTimelines: Record<string, TimelineEvent[]>;
  tripEvents: Record<string, TripEvent[]>;
  payments: Payment[];
  debts: Debt[];
  zones: Zone[];
  zoneVersions: Array<{ version: number; created_at: string; created_by: string; note: string; count: number }>;
  alerts: VehicleAlert[];
  commands: Command[];
  opsTasks: OpsTask[];
  damageReports: DamageReport[];
  staff: StaffMember[];
  kpis: KpiSnapshot;
  ledgerAccounts: LedgerAccount[];
  ledgerEntries: LedgerEntry[];
  invoices: Invoice[];
  corporate: CorporateAccount[];
  notificationRules: NotificationRule[];
  notificationLog: NotificationLogEntry[];
  promos: PromoCode[];
  groups: CustomerGroup[];
  campaigns: PushCampaign[];
  loyalty: LoyaltyTier[];
  referrals: Referral[];
  pois: Poi[];
  pricingPlans: PricingPlan[];
  packages: Package[];
  subscriptions: Subscription[];
  addons: Addon[];
  penalties: PenaltyCatalogItem[];
  translations: Translation[];
  appConfig: AppConfigItem[];
  tutorials: Tutorial[];
  faq: FaqItem[];
  heatCells: HeatCell[];
  revenueByDay: RevenueByDay[];
  cohorts: CohortRow[];
  funnel: FunnelStep[];
  demandCells: DemandCell[];
  scanLog: ScanLogRow[];
  maintenanceLog: MaintenanceLogRow[];
  batterySwaps: BatterySwapRow[];
  auditLog: AuditLogEntry[];
}

const GREEK_FIRST = ['Nikos', 'Maria', 'Giorgos', 'Eleni', 'Kostas', 'Sofia', 'Dimitris', 'Katerina', 'Yannis', 'Anna', 'Petros', 'Ioanna', 'Vasilis', 'Despina', 'Alexis', 'Christina'];
const GREEK_LAST = ['Papadopoulos', 'Nikolaou', 'Georgiou', 'Dimitriou', 'Vasileiou', 'Ioannou', 'Panagiotou', 'Konstantinou', 'Makris', 'Antoniou', 'Petrou', 'Christodoulou'];
const INTL = ['James Carter', 'Emma Wright', 'Lukas Weber', 'Marta Kowalska', 'Ahmed Hassan', 'Yuki Tanaka'];
const ATHENS_STREETS = [
  'Ermou', 'Athinas', 'Stadiou', 'Panepistimiou', 'Akadimias', 'Patission',
  'Syngrou Ave', 'Kifisias Ave', 'Alexandras Ave', 'Vouliagmenis Ave',
  'Mitropoleos', 'Adrianou', 'Voukourestiou', 'Solonos', 'Skoufa', 'Praxitelous',
];

function isoDaysAgo(days: number, rng: Rng): string {
  const ms = Date.now() - days * 86400000 - rng.int(0, 86400000);
  return new Date(ms).toISOString();
}
function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60000).toISOString();
}

let cached: MockDb | null = null;

export function getMockDb(): MockDb {
  if (cached) return cached;
  cached = build();
  return cached;
}

function build(): MockDb {
  const rng = new Rng(20260808);

  /* ---------- Cities ---------- */
  const cities: City[] = [
    { id: 'city-athens', name: 'Athens', tz: 'Europe/Athens', currency: 'EUR', center: { type: 'Point', coordinates: ATHENS_CENTER }, default_zoom: 13 },
    { id: 'city-thess', name: 'Thessaloniki', tz: 'Europe/Athens', currency: 'EUR', center: { type: 'Point', coordinates: [22.9444, 40.6401] }, default_zoom: 13 },
  ];
  const cityName = (id: string | null) => cities.find((c) => c.id === id)?.name ?? '—';

  /* ---------- Models + battery curves ---------- */
  const models: VehicleModel[] = [
    { id: 'model-g30', name: 'Segway Max G30', kind: 'scooter', battery_curve_id: 'bc-g30', max_speed_kmh: 25, deposit_cents: 0, requires_licence: false, photo_url: null },
    { id: 'model-es400', name: 'Okai ES400B', kind: 'scooter', battery_curve_id: 'bc-es400', max_speed_kmh: 25, deposit_cents: 0, requires_licence: false, photo_url: null },
    { id: 'model-ebike', name: 'Penny e-Bike C1', kind: 'ebike', battery_curve_id: 'bc-ebike', max_speed_kmh: 25, deposit_cents: 0, requires_licence: false, photo_url: null },
  ];
  const batteryCurves: BatteryCurve[] = models.map((m) => ({
    id: m.battery_curve_id!,
    model_id: m.id,
    name: `${m.name} curve`,
    points: [
      [33000, 0], [34500, 10], [36000, 25], [37200, 40], [38400, 55], [39600, 70], [40800, 85], [42000, 100],
    ] as Array<[number, number]>,
  }));

  /* ---------- Vehicles + devices ---------- */
  const statuses = ['available', 'available', 'available', 'in_trip', 'in_trip', 'low_battery', 'maintenance', 'offline', 'transport', 'reserved'] as const;
  const vehicles: VehicleRow[] = [];
  const devices: Device[] = [];
  for (let i = 0; i < 24; i++) {
    const model = rng.pick(models);
    const status = i < 20 ? rng.pick(statuses) : rng.pick(['available', 'low_battery', 'offline'] as const);
    const city = rng.bool(0.82) ? cities[0]! : cities[1]!;
    const pos = jitterPoint(city.center.coordinates, 2600, rng);
    const online = status !== 'offline';
    const soc = status === 'low_battery' ? rng.int(5, 19) : status === 'offline' ? rng.int(0, 90) : rng.int(20, 100);
    const id = `veh-${String(i + 1).padStart(3, '0')}`;
    const imei = `86${rng.int(100000000000000, 999999999999999)}`;
    vehicles.push({
      id,
      code: `ATH-${String(1000 + i)}`,
      model_id: model.id,
      status,
      visible: (status as string) !== 'decommissioned',
      plate: null,
      vin: `VIN${rng.int(100000, 999999)}`,
      city_id: city.id,
      notes: rng.bool(0.15) ? 'Rear brake checked' : null,
      created_at: isoDaysAgo(rng.int(60, 400), rng),
      updated_at: isoMinutesAgo(rng.int(1, 300)),
      model_name: model.name,
      city_name: city.name,
      soc_pct: online ? soc : soc,
      last_seen: online ? isoMinutesAgo(rng.int(0, 8)) : isoMinutesAgo(rng.int(35, 900)),
      session_online: online,
      rides_today: rng.int(0, 9),
      idle_hours: status === 'available' ? +rng.float(0.5, 96).toFixed(1) : +rng.float(0, 12).toFixed(1),
      imei,
      lng: pos[0],
      lat: pos[1],
    });
    devices.push({
      id: `dev-${id}`,
      imei,
      iccid: `8930${rng.int(1000000000000000, 9999999999999999)}`,
      phone_number: `+3069${rng.int(10000000, 99999999)}`,
      model: 'fmb930',
      fw_version: rng.pick(['03.28.01', '03.28.03', '03.27.06']),
      vehicle_id: id,
      server_profile: rng.bool(0.7) ? 'penny' : 'atom',
      added_by: 'staff-owner',
      status: 'active',
    });
  }
  // a few bench/faulty devices not linked
  for (let i = 0; i < 4; i++) {
    devices.push({
      id: `dev-bench-${i}`,
      imei: `86${rng.int(100000000000000, 999999999999999)}`,
      iccid: `8930${rng.int(1000000000000000, 9999999999999999)}`,
      phone_number: `+3069${rng.int(10000000, 99999999)}`,
      model: 'fmb930',
      fw_version: '03.28.03',
      vehicle_id: null,
      server_profile: 'penny',
      added_by: 'staff-owner',
      status: rng.pick(['bench', 'faulty'] as const),
    });
  }

  /* ---------- Customers ---------- */
  const customers: CustomerRow[] = [];
  for (let i = 0; i < 60; i++) {
    const useGreek = rng.bool(0.8);
    const name = useGreek ? `${rng.pick(GREEK_FIRST)} ${rng.pick(GREEK_LAST)}` : rng.pick(INTL);
    const kyc = rng.pick(['approved', 'approved', 'approved', 'approved', 'pending', 'pending', 'rejected', 'rejected', 'expired', 'none'] as const);
    const status = rng.bool(0.9) ? 'active' : rng.pick(['blocked', 'shadow_banned'] as const);
    const rides = rng.int(0, 140);
    const debt = rng.bool(0.18) ? rng.int(200, 4500) : 0;
    const city = rng.bool(0.82) ? cities[0]! : cities[1]!;
    customers.push({
      id: `usr-${String(i + 1).padStart(3, '0')}`,
      phone: `+3069${rng.int(10000000, 99999999)}`,
      email: rng.bool(0.85) ? `${name.split(' ')[0]!.toLowerCase()}${i}@example.com` : null,
      full_name: name,
      legacy_atom_user_id: rng.bool(0.6) ? `atom_${rng.int(10000, 99999)}` : null,
      sumsub_applicant_id: kyc !== 'none' ? `sumsub_${rng.int(100000, 999999)}` : null,
      kyc_status: kyc,
      customer_group_id: rng.bool(0.4) ? rng.pick(['grp-loyal', 'grp-new', 'grp-corporate']) : null,
      status,
      blocked_reason: status === 'blocked' ? 'Unpaid debt after 4 retries' : null,
      marketing_consent: rng.bool(0.6),
      tos_accepted_at: isoDaysAgo(rng.int(10, 400), rng),
      privacy_accepted_at: isoDaysAgo(rng.int(10, 400), rng),
      score: rng.int(40, 100),
      emergency_contact: rng.bool(0.3) ? `+3069${rng.int(10000000, 99999999)}` : null,
      created_at: isoDaysAgo(rng.int(1, 400), rng),
      updated_at: isoMinutesAgo(rng.int(1, 4000)),
      // Extended profile ("dokładne dane" — docs/08 Customers).
      date_of_birth: `19${rng.int(65, 99)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
      nationality: useGreek ? 'GR' : rng.pick(['PL', 'DE', 'GB', 'FR', 'IT'] as const),
      gender: rng.pick(['male', 'female', null] as const),
      address_line: `${rng.pick(ATHENS_STREETS)} ${rng.int(1, 180)}`,
      address_city: city.name,
      address_postcode: `1${rng.int(0, 9)}${rng.int(0, 9)} ${rng.int(10, 99)}`,
      address_country: 'GR',
      avatar_url: null, // rendered as an initials avatar; never hotlink
      preferred_lang: useGreek ? 'el' : rng.pick(['en', 'pl'] as const),
      email_verified: rng.bool(0.78),
      phone_verified: true, // phone OTP is the primary auth
      signup_source: rng.pick(['ios', 'android', 'android', 'web', 'referral'] as const),
      signup_city_id: city.id,
      last_active_at: isoDaysAgo(rng.int(0, 45), rng),
      risk_score: status === 'blocked' ? rng.int(60, 95) : rng.int(0, 35),
      tags: [
        ...(rides > 90 ? ['power-user'] : []),
        ...(debt > 0 ? ['has-debt'] : []),
        ...(rng.bool(0.15) ? ['student'] : []),
        ...(rng.bool(0.08) ? ['vip'] : []),
      ],
      internal_notes: rng.bool(0.2) ? 'Called support about a parking penalty; resolved.' : null,
      deleted_at: null,
      rides,
      spend_cents: rides * rng.int(180, 520),
      debt_cents: debt,
      city_name: city.name,
    });
  }

  /* ---------- Rides ----------
     340 rides across 90 days. Every ride carries a full cost breakdown, a
     rating, start/end zone names and a polyline so the per-user and
     per-vehicle history tables + maps have real data to render. */
  const rideStatuses = ['charged', 'charged', 'charged', 'charged', 'charged', 'ended', 'disputed', 'aborted'] as const;
  const RIDE_COUNT = 340;
  const rides: RideRow[] = [];
  const rideExtras: Record<string, RideExtra> = {};
  const tripEvents: Record<string, TripEvent[]> = {};
  const payments: Payment[] = [];
  // Power users get most of the volume so at least a few profiles are deep.
  const heavyRiders = customers.slice(0, 15);
  for (let i = 0; i < RIDE_COUNT; i++) {
    const cust = rng.bool(0.55) ? rng.pick(heavyRiders) : rng.pick(customers);
    const veh = rng.pick(vehicles);
    const status = i < 5 ? 'active' : rng.pick(rideStatuses);
    const startedAt = isoDaysAgo(rng.int(0, 90), rng);
    const durationS = rng.int(180, 2400);
    const distance = Math.round(durationS * rng.float(2.2, 4.4));
    const pauseS = rng.bool(0.22) ? rng.int(30, 400) : 0;
    const endedAt = status === 'active' ? null : new Date(new Date(startedAt).getTime() + (durationS + pauseS) * 1000).toISOString();
    const city = cities.find((c) => c.name === veh.city_name)!;
    const startPos = jitterPoint(city.center.coordinates, 2400, rng);
    const endPos = jitterPoint(city.center.coordinates, 2400, rng);
    const model = models.find((m) => m.id === veh.model_id);
    const perMin = model?.kind === 'ebike' ? 18 : 15;
    const unlock = 100;
    const multiplier = rng.bool(0.2) ? 1.2 : 1;
    const aborted = status === 'aborted';
    const minutesCents = aborted ? 0 : Math.round((durationS / 60) * perMin * multiplier);
    const pauseCents = aborted ? 0 : Math.round((pauseS / 60) * 8);
    const paidParkingCents = !aborted && rng.bool(0.1) ? 200 : 0;
    const cost = aborted ? 0 : unlock + minutesCents + pauseCents + paidParkingCents;
    const penalty = rng.bool(0.08) ? rng.pick([500, 1000]) : 0;
    const photoReview = status === 'active' || aborted ? null : rng.pick(['auto_ok', 'auto_ok', 'auto_ok', 'approved', 'pending', 'rejected'] as const);
    const id = `trip-${String(i + 1).padStart(4, '0')}`;
    const hasDispute = status === 'disputed';
    const discount = rng.bool(0.15) ? rng.pick([50, 100]) : 0;
    const bonus = rng.bool(0.12) ? 100 : 0;
    rides.push({
      id,
      user_id: cust.id,
      vehicle_id: veh.id,
      status,
      group_id: null,
      reserved_at: null,
      started_at: startedAt,
      ended_at: endedAt,
      start_pos: { type: 'Point', coordinates: startPos },
      end_pos: endedAt ? { type: 'Point', coordinates: endPos } : null,
      distance_m: aborted ? 0 : distance,
      duration_s: aborted ? 0 : durationS,
      pause_s: pauseS,
      pricing_snapshot: {
        unlock_cents: unlock, per_min_cents: perMin, pause_per_min_cents: 8,
        day_cap_cents: 2500, currency: 'EUR', multiplier,
      },
      cost_cents: cost,
      discount_cents: discount,
      bonus_cents: bonus,
      penalty_cents: penalty,
      currency: 'EUR',
      end_photo_url: photoReview ? `photo:${id}` : null,
      photo_review: photoReview,
      end_zone_id: null,
      corporate_id: null,
      promo_redemption_id: null,
      created_at: startedAt,
      user_name: cust.full_name ?? '—',
      user_phone: cust.phone,
      vehicle_code: veh.code,
      city_name: veh.city_name,
      has_dispute: hasDispute,
      has_penalty: penalty > 0,
    });

    const rated = !aborted && rng.bool(0.55);
    rideExtras[id] = {
      vehicle_model: veh.model_name,
      rating: rated ? rng.int(2, 5) : null,
      rating_tags: rated ? Array.from(new Set([rng.pick(RATING_TAGS), rng.pick(RATING_TAGS)])).slice(0, rng.int(1, 2)) : [],
      start_zone_name: rng.pick(ATHENS_AREAS),
      end_zone_name: endedAt ? rng.pick(ATHENS_AREAS) : null,
      minutes_cents: minutesCents,
      pause_cents: pauseCents,
      paid_parking_cents: paidParkingCents,
      payment_status: status === 'active' || aborted ? null : status === 'disputed' ? 'succeeded' : rng.bool(0.94) ? 'succeeded' : 'failed',
      route: endedAt ? buildRoute(startPos, endPos, id, 22) : [startPos],
    };

    // events
    const evs: TripEvent[] = [
      { id: `${id}-e1`, trip_id: id, from_status: null, to_status: 'unlocking', at: startedAt, actor: 'user', meta: {} },
      { id: `${id}-e2`, trip_id: id, from_status: 'unlocking', to_status: 'active', at: new Date(new Date(startedAt).getTime() + 6000).toISOString(), actor: 'system', meta: { ack_ms: rng.int(1200, 6000) } },
    ];
    if (endedAt) {
      evs.push({ id: `${id}-e3`, trip_id: id, from_status: 'active', to_status: 'ending', at: new Date(new Date(endedAt).getTime() - 8000).toISOString(), actor: 'user', meta: {} });
      evs.push({ id: `${id}-e4`, trip_id: id, from_status: 'ending', to_status: status === 'aborted' ? 'aborted' : 'ended', at: endedAt, actor: 'system', meta: {} });
      if (status === 'charged') evs.push({ id: `${id}-e5`, trip_id: id, from_status: 'ended', to_status: 'charged', at: new Date(new Date(endedAt).getTime() + 3000).toISOString(), actor: 'system', meta: { amount_cents: cost } });
      if (status === 'disputed') evs.push({ id: `${id}-e5`, trip_id: id, from_status: 'ended', to_status: 'disputed', at: new Date(new Date(endedAt).getTime() + 90000).toISOString(), actor: 'user', meta: { reason: 'wrong_charge' } });
    }
    tripEvents[id] = evs;

    // payment
    if (status === 'charged' || status === 'disputed') {
      payments.push({
        id: `pay-${id}`, user_id: cust.id, trip_id: id, stripe_pi_id: `pi_${rng.int(100000, 999999)}`,
        amount_cents: cost, kind: 'trip',
        status: rideExtras[id]!.payment_status === 'failed' ? 'failed' : 'succeeded',
        failure_code: rideExtras[id]!.payment_status === 'failed' ? 'card_declined' : null,
        initiated_by: 'system', admin_reason: null, created_at: endedAt ?? startedAt,
      });
    }
    if (penalty > 0) {
      payments.push({
        id: `pay-pen-${id}`, user_id: cust.id, trip_id: id, stripe_pi_id: `pi_${rng.int(100000, 999999)}`,
        amount_cents: penalty, kind: 'penalty', status: rng.bool(0.8) ? 'succeeded' : 'failed',
        failure_code: rng.bool(0.8) ? null : 'card_declined', initiated_by: 'admin', admin_reason: 'Bad parking — blocking sidewalk', created_at: endedAt ?? startedAt,
      });
    }
  }
  /* Reconcile the customer roll-ups with the rides we actually generated.
     `rides` / `spend_cents` on CustomerRow are *lifetime* figures: Penny rides
     plus the pre-migration Atom history (only for migrated accounts). The
     Penny-only numbers live in UserProfileFull.stats. */
  const legacyRides: Record<string, number> = {};
  for (const c of customers) {
    const own = rides.filter((r) => r.user_id === c.id && r.status !== 'aborted');
    const pennySpend = own.reduce((s, r) => s + r.cost_cents + r.penalty_cents - r.discount_cents - r.bonus_cents, 0);
    const legacy = c.legacy_atom_user_id ? rng.int(4, 120) : 0;
    legacyRides[c.id] = legacy;
    c.rides = own.length + legacy;
    c.spend_cents = pennySpend + legacy * rng.int(180, 520);
  }

  // extra topups / package / subscription payments
  for (let i = 0; i < 40; i++) {
    const cust = rng.pick(customers);
    const kind = rng.pick(['topup', 'package', 'subscription', 'addon'] as const);
    payments.push({
      id: `pay-x-${i}`, user_id: cust.id, trip_id: null, stripe_pi_id: `pi_${rng.int(100000, 999999)}`,
      amount_cents: kind === 'subscription' ? 999 : kind === 'package' ? rng.pick([500, 900, 1500]) : rng.pick([500, 1000, 2000]),
      kind, status: rng.bool(0.93) ? 'succeeded' : 'failed', failure_code: null, initiated_by: 'user', admin_reason: null,
      created_at: isoDaysAgo(rng.int(0, 30), rng),
    });
  }

  /* ---------- Debts ---------- */
  const debts: Debt[] = customers
    .filter((c) => c.debt_cents > 0)
    .map((c, i) => ({
      id: `debt-${i}`, user_id: c.id, amount_cents: c.debt_cents,
      source: rng.pick(['failed_trip_payment', 'penalty', 'chargeback'] as const),
      status: rng.pick(['open', 'retrying', 'retrying'] as const),
      next_retry_at: isoMinutesAgo(-rng.int(60, 4000)), attempts: rng.int(1, 4), created_at: isoDaysAgo(rng.int(1, 20), rng),
    }));

  /* ---------- Zones ---------- */
  const zc = cities[0]!.center.coordinates;
  const zones: Zone[] = [
    { id: 'zone-op', city_id: 'city-athens', kind: 'operating', geom: { type: 'Polygon', coordinates: boxPolygon(zc, 6000, 5000) }, rules: {}, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Athens operating area' },
    { id: 'zone-park-1', city_id: 'city-athens', kind: 'parking', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 1200, rng), 400, 300, rng) }, rules: {}, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Syntagma parking' },
    { id: 'zone-paid-1', city_id: 'city-athens', kind: 'paid_parking', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 1500, rng), 350, 300, rng) }, rules: { fee_cents: 200 }, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Kolonaki paid' },
    { id: 'zone-station-1', city_id: 'city-athens', kind: 'parking_station', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 900, rng), 120, 90, rng) }, rules: { station_capacity: 12 }, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Monastiraki station' },
    { id: 'zone-charge-1', city_id: 'city-athens', kind: 'charging_station', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 2000, rng), 100, 80, rng) }, rules: {}, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Depot charging' },
    { id: 'zone-nopark-1', city_id: 'city-athens', kind: 'no_parking', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 800, rng), 500, 250, rng) }, rules: {}, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Ermou pedestrian' },
    { id: 'zone-bonus-1', city_id: 'city-athens', kind: 'bonus', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 2600, rng), 600, 500, rng) }, rules: { bonus_cents: 100 }, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Exarcheia rebalance bonus' },
    { id: 'zone-speed-1', city_id: 'city-athens', kind: 'speed_limit', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 1000, rng), 700, 400, rng) }, rules: { limit_kmh: 15 }, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Plaka slow zone' },
    { id: 'zone-nogo-1', city_id: 'city-athens', kind: 'no_go', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 2200, rng), 500, 400, rng) }, rules: {}, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'Acropolis no-go' },
    { id: 'zone-rebal-1', city_id: 'city-athens', kind: 'rebalancing', geom: { type: 'Polygon', coordinates: boxPolygon(jitterPoint(zc, 3000, rng), 900, 700, rng) }, rules: {}, active: true, valid_from: null, valid_to: null, version: 3, created_by: 'staff-owner', name: 'North rebalancing target' },
  ];
  const zoneVersions = [
    { version: 3, created_at: isoDaysAgo(2, rng), created_by: 'Owner', note: 'Added Plaka slow zone', count: zones.length },
    { version: 2, created_at: isoDaysAgo(28, rng), created_by: 'Ops Manager', note: 'Extended operating area north', count: 9 },
    { version: 1, created_at: isoDaysAgo(120, rng), created_by: 'Owner', note: 'Initial Athens zones', count: 7 },
  ];

  /* ---------- Alerts + commands ---------- */
  const alertKinds = ['fall', 'power_cut', 'moved_locked', 'geofence_exit', 'offline', 'low_batt', 'error'] as const;
  const alerts: VehicleAlert[] = [];
  for (let i = 0; i < 18; i++) {
    const veh = rng.pick(vehicles);
    const kind = rng.pick(alertKinds);
    alerts.push({
      id: `alert-${i}`, vehicle_id: veh.id, kind,
      payload: kind === 'moved_locked' ? { displacement_m: rng.int(35, 120) } : kind === 'offline' ? { minutes: rng.int(35, 400) } : kind === 'error' ? { code: rng.pick(['E12', 'E31', 'GPS_LOST']) } : {},
      ack_by: rng.bool(0.5) ? 'staff-owner' : null, ack_at: rng.bool(0.5) ? isoMinutesAgo(rng.int(1, 200)) : null,
      created_at: isoMinutesAgo(rng.int(1, 600)),
    });
  }
  const cmdKinds = ['unlock', 'lock', 'locate', 'reboot', 'ring', 'alarm_on', 'alarm_off'] as const;
  const commands: Command[] = [];
  for (let i = 0; i < 40; i++) {
    const veh = rng.pick(vehicles);
    const dev = devices.find((d) => d.vehicle_id === veh.id)!;
    const sent = isoMinutesAgo(rng.int(1, 3000));
    const cs = rng.pick(['acked', 'acked', 'acked', 'sent', 'failed', 'expired'] as const);
    commands.push({
      id: `cmd-${i}`, vehicle_id: veh.id, device_id: dev.id, kind: rng.pick(cmdKinds), payload: {},
      status: cs, channel: rng.bool(0.85) ? 'gprs' : 'sms', requested_by: rng.pick(['staff-owner', 'staff-ops1']),
      trip_id: null, sent_at: sent, acked_at: cs === 'acked' ? new Date(new Date(sent).getTime() + rng.int(1000, 7000)).toISOString() : null,
      error: cs === 'failed' ? 'no_ack_timeout' : null, created_at: sent,
    });
  }

  /* ---------- Ops tasks ---------- */
  const taskKinds = ['rebalance', 'battery_swap', 'pickup', 'repair', 'inspect', 'deploy'] as const;
  const opsTasks: OpsTask[] = [];
  for (let i = 0; i < 22; i++) {
    const veh = rng.pick(vehicles);
    opsTasks.push({
      id: `task-${i}`, kind: rng.pick(taskKinds), vehicle_id: veh.id, zone_id: rng.bool(0.3) ? 'zone-rebal-1' : null,
      priority: rng.int(1, 5), status: rng.pick(['open', 'open', 'assigned', 'in_progress', 'done'] as const),
      assignee: rng.bool(0.6) ? rng.pick(['staff-ops1', 'staff-ops2']) : null, due_at: isoMinutesAgo(-rng.int(60, 4000)),
      checklist: [
        { key: 'photo_before', label: 'Photo before', required_photo: true, done: rng.bool() },
        { key: 'action', label: 'Complete action', required_photo: false, done: rng.bool() },
        { key: 'photo_after', label: 'Photo after', required_photo: true, done: false },
      ],
      photos: [], notes: rng.bool(0.3) ? 'Reported by rider' : null, created_by: rng.bool(0.5) ? 'system_rule' : 'admin',
      completed_at: null, created_at: isoMinutesAgo(rng.int(30, 5000)),
    });
  }

  /* ---------- Damage reports ---------- */
  const damageReports: DamageReport[] = [];
  for (let i = 0; i < 12; i++) {
    const veh = rng.pick(vehicles);
    damageReports.push({
      id: `dmg-${i}`, vehicle_id: veh.id, reporter: rng.pick(['rider', 'ops', 'admin'] as const),
      user_id: rng.bool(0.5) ? rng.pick(customers).id : null, trip_id: rng.bool(0.4) ? rng.pick(rides).id : null,
      description: rng.pick(['Cracked deck', 'Brake lever loose', 'Flat tyre', 'Missing bell', 'Scratched panel', 'Throttle stuck']),
      photos: [`dmg-photo-${i}-a`, `dmg-photo-${i}-b`], severity: rng.pick(['low', 'medium', 'high', 'critical'] as const),
      status: rng.pick(['new', 'new', 'confirmed', 'fixed', 'rejected'] as const), linked_task_id: null, penalty_payment_id: null,
      created_at: isoDaysAgo(rng.int(0, 20), rng),
    });
  }

  /* ---------- Staff ---------- */
  const staff: StaffMember[] = [
    { id: 'staff-owner', user_id: 'su-owner', name: 'Konstantinos (Owner)', email: 'owner@penny.rent', role: 'owner', city_scope: [], active: true, last_active: isoMinutesAgo(2) },
    { id: 'staff-admin1', user_id: 'su-admin1', name: 'Eleni Admin', email: 'eleni@penny.rent', role: 'admin', city_scope: ['Athens'], active: true, last_active: isoMinutesAgo(24) },
    { id: 'staff-support1', user_id: 'su-sup1', name: 'Giorgos Support', email: 'support@penny.rent', role: 'support', city_scope: ['Athens'], active: true, last_active: isoMinutesAgo(9) },
    { id: 'staff-opsmgr', user_id: 'su-om', name: 'Maria Ops Mgr', email: 'opsmgr@penny.rent', role: 'ops_manager', city_scope: ['Athens', 'Thessaloniki'], active: true, last_active: isoMinutesAgo(41) },
    { id: 'staff-ops1', user_id: 'su-ops1', name: 'Nikos Field', email: 'ops1@penny.rent', role: 'ops', city_scope: ['Athens'], active: true, last_active: isoMinutesAgo(6) },
    { id: 'staff-ops2', user_id: 'su-ops2', name: 'Dimitris Field', email: 'ops2@penny.rent', role: 'ops', city_scope: ['Thessaloniki'], active: true, last_active: isoMinutesAgo(120) },
    { id: 'staff-acct', user_id: 'su-acct', name: 'Sofia Accountant', email: 'finance@penny.rent', role: 'accountant', city_scope: [], active: true, last_active: isoMinutesAgo(300) },
    { id: 'staff-ro', user_id: 'su-ro', name: 'Investor (read-only)', email: 'investor@penny.rent', role: 'readonly', city_scope: [], active: false, last_active: isoDaysAgo(9, rng) },
  ];

  /* ---------- KPIs ---------- */
  const fleetByStatus: Record<string, number> = {};
  for (const v of vehicles) fleetByStatus[v.status] = (fleetByStatus[v.status] ?? 0) + 1;
  const spark = (base: number, jit: number) => Array.from({ length: 7 }, () => Math.round(base + (rng.next() - 0.4) * jit));
  const kpis: KpiSnapshot = {
    active_rides: rides.filter((r) => r.status === 'active').length,
    today_revenue_cents: 84210,
    today_rides: 176,
    new_users_today: 14,
    open_debts_cents: debts.reduce((s, d) => s + d.amount_cents, 0),
    open_debts_count: debts.length,
    unlock_success_pct: 97.4,
    fleet_by_status: fleetByStatus,
    spark_revenue: spark(78000, 26000),
    spark_rides: spark(165, 60),
    spark_users: spark(16, 12),
    spark_unlock: spark(97, 4).map((v) => Math.min(100, v)),
  };

  /* ---------- Ledger ---------- */
  const ledgerAccounts: LedgerAccount[] = [
    { id: 'la-rev', kind: 'penny_revenue', owner_id: null, owner_label: 'Penny revenue', balance_cents: -1284300 },
    { id: 'la-clear', kind: 'stripe_clearing', owner_id: null, owner_label: 'Stripe clearing', balance_cents: 1284300 },
    { id: 'la-debt', kind: 'debt', owner_id: null, owner_label: 'Debt receivable', balance_cents: kpis.open_debts_cents },
    { id: 'la-bonus', kind: 'bonus', owner_id: null, owner_label: 'Bonus / promo pool', balance_cents: -43200 },
    { id: 'la-wallet', kind: 'user_wallet', owner_id: null, owner_label: 'Wallet balances (all users)', balance_cents: 61800 },
    { id: 'la-corp', kind: 'corporate', owner_id: null, owner_label: 'Corporate receivable', balance_cents: 128900 },
  ];
  const ledgerEntries: LedgerEntry[] = [];
  payments.filter((p) => p.status === 'succeeded').slice(0, 80).forEach((p, i) => {
    const txn = `txn-${i}`;
    ledgerEntries.push({ id: `le-${i}-a`, txn_id: txn, account_id: 'la-clear', account_kind: 'stripe_clearing', delta_cents: p.amount_cents, currency: 'EUR', created_at: p.created_at, memo: `${p.kind} capture` });
    ledgerEntries.push({ id: `le-${i}-b`, txn_id: txn, account_id: 'la-rev', account_kind: 'penny_revenue', delta_cents: -p.amount_cents, currency: 'EUR', created_at: p.created_at, memo: `${p.kind} revenue` });
  });

  /* ---------- Invoices + corporate ---------- */
  const corporate: CorporateAccount[] = [
    { id: 'corp-1', name: 'Acme Logistics', billing_email: 'ap@acme.gr', monthly_invoicing: true, member_count: 12, mtd_spend_cents: 48200, stripe_customer_id: 'cus_acme' },
    { id: 'corp-2', name: 'Delphi Tours', billing_email: 'finance@delphi.gr', monthly_invoicing: true, member_count: 5, mtd_spend_cents: 19800, stripe_customer_id: 'cus_delphi' },
    { id: 'corp-3', name: 'University of Athens', billing_email: 'mobility@uoa.gr', monthly_invoicing: false, member_count: 30, mtd_spend_cents: 60900, stripe_customer_id: 'cus_uoa' },
  ];
  const invoices: Invoice[] = [];
  for (let i = 0; i < 30; i++) {
    const corp = rng.bool(0.4);
    invoices.push({
      id: `inv-${i}`, number: `PN-2026-${String(1000 + i)}`,
      user_id: corp ? null : rng.pick(customers).id, corporate_id: corp ? rng.pick(corporate).id : null,
      party_label: corp ? rng.pick(corporate).name : rng.pick(customers).full_name ?? '—',
      amount_cents: rng.int(300, 12000), mydata_mark: rng.bool(0.7) ? `40000${rng.int(1000000, 9999999)}` : null,
      mydata_status: rng.pick(['transmitted', 'transmitted', 'pending', 'failed'] as const),
      issued_at: isoDaysAgo(rng.int(0, 40), rng), pdf_url: `invoice:${i}`,
    });
  }

  /* ---------- Notification rules (seeded from docs/12) ---------- */
  const staffRule = (event_kind: string, label: string, condition: Record<string, unknown>, channels: NotificationRule['channels'], digest: NotificationRule['digest'] = 'none'): NotificationRule => ({
    id: `nr-${event_kind}`, event_kind, label, audience: 'staff', condition, channels, recipients: ['ops', 'owner'], throttle_s: 300, digest, quiet_hours: null, active: true,
  });
  const notificationRules: NotificationRule[] = [
    staffRule('moved_without_rental', 'Vehicle moved without rental', { min_move_m: 30, sustained_s: 60 }, ['email', 'push', 'telegram', 'panel']),
    staffRule('offline_too_long', 'Vehicle offline too long', { min_offline_min: 30 }, ['email', 'telegram'], 'hourly'),
    staffRule('fall_detected', 'Fall detected', { tilt_deg: 60, hold_s: 10 }, ['push', 'panel']),
    staffRule('power_cut', 'Power cut / battery removed', { ext_voltage_mv: 0 }, ['email', 'telegram', 'panel']),
    staffRule('left_operating_zone', 'Left operating zone (no trip)', {}, ['email', 'telegram']),
    staffRule('low_battery', 'Low battery', { soc_lt: 20 }, ['panel'], 'daily'),
    staffRule('no_gps_fix', 'No GPS fix', { sats_lt: 4, min: 15 }, ['panel'], 'daily'),
    staffRule('battery_drain_anomaly', 'Battery drain anomaly', { sigma: 2 }, ['email'], 'daily'),
    staffRule('repeated_unlock_failures', 'Repeated unlock failures', { fails: 3, window_h: 24 }, ['email', 'panel']),
    staffRule('command_failure_spike', 'Command failure spike', { pct: 5, window_min: 15 }, ['telegram', 'panel']),
    staffRule('stuck_trip', 'Stuck trip (no lock ACK)', { min_s: 60 }, ['telegram', 'panel']),
    staffRule('gateway_down', 'Gateway / DB down', {}, ['sms', 'telegram']),
    staffRule('sms_budget', 'SMS budget exceeded', { per_day: 500 }, ['email'], 'daily'),
    staffRule('vandalism_pattern', 'Vandalism pattern', { reports: 2, window_d: 7 }, ['email']),
    staffRule('photo_queue_sla', 'Photo queue SLA breach', { p95_h: 6 }, ['email']),
    staffRule('chargeback_received', 'Chargeback received', {}, ['email', 'panel']),
    staffRule('debt_threshold', 'Open debts over threshold', { total_eur: 500 }, ['email'], 'daily'),
    staffRule('idle_too_long', 'Vehicle idle > 72h', { hours: 72 }, ['panel'], 'daily'),
    { id: 'nr-welcome', event_kind: 'welcome_series', label: 'Rider welcome series', audience: 'rider', condition: { day: 0 }, channels: ['push', 'email'], recipients: ['new_users'], throttle_s: 0, digest: 'none', quiet_hours: { from: '22:00', to: '08:00' }, active: true },
    { id: 'nr-winback', event_kind: 'winback', label: 'Win-back inactive riders', audience: 'rider', condition: { inactive_days: 14 }, channels: ['push', 'email'], recipients: ['inactive'], throttle_s: 0, digest: 'none', quiet_hours: { from: '22:00', to: '08:00' }, active: true },
    { id: 'nr-receipt', event_kind: 'trip_receipt', label: 'Trip receipt', audience: 'rider', condition: {}, channels: ['push', 'inbox'], recipients: ['rider'], throttle_s: 0, digest: 'none', quiet_hours: null, active: true },
    { id: 'nr-debt', event_kind: 'debt_created', label: 'Payment failed → debt', audience: 'rider', condition: {}, channels: ['push', 'email'], recipients: ['rider'], throttle_s: 0, digest: 'none', quiet_hours: null, active: true },
  ];
  const notificationLog: NotificationLogEntry[] = [];
  for (let i = 0; i < 60; i++) {
    const rule = rng.pick(notificationRules);
    notificationLog.push({
      id: `nl-${i}`, rule_id: rule.id, channel: rng.pick(rule.channels), template_key: rule.event_kind,
      target: rule.audience === 'staff' ? 'ops@penny.rent' : rng.pick(customers).phone,
      status: rng.pick(['sent', 'sent', 'sent', 'failed', 'suppressed'] as const), sent_at: isoMinutesAgo(rng.int(1, 6000)),
    });
  }

  /* ---------- Marketing ---------- */
  const promos: PromoCode[] = [
    { id: 'promo-1', code: 'WELCOME5', kind: 'fixed', value: 500, max_uses: 10000, used: 3241, per_user_limit: 1, valid_from: isoDaysAgo(90, rng), valid_to: isoDaysAgo(-60, rng), new_users_only: true, city_id: null, active: true },
    { id: 'promo-2', code: 'SUMMER20', kind: 'percent', value: 20, max_uses: 5000, used: 1180, per_user_limit: 3, valid_from: isoDaysAgo(30, rng), valid_to: isoDaysAgo(-30, rng), new_users_only: false, city_id: 'city-athens', active: true },
    { id: 'promo-3', code: 'FREEMIN10', kind: 'free_minutes', value: 10, max_uses: 2000, used: 640, per_user_limit: 1, valid_from: isoDaysAgo(10, rng), valid_to: isoDaysAgo(-20, rng), new_users_only: false, city_id: null, active: true },
    { id: 'promo-4', code: 'WINTER15', kind: 'percent', value: 15, max_uses: 3000, used: 3000, per_user_limit: 2, valid_from: isoDaysAgo(200, rng), valid_to: isoDaysAgo(120, rng), new_users_only: false, city_id: null, active: false },
  ];
  const groups: CustomerGroup[] = [
    { id: 'grp-loyal', name: 'Loyal riders (50+ rides)', kind: 'rule', rules: [{ field: 'rides', op: '>=', value: '50' }], member_count: customers.filter((c) => c.rides >= 50).length },
    { id: 'grp-new', name: 'New this week', kind: 'rule', rules: [{ field: 'signup', op: 'within_days', value: '7' }], member_count: 14 },
    { id: 'grp-debt', name: 'Has open debt', kind: 'rule', rules: [{ field: 'debt', op: '>', value: '0' }], member_count: customers.filter((c) => c.debt_cents > 0).length },
    { id: 'grp-corporate', name: 'Corporate members', kind: 'manual', rules: [], member_count: 47 },
  ];
  const campaigns: PushCampaign[] = [
    { id: 'camp-1', title: 'Weekend 2x points!', body: 'Ride this weekend, earn double loyalty points.', segment: 'Loyal riders', scheduled_at: isoDaysAgo(-2, rng), sent_count: 0, status: 'scheduled', channel: 'push', open_rate: 0 },
    { id: 'camp-2', title: 'We miss you 🛴', body: 'Here is 30% off your next ride.', segment: 'Inactive 14d', scheduled_at: isoDaysAgo(3, rng), sent_count: 1820, status: 'sent', channel: 'push', open_rate: 22.4 },
    { id: 'camp-3', title: 'Summer newsletter', body: 'New zones and lower prices.', segment: 'All (marketing consent)', scheduled_at: isoDaysAgo(6, rng), sent_count: 8420, status: 'sent', channel: 'email', open_rate: 41.2 },
    { id: 'camp-4', title: 'Draft: NPS ask', body: 'How likely are you to recommend Penny?', segment: '5+ rides', scheduled_at: null, sent_count: 0, status: 'draft', channel: 'push', open_rate: 0 },
  ];
  const loyalty: LoyaltyTier[] = [
    { id: 'ly-1', name: 'Bronze', min_points: 0, perks: ['Standard pricing'] },
    { id: 'ly-2', name: 'Silver', min_points: 500, perks: ['Free unlock Fridays', '5% off'] },
    { id: 'ly-3', name: 'Gold', min_points: 2000, perks: ['Free unlock daily', '10% off', 'Priority support'] },
  ];
  const referrals: Referral[] = [];
  for (let i = 0; i < 18; i++) {
    const a = rng.pick(customers); const b = rng.pick(customers);
    referrals.push({ id: `ref-${i}`, referrer_id: a.id, referrer_name: a.full_name ?? '—', referee_id: b.id, referee_name: b.full_name ?? '—', status: rng.pick(['pending', 'qualified', 'rewarded'] as const), reward_cents: 500, created_at: isoDaysAgo(rng.int(0, 40), rng) });
  }
  const pois: Poi[] = [];
  for (let i = 0; i < 10; i++) {
    pois.push({ id: `poi-${i}`, city_id: 'city-athens', name: rng.pick(['Acropolis', 'Syntagma Sq', 'Monastiraki', 'National Garden', 'Central Market', 'Lycabettus']), kind: rng.pick(['landmark', 'transit', 'partner']), pos: { type: 'Point', coordinates: jitterPoint(zc, 2000, rng) }, icon: '📍', active: rng.bool(0.9) });
  }

  /* ---------- Pricing ---------- */
  const pricingPlans: PricingPlan[] = [];
  for (const city of cities) {
    for (const model of models) {
      pricingPlans.push({
        id: `pp-${city.id}-${model.id}`, city_id: city.id, model_id: model.id,
        unlock_cents: 100, per_min_cents: model.kind === 'ebike' ? 18 : 15, pause_per_min_cents: 8,
        day_cap_cents: 2500, valid_from: isoDaysAgo(60, rng), valid_to: null, active: true,
        dynamic: { happy_hours: [{ dow: 1, from: '10:00', to: '12:00', multiplier: 0.8 }], demand: { enabled: true, cell_size_m: 500, cap: 1.5 } },
      });
    }
  }
  const packages: Package[] = [
    { id: 'pkg-1', name: 'Starter 60 min', minutes: 60, price_cents: 500, validity_days: 30, active: true, sold: 820 },
    { id: 'pkg-2', name: 'Commuter 150 min', minutes: 150, price_cents: 1100, validity_days: 30, active: true, sold: 460 },
    { id: 'pkg-3', name: 'Power 300 min', minutes: 300, price_cents: 1900, validity_days: 60, active: true, sold: 190 },
  ];
  const subscriptions: Subscription[] = [
    { id: 'sub-1', name: 'Penny Plus', stripe_price_id: 'price_plus', price_cents: 999, perks: ['Free unlocks', '10% off minutes'], active: true, active_subs: 340 },
    { id: 'sub-2', name: 'Penny Daily Pass', stripe_price_id: 'price_daily', price_cents: 399, perks: ['30 free minutes/day'], active: true, active_subs: 88 },
  ];
  const addons: Addon[] = [
    { id: 'add-1', name: 'Trip insurance', kind: 'insurance', price_cents: 90, per: 'trip', active: true },
    { id: 'add-2', name: 'Monthly insurance', kind: 'insurance', price_cents: 499, per: 'month', active: true },
    { id: 'add-3', name: 'Helmet reservation', kind: 'helmet', price_cents: 0, per: 'trip', active: false },
  ];
  const penalties: PenaltyCatalogItem[] = [
    { id: 'pen-1', code: 'bad_parking', label: 'Bad parking', tiers_cents: [0, 500, 1000], requires_photo: true, appealable: true, active: true },
    { id: 'pen-2', code: 'no_go_riding', label: 'Riding in no-go zone', tiers_cents: [500, 1000], requires_photo: false, appealable: true, active: true },
    { id: 'pen-3', code: 'abandoned', label: 'Abandoned outside operating zone', tiers_cents: [1000, 2000, 4000], requires_photo: true, appealable: true, active: true },
    { id: 'pen-4', code: 'damage', label: 'Damage (post-review)', tiers_cents: [1000, 3000, 8000], requires_photo: true, appealable: true, active: true },
  ];

  /* ---------- Settings content ---------- */
  const translations: Translation[] = [
    { ns: 'common', key: 'unlock', pl: 'Odblokuj', en: 'Unlock', el: 'Ξεκλείδωμα' },
    { ns: 'common', key: 'end_ride', pl: 'Zakończ', en: 'End ride', el: 'Τέλος' },
    { ns: 'common', key: 'pause', pl: 'Pauza', en: 'Pause', el: 'Παύση' },
    { ns: 'onboarding', key: 'welcome', pl: 'Witaj w Penny', en: 'Welcome to Penny', el: 'Καλώς ήρθες στην Penny' },
    { ns: 'payments', key: 'add_card', pl: 'Dodaj kartę', en: 'Add card', el: 'Προσθήκη κάρτας' },
    { ns: 'errors', key: 'low_battery', pl: 'Niski poziom baterii', en: 'Low battery', el: 'Χαμηλή μπαταρία' },
  ];
  const appConfig: AppConfigItem[] = [
    { key: 'reservation_ttl_min', label: 'Reservation TTL', group: 'Trips', value: 15, kind: 'number', unit: 'min' },
    { key: 'reservation_free_min', label: 'Free reservation minutes', group: 'Trips', value: 10, kind: 'number', unit: 'min' },
    { key: 'min_start_battery', label: 'Minimum start battery', group: 'Trips', value: 15, kind: 'number', unit: '%' },
    { key: 'night_hours_from', label: 'Night hours start', group: 'Safety', value: '23:00', kind: 'time' },
    { key: 'night_hours_to', label: 'Night hours end', group: 'Safety', value: '05:00', kind: 'time' },
    { key: 'reaction_test_required', label: 'Reaction test at night', group: 'Safety', value: true, kind: 'bool' },
    { key: 'photo_ai_threshold', label: 'Photo AI auto-approve threshold', group: 'Verification', value: 0.85, kind: 'number' },
    { key: 'unlock_hold_cents', label: 'Pre-auth hold at unlock', group: 'Payments', value: 500, kind: 'number', unit: '¢' },
    { key: 'offline_alert_min', label: 'Offline alert threshold', group: 'Alerts', value: 30, kind: 'number', unit: 'min' },
    { key: 'moved_alert_m', label: 'Moved-without-rental threshold', group: 'Alerts', value: 30, kind: 'number', unit: 'm' },
  ];
  const tutorials: Tutorial[] = [
    { id: 'tut-main', key: 'main', title: 'Main tutorial', lang: 'en', slides: [{ title: 'Find a scooter', body: 'Open the map and tap a pin.' }, { title: 'Scan & unlock', body: 'Scan the QR to start your ride.' }, { title: 'Park well', body: 'End inside a parking zone and take a photo.' }] },
    { id: 'tut-short', key: 'short', title: 'Short tutorial', lang: 'en', slides: [{ title: 'Quick start', body: 'Scan, ride, park, photo.' }] },
    { id: 'tut-parking', key: 'parking_school', title: 'Parking school', lang: 'en', slides: [{ title: 'Good parking', body: 'Upright, on the edge, not blocking.' }, { title: 'Bad parking', body: 'Blocking sidewalk, lying down, on ramps.' }] },
  ];
  const faq: FaqItem[] = [
    { id: 'faq-1', lang: 'en', question: 'How do I start a ride?', answer: 'Scan the QR code on the scooter.', sort: 1 },
    { id: 'faq-2', lang: 'en', question: 'Where can I park?', answer: 'Inside any parking zone shown on the map.', sort: 2 },
    { id: 'faq-3', lang: 'en', question: 'What if the scooter is damaged?', answer: 'Report it in the app before riding.', sort: 3 },
    { id: 'faq-4', lang: 'el', question: 'Πώς ξεκινάω μια βόλτα;', answer: 'Σκανάρετε τον κωδικό QR.', sort: 1 },
  ];

  /* ---------- Analytics ---------- */
  const heatCells: HeatCell[] = [];
  for (let i = 0; i < 400; i++) {
    const p = jitterPoint(zc, 3200, rng);
    heatCells.push({ lng: p[0], lat: p[1], weight: rng.float(0.1, 1), hour: rng.int(0, 23), dow: rng.int(0, 6), kind: rng.pick(['start', 'end', 'idle'] as const) });
  }
  const revenueByDay: RevenueByDay[] = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    revenueByDay.push({
      date: day, trips_cents: rng.int(45000, 92000), packages_cents: rng.int(3000, 12000),
      subs_cents: rng.int(2000, 6000), penalties_cents: rng.int(500, 4000), rides: rng.int(120, 230),
    });
  }
  const cohorts: CohortRow[] = [];
  for (let m = 0; m < 6; m++) {
    const month = new Date(Date.UTC(2026, 2 + m, 1)).toISOString().slice(0, 7);
    cohorts.push({ cohort: month, size: rng.int(120, 340), ltv_cents: rng.int(1200, 4200), retention: Array.from({ length: 6 - m }, (_, w) => Math.round(100 * Math.pow(0.72, w))) });
  }
  const funnel: FunnelStep[] = [
    { step: 'App install', count: 12800 },
    { step: 'Signup (OTP)', count: 8420 },
    { step: 'KYC approved', count: 6110 },
    { step: 'Card added', count: 5240 },
    { step: 'First ride', count: 4380 },
  ];
  const demandCells: DemandCell[] = [];
  for (let i = 0; i < 12; i++) {
    const p = jitterPoint(zc, 3000, rng);
    demandCells.push({ id: `dc-${i}`, label: `Cell ${String.fromCharCode(65 + i)}`, demand: rng.int(2, 40), supply: rng.int(0, 20), lng: p[0], lat: p[1] });
  }

  /* ---------- Logs ---------- */
  const scanLog: ScanLogRow[] = [];
  for (let i = 0; i < 50; i++) {
    const cust = rng.pick(customers); const veh = rng.pick(vehicles);
    const result = rng.pick(['ok', 'ok', 'ok', 'not_found', 'unavailable'] as const);
    scanLog.push({ id: `scan-${i}`, user_id: cust.id, user_name: cust.full_name ?? '—', vehicle_code_scanned: result === 'not_found' ? `ATH-9${rng.int(100, 999)}` : veh.code, resolved_vehicle_id: result === 'not_found' ? null : veh.id, result, created_at: isoMinutesAgo(rng.int(1, 6000)) });
  }
  const maintenanceLog: MaintenanceLogRow[] = [];
  for (let i = 0; i < 20; i++) {
    const veh = rng.pick(vehicles);
    maintenanceLog.push({ id: `ml-${i}`, vehicle_id: veh.id, vehicle_code: veh.code, task_id: rng.bool(0.5) ? rng.pick(opsTasks).id : null, parts: rng.pick(['Brake pads', 'Inner tube', 'Bell', 'Kickstand', 'Deck grip']), cost_cents: rng.int(300, 4500), notes: 'Routine service', created_at: isoDaysAgo(rng.int(0, 40), rng) });
  }
  const batterySwaps: BatterySwapRow[] = [];
  for (let i = 0; i < 24; i++) {
    const veh = rng.pick(vehicles);
    batterySwaps.push({ id: `bs-${i}`, vehicle_id: veh.id, vehicle_code: veh.code, by_name: rng.pick(['Nikos Field', 'Dimitris Field']), at: isoDaysAgo(rng.int(0, 20), rng), voltage_before: rng.int(33200, 35000), voltage_after: rng.int(41000, 42000) });
  }

  /* ---------- Audit log ---------- */
  const auditLog: AuditLogEntry[] = [];
  const auditActions = [
    { action: 'admin_charge', entity: 'payment', reason: 'Damage penalty — cracked deck' },
    { action: 'refund', entity: 'payment', reason: 'Goodwill — app glitch' },
    { action: 'block_user', entity: 'user', reason: 'Chargeback fraud pattern' },
    { action: 'zone_edit', entity: 'zone', reason: 'Added Plaka slow zone' },
    { action: 'price_change', entity: 'pricing_plan', reason: 'Summer promo pricing' },
    { action: 'command_send', entity: 'vehicle', reason: 'Field recovery' },
    { action: 'debt_write_off', entity: 'debt', reason: 'Uncollectable < 3€' },
  ];
  for (let i = 0; i < 40; i++) {
    const a = rng.pick(auditActions); const s = rng.pick(staff);
    auditLog.push({ id: `audit-${i}`, staff_id: s.id, action: a.action, entity: a.entity, entity_id: rng.uuid().slice(0, 8), before: null, after: {}, reason: a.reason, ip: `10.0.${rng.int(0, 255)}.${rng.int(1, 255)}`, at: isoMinutesAgo(rng.int(1, 20000)) });
  }

  /* ---------- Rich profiles, Sumsub bundles and merged timelines ----------
     Built last: they read from every other collection above. */
  const profileCtx: ProfileCtx = {
    customers, vehicles, rides, rideExtras, payments, debts, referrals, corporate, groups,
    alerts, commands, damage: damageReports, batterySwaps, maintenance: maintenanceLog,
    notifications: notificationLog, scans: scanLog, legacyRides,
  };
  const userProfiles: Record<string, UserProfileFull> = {};
  const sumsub: Record<string, SumsubProfileBundle> = {};
  const userTimelines: Record<string, TimelineEvent[]> = {};
  for (const c of customers) {
    const profile = buildUserProfile(c, profileCtx);
    userProfiles[c.id] = profile;
    sumsub[c.id] = buildSumsubBundle(c, {
      nationality: profile.nationality,
      dob: profile.date_of_birth,
      gender: profile.gender,
      city: profile.address.city,
    });
    userTimelines[c.id] = buildUserTimeline(profile, profileCtx);
  }
  const vehicleTimelines: Record<string, TimelineEvent[]> = {};
  for (const v of vehicles) vehicleTimelines[v.id] = buildVehicleTimeline(v, profileCtx);

  return {
    rideExtras, userProfiles, sumsub, userTimelines, vehicleTimelines,
    cities, models, batteryCurves, vehicles, devices, customers, rides, tripEvents, payments, debts,
    zones, zoneVersions, alerts, commands, opsTasks, damageReports, staff, kpis, ledgerAccounts, ledgerEntries,
    invoices, corporate, notificationRules, notificationLog, promos, groups, campaigns, loyalty, referrals, pois,
    pricingPlans, packages, subscriptions, addons, penalties, translations, appConfig, tutorials, faq,
    heatCells, revenueByDay, cohorts, funnel, demandCells, scanLog, maintenanceLog, batterySwaps, auditLog,
  };
}

// map helpers exposed for pages
export function cityNameOf(db: MockDb, id: string | null): string {
  return db.cities.find((c) => c.id === id)?.name ?? '—';
}
