import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { StatCard } from '@/components/ui/StatCard';
import { formatMoney, formatDateTime, relativeTime } from '@/lib/format';
import type { VerificationItem } from '@/types/domain';

const REJECT_REASONS = ['Blocking sidewalk', 'Lying down / not upright', 'On the road / in traffic', 'Blocking entrance/ramp', 'Photo unclear', 'Wrong zone'];

export function RideVerificationPage() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['verification'], queryFn: () => ds.listVerification() });
  const [idx, setIdx] = useState(0);
  const [rejectOpen, setRejectOpen] = useState(false);

  const queue = useMemo(() => (data ?? []).filter((q) => q.trip.photo_review === 'pending'), [data]);
  const current = queue[Math.min(idx, queue.length - 1)];

  const review = useMutation({
    mutationFn: ({ tripId, verdict, reason }: { tripId: string; verdict: 'approved' | 'rejected'; reason?: string }) => ds.reviewPhoto(tripId, verdict, reason),
    onSuccess: (_r, v) => {
      toast.push(`Photo ${v.verdict}`, v.verdict === 'approved' ? 'success' : 'info');
      qc.invalidateQueries({ queryKey: ['verification'] });
      setIdx((i) => Math.max(0, Math.min(i, queue.length - 2)));
    },
  });

  const approve = () => { if (current && can('verification.review')) review.mutate({ tripId: current.trip.id, verdict: 'approved' }); };
  const reject = (reason: string) => { if (current) { review.mutate({ tripId: current.trip.id, verdict: 'rejected', reason }); setRejectOpen(false); } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (rejectOpen) return;
      if (e.key.toLowerCase() === 'a') { e.preventDefault(); approve(); }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); if (can('verification.review')) setRejectOpen(true); }
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'j') setIdx((i) => Math.min(queue.length - 1, i + 1));
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'k') setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // SLA: p95 wait of pending items
  const slaHours = useMemo(() => {
    if (!queue.length) return 0;
    const waits = queue.map((q) => (Date.now() - new Date(q.queued_at).getTime()) / 3600000).sort((a, b) => a - b);
    const p95 = waits[Math.floor(waits.length * 0.95)] ?? waits[waits.length - 1] ?? 0;
    return +p95.toFixed(1);
  }, [queue]);

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title="Ride verification"
        sub="AI pre-screened parking photos — only pending items need a human"
        actions={<Badge tone="info">Keys: A approve · R reject · ← → navigate</Badge>}
      />

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <StatCard label="Pending review" value={queue.length} icon="📷" />
        <StatCard label="Queue SLA (p95 wait)" value={`${slaHours}h`} delta={slaHours > 6 ? { value: 'over 6h target', up: false } : { value: 'within target', up: true }} />
        <StatCard label="AI auto-approved (batch)" value={`${(data ?? []).filter((q) => q.ai_verdict === 'auto_ok').length}`} icon="🤖" />
      </div>

      {isLoading ? <Card pad><Skeleton height={300} /></Card> : null}
      {!isLoading && queue.length === 0 ? (
        <Card><EmptyState emoji="✅" title="Queue clear" hint="No parking photos awaiting human review." /></Card>
      ) : null}

      {current ? (
        <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
          <Card>
            <CardHeader title={`Photo review — ${current.trip.id}`} sub={`${idx + 1} of ${queue.length}`} />
            <div className="card-pad">
              <PhotoPlaceholder id={current.trip.id} />
              <div className="between" style={{ marginTop: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>AI confidence</div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>{Math.round(current.ai_confidence * 100)}%</div>
                </div>
                <Badge tone={current.ai_verdict === 'auto_ok' ? 'success' : 'warning'}>
                  {current.ai_verdict === 'auto_ok' ? 'AI would auto-approve' : 'AI flagged for review'}
                </Badge>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <Button variant="primary" style={{ flex: 1 }} disabled={!can('verification.review') || review.isPending} onClick={approve}>✓ Approve (A)</Button>
                <Button variant="danger" style={{ flex: 1 }} disabled={!can('verification.review') || review.isPending} onClick={() => setRejectOpen(true)}>✕ Reject → penalty (R)</Button>
              </div>
              {!can('verification.review') ? <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Your role cannot review photos.</div> : null}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                <Button size="sm" variant="ghost" onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹ Prev</Button>
                <Button size="sm" variant="ghost" onClick={() => setIdx((i) => Math.min(queue.length - 1, i + 1))}>Next ›</Button>
              </div>
            </div>
          </Card>

          <UserHistoryPanel item={current} />
        </div>
      ) : null}

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject photo — select reason"
        footer={<Button onClick={() => setRejectOpen(false)}>Cancel</Button>}
      >
        <p className="muted" style={{ marginTop: 0 }}>Rejection triggers the penalty flow (warning → 5€ → 10€) and pushes the reason + photo to the rider with an appeal link.</p>
        <div className="stack">
          {REJECT_REASONS.map((r) => (
            <Button key={r} onClick={() => reject(r)}>{r}</Button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function PhotoPlaceholder({ id }: { id: string }) {
  const hue = (id.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 60) + 190;
  return (
    <div style={{ height: 300, borderRadius: 12, background: `linear-gradient(135deg, hsl(${hue} 40% 82%), hsl(${hue} 30% 68%))`, display: 'grid', placeItems: 'center', position: 'relative' }}>
      <div style={{ fontSize: 72, opacity: 0.85 }}>🛴</div>
      <div style={{ position: 'absolute', bottom: 10, left: 12, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 11, padding: '3px 8px', borderRadius: 6 }}>end-photo · {id}</div>
    </div>
  );
}

function UserHistoryPanel({ item }: { item: VerificationItem }) {
  const ds = useDS();
  const { data } = useQuery({ queryKey: ['customer', item.trip.user_id], queryFn: () => ds.getCustomer(item.trip.user_id) });
  const c = data?.customer;
  return (
    <Card>
      <CardHeader title="Rider history" sub="Context for a fair decision" />
      <div className="card-pad stack">
        <div className="between">
          <div>
            <div style={{ fontWeight: 700 }}>{item.trip.user_name}</div>
            <div className="muted" style={{ fontSize: 13 }}>{item.trip.user_phone}</div>
          </div>
          <Link className="btn btn-sm" to={`/customers/${item.trip.user_id}`}>Open profile</Link>
        </div>
        {c ? (
          <div className="row-wrap" style={{ gap: 8 }}>
            <Badge tone="info">Score {c.score}</Badge>
            <Badge tone="neutral">{c.rides} rides</Badge>
            <Badge tone={c.debt_cents > 0 ? 'danger' : 'success'}>{c.debt_cents > 0 ? `Debt ${formatMoney(c.debt_cents)}` : 'No debt'}</Badge>
          </div>
        ) : <Skeleton height={22} width={200} />}
        <div className="divider" />
        <div className="muted" style={{ fontSize: 12 }}>This trip</div>
        <div style={{ fontSize: 13 }}>
          <div>Vehicle <b>{item.trip.vehicle_code}</b> · {item.trip.city_name}</div>
          <div>Ended {formatDateTime(item.trip.ended_at)} · {relativeTime(item.queued_at)} in queue</div>
          <div>Cost {formatMoney(item.trip.cost_cents)}{item.trip.penalty_cents ? ` · penalty ${formatMoney(item.trip.penalty_cents)}` : ''}</div>
        </div>
        <div className="divider" />
        <div className="muted" style={{ fontSize: 12 }}>Recent rides</div>
        {(data?.rides ?? []).slice(0, 5).map((r) => (
          <div key={r.id} className="between" style={{ fontSize: 13 }}>
            <Link to={`/rides/${r.id}`}>{r.id}</Link>
            <span className="muted">{formatDateTime(r.started_at)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
