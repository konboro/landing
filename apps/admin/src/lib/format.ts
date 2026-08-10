// Re-export shared formatters plus admin-only helpers.
import { OPERATING_TZ } from '@penny/ui';
export {
  formatMoney,
  formatDuration,
  formatDistance,
  formatSoc,
  formatDateTime,
  relativeTime,
  formatTime,
  OPERATING_TZ,
  co2SavedKg,
  socColor,
} from '@penny/ui';

export function formatDate(iso: string | null | undefined, locale = 'en-GB'): string {
  if (!iso) return '—';
  // Street time, not the viewer's: an operator abroad must not see a Greek date
  // roll over an hour early. Locale was 'el-GR', which rendered Greek months.
  return new Date(iso).toLocaleDateString(locale, {
    year: 'numeric', month: 'short', day: '2-digit', timeZone: OPERATING_TZ,
  });
}

export function formatNumber(n: number, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}
