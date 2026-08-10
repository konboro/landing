import { useMemo, useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { Card, CardHeader, Button, Select, Input } from '@/components/ui/primitives';
import { Badge, PaymentStatusBadge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/feedback';
import { downloadCsv } from '@/lib/csv';
import { formatMoney, titleCase, relativeTime, formatDateTime } from '@/lib/format';
import { colors } from '@penny/ui';
import type { Payment } from '@/types/domain';

export function FinancePage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('transactions');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Finance" sub="Transactions, ledger, debts, invoices, myDATA, reconciliation" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'transactions', label: 'Transactions' },
        { key: 'ledger', label: 'Ledger explorer' },
        { key: 'debts', label: 'Debts' },
        { key: 'invoices', label: 'Invoices / myDATA' },
        { key: 'recon', label: 'Reconciliation' },
      ]} />
      {isLoading || !db ? <Card pad>Loading…</Card> : (
        <>
          {tab === 'transactions' ? <Transactions db={db} /> : null}
          {tab === 'ledger' ? <Ledger db={db} /> : null}
          {tab === 'debts' ? <Debts db={db} /> : null}
          {tab === 'invoices' ? <Invoices db={db} /> : null}
          {tab === 'recon' ? <Recon db={db} /> : null}
        </>
      )}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

