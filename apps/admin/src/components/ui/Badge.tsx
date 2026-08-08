import type { ReactNode } from 'react';
import { titleCase } from '@/lib/format';
import { useBrand } from '@/context/BrandContext';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ tone = 'neutral', color, dot = true, children }: { tone?: Tone; color?: string; dot?: boolean; children: ReactNode }) {
  const { colors } = useBrand();
  const toneColor: Record<Tone, string> = {
    neutral: colors.textMuted,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.primary,
  };
  const c = color ?? toneColor[tone];
  return (
    <span className="badge" style={{ color: c, background: `${c}1a` }}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

const tripTone: Record<string, Tone> = {
  active: 'info', charged: 'success', ended: 'neutral', disputed: 'warning',
  aborted: 'danger', reserved: 'info', paused: 'warning', unlocking: 'info', ending: 'info',
};
export function TripStatusBadge({ status }: { status: string }) {
  return <Badge tone={tripTone[status] ?? 'neutral'}>{titleCase(status)}</Badge>;
}

/** Vehicle status colours always come from the active brand (statusColor). */
export function VehicleStatusBadge({ status }: { status: string }) {
  const { statusColor } = useBrand();
  return <Badge color={statusColor(status)}>{titleCase(status)}</Badge>;
}

const payTone: Record<string, Tone> = {
  succeeded: 'success', processing: 'info', requires_action: 'warning',
  failed: 'danger', refunded: 'neutral', partially_refunded: 'warning',
};
export function PaymentStatusBadge({ status }: { status: string }) {
  return <Badge tone={payTone[status] ?? 'neutral'}>{titleCase(status)}</Badge>;
}

const kycTone: Record<string, Tone> = { approved: 'success', pending: 'warning', rejected: 'danger', expired: 'danger', none: 'neutral' };
export function KycBadge({ status }: { status: string }) {
  return <Badge tone={kycTone[status] ?? 'neutral'}>{titleCase(status)}</Badge>;
}

/* ---------- Connectivity ---------- */

const simStatusTone: Record<string, Tone> = {
  active: 'success', inventory: 'neutral', suspended: 'warning', terminated: 'danger', test: 'info',
};
export function SimStatusBadge({ status }: { status: string }) {
  return <Badge tone={simStatusTone[status] ?? 'neutral'}>{titleCase(status)}</Badge>;
}

const simHealthTone: Record<string, Tone> = {
  ok: 'success', near_limit: 'warning', over_limit: 'danger',
  no_usage: 'neutral', silent: 'danger', unassigned: 'warning',
};
const SIM_HEALTH_LABEL: Record<string, string> = {
  ok: 'OK', near_limit: 'Near limit', over_limit: 'Over limit',
  no_usage: 'No usage', silent: 'Silent', unassigned: 'Unassigned',
};
export function SimHealthBadge({ health }: { health: string }) {
  return <Badge tone={simHealthTone[health] ?? 'neutral'}>{SIM_HEALTH_LABEL[health] ?? titleCase(health)}</Badge>;
}
