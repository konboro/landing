// Realistic Athens seed data for MockRiderApi. Coordinates are [lng, lat].
import type { PricingSnapshot } from '@penny/db-types';
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

export const ATHENS: City = {
  id: 'city-athens',
  name: 'Athens',
  center: [23.7275, 37.9838], // Syntagma
  default_zoom: 14.5,
  station_mode: false,
};

const MODELS = ['Penny One', 'Penny Max', 'Penny City'] as const;

// A spread of scooters around central Athens (Syntagma, Monastiraki,
// Kolonaki, Plaka, Koukaki, Exarcheia).
const seeds: Array<[string, number, number, number]> = [
  // code, lng, lat, soc
  ['PNY-4821', 23.7268, 37.9755, 92],
  ['PNY-1130', 23.7241, 37.9762, 64],
  ['PNY-7742', 23.7302, 37.9788, 38],
  ['PNY-9004', 23.7350, 37.9812, 81],
  ['PNY-2258', 23.7208, 37.9808, 55],
  ['PNY-3391', 23.7181, 37.9765, 27],
  ['PNY-6620', 23.7325, 37.9861, 73],
  ['PNY-8817', 23.7290, 37.9902, 48],
  ['PNY-5043', 23.7360, 37.9760, 88],
  ['PNY-1902', 23.7230, 37.9840, 33],
  ['PNY-7015', 23.7195, 37.9880, 96],
  ['PNY-4477', 23.7410, 37.9835, 61],
  ['PNY-2864', 23.7255, 37.9700, 44],
  ['PNY-9531', 23.7150, 37.9820, 19],
];

export function makeVehicles(): MapVehicle[] {
  return seeds.map(([code, lng, lat, soc], i) => {
    const model = MODELS[i % MODELS.length]!;
    return {
      vehicle_id: `veh-${code}`,
      code,
      kind: 'scooter',
      model_name: model,
      lng,
      lat,
      soc_pct: soc,
      range_m: Math.round((soc / 100) * 30_000),
      max_speed_kmh: model === 'Penny Max' ? 25 : 20,
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
      name: 'Athens service area',
      geom: { type: 'Polygon', coordinates: rect(23.7275, 37.9825, 0.05, 0.045) },
      rules: {},
    },
    {
      id: 'zone-parking-syntagma',
      kind: 'parking',
      name: 'Syntagma parking',
      geom: { type: 'Polygon', coordinates: rect(23.7355, 37.9755, 0.004, 0.003) },
      rules: {},
    },
    {
      id: 'zone-parking-monastiraki',
      kind: 'parking',
      name: 'Monastiraki parking',
      geom: { type: 'Polygon', coordinates: rect(23.7255, 37.9762, 0.004, 0.003) },
      rules: {},
    },
    {
      id: 'zone-bonus-koukaki',
      kind: 'bonus',
      name: 'Koukaki bonus',
      geom: { type: 'Polygon', coordinates: rect(23.7245, 37.9648, 0.005, 0.004) },
      rules: { bonus_cents: 50 },
    },
    {
      id: 'zone-paid-plaka',
      kind: 'paid_parking',
      name: 'Plaka paid parking',
      geom: { type: 'Polygon', coordinates: rect(23.7300, 37.9720, 0.004, 0.003) },
      rules: { fee_cents: 80 },
    },
    {
      id: 'zone-noparking-ermou',
      kind: 'no_parking',
      name: 'Ermou pedestrian',
      geom: { type: 'Polygon', coordinates: rect(23.7290, 37.9770, 0.006, 0.0015) },
      rules: {},
    },
    {
      id: 'zone-nogo-acropolis',
      kind: 'no_go',
      name: 'Acropolis archaeological site',
      geom: { type: 'Polygon', coordinates: rect(23.7257, 37.9715, 0.006, 0.005) },
      rules: {},
    },
    {
      id: 'zone-speed-syntagma',
      kind: 'speed_limit',
      name: 'Syntagma slow zone',
      geom: { type: 'Polygon', coordinates: rect(23.7355, 37.9800, 0.008, 0.006) },
      rules: { limit_kmh: 10 },
    },
    {
      id: 'zone-station-omonia',
      kind: 'parking_station',
      name: 'Omonia station',
      geom: { type: 'Polygon', coordinates: rect(23.7280, 37.9838, 0.003, 0.002) },
      rules: { station_capacity: 12 },
    },
  ];
}

export function makePois(): MapPoi[] {
  return [
    { id: 'poi-syntagma', name: 'Syntagma Metro', kind: 'transit', lng: 23.7355, lat: 37.9753, icon: 'transit' },
    { id: 'poi-monastiraki', name: 'Monastiraki Metro', kind: 'transit', lng: 23.7256, lat: 37.9762, icon: 'transit' },
    { id: 'poi-acropolis', name: 'Acropolis', kind: 'attraction', lng: 23.7257, lat: 37.9715, icon: 'star' },
    { id: 'poi-charger-omonia', name: 'Charging station · Omonia', kind: 'charger', lng: 23.7281, lat: 37.9840, icon: 'charge' },
    { id: 'poi-station-koukaki', name: 'Penny station · Koukaki', kind: 'station', lng: 23.7248, lat: 37.9650, icon: 'P' },
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
