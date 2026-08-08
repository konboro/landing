// Ride-history projections shared by the mock data source: the deep per-ride
// extras that the admin ride tables show (cost breakdown, rating, zones,
// polyline) and the aggregates rendered as summary tiles.
import type { LngLat } from '@penny/db-types';
import type {
  RideRow,
  RideCostBreakdown,
  UserRideHistoryRow,
  VehicleRideHistoryRow,
  UserStats,
  VehicleStats,
} from '@/types/domain';
import { co2SavedKg } from '@penny/ui';

/** Per-ride detail that has no home in `Trip` but the panel wants to show. */
export interface RideExtra {
  vehicle_model: string;
  rating: number | null;
  rating_tags: string[];
  start_zone_name: string | null;
  end_zone_name: string | null;
  minutes_cents: number;
  pause_cents: number;
  paid_parking_cents: number;
  payment_status: string | null;
  route: LngLat[];
}

export const ATHENS_AREAS = [
  'Syntagma', 'Monastiraki', 'Kolonaki', 'Exarcheia', 'Plaka', 'Psyri', 'Koukaki',
  'Pagkrati', 'Ampelokipoi', 'Petralona', 'Gazi', 'Kypseli', 'Neos Kosmos', 'Ilisia',
];

export const RATING_TAGS = [
  'clean', 'smooth ride', 'good battery', 'easy to find', 'brakes ok',
  'wobbly', 'slow', 'dirty', 'hard to park', 'app glitch',
];

export function maskPhone(phone: string): string {
  if (phone.length <= 5) return phone;
  return `${phone.slice(0, 5)}•••${phone.slice(-3)}`;
}

export function costBreakdown(ride: RideRow, extra: RideExtra): RideCostBreakdown {
  return {
    unlock_cents: ride.pricing_snapshot?.unlock_cents ?? 0,
    minutes_cents: extra.minutes_cents,
    pause_cents: extra.pause_cents,
    paid_parking_cents: extra.paid_parking_cents,
    bonus_cents: ride.bonus_cents,
    discount_cents: ride.discount_cents,
    penalty_cents: ride.penalty_cents,
    total_cents: ride.cost_cents + ride.penalty_cents - ride.discount_cents - ride.bonus_cents,
    currency: ride.currency,
  };
}

function base(ride: RideRow, extra: RideExtra) {
  const start = ride.start_pos?.coordinates ?? [0, 0];
  const end = ride.end_pos?.coordinates ?? null;
  const hours = ride.duration_s > 0 ? ride.duration_s / 3600 : 0;
  return {
    id: ride.id,
    started_at: ride.started_at,
    ended_at: ride.ended_at,
    status: ride.status,
    duration_s: ride.duration_s,
    pause_s: ride.pause_s,
    distance_m: ride.distance_m,
    avg_speed_kmh: hours > 0 ? +(ride.distance_m / 1000 / hours).toFixed(1) : 0,
    cost: costBreakdown(ride, extra),
    cost_cents: ride.cost_cents,
    currency: ride.currency,
    photo_review: ride.photo_review,
    rating: extra.rating,
    rating_tags: extra.rating_tags,
    start_zone_name: extra.start_zone_name,
    end_zone_name: extra.end_zone_name,
    start_lng: start[0],
    start_lat: start[1],
    end_lng: end ? end[0] : null,
    end_lat: end ? end[1] : null,
    route: extra.route as Array<[number, number]>,
    payment_status: extra.payment_status,
    has_dispute: ride.has_dispute,
    has_penalty: ride.has_penalty,
    city_name: ride.city_name,
  };
}

export function toUserRideRow(ride: RideRow, extra: RideExtra): UserRideHistoryRow {
  return {
    ...base(ride, extra),
    vehicle_id: ride.vehicle_id,
    vehicle_code: ride.vehicle_code,
    vehicle_model: extra.vehicle_model,
  };
}

export function toVehicleRideRow(ride: RideRow, extra: RideExtra): VehicleRideHistoryRow {
  return {
    ...base(ride, extra),
    user_id: ride.user_id,
    user_name: ride.user_name,
    user_phone_masked: maskPhone(ride.user_phone),
  };
}

