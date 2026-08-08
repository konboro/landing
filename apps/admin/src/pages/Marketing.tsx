import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, Field, Input, Select } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { MapView, type MapMarker } from '@/components/map/MapView';
import { formatMoney, formatDate, titleCase, relativeTime } from '@/lib/format';
import { colors } from '@penny/ui';

export function MarketingPage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('promos');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Marketing" sub="Promos, groups, campaigns, loyalty, POIs, referrals" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'promos', label: 'Promo codes' },
        { key: 'groups', label: 'Customer groups' },
        { key: 'campaigns', label: 'Campaigns' },
        { key: 'loyalty', label: 'Loyalty' },
        { key: 'pois', label: 'POIs' },
        { key: 'referrals', label: 'Referral program' },
      ]} />
      {isLoading || !db ? <Card pad>Loading…</Card> : (
        <>
          {tab === 'promos' ? <Promos db={db} /> : null}
          {tab === 'groups' ? <Groups db={db} /> : null}
          {tab === 'campaigns' ? <Campaigns db={db} /> : null}
          {tab === 'loyalty' ? <Loyalty db={db} /> : null}
          {tab === 'pois' ? <Pois db={db} /> : null}
          {tab === 'referrals' ? <Referrals db={db} /> : null}
        </>
      )}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

