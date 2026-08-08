import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button, KV, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { KycBadge, TripStatusBadge, PaymentStatusBadge, Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney, formatDateTime, formatDate, relativeTime, titleCase, initials } from '@/lib/format';
import { colors } from '@penny/ui';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: () => ds.getCustomer(id) });
  const [tab, setTab] = useState('profile');
  const [chargeOpen, setChargeOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [rekycOpen, setRekycOpen] = useState(false);
  const [gdprOpen, setGdprOpen] = useState<null | 'export' | 'delete'>(null);
  const [notes, setNotes] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['customer', id] });

  const charge = useMutation({
    mutationFn: (v: { amount_cents: number; kind: string; reason: string; evidence_urls: string[] }) => ds.adminCharge({ user_id: id, ...v }),
    onSuccess: () => { toast.push('Card charged (audited)', 'success'); invalidate(); setChargeOpen(false); },
  });
  const credit = useMutation({
    mutationFn: (v: { amount: number; reason: string }) => ds.creditWallet(id, v.amount, v.reason),
    onSuccess: () => { toast.push('Wallet credited (audited)', 'success'); invalidate(); setCreditOpen(false); },
  });
  const block = useMutation({
    mutationFn: (reason: string) => ds.setUserBlocked(id, data?.customer.status !== 'blocked', reason),
    onSuccess: () => { toast.push('User status updated (audited)', 'success'); invalidate(); setBlockOpen(false); },
  });

  if (isLoading) return <div><PageHeader title="Customer" back={{ to: '/customers', label: 'Customers' }} /><Card pad>Loading…</Card></div>;
  if (!data) return <div><PageHeader title="Not found" back={{ to: '/customers', label: 'Customers' }} /><Card><EmptyState emoji="🔍" title="No such customer" /></Card></div>;

  const c = data.customer;
  const isBlocked = c.status === 'blocked';
  const penalties = data.payments.filter((p) => p.kind === 'penalty');
  const disputes = data.rides.filter((r) => r.has_dispute);
  const devicesUsed = Array.from(new Set(data.rides.map((r) => r.vehicle_code)));

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 40, height: 40, borderRadius: '50%', background: colors.primarySoft, color: colors.primaryDark, display: 'grid', placeItems: 'center', fontWeight: 700, textTransform: 'uppercase' }}>{initials(c.full_name)}</span>
            {c.full_name}
            {isBlocked ? <Badge tone="danger">Blocked</Badge> : null}
          </span>
        }
        sub={<>{c.phone} · {c.email ?? 'no email'} · signed up {formatDate(c.created_at)}{c.legacy_atom_user_id ? ` · legacy ${c.legacy_atom_user_id}` : ''}</>}
        back={{ to: '/customers', label: 'Customers' }}
        actions={
          <>
            <Button variant="danger" disabled={!can('payments.charge')} onClick={() => setChargeOpen(true)}>Charge card</Button>
            <Button disabled={!can('users.credit')} onClick={() => setCreditOpen(true)}>Credit wallet</Button>
            <Button disabled={!can('users.block')} onClick={() => setBlockOpen(true)}>{isBlocked ? 'Unblock' : 'Block'}</Button>
            <Button variant="ghost" onClick={() => setRekycOpen(true)}>Force re-KYC</Button>
            <Button variant="ghost" onClick={() => setGdprOpen('export')}>GDPR export</Button>
            <Button variant="ghost" onClick={() => toast.push('Read-only impersonation session started', 'info')}>Impersonate (read-only)</Button>
          </>
        }
      />

      <div className="row-wrap">
        <Stat label="Rides" value={c.rides} />
        <Stat label="Lifetime spend" value={formatMoney(c.spend_cents)} />
        <Stat label="Open debt" value={formatMoney(c.debt_cents)} tone={c.debt_cents > 0 ? 'danger' : undefined} />
        <Stat label="Rider score" value={c.score} tone={c.score < 60 ? 'warning' : 'success'} />
        <Stat label="Loyalty" value="Silver · 640 pts" />
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'profile', label: 'Profile & KYC' },
        { key: 'rides', label: `Rides (${data.rides.length})` },
        { key: 'payments', label: 'Payments & ledger' },
        { key: 'debts', label: `Debts (${data.debts.length})` },
        { key: 'penalties', label: `Penalties (${penalties.length})` },
        { key: 'disputes', label: `Disputes (${disputes.length})` },
        { key: 'devices', label: 'Devices' },
        { key: 'referrals', label: `Referrals (${data.referrals.length})` },
        { key: 'notes', label: 'Notes' },
      ]} />

      {tab === 'profile' ? (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Card>
            <CardHeader title="Identity & KYC" actions={<a className="btn btn-sm" href={`https://cockpit.sumsub.com/checkus#/applicant/${c.sumsub_applicant_id ?? ''}`} target="_blank" rel="noreferrer">Open in Sumsub ↗</a>} />
            <div className="card-pad">
              <KV items={[
                ['Full name', c.full_name ?? '—'], ['Phone', c.phone], ['Email', c.email ?? '—'],
                ['KYC status', <KycBadge status={c.kyc_status} />],
                ['Sumsub applicant', <span className="mono">{c.sumsub_applicant_id ?? '—'}</span>],
                ['Marketing consent', c.marketing_consent ? 'Yes' : 'No'],
                ['ToS accepted', formatDate(c.tos_accepted_at)],
                ['Emergency contact', c.emergency_contact ?? '—'],
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Documents" />
            <div className="card-pad stack">
              <DocRow name="Driving licence" status={c.kyc_status === 'approved' ? 'valid' : 'pending'} />
              <DocRow name="ID / Passport" status={c.kyc_status === 'approved' ? 'valid' : 'pending'} />
              <DocRow name="Selfie / liveness" status={c.kyc_status === 'approved' ? 'valid' : c.kyc_status === 'rejected' ? 'rejected' : 'pending'} />
              <p className="muted" style={{ fontSize: 12 }}>Documents are stored in Sumsub; PII is never mirrored into Penny tables (see Hard Rule #11).</p>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'rides' ? (
        <Card>
          <CardHeader title="Ride history" />
          <SimpleRideTable rides={data.rides} />
        </Card>
      ) : null}

      {tab === 'payments' ? (
        <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
          <Card>
            <CardHeader title="Payments" />
            <div className="table-wrap">
              {data.payments.length === 0 ? <EmptyState title="No payments" /> : (
                <table className="data">
                  <thead><tr><th>ID</th><th>Kind</th><th>Amount</th><th>Status</th><th>By</th><th>When</th></tr></thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}><td className="mono">{p.id}</td><td>{titleCase(p.kind)}</td><td>{formatMoney(p.amount_cents)}</td><td><PaymentStatusBadge status={p.status} /></td><td>{p.initiated_by}</td><td>{relativeTime(p.created_at)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Wallet ledger" sub="Double-entry (balanced)" />
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Account</th><th>Δ</th><th>Memo</th></tr></thead>
                <tbody>
                  {data.ledger.map((l) => (
                    <tr key={l.id}><td>{titleCase(l.account_kind)}</td><td style={{ color: l.delta_cents < 0 ? colors.danger : colors.success }}>{formatMoney(l.delta_cents)}</td><td className="muted">{l.memo}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'debts' ? (
        <Card>
          <CardHeader title="Debts" sub="Retry now / write-off" />
          <div className="table-wrap">
            {data.debts.length === 0 ? <EmptyState emoji="✅" title="No open debts" /> : (
              <table className="data">
                <thead><tr><th>ID</th><th>Amount</th><th>Source</th><th>Status</th><th>Attempts</th><th>Next retry</th><th></th></tr></thead>
                <tbody>
                  {data.debts.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.id}</td><td>{formatMoney(d.amount_cents)}</td><td>{titleCase(d.source)}</td>
                      <td><Badge tone={d.status === 'paid' ? 'success' : d.status === 'written_off' ? 'neutral' : 'warning'}>{titleCase(d.status)}</Badge></td>
                      <td>{d.attempts}</td><td>{relativeTime(d.next_retry_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Button size="sm" onClick={() => toast.push('Retry queued', 'info')}>Retry</Button>{' '}
                        <Button size="sm" variant="ghost" disabled={!can('debts.writeoff')} onClick={() => toast.push('Write-off requires reason (audited)', 'info')}>Write off</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      ) : null}

      {tab === 'penalties' ? (
        <Card>
          <CardHeader title="Penalties" />
          <div className="table-wrap">
            {penalties.length === 0 ? <EmptyState emoji="✅" title="No penalties" /> : (
              <table className="data">
                <thead><tr><th>ID</th><th>Amount</th><th>Status</th><th>Reason</th><th>When</th></tr></thead>
                <tbody>{penalties.map((p) => <tr key={p.id}><td className="mono">{p.id}</td><td>{formatMoney(p.amount_cents)}</td><td><PaymentStatusBadge status={p.status} /></td><td>{p.admin_reason ?? '—'}</td><td>{relativeTime(p.created_at)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </Card>
      ) : null}

      {tab === 'disputes' ? (
        <Card>
          <CardHeader title="Disputes" />
          <SimpleRideTable rides={disputes} />
        </Card>
      ) : null}

      {tab === 'devices' ? (
        <Card>
          <CardHeader title="Devices / vehicles used" />
          <div className="card-pad">
            {devicesUsed.length === 0 ? <EmptyState title="No devices" /> : (
              <div className="row-wrap">{devicesUsed.map((code) => <span key={code} className="pill-tag mono">{code}</span>)}</div>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Login devices (push tokens) and fraud signals appear here in production.</p>
          </div>
        </Card>
      ) : null}

      {tab === 'referrals' ? (
        <Card>
          <CardHeader title="Referrals" />
          <div className="table-wrap">
            {data.referrals.length === 0 ? <EmptyState title="No referrals" /> : (
              <table className="data">
                <thead><tr><th>Referrer</th><th>Referee</th><th>Status</th><th>Reward</th><th>When</th></tr></thead>
                <tbody>{data.referrals.map((r) => <tr key={r.id}><td>{r.referrer_name}</td><td>{r.referee_name}</td><td><Badge tone={r.status === 'rewarded' ? 'success' : 'info'}>{titleCase(r.status)}</Badge></td><td>{formatMoney(r.reward_cents)}</td><td>{relativeTime(r.created_at)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </Card>
      ) : null}

      {tab === 'notes' ? (
        <Card>
          <CardHeader title="Internal notes" />
          <div className="card-pad">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note (visible to staff only)…" />
            <div style={{ marginTop: 10 }}><Button variant="primary" onClick={() => { toast.push('Note saved', 'success'); setNotes(''); }}>Save note</Button></div>
          </div>
        </Card>
      ) : null}

      {/* Charge card modal — reason + evidence MANDATORY */}
      <ChargeModal open={chargeOpen} onClose={() => setChargeOpen(false)} busy={charge.isPending} onSubmit={(v) => charge.mutate(v)} />

      {/* Credit wallet */}
      <CreditModal open={creditOpen} onClose={() => setCreditOpen(false)} busy={credit.isPending} onSubmit={(amount, reason) => credit.mutate({ amount, reason })} />

      {/* Block/unblock */}
      <ConfirmModal open={blockOpen} onClose={() => setBlockOpen(false)} onConfirm={(reason) => block.mutate(reason)} title={isBlocked ? 'Unblock user' : 'Block user'} message={isBlocked ? 'Restore ride access for this user.' : 'Blocks new rides immediately.'} requireReason danger={!isBlocked} busy={block.isPending} confirmLabel={isBlocked ? 'Unblock' : 'Block'} />

      {/* Force re-KYC */}
      <ConfirmModal open={rekycOpen} onClose={() => setRekycOpen(false)} onConfirm={() => { toast.push('Re-KYC requested (audited)', 'success'); setRekycOpen(false); }} title="Force re-KYC" message="Sets KYC to pending and prompts the rider to re-verify via Sumsub." requireReason confirmLabel="Request re-KYC" />

      {/* GDPR */}
      <ConfirmModal open={gdprOpen !== null} onClose={() => setGdprOpen(null)} onConfirm={() => { toast.push(gdprOpen === 'delete' ? 'Deletion scheduled (audited)' : 'Export queued — link emailed', gdprOpen === 'delete' ? 'error' : 'success'); setGdprOpen(null); }} title={gdprOpen === 'delete' ? 'GDPR delete' : 'GDPR data export'} message={gdprOpen === 'delete' ? 'Irreversibly anonymizes this user (retains legally-required financial records).' : 'Assembles a full data export and emails a download link.'} requireReason danger={gdprOpen === 'delete'} confirmLabel={gdprOpen === 'delete' ? 'Schedule delete' : 'Export'} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' | 'warning' | 'success' }) {
  const col = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.text;
  return (
    <div className="card stat-card" style={{ minWidth: 150, flex: 1 }}>
      <span className="stat-label">{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: col }}>{value}</span>
    </div>
  );
}

function DocRow({ name, status }: { name: string; status: 'valid' | 'pending' | 'rejected' }) {
  return (
    <div className="between" style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
      <span>{name}</span>
      <Badge tone={status === 'valid' ? 'success' : status === 'rejected' ? 'danger' : 'warning'}>{titleCase(status)}</Badge>
    </div>
  );
}

function SimpleRideTable({ rides }: { rides: Array<{ id: string; status: string; vehicle_code: string; cost_cents: number; started_at: string | null }> }) {
  if (rides.length === 0) return <EmptyState title="No rides" />;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>Trip</th><th>Vehicle</th><th>Status</th><th>Cost</th><th>Started</th></tr></thead>
        <tbody>
          {rides.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => window.location.assign(`/rides/${r.id}`)}>
              <td className="mono">{r.id}</td><td>{r.vehicle_code}</td><td><TripStatusBadge status={r.status} /></td><td>{formatMoney(r.cost_cents)}</td><td>{formatDateTime(r.started_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChargeModal({ open, onClose, onSubmit, busy }: { open: boolean; onClose: () => void; onSubmit: (v: { amount_cents: number; kind: string; reason: string; evidence_urls: string[] }) => void; busy?: boolean }) {
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState('penalty');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const amountCents = Math.round(parseFloat(amount || '0') * 100);
  const evidenceUrls = evidence.split(/\s+/).filter(Boolean);
  const valid = amountCents > 0 && reason.trim().length >= 3 && evidenceUrls.length > 0;
  return (
    <Modal open={open} onClose={onClose} title="Charge card (manual)" footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" disabled={!valid || busy} onClick={() => onSubmit({ amount_cents: amountCents, kind, reason: reason.trim(), evidence_urls: evidenceUrls })}>{busy ? 'Charging…' : `Charge ${amountCents ? formatMoney(amountCents) : ''}`}</Button></>}>
      <div style={{ background: colors.primarySoft, padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
        Manual charges require an amount, a category, a <b>reason</b> and at least one <b>evidence</b> URL. The rider is emailed a breakdown with an appeal link. Recorded in audit_log.
      </div>
      <Field label="Amount (EUR)" required><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" /></Field>
      <Field label="Category" required><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="penalty">Penalty</option><option value="damage">Damage</option><option value="other">Other</option></Select></Field>
      <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the charge" /></Field>
      <Field label="Evidence URLs" required hint="One or more, space-separated (photos, report links)."><Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://…/damage-photo.jpg" /></Field>
    </Modal>
  );
}

function CreditModal({ open, onClose, onSubmit, busy }: { open: boolean; onClose: () => void; onSubmit: (amount: number, reason: string) => void; busy?: boolean }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const cents = Math.round(parseFloat(amount || '0') * 100);
  return (
    <Modal open={open} onClose={onClose} title="Credit wallet" footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" disabled={cents <= 0 || reason.trim().length < 3 || busy} onClick={() => onSubmit(cents, reason.trim())}>Credit {cents ? formatMoney(cents) : ''}</Button></>}>
      <Field label="Amount (EUR)" required><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" /></Field>
      <Field label="Reason" required hint="Recorded in audit_log."><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