function within(iso: string | null, days: number): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() <= days * 86400000;
}

function modeOf(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

export function computeUserStats(
  rides: UserRideHistoryRow[],
  opts: { debt_cents: number; refunds_cents: number },
): UserStats {
  const billed = rides.filter((r) => r.status !== 'aborted');
  const rated = rides.filter((r) => r.rating != null);
  const spend = billed.reduce((s, r) => s + r.cost.total_cents, 0);
  const distance = billed.reduce((s, r) => s + r.distance_m, 0);
  const duration = billed.reduce((s, r) => s + r.duration_s, 0);
  const reviewed = rides.filter((r) => r.photo_review && r.photo_review !== 'pending');
  const rejected = reviewed.filter((r) => r.photo_review === 'rejected');
  const sorted = [...rides].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  return {
    total_rides: rides.length,
    rides_7d: rides.filter((r) => within(r.started_at, 7)).length,
    rides_30d: rides.filter((r) => within(r.started_at, 30)).length,
    total_distance_m: distance,
    total_duration_s: duration,
    total_spend_cents: spend,
    avg_ride_cost_cents: billed.length ? Math.round(spend / billed.length) : 0,
    avg_distance_m: billed.length ? Math.round(distance / billed.length) : 0,
    avg_duration_s: billed.length ? Math.round(duration / billed.length) : 0,
    avg_rating: rated.length ? +(rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length).toFixed(2) : null,
    rating_count: rated.length,
    co2_saved_kg: co2SavedKg(distance),
    open_debt_cents: opts.debt_cents,
    penalties_count: rides.filter((r) => r.has_penalty).length,
    penalties_cents: rides.reduce((s, r) => s + r.cost.penalty_cents, 0),
    disputes_count: rides.filter((r) => r.has_dispute).length,
    refunds_cents: opts.refunds_cents,
    first_ride_at: sorted[0]?.started_at ?? null,
    last_ride_at: sorted[sorted.length - 1]?.started_at ?? null,
    favourite_vehicle_code: modeOf(rides.map((r) => r.vehicle_code)),
    favourite_end_zone: modeOf(rides.map((r) => r.end_zone_name)),
    photo_reject_rate_pct: reviewed.length ? +((rejected.length / reviewed.length) * 100).toFixed(1) : 0,
  };
}

export function computeVehicleStats(
  rides: VehicleRideHistoryRow[],
  opts: { damage_count: number; battery_swaps: number; maintenance_cost_cents: number; deployed_at: string | null },
): VehicleStats {
  const billed = rides.filter((r) => r.status !== 'aborted');
  const rated = rides.filter((r) => r.rating != null);
  const sorted = [...rides].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  const first = sorted[0]?.started_at ?? opts.deployed_at;
  const days = first ? Math.max(1, (Date.now() - new Date(first).getTime()) / 86400000) : 1;
  const distance = billed.reduce((s, r) => s + r.distance_m, 0);
  return {
    total_rides: rides.length,
    rides_7d: rides.filter((r) => within(r.started_at, 7)).length,
    rides_30d: rides.filter((r) => within(r.started_at, 30)).length,
    revenue_cents: billed.reduce((s, r) => s + r.cost.total_cents, 0),
    revenue_30d_cents: billed.filter((r) => within(r.started_at, 30)).reduce((s, r) => s + r.cost.total_cents, 0),
    avg_distance_m: billed.length ? Math.round(distance / billed.length) : 0,
    avg_duration_s: billed.length ? Math.round(billed.reduce((s, r) => s + r.duration_s, 0) / billed.length) : 0,
    total_distance_m: distance,
    utilization_rides_per_day: +(rides.length / days).toFixed(2),
    unique_riders: new Set(rides.map((r) => r.user_id)).size,
    avg_rating: rated.length ? +(rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length).toFixed(2) : null,
    last_ride_at: sorted[sorted.length - 1]?.started_at ?? null,
    first_ride_at: sorted[0]?.started_at ?? null,
    penalties_count: rides.filter((r) => r.has_penalty).length,
    damage_count: opts.damage_count,
    battery_swaps: opts.battery_swaps,
    maintenance_cost_cents: opts.maintenance_cost_cents,
  };
}
