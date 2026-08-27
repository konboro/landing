import { OPERATING_TZ } from '@penny/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button, KV, Field, Input, Select } from '@/components/ui/primitives';
import { TripStatusBadge, PaymentStatusBadge, Badge } from '@/components/ui/Badge';
import { MapView, type MapPath, type MapMarker } from '@/components/map/MapView';
import { LineTrend, chartPalette } from '@/components/charts/Charts';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney, formatDistance, formatDuration, formatDateTime, relativeTime, titleCase } from '@/lib/format';
import { colors } from '@penny/ui';

export function RideDetailPage() {
  const { id = '' } = useParams();
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['ride', id], queryFn: () => ds.getRide(id) });

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);

  const route = data?.route ?? [];
  useEffect(() => {
    if (!playing) { if (timer.current) window.clearInterval(timer.current); return; }
    timer.current = window.setInterval(() => {
      setT((prev) => { if (prev >= route.length - 1) { setPlaying(false); return prev; } return prev + 1; });
    }, 120);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, route.length]);

  const refund = useMutation({
    mutationFn: ({ paymentId, amount, reason }: { paymentId: string; amount: number; reason: string }) => ds.refund(paymentId, amount, reason),
    onSuccess: () => { toast.push('Refund issued', 'success'); qc.invalidateQueries({ queryKey: ['ride', id] }); setRefundOpen(false); },
  });

  const telemetryData = useMemo(() => (data?.telemetry ?? []).map((s, i) => ({ i, t: new Date(s.device_ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: OPERATING_TZ }), speed: s.speed_kmh, soc: s.soc_pct })), [data]);

  if (isLoading) return <div><PageHeader title="Ride" back={{ to: '/rides', label: 'Rides' }} /><Card pad>Loading…</Card></div>;
  if (!data) return <div><PageHeader title="Ride not found" back={{ to: '/rides', label: 'Rides' }} /><Card><EmptyState emoji="🔍" title="No such ride" /></Card></div>;

  const { ride } = data;
  const paths: MapPath[] = route.length ? [{ coordinates: route, color: colors.primary }] : [];
  const pos = route[Math.min(t, route.length - 1)];
  const marker: MapMarker[] = pos ? [{ id: 'cursor', lng: pos[0], lat: pos[1], color: colors.primaryDark, label: `t=${t}` }] : [];
  const center = route[Math.floor(route.length / 2)] ?? [23.7275, 37.9838];

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title={<span>Ride <span className="mono">{ride.id}</span> <TripStatusBadge status={ride.status} /></span>}
        sub={<>{ride.user_name} · {ride.vehicle_code} · {formatDateTime(ride.started_at)}</>}
        back={{ to: '/rides', label: 'Rides' }}
        actions={
          <>
            <Button disabled={!can('payments.refund')} onClick={() => setRefundOpen(true)}>Refund</Button>
            <Button disabled={!can('payments.charge')} onClick={() => setAdjustOpen(true)}>Adjust price</Button>
            {ride.has_dispute ? <Button variant="primary" onClick={() => setDisputeOpen(true)}>Resolve dispute</Button> : null}
          </>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <Card>
          <CardHeader title="Route playback" sub="Animated over the trip LineString" />
          <div className="card-pad">
            <MapView height={320} paths={paths} markers={marker} center={center} zoom={14} legend={[{ color: colors.primary, label: 'Route' }, { color: colors.primaryDark, label: 'Playback cursor' }]} />
            <div className="row" style={{ alignItems: 'center', marginTop: 12 }}>
              <Button variant="primary" size="sm" onClick={() => { if (t >= route.length - 1) setT(0); setPlaying((p) => !p); }}>{playing ? '⏸ Pause' : '▶ Play'}</Button>
              <input type="range" min={0} max={Math.max(0, route.length - 1)} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} style={{ flex: 1 }} />
              <span className="muted mono" style={{ fontSize: 12, minWidth: 70, textAlign: 'right' }}>{route.length ? Math.round((t / (route.length - 1)) * 100) : 0}%</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Trip summary" />
          <div className="card-pad">
            <KV items={[
              ['Rider', <Link to={`/customers/${ride.user_id}`}>{ride.user_name}</Link>],
              ['Vehicle', <Link to={`/vehicles/${ride.vehicle_id}`}>{ride.vehicle_code}</Link>],
              ['City', ride.city_name],
              ['Distance', formatDistance(ride.distance_m)],
              ['Duration', formatDuration(ride.duration_s)],
              ['Pause', formatDuration(ride.pause_s)],
              ['Unlock fee', formatMoney(ride.pricing_snapshot?.unlock_cents ?? 0)],
              ['Per-min', formatMoney(ride.pricing_snapshot?.per_min_cents ?? 0)],
              ['Multiplier', `${ride.pricing_snapshot?.multiplier ?? 1}×`],
              ['Discount', formatMoney(ride.discount_cents)],
              ['Bonus', `− ${formatMoney(ride.bonus_cents)}`],
              ['Penalty', formatMoney(ride.penalty_cents)],
              ['Total cost', <b>{formatMoney(ride.cost_cents)}</b>],
              ['Photo review', ride.photo_review ? <Badge tone={ride.photo_review === 'rejected' ? 'danger' : ride.photo_review === 'pending' ? 'warning' : 'success'}>{titleCase(ride.photo_review)}</Badge> : '—'],
            ]} />
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <Card>
          <CardHeader title="Telemetry" sub="Speed (km/h) & battery (%)" />
          <div className="card-pad">
            <LineTrend data={telemetryData} xKey="t" height={240} series={[{ key: 'speed', name: 'Speed km/h', color: chartPalette[0]! }, { key: 'soc', name: 'Battery %', color: chartPalette[1]! }]} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Event timeline" sub="trip_events + commands" />
          <div className="card-pad">
            <div className="timeline">
              {data.events.map((e) => (
                <div key={e.id} className="timeline-item">
                  <div style={{ fontWeight: 600 }}>{e.from_status ? `${titleCase(e.from_status)} → ` : ''}{titleCase(e.to_status)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(e.at)} · {e.actor}{e.meta && Object.keys(e.meta).length ? ` · ${JSON.stringify(e.meta)}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Payments" sub={`${data.payments.length} related`} />
        <div className="table-wrap">
          {data.payments.length === 0 ? <EmptyState title="No payments" /> : (
            <table className="data">
              <thead><tr><th>ID</th><th>Kind</th><th>Amount</th><th>Status</th><th>Initiated</th><th>When</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
                    <td>{titleCase(p.kind)}</td>
                    <td>{formatMoney(p.amount_cents)}</td>
                    <td><PaymentStatusBadge status={p.status} /></td>
                    <td>{p.initiated_by}</td>
                    <td>{relativeTime(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Refund */}
      <RefundModal open={refundOpen} onClose={() => setRefundOpen(false)} payments={data.payments} busy={refund.isPending} onSubmit={(paymentId, amount, reason) => refund.mutate({ paymentId, amount, reason })} />

      {/* Adjust price */}
      <AdjustPriceModal open={adjustOpen} onClose={() => setAdjustOpen(false)} current={ride.cost_cents} onDone={() => { toast.push('Price adjusted (audited)', 'success'); setAdjustOpen(false); }} tripId={ride.id} />

      {/* Resolve dispute */}
      <ConfirmModal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        onConfirm={() => { toast.push('Dispute resolved (audited)', 'success'); setDisputeOpen(false); }}
        title="Resolve dispute"
        message="Mark this disputed ride as resolved. Choose the outcome and provide a reason for the audit log."
        requireReason
        confirmLabel="Resolve"
      />
    </div>
  );
}

function RefundModal({ open, onClose, payments, onSubmit, busy }: { open: boolean; onClose: () => void; payments: { id: string; amount_cents: number; kind: string }[]; onSubmit: (paymentId: string, amount: number, reason: string) => void; busy?: boolean }) {
  const paid = payments;
  const [paymentId, setPaymentId] = useState(paid[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setPaymentId(paid[0]?.id ?? ''); setAmount(''); setReason(''); } }, [open]);
  const max = paid.find((p) => p.id === paymentId)?.amount_cents ?? 0;
  const amountCents = Math.round(parseFloat(amount || '0') * 100) || max;
  return (
    <Modal open={open} onClose={onClose} title="Issue refund" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !paymentId || reason.trim().length < 3} onClick={() => onSubmit(paymentId, amountCents, reason.trim())}>Refund {formatMoney(amountCents)}</Button></>}>
      {paid.length === 0 ? <p className="muted">No captured payment to refund.</p> : (
        <>
          <Field label="Payment"><Select value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>{paid.map((p) => <option key={p.id} value={p.id}>{p.id} · {titleCase(p.kind)} · {formatMoney(p.amount_cents)}</option>)}</Select></Field>
          <Field label="Amount (EUR)" hint={`Leave blank for full ${formatMoney(max)}`}><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(max / 100).toFixed(2)} inputMode="decimal" /></Field>
          <Field label="Reason" required hint="Recorded in audit_log."><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this refunded?" /></Field>
        </>
      )}
    </Modal>
  );
}

function AdjustPriceModal({ open, onClose, current, onDone, tripId }: { open: boolean; onClose: () => void; current: number; onDone: () => void; tripId: string }) {
  const ds = useDS();
  const [amount, setAmount] = useState((current / 100).toFixed(2));
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setAmount((current / 100).toFixed(2)); setReason(''); } }, [open, current]);
  return (
    <Modal open={open} onClose={onClose} title="Adjust ride price" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={reason.trim().length < 3} onClick={async () => { await ds.logAudit({ action: 'adjust_price', entity: 'trip', entity_id: tripId, reason: reason.trim(), after: { cost_cents: Math.round(parseFloat(amount) * 100) } }); onDone(); }}>Save</Button></>}>
      <Field label="New total (EUR)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
      <Field label="Reason" required hint="Recorded in audit_log."><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
