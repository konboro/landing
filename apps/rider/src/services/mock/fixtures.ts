// Realistic Thessaloniki seed data for MockRiderApi. Coordinates are [lng, lat].
import type { PricingSnapshot } from '@penny/db-types';
import { OPERATING_CITY } from '@penny/geo';
import type {
  MapVehicle,
  MapZone,
  MapPoi,
  City,
  PackageProduct,
  SubscriptionProduct,
  AddonProduct,
  FaqEntry,
  InboxItem,
  LngLat,
  TripDetail,
  CostBreakdown,
  KycDetail,
} from '../types';

export const THESSALONIKI: City = {
  id: 'city-thessaloniki',
  name: 'Thessaloniki',
  center: OPERATING_CITY.center, // Aristotelous Square
  default_zoom: 14.5,
  station_mode: false,
};

/** Old name kept as an alias so existing imports keep compiling; both now point
 *  at the live operating city. Drop it once nothing references `ATHENS`. */
export const ATHENS = THESSALONIKI;

// One model. The fleet is a single vehicle type, so a mock inventing three
// makes the app look like it supports a range it does not.
const MODEL = 'EFUN Pusa';

// Spread across central Thessaloniki — Aristotelous, the waterfront, Kamara,
// Ladadika, the university, Ano Poli and the railway station.
const seeds: Array<[string, number, number, number]> = [
  // code, lng, lat, soc
  ['PNY-4821', 22.9419, 40.6325, 92],
  ['PNY-1130', 22.9441, 40.6308, 64],
  ['PNY-7742', 22.9484, 40.6265, 38],
  ['PNY-9004', 22.9519, 40.6330, 81],
  ['PNY-2258', 22.9350, 40.6355, 55],
  ['PNY-3391', 22.9601, 40.6318, 27],
  ['PNY-6620', 22.9455, 40.6291, 73],
  ['PNY-8817', 22.9386, 40.6371, 48],
  ['PNY-5043', 22.9540, 40.6247, 88],
  ['PNY-1902', 22.9625, 40.6212, 33],
  ['PNY-7015', 22.9478, 40.6402, 96],
  ['PNY-4477', 22.9290, 40.6440, 61],
  ['PNY-2864', 22.9330, 40.6300, 44],
  ['PNY-9531', 22.9560, 40.6440, 19],
];

export function makeVehicles(): MapVehicle[] {
  return seeds.map(([code, lng, lat, soc], i) => {
    const model = MODEL;
    return {
      vehicle_id: `veh-${code}`,
      code,
      kind: 'scooter',
      model_name: model,
      lng,
      lat,
      soc_pct: soc,
      range_m: Math.round((soc / 100) * 30_000),
      max_speed_kmh: 25,
      reserved_by_me: false,
    };
  });
}

// Simple rectangular-ish polygons (UX only; server is authoritative).
function rect(cx: number, cy: number, w: number, h: number): [number, number][][] {
  const dx = w / 2;
  const dy = h / 2;
  return [
    [
      [cx - dx, cy - dy],
      [cx + dx, cy - dy],
      [cx + dx, cy + dy],
      [cx - dx, cy + dy],
      [cx - dx, cy - dy],
    ],
  ];
}