function Promos({ db }: { db: DB }) {
  return (
    <Card>
      <CardHeader title="Promo codes" actions={<Button variant="primary">+ New code</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Used / max</th><th>Per user</th><th>Window</th><th>New only</th><th>Status</th></tr></thead>
          <tbody>
            {db.promos.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.code}</td><td>{titleCase(p.kind)}</td>
                <td>{p.kind === 'percent' ? `${p.value}%` : p.kind === 'free_minutes' ? `${p.value} min` : formatMoney(p.value)}</td>
                <td>{p.used} / {p.max_uses}</td><td>{p.per_user_limit}</td>
                <td>{formatDate(p.valid_from)} → {formatDate(p.valid_to)}</td>
                <td>{p.new_users_only ? 'Yes' : '—'}</td>
                <td>{p.active && p.used < p.max_uses ? <Badge tone="success">Active</Badge> : <Badge>Ended</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Groups({ db }: { db: DB }) {
  const [rules, setRules] = useState<Array<{ field: string; op: string; value: string }>>([{ field: 'rides', op: '>=', value: '50' }]);
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Card>
        <CardHeader title="Customer groups" actions={<Button variant="primary">+ New group</Button>} />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Type</th><th>Members</th></tr></thead>
            <tbody>{db.groups.map((g) => <tr key={g.id}><td>{g.name}</td><td><Badge tone={g.kind === 'rule' ? 'info' : 'neutral'}>{g.kind}</Badge></td><td>{g.member_count}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Rule builder" sub="rides count · last active · city · debt" />
        <div className="card-pad stack">
          {rules.map((r, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <Select value={r.field} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>{['rides', 'last_active_days', 'city', 'debt_cents', 'score'].map((f) => <option key={f}>{f}</option>)}</Select>
              <Select value={r.op} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, op: e.target.value } : x))} style={{ width: 90 }}>{['>=', '<=', '=', '>', '<'].map((o) => <option key={o}>{o}</option>)}</Select>
              <Input value={r.value} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
              <Button variant="ghost" onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setRules([...rules, { field: 'rides', op: '>=', value: '1' }])}>+ Add rule</Button>
          <div className="divider" />
          <div className="muted" style={{ fontSize: 13 }}>Matches: {db.customers.filter((c) => rules.every((r) => matchRule(c, r))).length} customers</div>
        </div>
      </Card>
    </div>
  );
}

function matchRule(c: DB['customers'][number], r: { field: string; op: string; value: string }): boolean {
  const v = r.field === 'rides' ? c.rides : r.field === 'debt_cents' ? c.debt_cents : r.field === 'score' ? c.score : r.field === 'city' ? c.city_name : 0;
  const num = Number(r.value);
  if (r.field === 'city') return c.city_name === r.value;
  switch (r.op) { case '>=': return (v as number) >= num; case '<=': return (v as number) <= num; case '>': return (v as number) > num; case '<': return (v as number) < num; default: return (v as number) === num; }
}

function Campaigns({ db }: { db: DB }) {
  const toast = useToast();
  const [title, setTitle] = useState('Weekend 2x points!');
  const [body, setBody] = useState('Ride this weekend, earn double loyalty points.');
  const [segment, setSegment] = useState('Loyal riders');
  const [channel, setChannel] = useState<'push' | 'email'>('push');
  return (
    <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
      <div className="stack" style={{ gap: 'var(--space-lg)' }}>
        <Card>
          <CardHeader title="Compose campaign" />
          <div className="card-pad">
            <div className="row" style={{ gap: 8 }}>
              <Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value as 'push' | 'email')}><option value="push">Push</option><option value="email">Email</option></Select></Field>
              <Field label="Segment"><Select value={segment} onChange={(e) => setSegment(e.target.value)}>{db.groups.map((g) => <option key={g.id}>{g.name}</option>)}<option>All (marketing consent)</option></Select></Field>
            </div>
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Body"><Input value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <Field label="Schedule"><Input type="datetime-local" /></Field>
              <Button variant="primary" onClick={() => toast.push('Campaign scheduled', 'success')}>Schedule</Button>
              <Button onClick={() => toast.push('Test sent to you', 'info')}>Send test to me</Button>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Campaign history" />
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Title</th><th>Channel</th><th>Segment</th><th>Sent</th><th>Open</th><th>Status</th></tr></thead>
              <tbody>{db.campaigns.map((c) => <tr key={c.id}><td>{c.title}</td><td>{c.channel}</td><td>{c.segment}</td><td>{c.sent_count || '—'}</td><td>{c.open_rate ? `${c.open_rate}%` : '—'}</td><td><Badge tone={c.status === 'sent' ? 'success' : c.status === 'scheduled' ? 'info' : 'neutral'}>{titleCase(c.status)}</Badge></td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Device preview" />
        <div className="card-pad" style={{ display: 'grid', placeItems: 'center' }}>
          <PhonePreview channel={channel} title={title} body={body} />
        </div>
      </Card>
    </div>
  );
}

function PhonePreview({ channel, title, body }: { channel: 'push' | 'email'; title: string; body: string }) {
  return (
    <div style={{ width: 260, height: 500, borderRadius: 34, border: '10px solid #111', background: 'linear-gradient(160deg,#2f5be0,#183492)', padding: 14, position: 'relative', overflow: 'hidden' }}>
      <div style={{ color: '#fff', textAlign: 'center', fontSize: 13, marginTop: 40, opacity: 0.9 }}>9:41</div>
      <div style={{ position: 'absolute', top: 90, left: 12, right: 12, background: 'rgba(255,255,255,.95)', borderRadius: 14, padding: 12, boxShadow: '0 8px 24px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: colors.primary, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>P</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Penny</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888' }}>{channel === 'push' ? 'now' : 'Inbox'}</span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{title || 'Title'}</div>
        <div style={{ fontSize: 13, color: '#333', marginTop: 2 }}>{body || 'Body text…'}</div>
      </div>
    </div>
  );
}

function Loyalty({ db }: { db: DB }) {
  return (
    <Card>
      <CardHeader title="Loyalty tiers" actions={<Button variant="primary">+ New tier</Button>} />
      <div className="card-pad row-wrap">
        {db.loyalty.map((t) => (
          <div key={t.id} className="card" style={{ padding: 16, flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>≥ {t.min_points} pts</div>
            <div className="divider" />
            {t.perks.map((p) => <div key={p} style={{ fontSize: 13 }}>✓ {p}</div>)}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Pois({ db }: { db: DB }) {
  const markers: MapMarker[] = db.pois.map((p) => ({ id: p.id, lng: p.pos.coordinates[0], lat: p.pos.coordinates[1], color: colors.primary, label: p.name }));
  return (
    <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
      <Card><CardHeader title="POI map" /><div className="card-pad"><MapView height={360} markers={markers} /></div></Card>
      <Card>
        <CardHeader title="POIs" actions={<Button variant="primary" size="sm">+ Add</Button>} />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Kind</th><th>Active</th></tr></thead>
            <tbody>{db.pois.map((p) => <tr key={p.id}><td>{p.icon} {p.name}</td><td>{p.kind}</td><td>{p.active ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Referrals({ db }: { db: DB }) {
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Referral program config" />
        <div className="card-pad row-wrap">
          <Field label="Referrer reward (EUR)"><Input defaultValue="5.00" /></Field>
          <Field label="Referee reward (EUR)"><Input defaultValue="5.00" /></Field>
          <Field label="Qualify on"><Select><option>First charged trip</option><option>Signup</option><option>KYC approved</option></Select></Field>
          <div style={{ alignSelf: 'flex-end' }}><Button variant="primary">Save</Button></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Referrals" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Referrer</th><th>Referee</th><th>Status</th><th>Reward</th><th>When</th></tr></thead>
            <tbody>{db.referrals.map((r) => <tr key={r.id}><td>{r.referrer_name}</td><td>{r.referee_name}</td><td><Badge tone={r.status === 'rewarded' ? 'success' : 'info'}>{titleCase(r.status)}</Badge></td><td>{formatMoney(r.reward_cents)}</td><td>{relativeTime(r.created_at)}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
