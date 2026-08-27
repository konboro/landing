import type { VehicleRideHistoryRow, RideCostBreakdown, TimelineEvent } from '@/types/domain';

/**
 * `v_vehicle_ride_history` → the row shape the ride tables render.
 *
 * The view is flat (`trip_id`, `cost_cents`, `penalty_cents`, …) while the
 * table was written against the old mock, which nested a full cost breakdown
 * under `row.cost`. Reading `r.cost.unlock_cents` off a view row threw and
 * blanked the vehicle's Rides tab.
 *
 * What the view genuinely cannot supply is marked below. Per-component amounts
 * (unlock / minutes / pause / paid parking) are not stored per trip — only the
 * charged total and the penalty are — so they come back as 0 and their columns
 * are hidden by default. Extending the view from `trips.pricing_snapshot` is
 * the real fix; this stops the crash without inventing numbers in the total.
 */
export function toVehicleRideRow(raw: Record<string, unknown>): VehicleRideHistoryRow {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  const total = n(raw.cost_cents);
  const penalty = n(raw.penalty_cents);
  const currency = (s(raw.currency) ?? 'EUR');

  const cost: RideCostBreakdown = {
    // Not in the view — see the note above. Zero here means "not broken out",
    // which is why these columns ship hidden.
    unlock_cents: 0,
    minutes_cents: 0,
    pause_cents: 0,
    paid_parking_cents: 0,
    bonus_cents: 0,
    discount_cents: 0,
    penalty_cents: penalty,
    total_cents: total,
    currency,
  };

  const duration = n(raw.duration_s);
  const distance = n(raw.distance_m);

  return {
    id: String(raw.trip_id ?? raw.id ?? ''),
    started_at: s(raw.started_at),
    ended_at: s(raw.ended_at),
    status: String(raw.status ?? ''),
    duration_s: duration,
    pause_s: n(raw.pause_s),
    distance_m: distance,
    // Derived, not stored: metres over moving seconds. Guarded so a zero-length
    // ride does not render NaN km/h.
    avg_speed_kmh: duration > 0 ? Math.round((distance / duration) * 3.6 * 10) / 10 : 0,
    cost,
    cost_cents: total,
    currency,
    photo_review: s(raw.photo_review),
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    rating_tags: Array.isArray(raw.rating_tags) ? (raw.rating_tags as string[]) : [],
    start_zone_name: s(raw.start_zone_name),
    end_zone_name: s(raw.end_zone_name),
    start_lng: n(raw.start_lng),
    start_lat: n(raw.start_lat),
    end_lng: typeof raw.end_lng === 'number' ? raw.end_lng : null,
    end_lat: typeof raw.end_lat === 'number' ? raw.end_lat : null,
    // The route lives in `trip_routes`; the list does not draw one.
    route: [],
    payment_status: s(raw.payment_status),
    has_dispute: raw.has_dispute === true,
    has_penalty: raw.has_penalty === true || penalty > 0,
    user_id: String(raw.rider_id ?? ''),
    user_name: String(raw.rider_name ?? '—'),
    user_phone_masked: String(raw.rider_phone_masked ?? '—'),
    // The view is already scoped to one vehicle, so it carries the code rather
    // than the city; the column falls back to the vehicle's own header.
    city_name: String(raw.city_name ?? raw.vehicle_code ?? ''),
  };
}

/**
 * `v_vehicle_timeline` → `TimelineEvent`.
 *
 * The view's `detail` column is **jsonb**, not text — a ride row carries
 * `{status, trip_id, user_id, …}` and a command row `{kind, ack_at, ack_by,
 * payload}`. The feed rendered it straight into JSX, which is React error #31
 * ("objects are not valid as a React child") and blanked the vehicle's Timeline
 * tab.
 *
 * Summarised rather than JSON-dumped: an operator reading a timeline wants
 * "aborted · trip f20c664e", not a serialised object.
 */
export function toTimelineEvent(raw: Record<string, unknown>): TimelineEvent {
  const kind = String(raw.kind ?? 'event');
  const d = raw.detail;

  const summarise = (): string => {
    if (d == null) return '';
    if (typeof d === 'string') return d;
    if (typeof d !== 'object') return String(d);
    const o = d as Record<string, unknown>;

    if (kind === 'ride') {
      const bits = [o.status, o.trip_id ? `trip ${String(o.trip_id).slice(0, 8)}` : null];
      return bits.filter(Boolean).join(' · ');
    }
    if (kind === 'command') {
      const acked = o.ack_at ? 'acked' : 'no ack';
      return [o.kind, acked].filter(Boolean).join(' · ');
    }
    // Anything else: the scalar fields, in order, as `key value` pairs. Nested
    // objects are skipped — they belong in the record the row links to, not in
    // a one-line summary.
    return Object.entries(o)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .slice(0, 4)
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ${String(v)}`)
      .join(' · ');
  };

  const at = String(raw.at ?? '');
  return {
    id: String(raw.ref_id ?? `${kind}:${at}`),
    at,
    kind: kind as TimelineEvent['kind'],
    title: String(raw.title ?? kind),
    detail: summarise(),
    ref_id: raw.ref_id ? String(raw.ref_id) : null,
  };
}
