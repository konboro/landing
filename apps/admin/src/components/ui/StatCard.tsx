import type { ReactNode } from 'react';
import { Sparkline } from '@/components/charts/Charts';

export function StatCard({
  label,
  value,
  delta,
  spark,
  sparkColor,
  icon,
}: {
  label: string;
  value: ReactNode;
  delta?: { value: string; up: boolean } | null;
  spark?: number[];
  sparkColor?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="card stat-card">
      <div className="between">
        <span className="stat-label">{label}</span>
        {icon ? <span style={{ fontSize: 18 }}>{icon}</span> : null}
      </div>
      <div className="stat-value">{value}</div>
      <div className="between">
        {delta ? <span className={`stat-delta ${delta.up ? 'up' : 'down'}`}>{delta.up ? '▲' : '▼'} {delta.value}</span> : <span />}
        {spark ? <Sparkline data={spark} color={sparkColor} width={90} height={28} /> : null}
      </div>
    </div>
  );
}