function Transactions({ db }: { db: DB }) {
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const rows = db.payments.filter((p) => (kind === 'all' || p.kind === kind) && (status === 'all' || p.status === status) && (!q || p.id.includes(q) || p.user_id.includes(q)));
  const total = rows.filter((p) => p.status === 'succeeded').reduce((s, p) => s + p.amount_cents, 0);
  return (
    <Card>
      <CardHeader title={`Transaction history (${rows.length})`} sub={`Captured: ${formatMoney(total)}`} actions={<Button size="sm" onClick={() => downloadCsv('transactions', rows, [
        { header: 'ID', value: (p: Payment) => p.id }, { header: 'User', value: (p: Payment) => p.user_id }, { header: 'Kind', value: (p: Payment) => p.kind },
        { header: 'Amount', value: (p: Payment) => p.amount_cents }, { header: 'Status', value: (p: Payment) => p.status }, { header: 'When', value: (p: Payment) => p.created_at },
      ])}>⬇ CSV</Button>} />
      <div className="card-pad" style={{ paddingBottom: 8 }}>
        <div className="toolbar">
          <Input style={{ maxWidth: 220 }} placeholder="Search id / user…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All kinds</option>{['trip', 'topup', 'package', 'subscription', 'addon', 'penalty', 'manual'].map((k) => <option key={k}>{k}</option>)}</Select>
          <Select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{['succeeded', 'failed', 'refunded'].map((k) => <option key={k}>{k}</option>)}</Select>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>ID</th><th>Kind</th><th>Amount</th><th>Status</th><th>By</th><th>Reason</th><th>When</th></tr></thead>
          <tbody>{rows.slice(0, 100).map((p) => <tr key={p.id}><td className="mono">{p.id}</td><td>{titleCase(p.kind)}</td><td>{formatMoney(p.amount_cents)}</td><td><PaymentStatusBadge status={p.status} /></td><td>{p.initiated_by}</td><td className="muted">{p.admin_reason ?? '—'}</td><td>{relativeTime(p.created_at)}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Ledger({ db }: { db: DB }) {
  const txns = useMemo(() => {
    const map = new Map<string, DB['ledgerEntries']>();
    for (const e of db.ledgerEntries) { const a = map.get(e.txn_id) ?? []; a.push(e); map.set(e.txn_id, a); }
    return Array.from(map.entries()).slice(0, 40);
  }, [db]);
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Ledger accounts" sub="Balances are derived (never a mutable column)" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Account</th><th>Kind</th><th>Balance</th></tr></thead>
            <tbody>{db.ledgerAccounts.map((a) => <tr key={a.id}><td>{a.owner_label}</td><td>{titleCase(a.kind)}</td><td style={{ color: a.balance_cents < 0 ? colors.danger : colors.success, fontWeight: 600 }}>{formatMoney(a.balance_cents)}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Transactions (double-entry)" sub="Each txn sums to 0" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Txn</th><th>Entries</th><th>Sum</th><th>Balanced</th></tr></thead>
            <tbody>
              {txns.map(([txn, entries]) => {
                const sum = entries.reduce((s, e) => s + e.delta_cents, 0);
                return (
                  <tr key={txn}>
                    <td className="mono">{txn}</td>
                    <td>{entries.map((e) => <span key={e.id} className="pill-tag">{titleCase(e.account_kind)} {formatMoney(e.delta_cents)}</span>)}</td>
                    <td>{formatMoney(sum)}</td>
                    <td>{sum === 0 ? <Badge tone="success">Balanced</Badge> : <Badge tone="danger">Off by {formatMoney(sum)}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Debts({ db }: { db: DB }) {
  const now = Date.now();
  const buckets = { '0–7d': 0, '8–30d': 0, '31–90d': 0, '90d+': 0 } as Record<string, number>;
  for (const d of db.debts) {
    const age = (now - new Date(d.created_at).getTime()) / 86400000;
    const k = age <= 7 ? '0–7d' : age <= 30 ? '8–30d' : age <= 90 ? '31–90d' : '90d+';
    buckets[k]! += d.amount_cents;
  }
  const custName = (id: string) => db.customers.find((c) => c.id === id)?.full_name ?? id;
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <div className="row-wrap">
        {Object.entries(buckets).map(([k, v]) => <div key={k} className="card stat-card" style={{ minWidth: 160, flex: 1 }}><span className="stat-label">{k}</span><span style={{ fontSize: 20, fontWeight: 700, color: v > 0 ? colors.danger : colors.text }}>{formatMoney(v)}</span></div>)}
      </div>
      <Card>
        <CardHeader title="Open debts" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Debt</th><th>Customer</th><th>Amount</th><th>Source</th><th>Status</th><th>Attempts</th><th>Age</th></tr></thead>
            <tbody>{db.debts.map((d) => <tr key={d.id}><td className="mono">{d.id}</td><td>{custName(d.user_id)}</td><td>{formatMoney(d.amount_cents)}</td><td>{titleCase(d.source)}</td><td><Badge tone={d.status === 'paid' ? 'success' : 'warning'}>{titleCase(d.status)}</Badge></td><td>{d.attempts}</td><td>{relativeTime(d.created_at)}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Invoices({ db }: { db: DB }) {
  if (!db.invoices.length) {
    return (
      <Card>
        <CardHeader title="Invoices & myDATA transmission" sub="AADE e-invoicing status" />
        <EmptyState
          emoji="🧾"
          title="No invoices issued yet"
          hint="Invoices appear here once myDATA e-invoicing goes live (docs/05, phase 4). Until then rides are receipted through Stripe — see Transactions."
        />
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Invoices & myDATA transmission" sub="AADE e-invoicing status" />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Number</th><th>Party</th><th>Amount</th><th>myDATA mark</th><th>Status</th><th>Issued</th><th></th></tr></thead>
          <tbody>{db.invoices.map((i) => <tr key={i.id}><td className="mono">{i.number}</td><td>{i.party_label}</td><td>{formatMoney(i.amount_cents)}</td><td className="mono" style={{ fontSize: 12 }}>{i.mydata_mark ?? '—'}</td><td><Badge tone={i.mydata_status === 'transmitted' ? 'success' : i.mydata_status === 'failed' ? 'danger' : 'warning'}>{titleCase(i.mydata_status)}</Badge></td><td>{formatDateTime(i.issued_at)}</td><td><Button size="sm" variant="ghost" disabled title="Invoice PDFs are generated by the myDATA e-invoicing service (docs/05, phase 4), which is not live yet.">PDF</Button></td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Recon({ db }: { db: DB }) {
  const stripeClearing = db.ledgerAccounts.find((a) => a.kind === 'stripe_clearing')?.balance_cents ?? 0;
  const captured = db.payments.filter((p) => p.status === 'succeeded').reduce((s, p) => s + p.amount_cents, 0);
  const diff = captured - stripeClearing;
  return (
    <Card>
      <CardHeader title="Stripe ↔ ledger reconciliation" sub="Balance drift detection" />
      <div className="card-pad">
        <div className="row-wrap">
          <div className="card stat-card" style={{ flex: 1, minWidth: 200 }}><span className="stat-label">Stripe captured (payments)</span><span style={{ fontSize: 20, fontWeight: 700 }}>{formatMoney(captured)}</span></div>
          <div className="card stat-card" style={{ flex: 1, minWidth: 200 }}><span className="stat-label">Ledger stripe_clearing</span><span style={{ fontSize: 20, fontWeight: 700 }}>{formatMoney(stripeClearing)}</span></div>
          <div className="card stat-card" style={{ flex: 1, minWidth: 200 }}><span className="stat-label">Difference</span><span style={{ fontSize: 20, fontWeight: 700, color: diff === 0 ? colors.success : colors.warning }}>{formatMoney(diff)}</span></div>
        </div>
        <div style={{ marginTop: 14 }}>{diff === 0 ? <Badge tone="success">Reconciled</Badge> : <Badge tone="warning">Investigate {formatMoney(Math.abs(diff))} — likely in-flight captures/refunds</Badge>}</div>
      </div>
    </Card>
  );
}
