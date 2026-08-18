// myDATA on the dashboard.
//
// The point is not another number on a busy screen — it is that somebody opens
// this page every morning, and "did yesterday's takings get declared?" should be
// answerable there rather than by remembering to visit a tab.
//
// Two things it must never do: claim receipts are filed while the system is in
// practice mode, and disappear silently when it cannot load. It hides itself
// only for people who are not allowed to see tax filings at all.
import { Link } from 'react-router-dom';
import { Card, CardHeader, Button } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { useMydataHealth } from '@/hooks/useMydata';
import { formatMoney, titleCase, relativeTime } from '@/lib/format';
import { colors } from '@penny/ui';
import type { MydataHealth } from '@/types/domain';

function Figure({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="card stat-card" style={{ flex: 1, minWidth: 132 }}>
      <span className="stat-label">{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: tone }}>{value}</span>
    </div>
  );
}

export function MydataHealthCard() {
  const { data: h, isLoading, isError } = useMydataHealth();

  // A 403 means this role does not look after tax. Anything else that fails
  // still says so — a blank space where the tax status should be is the same
  // failure mode as the old system's email that never sent.
  if (isError) return null;
  if (isLoading || !h) return null;

  const live = h.mode === 'live';
  const attention = h.open_issues + h.payments_without_receipt;

  return (
    <Card>
      <CardHeader
        title="Tax receipts (myDATA)"
        sub={windowSummary(h)}
        actions={
          <>
            <Badge tone={live ? 'success' : 'warning'}>
              {live ? 'Filing to AADE' : `${titleCase((h.mode ?? 'off').replace('_', ' '))} — not sending`}
            </Badge>
            <Link to="/mydata"><Button size="sm">Open</Button></Link>
          </>
        }
      />
      <div className="card-pad">
        {!live ? (
          <div
            className="card"
            style={{ padding: 10, marginBottom: 12, borderLeft: `3px solid ${colors.warning}`, fontSize: 13 }}
          >
            Receipts below were built but <strong>not sent to AADE</strong>. The old pipeline is
            still filing for real.
          </div>
        ) : null}

        <div className="row-wrap">
          <Figure label="Receipts today" value={String(h.today_receipts)} />
          <Figure
            label="Filed today"
            value={live ? String(h.today_filed) : '—'}
            tone={live && h.today_filed < h.today_receipts ? colors.warning : undefined}
          />
          <Figure label="Value today" value={formatMoney(h.today_gross_cents)} />
          <Figure label="Last 7 days" value={String(h.d7_receipts)} />
          <Figure
            label="Needs attention"
            value={String(attention)}
            tone={attention > 0 ? colors.danger : colors.success}
          />
        </div>

        {h.today_failed > 0 || h.payments_without_receipt > 0 ? (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            {h.today_failed > 0 ? (
              <div style={{ color: colors.danger }}>
                {h.today_failed} receipt{h.today_failed === 1 ? '' : 's'} could not be filed today.
              </div>
            ) : null}
            {h.payments_without_receipt > 0 ? (
              <div style={{ color: colors.danger }}>
                {h.payments_without_receipt} payment{h.payments_without_receipt === 1 ? '' : 's'} with
                no receipt at all.
              </div>
            ) : null}
          </div>
        ) : null}

        {h.series_synced_at ? (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            Receipt numbering last synced {relativeTime(h.series_synced_at)}.
            {!live ? ' It must be re-synced from the old system at cutover.' : ''}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function windowSummary(h: MydataHealth): string {
  const parts = [
    `${h.h24_receipts} in 24h`,
    `${h.d7_receipts} in 7 days`,
  ];
  if (h.in_flight > 0) parts.push(`${h.in_flight} sending`);
  if (h.d7_by_hand > 0) parts.push(`${h.d7_by_hand} filed by hand this week`);
  return parts.join(' · ');
}
