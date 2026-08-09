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

export function formatDateTime(iso: string | null | undefined, locale = 'en-GB'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = now - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
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
