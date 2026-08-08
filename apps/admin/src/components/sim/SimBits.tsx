// Small presentational pieces shared by the Connectivity page, the SIM drawer
// and the vehicle/IoT surfaces that embed SIM information.
import type { ReactNode } from 'react';
import { useBrand } from '@/context/BrandContext';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/primitives';
import type { SimAlert } from '@/types/domain';

/** Data used vs plan allowance as an inline bar + percentage. */
export function UsageBar({
  usedMb,
  limitMb,
  pct,
  compact,
}: {
  usedMb: number;
  limitMb: number;
  pct: number;
  compact?: boolean;
}) {
  const { colors } = useBrand();
  const color = pct >= 100 ? colors.danger : pct >= 80 ? colors.warning : colors.success;
  const width = Math.max(2, Math.min(100, pct));
  return (
    <div className="usage-bar" title={`${usedMb.toFixed(1)} MB of ${limitMb} MB (${pct}%)`}>
      <div className="track">
        <span style={{ width: `${width}%`, background: color }} />
      </div>
      <span className="pct" style={{ color }}>{Math.round(pct)}%</span>
      {compact ? null : (
        <span className="muted nowrap" style={{ fontSize: 11 }}>
          {usedMb.toFixed(1)}/{limitMb} MB
        </span>
      )}
    </div>
  );
}

const SEVERITY_EMOJI: Record<SimAlert['severity'], string> = {
  critical: '🔴',
  warning: '🟠',
  info: '🔵',
};

/** Alerts strip — worst first, each row jumps straight to the SIM. */
export function SimAlertsStrip({
  alerts,
  loading,
  error,
  onOpen,
  max = 6,
}: {
  alerts: SimAlert[] | undefined;
  loading?: boolean;
  error?: unknown;
  onOpen: (simId: string) => void;
  max?: number;
}) {
  const { colors } = useBrand();
  const severityColor: Record<SimAlert['severity'], string> = {
    critical: colors.danger,
    warning: colors.warning,
    info: colors.primary,
  };

  if (loading) {
    return (
      <div className="card-pad stack" style={{ gap: 8 }}>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={14} />)}
      </div>
    );
  }
  if (error) {
    return <EmptyState emoji="⚠️" title="Could not load SIM alerts" hint={error instanceof Error ? error.message : String(error)} />;
  }
  if (!alerts || alerts.length === 0) {
    return <EmptyState emoji="✅" title="No connectivity alerts" hint="Every SIM is inside its plan and attaching normally." />;
  }

  return (
    <div className="alert-strip">
      {alerts.slice(0, max).map((a) => (
        <div key={`${a.sim_id}-${a.reason}`} className="alert-row">
          <span className="sev-bar" style={{ background: severityColor[a.severity] }} />
          <span aria-hidden>{SEVERITY_EMOJI[a.severity]}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <b className="mono" style={{ fontSize: 12 }}>{a.iccid}</b>
            {a.vehicle_code ? <span className="muted"> · {a.vehicle_code}</span> : null}
            <div className="muted" style={{ fontSize: 12 }}>{a.reason}</div>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onOpen(a.sim_id)}>Open SIM ›</Button>
        </div>
      ))}
      {alerts.length > max ? (
        <div className="alert-row muted" style={{ fontSize: 12 }}>
          + {alerts.length - max} more — use the “Needs attention” views below.
        </div>
      ) : null}
    </div>
  );
}

/** Compact label/value line used inside the drawer's identity block. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="between" style={{ gap: 'var(--space-md)', padding: '4px 0', alignItems: 'flex-start' }}>
      <span className="muted" style={{ fontSize: 12, flex: '0 0 130px' }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: 'right', wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}
