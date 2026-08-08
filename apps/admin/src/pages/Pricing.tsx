import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney, titleCase } from '@/lib/format';
import { colors } from '@penny/ui';

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PricingPage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('plans');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Pricing" sub="Plans, dynamic pricing, packages, subscriptions, add-ons, penalties" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'plans', label: 'Plans' },
        { key: 'dynamic', label: 'Dynamic pricing' },
        { key: 'packages', label: 'Packages' },
        { key: 'subs', label: 'Subscriptions' },
        { key: 'addons', label: 'Add-ons' },
        { key: 'penalties', label: 'Penalties' },
      ]} />
      {isLoading || !db ? <Card pad>Loading…</Card> : (
        <>
          {tab === 'plans' ? <Plans db={db} /> : null}
          {tab === 'dynamic' ? <Dynamic /> : null}
          {tab === 'packages' ? <Packages db={db} /> : null}
          {tab === 'subs' ? <Subs db={db} /> : null}
          {tab === 'addons' ? <Addons db={db} /> : null}
          {tab === 'penalties' ? <Penalties db={db} /> : null}
        </>
      )}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

function Plans({ db }: { db: DB }) {
  const modelName = (id: string) => db.models.find((m) => m.id === id)?.name ?? id;
  const cityName = (id: string) => db.cities.find((c) => c.id === id)?.name ?? id;
  return (
    <Card>
      <CardHeader title="Pricing plans" sub="Per city × model" actions={<Button variant="primary">+ New plan</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>City</th><th>Model</th><th>Unlock</th><th>Per min</th><th>Pause/min</th><th>Day cap</th><th>Dynamic</th><th>Status</th></tr></thead>
          <tbody>
            {db.pricingPlans.map((p) => (
              <tr key={p.id}>
                <td>{cityName(p.city_id)}</td><td>{modelName(p.model_id)}</td>
                <td>{formatMoney(p.unlock_cents)}</td><td>{formatMoney(p.per_min_cents)}</td><td>{formatMoney(p.pause_per_min_cents)}</td>
                <td>{p.day_cap_cents ? formatMoney(p.day_cap_cents) : '—'}</td>
                <td>{p.dynamic.demand.enabled ? <Badge tone="info">demand ≤{p.dynamic.demand.cap}×</Badge> : '—'}</td>
                <td>{p.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Dynamic() {
  const grid: number[][] = DOWS.map((_, dow) => Array.from({ length: 24 }, (_, h) => {
    let m = 1;
    if (h >= 7 && h <= 9) m += 0.3; // morning peak
    if (h >= 17 && h <= 19) m += 0.4; // evening peak
    if (dow === 1 && h >= 10 && h <= 12) m = 0.8; // happy hour
    if (h >= 0 && h <= 5) m = 0.9;
    return Math.min(1.5, +m.toFixed(2));
  }));
  const color = (m: number) => m < 1 ? `rgba(31,170,89,${(1 - m) * 2 + 0.2})` : `rgba(224,65,65,${(m - 1) * 1.2 + 0.08})`;
  return (
    <Card>
      <CardHeader title="Dynamic pricing preview" sub="Multiplier by day × hour (transparent, capped 1.5×, shown pre-ride)" />
      <div className="card-pad scroll-x">
        <table className="matrix">
          <thead><tr><th className="rowhead"></th>{Array.from({ length: 24 }).map((_, h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {DOWS.map((d, dow) => (
              <tr key={d}><td className="rowhead">{d}</td>{grid[dow]!.map((m, h) => <td key={h} style={{ background: color(m), fontSize: 11 }} title={`${m}×`}>{m !== 1 ? m : ''}</td>)}</tr>
            ))}
          </tbody>
        </table>
        <div className="row-wrap" style={{ marginTop: 12, fontSize: 13 }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(31,170,89,.6)', borderRadius: 3, marginRight: 4 }} />Happy hour (&lt;1×)</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(224,65,65,.5)', borderRadius: 3, marginRight: 4 }} />Peak demand (&gt;1×)</span>
        </div>
      </div>
    </Card>
  );
}

function Packages({ db }: { db: DB }) {
  return (
    <Card>
      <CardHeader title="Packages" sub="Minute bundles" actions={<Button variant="primary">+ New package</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Minutes</th><th>Price</th><th>Validity</th><th>Sold</th><th>Status</th></tr></thead>
          <tbody>{db.packages.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.minutes}</td><td>{formatMoney(p.price_cents)}</td><td>{p.validity_days}d</td><td>{p.sold}</td><td>{p.active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Subs({ db }: { db: DB }) {
  return (
    <Card>
      <CardHeader title="Subscriptions" actions={<Button variant="primary">+ New subscription</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Price</th><th>Perks</th><th>Active subs</th><th>Status</th></tr></thead>
          <tbody>{db.subscriptions.map((s) => <tr key={s.id}><td>{s.name}</td><td>{formatMoney(s.price_cents)}/mo</td><td>{s.perks.map((p) => <span key={p} className="pill-tag">{p}</span>)}</td><td>{s.active_subs}</td><td>{s.active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Addons({ db }: { db: DB }) {
  return (
    <Card>
      <CardHeader title="Add-ons" actions={<Button variant="primary">+ New add-on</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Kind</th><th>Price</th><th>Per</th><th>Status</th></tr></thead>
          <tbody>{db.addons.map((a) => <tr key={a.id}><td>{a.name}</td><td>{titleCase(a.kind)}</td><td>{formatMoney(a.price_cents)}</td><td>{a.per}</td><td>{a.active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Penalties({ db }: { db: DB }) {
  return (
    <Card>
      <CardHeader title="Penalties catalogue" sub="Escalation tiers with photo evidence + appeal" actions={<Button variant="primary">+ New penalty</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Code</th><th>Label</th><th>Tiers</th><th>Photo</th><th>Appealable</th><th>Status</th></tr></thead>
          <tbody>{db.penalties.map((p) => <tr key={p.id}><td className="mono">{p.code}</td><td>{p.label}</td><td>{p.tiers_cents.map((t) => formatMoney(t)).join(' → ')}</td><td>{p.requires_photo ? 'Required' : '—'}</td><td>{p.appealable ? 'Yes' : 'No'}</td><td style={{ color: colors.text }}>{p.active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}
