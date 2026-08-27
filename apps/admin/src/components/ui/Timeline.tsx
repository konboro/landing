import { OPERATING_TZ } from '@penny/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip } from './primitives';
import { EmptyState, Skeleton } from './feedback';
import { titleCase } from '@/lib/format';
import { colors } from '@penny/ui';
import type { TimelineEvent, TimelineKind } from '@/types/domain';

const ICON: Record<TimelineKind, string> = {
  ride: '🛴',
  payment: '💳',
  refund: '↩️',
  penalty: '⚠️',
  debt: '🧾',
  kyc: '🪪',
  command: '📡',
  status: '🔄',
  alert: '🚨',
  damage: '🛠',
  battery_swap: '🔋',
  maintenance: '🔧',
  notification: '🔔',
  support: '💬',
  loyalty: '⭐',
  referral: '🤝',
  account: '👤',
};

const TONE_COLOR: Record<NonNullable<TimelineEvent['tone']>, string> = {
  neutral: colors.textMuted,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.primary,
};

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', timeZone: OPERATING_TZ });
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: OPERATING_TZ });
}

/**
 * Merged activity feed used by both the customer "Activity" tab and the
 * vehicle "Timeline" tab: per-kind filter chips, grouped by day, icon per kind.
 */
export function TimelineFeed({
  events,
  loading,
  emptyTitle = 'No activity yet',
  maxHeight,
}: {
  events: TimelineEvent[];
  loading?: boolean;
  emptyTitle?: string;
  maxHeight?: number;
}) {
  const [active, setActive] = useState<Set<TimelineKind>>(new Set());

  const kinds = useMemo(() => {
    const counts = new Map<TimelineKind, number>();
    for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const filtered = useMemo(
    () => (active.size === 0 ? events : events.filter((e) => active.has(e.kind))),
    [events, active],
  );

  const groups = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of filtered) {
      const k = dayKey(e.at);
      const list = map.get(k);
      if (list) list.push(e); else map.set(k, [e]);
    }
    return [...map.entries()];
  }, [filtered]);

  const toggle = (k: TimelineKind) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  if (loading) {
    return (
      <div className="card-pad stack" style={{ gap: 12 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Skeleton width={28} height={28} style={{ borderRadius: 999, flex: '0 0 28px' }} />
            <div style={{ flex: 1 }}>
              <Skeleton width="40%" height={12} />
              <Skeleton width="70%" height={10} style={{ marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card-pad">
      {kinds.length > 1 ? (
        <div className="toolbar" style={{ marginBottom: 'var(--space-md)' }}>
          <Chip active={active.size === 0} onClick={() => setActive(new Set())}>All ({events.length})</Chip>
          {kinds.map(([k, n]) => (
            <Chip key={k} active={active.has(k)} onClick={() => toggle(k)}>
              <span aria-hidden>{ICON[k]}</span> {titleCase(k)} ({n})
            </Chip>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title={emptyTitle} hint={active.size ? 'No events of the selected kind.' : undefined} />
      ) : (
        <div style={maxHeight ? { maxHeight, overflowY: 'auto', paddingRight: 4 } : undefined}>
          {groups.map(([day, list]) => (
            <div key={day} className="tl-group">
              <div className="tl-day">
                <span>{day}</span>
                <span className="muted" style={{ fontSize: 11 }}>{list.length} event{list.length === 1 ? '' : 's'}</span>
              </div>
              {list.map((e) => (
                <div key={e.id} className="tl-row">
                  <span className="tl-icon" style={{ borderColor: TONE_COLOR[e.tone ?? 'neutral'] }} aria-hidden>{ICON[e.kind]}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="tl-title">
                      {e.link ? <Link to={e.link} style={{ color: colors.primary }}>{e.title}</Link> : e.title}
                    </div>
                    <div className="tl-detail">{e.detail}</div>
                  </div>
                  <div className="tl-meta">
                    <div className="mono">{timeOf(e.at)}</div>
                    {e.ref_id ? <div className="mono muted" style={{ fontSize: 10 }}>{e.ref_id}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