export function makeZones(): MapZone[] {
  return [
    {
      id: 'zone-operating',
      kind: 'operating',
      name: 'Thessaloniki service area',
      geom: { type: 'Polygon', coordinates: rect(22.9444, 40.6350, 0.05, 0.045) },
      rules: {},
    },
    {
      id: 'zone-parking-aristotelous',
      kind: 'parking',
      name: 'Aristotelous parking',
      geom: { type: 'Polygon', coordinates: rect(22.9419, 40.6326, 0.004, 0.003) },
      rules: {},
    },
    {
      id: 'zone-parking-university',
      kind: 'parking',
      name: 'University parking',
      geom: { type: 'Polygon', coordinates: rect(22.9600, 40.6318, 0.004, 0.003) },
      rules: {},
    },
    {
      id: 'zone-bonus-station',
      kind: 'bonus',
      name: 'Railway station bonus',
      geom: { type: 'Polygon', coordinates: rect(22.9292, 40.6442, 0.005, 0.004) },
      rules: { bonus_cents: 50 },
    },
    {
      id: 'zone-paid-ladadika',
      kind: 'paid_parking',
      name: 'Ladadika paid parking',
      geom: { type: 'Polygon', coordinates: rect(22.9350, 40.6355, 0.004, 0.003) },
      rules: { fee_cents: 80 },
    },
    {
      id: 'zone-noparking-whitetower',
      kind: 'no_parking',
      name: 'White Tower forecourt',
      geom: { type: 'Polygon', coordinates: rect(22.9484, 40.6265, 0.006, 0.0015) },
      rules: {},
    },
    {
      id: 'zone-nogo-port',
      kind: 'no_go',
      name: 'Port restricted area',
      geom: { type: 'Polygon', coordinates: rect(22.9288, 40.6381, 0.006, 0.005) },
      rules: {},
    },
    {
      id: 'zone-speed-anopoli',
      kind: 'speed_limit',
      name: 'Ano Poli slow zone',
      geom: { type: 'Polygon', coordinates: rect(22.9490, 40.6460, 0.008, 0.006) },
      rules: { limit_kmh: 15 },
    },
    {
      id: 'zone-station-navarinou',
      kind: 'parking_station',
      name: 'Navarinou station',
      geom: { type: 'Polygon', coordinates: rect(22.9455, 40.6291, 0.003, 0.002) },
      rules: { station_capacity: 12 },
    },
    // The last two kinds `zone_kind` can hold. They were missing here, so mock
    // mode could never show that the map styled only eight of the ten — a
    // charging station drew as nothing and a rebalancing zone drew as parking.
    {
      id: 'zone-charging-kamara',
      kind: 'charging_station',
      name: 'Kamara charging station',
      geom: { type: 'Polygon', coordinates: rect(22.9519, 40.6330, 0.0025, 0.002) },
      rules: { station_capacity: 8 },
    },
    {
      id: 'zone-rebalancing-west',
      kind: 'rebalancing',
      name: 'West waterfront rebalancing',
      geom: { type: 'Polygon', coordinates: rect(22.9250, 40.6300, 0.008, 0.005) },
      rules: { target_count: 10 },
    },
  ];
}

export function makePois(): MapPoi[] {
  return [
    { id: 'poi-aristotelous', name: 'Aristotelous Square', kind: 'attraction', lng: 22.9419, lat: 40.6325, icon: 'star' },
    { id: 'poi-metro-venizelou', name: 'Venizelou Metro', kind: 'transit', lng: 22.9403, lat: 40.6362, icon: 'transit' },
    { id: 'poi-whitetower', name: 'White Tower', kind: 'attraction', lng: 22.9484, lat: 40.6265, icon: 'star' },
    { id: 'poi-charger-kamara', name: 'Charging station · Kamara', kind: 'charger', lng: 22.9519, lat: 40.6330, icon: 'charge' },
    { id: 'poi-station-stathmos', name: 'Penny station · Railway station', kind: 'station', lng: 22.9292, lat: 40.6442, icon: 'P' },
  ];
}

export const PACKAGES: PackageProduct[] = [
  { id: 'pkg-60', name: '60 minutes', minutes: 60, price_cents: 799, validity_days: 30 },
  { id: 'pkg-150', name: '150 minutes', minutes: 150, price_cents: 1799, validity_days: 30 },
  { id: 'pkg-400', name: '400 minutes', minutes: 400, price_cents: 3999, validity_days: 60 },
];

export const SUBSCRIPTIONS: SubscriptionProduct[] = [
  { id: 'sub-lite', name: 'Penny Lite', price_cents: 499, perk: 'Free unlocks, all rides', active: false },
  { id: 'sub-plus', name: 'Penny Plus', price_cents: 1299, perk: 'Free unlocks + 30 free min/day', active: false },
];

export const ADDONS: AddonProduct[] = [
  { id: 'addon-insurance', name: 'Ride protection', description: 'Damage cover up to €1500 per ride', price_cents: 99, per: 'ride', active: false },
  { id: 'addon-insurance-monthly', name: 'Protection monthly', description: 'Every ride covered, all month', price_cents: 599, per: 'month', active: false },
];

