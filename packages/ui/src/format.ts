// Shared formatting — money, duration, distance, dates. Locale-aware.

// The default locale is English. It used to be 'el-GR', and because almost no
// caller passes one, every date and amount in the app rendered in Greek
// regardless of the chosen language — most visibly in ride detail. Callers that
// genuinely want a rider's own locale still pass it explicitly.
export function formatMoney(cents: number, currency = 'EUR', locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}

export function formatSoc(pct: number | null | undefined): string {
  if (pct == null) return '—';
  return `${Math.round(pct)}%`;
}

/**
 * The timezone the fleet operates in. Every timestamp in the product is shown in
 * street time, not the viewer's.
 *
 * Without this, `toLocaleString` uses whatever timezone the device happens to be
 * in: an operator working from Poland (UTC+2) saw every Greek timestamp an hour
 * early, so a ride that started at 16:22 in Thessaloniki read 15:22 in the panel.
 * Dispatchers reason about street time — "was the scooter moved before or after
 * the shift ended" has one right answer, and it is the city's clock.
 *
 * Stored values are unaffected: the database keeps timestamptz in UTC, which is
 * correct. This only decides how an instant is rendered.
 */
export const OPERATING_TZ = 'Europe/Athens';

export function formatDateTime(
  iso: string | null | undefined,
  locale = 'en-GB',
  timeZone = OPERATING_TZ,
): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/** Time-of-day only, in the operating city's clock. */
export function formatTime(
  iso: string | null | undefined,
  locale = 'en-GB',
  timeZone = OPERATING_TZ,
): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = now - new Date(iso).getTime();
  // Future instants are not a hypothetical: task due dates and pop-up expiries
  // both run through here, and the backwards-only version rendered a deadline
  // two hours out as "-7200s ago". Same ladder, other direction.
  const future = diff < 0;
  const suffix = (v: string) => (future ? `in ${v}` : `${v} ago`);
  const s = Math.round(Math.abs(diff) / 1000);
  if (s < 60) return suffix(`${s}s`);
  const m = Math.round(s / 60);
  if (m < 60) return suffix(`${m}m`);
  const h = Math.round(m / 60);
  if (h < 24) return suffix(`${h}h`);
  const d = Math.round(h / 24);
  return suffix(`${d}d`);
}

/** CO2 saved vs a short car trip: ~0.12 kg/km avoided. */
export function co2SavedKg(meters: number): number {
  return +((meters / 1000) * 0.12).toFixed(2);
}

export function socColor(pct: number | null | undefined): 'ok' | 'warn' | 'crit' {
  if (pct == null) return 'crit';
  if (pct >= 40) return 'ok';
  if (pct >= 15) return 'warn';
  return 'crit';
}
