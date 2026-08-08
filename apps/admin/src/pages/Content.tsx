import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, Input, Textarea, Select, Field } from '@/components/ui/primitives';
import { Badge, PaymentStatusBadge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney, titleCase, relativeTime } from '@/lib/format';
import type { FaqItem } from '@penny/db-types';

export function ContentPage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('products');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Subscriptions & Add-ons content" sub="Products, purchase history, FAQ editor" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'products', label: 'Products' },
        { key: 'purchases', label: 'Purchase history' },
        { key: 'faq', label: 'FAQ editor' },
      ]} />
      {isLoading || !db ? <Card pad>Loading…</Card> : (
        <>
          {tab === 'products' ? <Products db={db} /> : null}
          {tab === 'purchases' ? <Purchases db={db} /> : null}
          {tab === 'faq' ? <Faq db={db} /> : null}
        </>
      )}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

function Products({ db }: { db: DB }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Card>
        <CardHeader title="Subscriptions" actions={<Button size="sm" variant="primary">+ New</Button>} />
        <div className="card-pad stack">
          {db.subscriptions.map((s) => (
            <div key={s.id} className="between" style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
              <div><div style={{ fontWeight: 600 }}>{s.name}</div><div className="muted" style={{ fontSize: 13 }}>{s.perks.join(' · ')}</div></div>
              <div style={{ textAlign: 'right' }}><div>{formatMoney(s.price_cents)}/mo</div><div className="muted" style={{ fontSize: 12 }}>{s.active_subs} active</div></div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Packages & add-ons" actions={<Button size="sm" variant="primary">+ New</Button>} />
        <div className="card-pad stack">
          {db.packages.map((p) => <div key={p.id} className="between" style={{ fontSize: 14 }}><span>{p.name} <span className="muted">({p.minutes} min)</span></span><span>{formatMoney(p.price_cents)}</span></div>)}
          <div className="divider" />
          {db.addons.map((a) => <div key={a.id} className="between" style={{ fontSize: 14 }}><span>{a.name} <Badge tone="neutral" dot={false}>{a.per}</Badge></span><span>{formatMoney(a.price_cents)}</span></div>)}
        </div>
      </Card>
    </div>
  );
}

function Purchases({ db }: { db: DB }) {
  const rows = db.payments.filter((p) => ['package', 'subscription', 'addon'].includes(p.kind));
  const custName = (id: string) => db.customers.find((c) => c.id === id)?.full_name ?? id;
  return (
    <Card>
      <CardHeader title="Purchase history" sub={`${rows.length} product purchases`} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}><td className="mono">{p.id}</td><td>{custName(p.user_id)}</td><td>{titleCase(p.kind)}</td><td>{formatMoney(p.amount_cents)}</td><td><PaymentStatusBadge status={p.status} /></td><td>{relativeTime(p.created_at)}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Faq({ db }: { db: DB }) {
  const toast = useToast();
  const [items, setItems] = useState<FaqItem[]>(db.faq);
  const [lang, setLang] = useState('en');
  const shown = items.filter((f) => f.lang === lang);
  const update = (id: string, patch: Partial<FaqItem>) => setItems(items.map((f) => f.id === id ? { ...f, ...patch } : f));
  return (
    <Card>
      <CardHeader title="FAQ editor" actions={
        <>
          <Select style={{ width: 'auto' }} value={lang} onChange={(e) => setLang(e.target.value)}>{['en', 'el', 'pl'].map((l) => <option key={l}>{l}</option>)}</Select>
          <Button size="sm" onClick={() => setItems([...items, { id: `faq-${Date.now()}`, lang: lang as FaqItem['lang'], question: '', answer: '', sort: shown.length + 1 }])}>+ Add</Button>
          <Button size="sm" variant="primary" onClick={() => toast.push('FAQ saved', 'success')}>Save</Button>
        </>
      } />
      <div className="card-pad stack">
        {shown.length === 0 ? <div className="muted">No FAQ items for {lang}.</div> : shown.map((f) => (
          <div key={f.id} className="card" style={{ padding: 12 }}>
            <Field label="Question"><Input value={f.question} onChange={(e) => update(f.id, { question: e.target.value })} /></Field>
            <Field label="Answer"><Textarea value={f.answer} onChange={(e) => update(f.id, { answer: e.target.value })} /></Field>
          </div>
        ))}
      </div>
    </Card>
  );
}