export const FAQ: FaqEntry[] = [
  { id: 'faq-1', question: 'How do I unlock a scooter?', answer: 'Tap Scan, point at the QR code on the handlebar, confirm the price and slide to start. On 2G the unlock can take up to 20 seconds — you are never charged unless the scooter confirms.' },
  { id: 'faq-2', question: 'Where can I park?', answer: 'End your ride inside the service area, in a green parking zone and out of red no-parking areas. A parking photo is required. Bonus zones give you credit.' },
  { id: 'faq-3', question: 'What if the scooter does not unlock?', answer: 'The trip is aborted automatically with zero charge. Try another scooter nearby, or report the problem from the pin.' },
  { id: 'faq-4', question: 'How is the price calculated?', answer: 'An unlock fee plus a per-minute rate, with a daily cap. Pauses are billed at a lower rate. Packages and subscriptions apply automatically before your card.' },
  { id: 'faq-5', question: 'Why a reaction test at night?', answer: 'Between 23:00 and 05:00 we ask for a quick tap test to help keep everyone safe. It takes a few seconds.' },
];

export const INBOX: InboxItem[] = [
  {
    id: 'msg-welcome',
    title: 'Welcome to Penny 🛴',
    body: 'Your first unlock is on us — use code PENNY1 at checkout.',
    deep_link: null,
    read: false,
    created_at: new Date(Date.now() - 3600_000 * 20).toISOString(),
  },
  {
    id: 'msg-bonus',
    title: 'Bonus zone active in Koukaki',
    body: 'Park in the Koukaki bonus zone today and earn €0.50 credit.',
    deep_link: 'penny://map',
    read: false,
    created_at: new Date(Date.now() - 3600_000 * 4).toISOString(),
  },
];

/* ------------------------------ Ride history ------------------------------ */
// A deterministic 15-month ride history. Seeded PRNG (mulberry32) so the demo
// is identical on every reload — no network, no external assets, no surprises.

export const RIDER_CITIES: { id: string; name: string; center: LngLat }[] = [
  { id: 'city-thessaloniki', name: 'Thessaloniki', center: OPERATING_CITY.center },
  { id: 'city-thessaloniki', name: 'Thessaloniki', center: [22.9444, 40.6401] },
  { id: 'city-patras', name: 'Patras', center: [21.7346, 38.2466] },
];

export const RIDE_TAGS = [
  'smooth',
  'clean',
  'fast',
  'comfy',
  'good brakes',
  'wobbly',
  'dirty',
  'weak battery',
  'noisy',
];

export const BASE_PRICING: PricingSnapshot = {
  unlock_cents: 100,
  per_min_cents: 23,
  pause_per_min_cents: 8,
  day_cap_cents: 2500,
  currency: 'EUR',
  multiplier: 1,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Midnight UTC today — anchors every relative timestamp to a stable point. */
function dayAnchor(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0);
}

function walk(rnd: () => number, start: LngLat, points: number): LngLat[] {
  const route: LngLat[] = [start];
  let lng = start[0];
  let lat = start[1];
  let bearing = rnd() * Math.PI * 2;
  for (let i = 0; i < points; i++) {
    bearing += (rnd() - 0.5) * 0.7;
    lng += Math.cos(bearing) * 0.00055;
    lat += Math.sin(bearing) * 0.00042;
    route.push([+lng.toFixed(6), +lat.toFixed(6)]);
  }
  return route;
}

const REJECT_REASONS = [
  'Scooter parked on a pedestrian ramp — blocking access.',
  'Photo too dark to confirm the parking spot.',
  'Scooter left lying on the pavement, not upright.',
];

const STREETS = [
  'Ermou', 'Athinas', 'Stadiou', 'Panepistimiou', 'Praxitelous',
  'Falirou', 'Veikou', 'Skoufa', 'Solonos', 'Adrianou',
];

function money(breakdown: Omit<CostBreakdown, 'total_cents'>): CostBreakdown {
  const total =
    breakdown.unlock_cents +
    breakdown.ride_cents +
    breakdown.pause_cents +
    breakdown.paid_parking_cents +
    breakdown.addon_cents +
    breakdown.penalty_cents -
    breakdown.bonus_cents -
    breakdown.discount_cents -
    breakdown.promo_cents;
  return { ...breakdown, total_cents: Math.max(0, total) };
}

/**
 * 46 finished rides spread over ~15 months, with routes, full cost
 * breakdowns, parking photos + review outcomes, ratings and two disputes.
 */
