import type { ReactNode } from 'react';
import { colors, vehicleStatusColor } from '@penny/ui';
import { titleCase } from '@/lib/format';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const toneColor: Record<Tone, string> = {
  neutral: colors.textMuted,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.primary,
};

export function Badge({ tone = 'neutral', color, dot = true, children }: { tone?: Tone; color?: string; dot?: boolean; children: ReactNode }) {
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

export function VehicleStatusBadge({ status }: { status: string }) {
  return <Badge color={vehicleStatusColor[status] ?? colors.textMuted}>{titleCase(status)}</Badge>;
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
