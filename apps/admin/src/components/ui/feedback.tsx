import type { CSSProperties, ReactNode } from 'react';

export function Skeleton({ width = '100%', height = 16, style }: { width?: number | string; height?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ width, height, ...style }} />;
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 16, padding: '10px 0' }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={14} width={c === 0 ? 120 : `${Math.max(60, 140 - c * 12)}px`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ emoji = '📭', title, hint, action }: { emoji?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="emoji">{emoji}</div>
      <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{title}</div>
      {hint ? <div>{hint}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <EmptyState emoji="⚠️" title="Something went wrong" hint={message} />;
}