export function makeHistory(): TripDetail[] {
  const rnd = mulberry32(0x50454e4e); // "PENN"
  const anchor = dayAnchor();
  const out: TripDetail[] = [];
  const codes = seeds.map((s) => s[0]);
  let daysBack = 1;

  for (let i = 0; i < 46; i++) {
    // Irregular but monotonically increasing gaps -> rides in every month.
    daysBack += 2 + Math.floor(rnd() * 12);
    const cityIdx = i % 11 === 3 ? 1 : i % 17 === 5 ? 2 : 0;
    const city = RIDER_CITIES[cityIdx]!;
    const code = codes[(i * 5) % codes.length]!;
    const model = MODEL;

    const startedMs = anchor - daysBack * 86400_000 + Math.floor(rnd() * 10) * 3600_000;
    const duration_s = 240 + Math.floor(rnd() * 1900);
    const pause_s = rnd() < 0.28 ? 60 + Math.floor(rnd() * 420) : 0;
    const moving_s = Math.max(60, duration_s - pause_s);
    const distance_m = Math.round((moving_s / 60) * (180 + rnd() * 160));

    const start: LngLat = [
      +(city.center[0] + (rnd() - 0.5) * 0.02).toFixed(6),
      +(city.center[1] + (rnd() - 0.5) * 0.016).toFixed(6),
    ];
    const route = walk(rnd, start, 18 + Math.floor(rnd() * 26));
    const end = route[route.length - 1]!;

    const multiplier = rnd() < 0.18 ? 1.3 : 1;
    const pricing: PricingSnapshot = { ...BASE_PRICING, multiplier };

    const rideMin = Math.ceil(moving_s / 60);
    const pauseMin = Math.ceil(pause_s / 60);
    const ride_cents = Math.round(rideMin * pricing.per_min_cents * multiplier);
    const pause_cents = pauseMin * pricing.pause_per_min_cents;
    const paid_parking_cents = rnd() < 0.14 ? 80 : 0;
    const addon_insurance = rnd() < 0.2;
    const addon_cents = addon_insurance ? 99 : 0;
    const bonus_cents = rnd() < 0.22 ? 50 : 0;
    const discount_cents = rnd() < 0.15 ? Math.min(ride_cents, 60 + Math.floor(rnd() * 140)) : 0;
    const promoRoll = rnd();
    const promo_code = promoRoll < 0.1 ? 'ATHENS20' : promoRoll < 0.14 ? 'PENNY1' : null;
    const promo_cents = promo_code === 'ATHENS20' ? 60 : promo_code === 'PENNY1' ? 100 : 0;

    // Photo review: mostly fine, a handful rejected (those carry a penalty).
    const reviewRoll = rnd();
    const rejected = i === 6 || i === 19 || i === 31;
    const outcome = rejected
      ? 'rejected'
      : i === 0
        ? 'pending'
        : reviewRoll < 0.22
          ? 'approved'
          : 'auto_ok';
    const penalty_cents = rejected ? 500 : 0;

    const breakdown = money({
      unlock_cents: pricing.unlock_cents,
      ride_cents,
      pause_cents,
      paid_parking_cents,
      addon_cents,
      bonus_cents,
      discount_cents,
      promo_cents,
      penalty_cents,
      currency: 'EUR',
    });

    const disputed = i === 12 || i === 27;
    const rated = i > 1 && rnd() < 0.72;
    const rating = rated ? 3 + Math.floor(rnd() * 3) : null;
    const tagCount = rated ? Math.floor(rnd() * 3) : 0;
    const tags: string[] = [];
    for (let k = 0; k < tagCount; k++) {
      const tag = RIDE_TAGS[Math.floor(rnd() * RIDE_TAGS.length)]!;
      if (!tags.includes(tag)) tags.push(tag);
    }

    const reviewedAt = outcome === 'pending' ? null : new Date(startedMs + duration_s * 1000 + 600_000).toISOString();

    out.push({
      id: `trip-h${String(i).padStart(2, '0')}-${code.toLowerCase()}`,
      vehicle_id: `veh-${code}`,
      vehicle_code: code,
      status: disputed ? 'disputed' : 'charged',
      started_at: new Date(startedMs).toISOString(),
      ended_at: new Date(startedMs + duration_s * 1000).toISOString(),
      duration_s,
      pause_s,
      distance_m,
      soc_pct: 20 + Math.floor(rnd() * 70),
      pricing,
      cost_cents: breakdown.total_cents,
      bonus_cents,
      penalty_cents,
      discount_cents: discount_cents + promo_cents,
      currency: 'EUR',
      start_pos: start,
      end_pos: end,
      route,
      end_photo_url: `mock://photo/parking/${code}-${i}.jpg`,
      photo_review: outcome,
      rating,
      tags,
      group_id: null,
      addon_insurance,
      city_id: city.id,
      city_name: city.name,
      // detail-only
      avg_speed_kmh: +(((distance_m / 1000) / (moving_s / 3600)) || 0).toFixed(1),
      top_speed_kmh: 25,
      breakdown,
      photo_review_info: {
        outcome,
        reason: rejected ? REJECT_REASONS[i % REJECT_REASONS.length]! : null,
        reviewed_at: reviewedAt,
        penalty_cents,
      },
      promo_code,
      dispute: disputed
        ? {
            status: i === 12 ? 'resolved' : 'open',
            reason: i === 12 ? 'Wrong duration' : 'Overcharged',
            created_at: new Date(startedMs + 86400_000).toISOString(),
            resolution: i === 12 ? 'Refunded 2 minutes billed after the lock ACK.' : null,
            refund_cents: i === 12 ? 46 : 0,
          }
        : null,
      rating_editable: rating === null,
      available_tags: RIDE_TAGS,
      start_address: `${STREETS[(i * 3) % STREETS.length]!} ${5 + (i % 60)}, ${city.name}`,
      end_address: `${STREETS[(i * 7 + 4) % STREETS.length]!} ${3 + ((i * 2) % 80)}, ${city.name}`,
    });
  }

  // Newest first — the list and the stats both rely on this ordering.
  return out.sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''));
}

