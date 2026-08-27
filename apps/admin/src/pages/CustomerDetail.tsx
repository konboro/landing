import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { usePanelData } from '@/hooks/usePanelData';
import { useTableState } from '@/hooks/useTableState';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button, KV, Field, Input, Select, Textarea, Chip } from '@/components/ui/primitives';
import { KycBadge, PaymentStatusBadge, Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { TimelineFeed } from '@/components/ui/Timeline';
import { UserRideHistoryTable } from '@/components/rides/RideHistoryTable';
import { SumsubPanel } from '@/components/customer/SumsubPanel';
import {
  formatMoney, formatDateTime, formatDate, formatDistance, formatDuration,
  relativeTime, titleCase, formatNumber,
} from '@/lib/format';
import { colors } from '@penny/ui';
import type { UserProfileFull, UserNote } from '@/types/domain';

const SIGNUP_ICON: Record<string, string> = { ios: '', android: '🤖', web: '🌐', referral: '🤝' };

function ageFrom(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function daysBetween(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

/* ------------------------------------------------------------------ */

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { can, staff } = useAuth();

  const detail = useQuery({ queryKey: ['customer', id], queryFn: () => ds.getCustomer(id) });
  const profileQ = useQuery({ queryKey: ['user-profile', id], queryFn: () => ds.getUserProfile(id) });

  const [tab, setTab] = useState('profile');
  const ridesState = useTableState({ pageSize: 25, sort: [{ field: 'started_at', dir: 'desc' }] });
  const ridesQ = useQuery({
    queryKey: ['user-rides', id, ridesState.params],
    queryFn: () => ds.getUserRides(id, ridesState.params),
    enabled: tab === 'rides',
  });
  const timelineQ = useQuery({
    queryKey: ['user-timeline', id],
    queryFn: () => ds.getUserTimeline(id, { page: 1, pageSize: 500 }),
    enabled: tab === 'activity',
  });
  const panel = usePanelData();

  const [chargeOpen, setChargeOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [rekycOpen, setRekycOpen] = useState(false);
  const [gdprOpen, setGdprOpen] = useState<null | 'export' | 'delete'>(null);
  const [refundTarget, setRefundTarget] = useState<{ id: string; amount_cents: number } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['customer', id] });
    qc.invalidateQueries({ queryKey: ['user-profile', id] });
  };

  const charge = useMutation({
    mutationFn: (v: { amount_cents: number; kind: string; reason: string; evidence_urls: string[] }) => ds.adminCharge({ user_id: id, ...v }),
    onSuccess: () => { toast.push('Card charged (audited)', 'success'); invalidate(); setChargeOpen(false); },
  });
  const credit = useMutation({
    mutationFn: (v: { amount: number; reason: string }) => ds.creditWallet(id, v.amount, v.reason),
    onSuccess: () => { toast.push('Wallet credited (audited)', 'success'); invalidate(); setCreditOpen(false); },
  });
  const block = useMutation({
    mutationFn: (reason: string) => ds.setUserBlocked(id, detail.data?.customer.status !== 'blocked', reason),
    onSuccess: () => { toast.push('User status updated (audited)', 'success'); invalidate(); setBlockOpen(false); },
  });
  const refund = useMutation({
    mutationFn: (v: { paymentId: string; amount: number; reason: string }) => ds.refund(v.paymentId, v.amount, v.reason),
    onSuccess: () => { toast.push('Refund issued (audited)', 'success'); invalidate(); setRefundTarget(null); },
  });

  /* ---- local (in-memory) profile mutations: tags + notes ---- */
  const patchProfile = (fn: (p: UserProfileFull) => UserProfileFull) => {
    qc.setQueryData<UserProfileFull | null>(['user-profile', id], (prev) => (prev ? fn(prev) : prev));
  };
  const addTag = async (tag: string) => {
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean) return;
    patchProfile((p) => (p.tags.includes(clean) ? p : { ...p, tags: [...p.tags, clean] }));
    await ds.logAudit({ action: 'user_tag_add', entity: 'user', entity_id: id, reason: `Added tag "${clean}"`, after: { tag: clean } });
    toast.push(`Tag "${clean}" added (audited)`, 'success');
  };
  const removeTag = async (tag: string) => {
    patchProfile((p) => ({ ...p, tags: p.tags.filter((t) => t !== tag) }));
    await ds.logAudit({ action: 'user_tag_remove', entity: 'user', entity_id: id, reason: `Removed tag "${tag}"`, before: { tag } });
    toast.push(`Tag "${tag}" removed (audited)`, 'info');
  };
  const addNote = async (body: string) => {
    const note: UserNote = { id: `note-${Date.now()}`, at: new Date().toISOString(), author: staff.name, body };
    patchProfile((p) => ({ ...p, notes: [note, ...p.notes] }));
    await ds.logAudit({ action: 'user_note_add', entity: 'user', entity_id: id, reason: body.slice(0, 140), after: { note_id: note.id } });
    toast.push('Note saved (audited)', 'success');
  };

  if (detail.isLoading || profileQ.isLoading) {
    return (
      <div>
        <PageHeader title="Customer" back={{ to: '/customers', label: 'Customers' }} />
        <Card pad>
          <div className="profile-hero">
            <Skeleton width={84} height={84} style={{ borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
              <Skeleton width={220} height={22} />
              <Skeleton width={380} height={13} style={{ marginTop: 10 }} />
              <Skeleton width={300} height={13} style={{ marginTop: 6 }} />
            </div>
          </div>
        </Card>
      </div>
    );
  }
  if (detail.isError) {
    return <div><PageHeader title="Customer" back={{ to: '/customers', label: 'Customers' }} /><Card><ErrorState message={detail.error instanceof Error ? detail.error.message : 'Load failed'} /></Card></div>;
  }
  if (!detail.data) {
    return <div><PageHeader title="Not found" back={{ to: '/customers', label: 'Customers' }} /><Card><EmptyState emoji="🔍" title="No such customer" /></Card></div>;
  }

  const data = detail.data;
  const c = data.customer;
  const p = profileQ.data ?? null;
  const stats = p?.stats ?? null;
  const isBlocked = c.status === 'blocked';
  const penalties = data.payments.filter((x) => x.kind === 'penalty');
  const disputes = data.rides.filter((r) => r.has_dispute);
  const age = ageFrom(p?.date_of_birth ?? null);
  const invoices = (panel.data?.invoices ?? []).filter((i) => i.user_id === c.id);
  const notifications = (panel.data?.notificationLog ?? []).filter((n) => n.target === c.phone);

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title="Customer"
        back={{ to: '/customers', label: 'Customers' }}
        actions={
          <>
            <Button variant="danger" disabled={!can('payments.charge')} onClick={() => setChargeOpen(true)}>Charge card</Button>
            <Button disabled={!can('users.credit')} onClick={() => setCreditOpen(true)}>Credit wallet</Button>
            <Button disabled={!can('users.block')} onClick={() => setBlockOpen(true)}>{isBlocked ? 'Unblock' : 'Block'}</Button>
            <Button variant="ghost" onClick={() => setRekycOpen(true)}>Force re-KYC</Button>
            <Button variant="ghost" onClick={() => setGdprOpen('export')}>GDPR export</Button>
            <Button variant="ghost" onClick={() => setGdprOpen('delete')}>GDPR delete</Button>
            <Button variant="ghost" onClick={() => toast.push('Read-only impersonation session started', 'info')}>Impersonate (read-only)</Button>
          </>
        }
      />

      {/* ---------------- Hero ---------------- */}
      <Card pad>
        <div className="profile-hero">
          {p ? <img className="avatar-lg" src={p.avatar_url} alt="" /> : <div className="avatar-lg" />}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="hero-name">
              <h2>{c.full_name ?? 'Unnamed rider'}</h2>
              <Badge tone={c.status === 'active' ? 'success' : c.status === 'blocked' ? 'danger' : 'warning'}>{titleCase(c.status)}</Badge>
              <KycBadge status={c.kyc_status} />
              {p?.corporate_name ? <Badge tone="info">🏢 {p.corporate_name}</Badge> : null}
              {p?.customer_group_name ? <Badge tone="neutral">{p.customer_group_name}</Badge> : null}
              {p?.loyalty_tier ? <Badge tone="warning">⭐ {p.loyalty_tier} · {formatNumber(p.loyalty_points)} pts</Badge> : null}
            </div>
            <div className="hero-facts">
              <span className="mono">{c.phone} {p?.phone_verified ? <span className="verified" title="Verified">✓</span> : <span className="unverified" title="Not verified">✗</span>}</span>
              <span>{c.email ?? 'no email'} {c.email ? (p?.email_verified ? <span className="verified">✓</span> : <span className="unverified" title="Not verified">✗</span>) : null}</span>
              <span>📍 {c.city_name}</span>
              <span>{SIGNUP_ICON[p?.signup_source ?? 'web'] ?? '🌐'} joined <b>{formatDate(c.created_at)}</b> via {p?.signup_source ?? '—'}</span>
              <span>last active <b>{relativeTime(p?.last_active_at ?? c.updated_at)}</b></span>
              {c.legacy_atom_user_id ? <span className="mono">legacy {c.legacy_atom_user_id}</span> : null}
            </div>
            {p?.tags.length ? (
              <div className="row-wrap" style={{ gap: 6, marginTop: 10 }}>
                {p.tags.map((t) => <span key={t} className="pill-tag">#{t}</span>)}
              </div>
            ) : null}
            {isBlocked && c.blocked_reason ? (
              <div className="banner" style={{ borderColor: colors.danger, background: `${colors.danger}12`, marginTop: 12 }}>
                <div className="banner-bar" style={{ background: colors.danger }} />
                <div><b style={{ color: colors.danger }}>Blocked</b><div className="muted">{c.blocked_reason}</div></div>
              </div>
            ) : null}
          </div>
          <div style={{ minWidth: 210 }}>
            <ScoreMeter label="Rider score" value={c.score} good />
            <div style={{ height: 10 }} />
            <ScoreMeter label="Risk score" value={p?.risk_score ?? 0} good={false} />
            {p?.risk_reasons.length ? (
              <ul className="muted" style={{ fontSize: 11, margin: '8px 0 0', paddingLeft: 16 }}>
                {p.risk_reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ---------------- Quick tiles ---------------- */}
      <div className="tile-grid">
        <Tile label="Rides (Penny)" value={formatNumber(stats?.total_rides ?? 0)} hint={p?.legacy_rides ? `+${p.legacy_rides} legacy Atom` : `${stats?.rides_30d ?? 0} in last 30d`} />
        <Tile label="Total spend" value={formatMoney(stats?.total_spend_cents ?? 0)} hint={`avg ${formatMoney(stats?.avg_ride_cost_cents ?? 0)} / ride`} />
        <Tile label="Distance" value={formatDistance(stats?.total_distance_m ?? 0)} hint={`avg ${formatDistance(stats?.avg_distance_m ?? 0)}`} />
        <Tile label="Time riding" value={formatDuration(stats?.total_duration_s ?? 0)} hint={`avg ${formatDuration(stats?.avg_duration_s ?? 0)}`} />
        <Tile label="CO₂ saved" value={`${stats?.co2_saved_kg ?? 0} kg`} hint="vs. short car trips" />
        <Tile label="Avg rating" value={stats?.avg_rating != null ? `${stats.avg_rating} ★` : '—'} hint={`${stats?.rating_count ?? 0} ratings`} />
        <Tile label="Open debt" value={formatMoney(c.debt_cents)} tone={c.debt_cents > 0 ? 'danger' : undefined} hint={`${data.debts.length} record(s)`} />
        <Tile label="Wallet" value={formatMoney(p?.wallet_balance_cents ?? 0)} hint={`${p?.payment_methods.length ?? 0} card(s) on file`} />
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'profile', label: 'Profile' },
        { key: 'kyc', label: <>KYC / Sumsub {c.kyc_status === 'rejected' ? <span style={{ color: colors.danger }}>●</span> : null}</> },
        { key: 'rides', label: `Rides (${stats?.total_rides ?? data.rides.length})` },
        { key: 'money', label: 'Money' },
        { key: 'activity', label: 'Activity' },
      ]} />

      {/* ---------------- Profile ---------------- */}
      {tab === 'profile' ? (
        !p ? <Card><EmptyState title="Profile unavailable" hint="admin-user-profile returned no data for this user." /></Card> : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
            <Card>
              <CardHeader title="Personal data" sub="Held in Penny — KYC-extracted values live on the Sumsub tab" />
              <div className="card-pad">
                <KV items={[
                  ['Full name', c.full_name ?? '—'],
                  ['Date of birth', p.date_of_birth ? `${formatDate(p.date_of_birth)}${age != null ? ` · ${age} yrs` : ''}` : '—'],
                  ['Gender', p.gender ?? '—'],
                  ['Nationality', p.nationality],
                  ['Preferred language', p.preferred_lang.toUpperCase()],
                  ['Phone', <span className="mono">{c.phone} {p.phone_verified ? <span className="verified">✓ verified</span> : <span className="unverified">not verified</span>}</span>],
                  ['Email', <span>{c.email ?? '—'} {c.email ? (p.email_verified ? <span className="verified">✓ verified</span> : <span className="unverified">not verified</span>) : null}</span>],
                  ['Address', <span>{p.address.line1}{p.address.line2 ? `, ${p.address.line2}` : ''}<br />{p.address.postcode} {p.address.city}, {p.address.country}</span>],
                  ['Emergency contact', c.emergency_contact ? `${p.emergency_contact_name ?? 'Contact'} · ${c.emergency_contact}` : '—'],
                  ['Customer group', p.customer_group_name ?? '—'],
                  ['Corporate account', p.corporate_name ?? '—'],
                  ['Referral code', <span className="mono">{p.referral_code}</span>],
                  ['User id', <span className="mono">{c.id}</span>],
                  ['Legacy Atom id', <span className="mono">{c.legacy_atom_user_id ?? '—'}</span>],
                ]} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Consents" sub="GDPR — versioned, timestamped" />
              <div className="card-pad">
                <KV items={[
                  ['Terms of service', <ConsentValue ok at={p.consents.tos_accepted_at} extra={`v${p.consents.tos_version}`} />],
                  ['Privacy policy', <ConsentValue ok at={p.consents.privacy_accepted_at} extra={`v${p.consents.privacy_version}`} />],
                  ['Data processing', <ConsentValue ok at={p.consents.data_processing_at} />],
                  ['Marketing', <ConsentValue ok={p.consents.marketing_consent} at={p.consents.marketing_consent_at} />],
                  ['Age (18+) confirmed', p.consents.age_confirmed ? <Badge tone="success">Yes</Badge> : <Badge tone="danger">No</Badge>],
                ]} />
                <div className="divider" />
                <h4 className="section-label">Notification preferences</h4>
                <KV items={[
                  ['Push · trip receipts', <YesNo v={p.notification_prefs.push_trip_receipts} />],
                  ['Push · promotions', <YesNo v={p.notification_prefs.push_promotions} />],
                  ['Email · receipts', <YesNo v={p.notification_prefs.email_receipts} />],
                  ['Email · newsletter', <YesNo v={p.notification_prefs.email_newsletter} />],
                  ['SMS · critical only', <YesNo v={p.notification_prefs.sms_critical} />],
                ]} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Tags" sub="Segmentation + support shorthand. Every change is audited." />
              <div className="card-pad">
                <TagEditor tags={p.tags} onAdd={addTag} onRemove={removeTag} />
              </div>
            </Card>

            <Card>
              <CardHeader title={`Internal notes (${p.notes.length})`} sub="Staff-only. Never shown to the rider." />
              <div className="card-pad">
                <NoteComposer onSave={addNote} />
                <div className="divider" />
                {p.notes.length === 0 ? <EmptyState title="No notes yet" /> : (
                  <div className="stack" style={{ gap: 12 }}>
                    {p.notes.map((n) => (
                      <div key={n.id} className="note-item">
                        <div className="between"><b style={{ fontSize: 13 }}>{n.author}</b><span className="muted" style={{ fontSize: 12 }}>{formatDateTime(n.at)}</span></div>
                        <div style={{ fontSize: 13, marginTop: 2 }}>{n.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Customer form answers" sub="Answers to the signup form configured in Settings" />
              <div className="card-pad">
                <KV items={p.form_answers.map((a) => [a.question, a.answer] as [ReactNode, ReactNode])} />
              </div>
            </Card>

            <Card>
              <CardHeader title={`Payment methods (${p.payment_methods.length})`} />
              <div className="table-wrap">
                {p.payment_methods.length === 0 ? <EmptyState emoji="💳" title="No card on file" hint="This rider cannot start a trip until a card is added." /> : (
                  <table className="data">
                    <thead><tr><th>Brand</th><th>Number</th><th>Expires</th><th>Status</th><th>Added</th></tr></thead>
                    <tbody>
                      {p.payment_methods.map((m) => (
                        <tr key={m.id}>
                          <td>{m.brand} {m.is_default ? <Badge tone="info">default</Badge> : null}</td>
                          <td className="mono">•••• {m.last4}</td>
                          <td className="mono">{m.exp}</td>
                          <td><Badge tone={m.status === 'valid' ? 'success' : m.status === 'expired' ? 'danger' : 'warning'}>{titleCase(m.status)}</Badge></td>
                          <td>{formatDate(m.added_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
        )
      ) : null}

      {/* ---------------- KYC / Sumsub ---------------- */}
      {tab === 'kyc' ? (
        <SumsubPanel userId={id} kycStatus={c.kyc_status} onForceRekyc={() => setRekycOpen(true)} />
      ) : null}

      {/* ---------------- Rides ---------------- */}
      {tab === 'rides' ? (
        <div className="stack" style={{ gap: 'var(--space-lg)' }}>
          <div className="tile-grid">
            <Tile label="Total rides" value={formatNumber(stats?.total_rides ?? 0)} />
            <Tile label="Last 7 days" value={formatNumber(stats?.rides_7d ?? 0)} />
            <Tile label="Last 30 days" value={formatNumber(stats?.rides_30d ?? 0)} />
            <Tile label="First ride" value={stats?.first_ride_at ? formatDate(stats.first_ride_at) : '—'} />
            <Tile label="Last ride" value={stats?.last_ride_at ? relativeTime(stats.last_ride_at) : '—'} />
            <Tile label="Favourite vehicle" value={stats?.favourite_vehicle_code ?? '—'} hint={stats?.favourite_end_zone ? `usually parks ${stats.favourite_end_zone}` : undefined} />
            <Tile label="Photo rejects" value={`${stats?.photo_reject_rate_pct ?? 0}%`} tone={(stats?.photo_reject_rate_pct ?? 0) > 20 ? 'danger' : undefined} />
            <Tile label="Disputes" value={formatNumber(stats?.disputes_count ?? 0)} tone={(stats?.disputes_count ?? 0) > 0 ? 'warning' : undefined} />
          </div>
          {ridesQ.isError ? (
            <Card><ErrorState message={ridesQ.error instanceof Error ? ridesQ.error.message : 'Could not load ride history'} /></Card>
          ) : (
            <UserRideHistoryTable
              data={ridesQ.data}
              state={ridesState}
              loading={ridesQ.isLoading}
              onRowClick={(r) => nav(`/rides/${r.id}`)}
              csvName={`rides-${c.id}`}
              emptyTitle="This rider has no rides yet"
            />
          )}
        </div>
      ) : null}

      {/* ---------------- Money ---------------- */}
      {tab === 'money' ? (
        <div className="stack" style={{ gap: 'var(--space-lg)' }}>
          <div className="tile-grid">
            <Tile label="Lifetime spend" value={formatMoney(stats?.total_spend_cents ?? 0)} />
            <Tile label="Refunded" value={formatMoney(stats?.refunds_cents ?? 0)} />
            <Tile label="Penalties" value={formatMoney(stats?.penalties_cents ?? 0)} hint={`${stats?.penalties_count ?? 0} ride(s)`} />
            <Tile label="Open debt" value={formatMoney(c.debt_cents)} tone={c.debt_cents > 0 ? 'danger' : undefined} />
            <Tile label="Wallet balance" value={formatMoney(p?.wallet_balance_cents ?? 0)} />
            <Tile label="Legacy (Atom) spend" value={formatMoney(p?.legacy_spend_cents ?? 0)} hint="pre-migration" />
          </div>

          <Card>
            <CardHeader title={`Payments (${data.payments.length})`} sub="Stripe PaymentIntents — trips, top-ups, penalties, manual charges" />
            <div className="table-wrap">
              {data.payments.length === 0 ? <EmptyState title="No payments" /> : (
                <table className="data">
                  <thead><tr><th>ID</th><th>Kind</th><th>Amount</th><th>Status</th><th>By</th><th>Reason</th><th>Trip</th><th>When</th><th></th></tr></thead>
                  <tbody>
                    {data.payments.map((x) => (
                      <tr key={x.id}>
                        <td className="mono">{x.id}</td>
                        <td>{titleCase(x.kind)}</td>
                        <td>{formatMoney(x.amount_cents)}</td>
                        <td><PaymentStatusBadge status={x.status} /></td>
                        <td>{x.initiated_by}</td>
                        <td className="muted">{x.admin_reason ?? x.failure_code ?? '—'}</td>
                        <td>{x.trip_id ? <Link className="mono" to={`/rides/${x.trip_id}`} style={{ color: colors.primary }}>{x.trip_id}</Link> : '—'}</td>
                        <td>{relativeTime(x.created_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {x.status === 'succeeded' ? (
                            <Button size="sm" disabled={!can('payments.refund')} onClick={() => setRefundTarget({ id: x.id, amount_cents: x.amount_cents })}>Refund</Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            <Card>
              <CardHeader title="Ledger entries" sub="Double-entry — every txn nets to zero (Hard Rule #2)" />
              <div className="table-wrap">
                {data.ledger.length === 0 ? <EmptyState title="No ledger entries" /> : (
                  <table className="data">
                    <thead><tr><th>Txn</th><th>Account</th><th style={{ textAlign: 'right' }}>Δ</th><th>Memo</th><th>When</th></tr></thead>
                    <tbody>
                      {data.ledger.map((l) => (
                        <tr key={l.id}>
                          <td className="mono">{l.txn_id}</td>
                          <td>{l.account_kind ? titleCase(l.account_kind) : '—'}</td>
                          <td style={{ textAlign: 'right', color: l.delta_cents < 0 ? colors.danger : colors.success, fontWeight: 600 }}>{formatMoney(l.delta_cents)}</td>
                          <td className="muted">{l.memo}</td>
                          <td>{relativeTime(l.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card-pad" style={{ paddingTop: 0 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Balance check: {formatMoney(data.ledger.reduce((s, l) => s + l.delta_cents, 0))} (must be 0,00 €)
                </span>
              </div>
            </Card>

            <Card>
              <CardHeader title={`Debts (${data.debts.length})`} sub="Aged, with retry / write-off" />
              <div className="table-wrap">
                {data.debts.length === 0 ? <EmptyState emoji="✅" title="No open debts" /> : (
                  <table className="data">
                    <thead><tr><th>Amount</th><th>Age</th><th>Source</th><th>Status</th><th>Tries</th><th>Next retry</th><th></th></tr></thead>
                    <tbody>
                      {data.debts.map((d) => {
                        const age = daysBetween(d.created_at);
                        return (
                          <tr key={d.id}>
                            <td><b>{formatMoney(d.amount_cents)}</b></td>
                            <td><Badge tone={age > 30 ? 'danger' : age > 14 ? 'warning' : 'neutral'}>{age}d</Badge></td>
                            <td>{titleCase(d.source)}</td>
                            <td><Badge tone={d.status === 'paid' ? 'success' : d.status === 'written_off' ? 'neutral' : 'warning'}>{titleCase(d.status)}</Badge></td>
                            <td>{d.attempts}</td>
                            <td>{d.next_retry_at ? formatDateTime(d.next_retry_at) : '—'}</td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <Button size="sm" onClick={() => toast.push('Retry queued', 'info')}>Retry</Button>{' '}
                              <Button size="sm" variant="ghost" disabled={!can('debts.writeoff')} onClick={() => toast.push('Write-off requires a reason (audited)', 'info')}>Write off</Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title={`Penalties (${penalties.length})`} />
              <div className="table-wrap">
                {penalties.length === 0 ? <EmptyState emoji="✅" title="No penalties" /> : (
                  <table className="data">
                    <thead><tr><th>ID</th><th>Amount</th><th>Status</th><th>Reason</th><th>Trip</th><th>When</th></tr></thead>
                    <tbody>
                      {penalties.map((x) => (
                        <tr key={x.id}>
                          <td className="mono">{x.id}</td><td>{formatMoney(x.amount_cents)}</td>
                          <td><PaymentStatusBadge status={x.status} /></td>
                          <td className="muted">{x.admin_reason ?? '—'}</td>
                          <td>{x.trip_id ? <Link className="mono" to={`/rides/${x.trip_id}`} style={{ color: colors.primary }}>{x.trip_id}</Link> : '—'}</td>
                          <td>{relativeTime(x.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title={`Disputes (${disputes.length})`} />
              <div className="table-wrap">
                {disputes.length === 0 ? <EmptyState emoji="✅" title="No disputes" /> : (
                  <table className="data">
                    <thead><tr><th>Trip</th><th>Vehicle</th><th>Amount</th><th>Started</th></tr></thead>
                    <tbody>
                      {disputes.map((r) => (
                        <tr key={r.id} className="clickable" onClick={() => nav(`/rides/${r.id}`)}>
                          <td className="mono">{r.id}</td><td className="mono">{r.vehicle_code}</td>
                          <td>{formatMoney(r.cost_cents)}</td><td>{formatDateTime(r.started_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title={`Invoices (${invoices.length})`} sub="myDATA e-invoicing status (docs/05)" />
              <div className="table-wrap">
                {panel.isLoading ? <Skeleton height={80} style={{ margin: 'var(--space-lg)' }} />
                  : invoices.length === 0 ? <EmptyState title="No invoices" />
                    : (
                      <table className="data">
                        <thead><tr><th>Number</th><th>Amount</th><th>myDATA</th><th>MARK</th><th>Issued</th></tr></thead>
                        <tbody>
                          {invoices.map((i) => (
                            <tr key={i.id}>
                              <td className="mono">{i.number}</td><td>{formatMoney(i.amount_cents)}</td>
                              <td><Badge tone={i.mydata_status === 'transmitted' ? 'success' : i.mydata_status === 'failed' ? 'danger' : 'warning'}>{titleCase(i.mydata_status)}</Badge></td>
                              <td className="mono">{i.mydata_mark ?? '—'}</td>
                              <td>{formatDate(i.issued_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ---------------- Activity ---------------- */}
      {tab === 'activity' ? (
        <div className="stack" style={{ gap: 'var(--space-lg)' }}>
          <Card>
            <CardHeader title="Activity timeline" sub="Rides, money, KYC, notifications, support — merged and grouped by day" />
            {timelineQ.isError ? (
              <ErrorState message={timelineQ.error instanceof Error ? timelineQ.error.message : 'Could not load the timeline'} />
            ) : (
              <TimelineFeed events={timelineQ.data?.rows ?? []} loading={timelineQ.isLoading} maxHeight={620} />
            )}
          </Card>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
            <Card>
              <CardHeader title={`Devices (${p?.devices.length ?? 0})`} sub="Login devices & push tokens" />
              <div className="table-wrap">
                {!p || p.devices.length === 0 ? <EmptyState title="No devices" /> : (
                  <table className="data">
                    <thead><tr><th>Platform</th><th>Device</th><th>App</th><th>OS</th><th>Push token</th><th>Last seen</th></tr></thead>
                    <tbody>
                      {p.devices.map((d) => (
                        <tr key={d.id}>
                          <td>{titleCase(d.platform)}</td><td>{d.model}</td>
                          <td className="mono">{d.app_version}</td><td>{d.os_version}</td>
                          <td className="mono muted">{d.push_token_masked}</td><td>{relativeTime(d.last_seen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title={`Referrals (${data.referrals.length})`} sub={p ? `${p.referrals_qualified}/${p.referrals_sent} qualified · code ${p.referral_code}` : undefined} />
              <div className="table-wrap">
                {data.referrals.length === 0 ? <EmptyState title="No referrals" /> : (
                  <table className="data">
                    <thead><tr><th>Referrer</th><th>Referee</th><th>Status</th><th>Reward</th><th>When</th></tr></thead>
                    <tbody>
                      {data.referrals.map((r) => (
                        <tr key={r.id}>
                          <td>{r.referrer_name}</td><td>{r.referee_name}</td>
                          <td><Badge tone={r.status === 'rewarded' ? 'success' : 'info'}>{titleCase(r.status)}</Badge></td>
                          <td>{formatMoney(r.reward_cents)}</td><td>{relativeTime(r.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Loyalty events" sub={p ? `${p.loyalty_tier} · ${formatNumber(p.loyalty_points)} points` : undefined} />
              <div className="table-wrap">
                {!p || p.loyalty_events.length === 0 ? <EmptyState title="No loyalty events" /> : (
                  <table className="data">
                    <thead><tr><th>Points</th><th>Reason</th><th>When</th></tr></thead>
                    <tbody>
                      {p.loyalty_events.map((l) => (
                        <tr key={l.id}>
                          <td style={{ color: l.points > 0 ? colors.success : colors.danger, fontWeight: 600 }}>{l.points > 0 ? '+' : ''}{l.points}</td>
                          <td>{l.reason}</td><td>{relativeTime(l.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title={`Notifications sent (${notifications.length})`} sub="Push / email / SMS delivery log (docs/12)" />
              <div className="table-wrap">
                {panel.isLoading ? <Skeleton height={80} style={{ margin: 'var(--space-lg)' }} />
                  : notifications.length === 0 ? <EmptyState title="Nothing sent to this rider" />
                    : (
                      <table className="data">
                        <thead><tr><th>Template</th><th>Channel</th><th>Status</th><th>When</th></tr></thead>
                        <tbody>
                          {notifications.slice(0, 25).map((n) => (
                            <tr key={n.id}>
                              <td className="mono">{n.template_key}</td><td>{n.channel}</td>
                              <td><Badge tone={n.status === 'sent' ? 'success' : n.status === 'failed' ? 'danger' : 'neutral'}>{titleCase(n.status)}</Badge></td>
                              <td>{relativeTime(n.sent_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ---------------- Modals ---------------- */}
      <ChargeModal open={chargeOpen} onClose={() => setChargeOpen(false)} busy={charge.isPending} onSubmit={(v) => charge.mutate(v)} />
      <CreditModal open={creditOpen} onClose={() => setCreditOpen(false)} busy={credit.isPending} onSubmit={(amount, reason) => credit.mutate({ amount, reason })} />
      <ConfirmModal
        open={blockOpen} onClose={() => setBlockOpen(false)} onConfirm={(reason) => block.mutate(reason)}
        title={isBlocked ? 'Unblock user' : 'Block user'}
        message={isBlocked ? 'Restore ride access for this user.' : 'Blocks new rides immediately. Active trips are not interrupted.'}
        requireReason danger={!isBlocked} busy={block.isPending} confirmLabel={isBlocked ? 'Unblock' : 'Block'}
      />
      <ConfirmModal
        open={rekycOpen} onClose={() => setRekycOpen(false)}
        onConfirm={async (reason) => {
          await ds.logAudit({ action: 'force_rekyc', entity: 'user', entity_id: id, reason });
          toast.push('Re-KYC requested (audited)', 'success');
          qc.invalidateQueries({ queryKey: ['sumsub', id] });
          setRekycOpen(false);
        }}
        title="Force re-KYC"
        message="Sets KYC to pending and prompts the rider to re-verify through Sumsub. The existing applicant is reused via externalUserId (docs/09)."
        requireReason confirmLabel="Request re-KYC"
      />
      <ConfirmModal
        open={gdprOpen !== null} onClose={() => setGdprOpen(null)}
        onConfirm={async (reason) => {
          await ds.logAudit({ action: gdprOpen === 'delete' ? 'gdpr_delete' : 'gdpr_export', entity: 'user', entity_id: id, reason });
          toast.push(gdprOpen === 'delete' ? 'Deletion scheduled (audited)' : 'Export queued — link emailed', gdprOpen === 'delete' ? 'error' : 'success');
          setGdprOpen(null);
        }}
        title={gdprOpen === 'delete' ? 'GDPR delete' : 'GDPR data export'}
        message={gdprOpen === 'delete'
          ? 'Irreversibly anonymizes this user. Financial records required by Greek law are retained in pseudonymized form (docs/10).'
          : 'Assembles profile, rides, payments and KYC references into a downloadable archive and emails the rider a link.'}
        requireReason danger={gdprOpen === 'delete'} confirmLabel={gdprOpen === 'delete' ? 'Schedule delete' : 'Export'}
      />
      <RefundModal
        target={refundTarget} onClose={() => setRefundTarget(null)} busy={refund.isPending}
        onSubmit={(amount, reason) => { if (refundTarget) refund.mutate({ paymentId: refundTarget.id, amount, reason }); }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'danger' | 'warning' | 'success' }) {
  const col = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.text;
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value" style={{ color: col }}>{value}</span>
      {hint ? <span className="tile-hint">{hint}</span> : null}
    </div>
  );
}

function ScoreMeter({ label, value, good }: { label: string; value: number; good: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  // "good" metrics are green when high; risk is green when low.
  const level = good ? v : 100 - v;
  const col = level >= 70 ? colors.success : level >= 40 ? colors.warning : colors.danger;
  return (
    <div>
      <div className="between" style={{ fontSize: 12 }}>
        <span className="muted">{label}</span>
        <b style={{ color: col }}>{v}</b>
      </div>
      <div className="meter" style={{ marginTop: 4 }}><span style={{ width: `${v}%`, background: col }} /></div>
    </div>
  );
}

function YesNo({ v }: { v: boolean }) {
  return <Badge tone={v ? 'success' : 'neutral'}>{v ? 'On' : 'Off'}</Badge>;
}

function ConsentValue({ ok, at, extra }: { ok: boolean; at: string | null; extra?: string }) {
  if (!ok) return <Badge tone="neutral">Not given</Badge>;
  return (
    <span>
      <Badge tone="success">Given</Badge>{' '}
      <span className="muted" style={{ fontSize: 12 }}>{at ? formatDateTime(at) : 'no timestamp'}{extra ? ` · ${extra}` : ''}</span>
    </span>
  );
}

function TagEditor({ tags, onAdd, onRemove }: { tags: string[]; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [value, setValue] = useState('');
  const suggestions = useMemo(
    () => ['vip', 'chargeback-risk', 'commuter', 'tourist', 'support-heavy', 'photo-issues'].filter((s) => !tags.includes(s)),
    [tags],
  );
  return (
    <div>
      <div className="row-wrap" style={{ gap: 6, minHeight: 28 }}>
        {tags.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>No tags yet.</span> : null}
        {tags.map((t) => (
          <span key={t} className="tag-chip">#{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => onRemove(t)}>✕</button></span>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <Input
          style={{ maxWidth: 220 }} value={value} placeholder="new-tag"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(value); setValue(''); } }}
        />
        <Button onClick={() => { onAdd(value); setValue(''); }} disabled={!value.trim()}>Add tag</Button>
      </div>
      {suggestions.length ? (
        <div className="toolbar" style={{ marginTop: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>Suggestions:</span>
          {suggestions.map((s) => <Chip key={s} onClick={() => onAdd(s)}>{s}</Chip>)}
        </div>
      ) : null}
    </div>
  );
}

function NoteComposer({ onSave }: { onSave: (body: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note (staff only) — saved to the audit log…" />
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" disabled={text.trim().length < 3} onClick={() => { onSave(text.trim()); setText(''); }}>Save note</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

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

function RefundModal({ target, onClose, onSubmit, busy }: { target: { id: string; amount_cents: number } | null; onClose: () => void; onSubmit: (amount: number, reason: string) => void; busy?: boolean }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const max = target?.amount_cents ?? 0;
  const cents = Math.round(parseFloat(amount || '0') * 100) || max;
  return (
    <Modal
      open={target !== null} onClose={onClose} title="Issue refund"
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy || reason.trim().length < 3} onClick={() => onSubmit(cents, reason.trim())}>Refund {formatMoney(cents)}</Button></>}
    >
      <p className="muted" style={{ marginTop: 0 }}>Payment <span className="mono">{target?.id}</span> · captured {formatMoney(max)}</p>
      <Field label="Amount (EUR)" hint={`Leave blank for the full ${formatMoney(max)}`}><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={(max / 100).toFixed(2)} /></Field>
      <Field label="Reason" required hint="Recorded in audit_log."><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