/* ------------------------------- KYC states ------------------------------- */
// Rider-facing counterpart of the admin Sumsub view: only the signed-in
// rider's own state, never anyone else's.

export function makeKycDetail(status: KycDetail['status']): KycDetail {
  const submitted = new Date(dayAnchor() - 6 * 86400_000).toISOString();
  const reviewed = new Date(dayAnchor() - 5 * 86400_000).toISOString();
  const base: KycDetail = {
    status,
    provider: 'sumsub',
    level: 'id-and-liveness',
    applicant_ref: 'usr-••••-4f21',
    submitted_at: submitted,
    reviewed_at: reviewed,
    expires_at: null,
    documents: [
      { kind: 'id_card', label: 'ID card — front', status: 'approved', submitted_at: submitted },
      { kind: 'id_card_back', label: 'ID card — back', status: 'approved', submitted_at: submitted },
      { kind: 'selfie', label: 'Liveness selfie', status: 'approved', submitted_at: submitted },
    ],
    review_answer: 'GREEN',
    reject_reason: null,
    reject_labels: [],
    can_retry: false,
  };

  switch (status) {
    case 'none':
      return {
        ...base,
        applicant_ref: null,
        submitted_at: null,
        reviewed_at: null,
        documents: [],
        review_answer: null,
      };
    case 'pending':
      return {
        ...base,
        reviewed_at: null,
        review_answer: null,
        documents: base.documents.map((d) => ({ ...d, status: 'pending' })),
      };
    case 'rejected':
      return {
        ...base,
        review_answer: 'RETRY',
        reject_reason:
          'The photo of your ID was blurry and the document number could not be read. Please retake it in good light.',
        reject_labels: ['UNSATISFACTORY_PHOTOS', 'DOCUMENT_ILLEGIBLE'],
        can_retry: true,
        documents: [
          { kind: 'id_card', label: 'ID card — front', status: 'rejected', submitted_at: submitted },
          { kind: 'id_card_back', label: 'ID card — back', status: 'approved', submitted_at: submitted },
          { kind: 'selfie', label: 'Liveness selfie', status: 'approved', submitted_at: submitted },
        ],
      };
    case 'expired':
      return {
        ...base,
        expires_at: new Date(dayAnchor() - 86400_000).toISOString(),
        can_retry: true,
        review_answer: 'RETRY',
        reject_reason: 'Your ID document has expired. Verify again with a valid document.',
      };
    default:
      return base;
  }
}
