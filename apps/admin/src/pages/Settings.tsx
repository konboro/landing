import { useMemo, useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, Input, Select, Textarea, Checkbox, Field } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { LineTrend, chartPalette } from '@/components/charts/Charts';
import { titleCase } from '@/lib/format';
import { vehicleStatusColor } from '@penny/ui';
import type { AppConfigItem, BatteryCurve, NotificationRule, Translation } from '@/types/domain';

export function SettingsPage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('prefs');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Settings" sub="System preferences, models, forms, localization, tutorials, notification rules" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'prefs', label: 'Preferences' },
        { key: 'models', label: 'Models & battery curves' },
        { key: 'form', label: 'Customer form' },
        { key: 'reaction', label: 'Reaction test' },
        { key: 'i18n', label: 'Localization' },
        { key: 'personalization', label: 'Map & personalization' },
        { key: 'tutorials', label: 'Tutorials' },
        { key: 'notifications', label: 'Alerts & notifications' },
      ]} />
      {isLoading || !db ? <Card pad>Loading…</Card> : (
        <>
          {tab === 'prefs' ? <Prefs db={db} /> : null}
          {tab === 'models' ? <Models db={db} /> : null}
          {tab === 'form' ? <FormBuilder /> : null}
          {tab === 'reaction' ? <Reaction /> : null}
          {tab === 'i18n' ? <I18n db={db} /> : null}
          {tab === 'personalization' ? <Personalization /> : null}
          {tab === 'tutorials' ? <Tutorials db={db} /> : null}
          {tab === 'notifications' ? <Notifications db={db} /> : null}
        </>
      )}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

function Prefs({ db }: { db: DB }) {
  const toast = useToast();
  const [config, setConfig] = useState<AppConfigItem[]>(db.appConfig);
  const groups = Array.from(new Set(config.map((c) => c.group)));
  const update = (key: string, value: string | number | boolean) => setConfig(config.map((c) => c.key === key ? { ...c, value } : c));
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      {groups.map((g) => (
        <Card key={g}>
          <CardHeader title={g} />
          <div className="card-pad row-wrap">
            {config.filter((c) => c.group === g).map((c) => (
              <div key={c.key} style={{ minWidth: 220 }}>
                <label className="field-label">{c.label}{c.unit ? ` (${c.unit})` : ''}</label>
                {c.kind === 'bool'
                  ? <Checkbox label={c.value ? 'Enabled' : 'Disabled'} checked={Boolean(c.value)} onChange={(e) => update(c.key, e.target.checked)} />
                  : <Input value={String(c.value)} type={c.kind === 'number' ? 'number' : c.kind === 'time' ? 'time' : 'text'} onChange={(e) => update(c.key, c.kind === 'number' ? Number(e.target.value) : e.target.value)} />}
              </div>
            ))}
          </div>
        </Card>
      ))}
      <div><Button variant="primary" onClick={() => toast.push('Preferences saved (audited)', 'success')}>Save preferences</Button></div>
    </div>
  );
}

function Models({ db }: { db: DB }) {
  const [curve, setCurve] = useState<BatteryCurve>(db.batteryCurves[0]!);
  const chartData = useMemo(() => {
    // linear interpolation preview across voltage range
    const pts = [...curve.points].sort((a, b) => a[0] - b[0]);
    const out: Array<{ v: number; soc: number }> = [];
    const min = pts[0]![0]; const max = pts[pts.length - 1]![0];
    for (let v = min; v <= max; v += (max - min) / 40) {
      let soc = 0;
      for (let i = 1; i < pts.length; i++) {
        if (v <= pts[i]![0]) { const [v0, s0] = pts[i - 1]!; const [v1, s1] = pts[i]!; soc = s0 + ((v - v0) / (v1 - v0)) * (s1 - s0); break; }
      }
      out.push({ v: +(v / 1000).toFixed(2), soc: +soc.toFixed(1) });
    }
    return out;
  }, [curve]);
  const updatePoint = (i: number, idx: 0 | 1, value: number) => setCurve({ ...curve, points: curve.points.map((p, j) => j === i ? (idx === 0 ? [value, p[1]] : [p[0], value]) : p) as Array<[number, number]> });
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Vehicle models" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Kind</th><th>Max speed</th><th>Requires licence</th><th>Battery curve</th></tr></thead>
            <tbody>{db.models.map((m) => <tr key={m.id}><td>{m.name}</td><td>{m.kind}</td><td>{m.max_speed_kmh} km/h</td><td>{m.requires_licence ? 'Yes' : 'No'}</td><td>{db.batteryCurves.find((c) => c.id === m.battery_curve_id)?.name ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Battery curve editor" sub="voltage (mV) ↔ SoC (%) · linear interpolation" actions={
          <Select style={{ width: 'auto' }} value={curve.id} onChange={(e) => setCurve(db.batteryCurves.find((c) => c.id === e.target.value)!)}>{db.batteryCurves.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        } />
        <div className="card-pad grid" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Voltage (mV)</th><th>SoC (%)</th></tr></thead>
              <tbody>{curve.points.map((p, i) => <tr key={i}><td><Input type="number" value={p[0]} onChange={(e) => updatePoint(i, 0, Number(e.target.value))} style={{ width: 110 }} /></td><td><Input type="number" value={p[1]} onChange={(e) => updatePoint(i, 1, Number(e.target.value))} style={{ width: 80 }} /></td></tr>)}</tbody>
            </table>
          </div>
          <div><LineTrend data={chartData} xKey="v" height={260} series={[{ key: 'soc', name: 'SoC %', color: chartPalette[1]! }]} /></div>
        </div>
      </Card>
    </div>
  );
}

function FormBuilder() {
  const toast = useToast();
  const [fields, setFields] = useState([
    { label: 'Full name', kind: 'text', required: true },
    { label: 'Email', kind: 'email', required: true },
    { label: 'Date of birth', kind: 'date', required: false },
    { label: 'How did you hear about us?', kind: 'select', required: false },
  ]);
  return (
    <Card>
      <CardHeader title="Customer form builder" sub="Extra signup questions" actions={<><Button size="sm" onClick={() => setFields([...fields, { label: 'New field', kind: 'text', required: false }])}>+ Field</Button><Button size="sm" variant="primary" onClick={() => toast.push('Form saved', 'success')}>Save</Button></>} />
      <div className="card-pad stack">
        {fields.map((f, i) => (
          <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Input value={f.label} onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
            <Select style={{ width: 140 }} value={f.kind} onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))}>{['text', 'email', 'date', 'select', 'number'].map((k) => <option key={k}>{k}</option>)}</Select>
            <Checkbox label="Required" checked={f.required} onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} />
            <Button variant="ghost" onClick={() => setFields(fields.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Reaction() {
  const toast = useToast();
  return (
    <Card>
      <CardHeader title="Reaction test (night anti-DUI gate)" />
      <div className="card-pad row-wrap">
        <Field label="Enabled at night"><Select><option>Yes</option><option>No</option></Select></Field>
        <Field label="Night window"><Input defaultValue="23:00–05:00" /></Field>
        <Field label="Rounds to pass"><Input type="number" defaultValue="3" /></Field>
        <Field label="Max reaction (ms)"><Input type="number" defaultValue="900" /></Field>
        <Field label="Valid for (min)"><Input type="number" defaultValue="30" /></Field>
        <div style={{ alignSelf: 'flex-end' }}><Button variant="primary" onClick={() => toast.push('Reaction test config saved', 'success')}>Save</Button></div>
      </div>
    </Card>
  );
}

function I18n({ db }: { db: DB }) {
  const toast = useToast();
  const [rows, setRows] = useState<Translation[]>(db.translations);
  const update = (i: number, lang: 'pl' | 'en' | 'el', value: string) => setRows(rows.map((r, j) => j === i ? { ...r, [lang]: value } : r));
  return (
    <Card>
      <CardHeader title="App localization" sub="PL / EN / EL" actions={<Button size="sm" variant="primary" onClick={() => toast.push('Translations saved', 'success')}>Save</Button>} />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Namespace</th><th>Key</th><th>Polish</th><th>English</th><th>Greek</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.ns}.${r.key}`}>
                <td className="muted">{r.ns}</td><td className="mono">{r.key}</td>
                <td><Input value={r.pl} onChange={(e) => update(i, 'pl', e.target.value)} /></td>
                <td><Input value={r.en} onChange={(e) => update(i, 'en', e.target.value)} /></td>
                <td><Input value={r.el} onChange={(e) => update(i, 'el', e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Personalization() {
  const toast = useToast();
  const statuses = Object.keys(vehicleStatusColor);
  return (
    <Card>
      <CardHeader title="Map icons & personalization" sub="app_content" actions={<Button size="sm" variant="primary" onClick={() => toast.push('Saved', 'success')}>Save</Button>} />
      <div className="card-pad row-wrap">
        {statuses.map((s) => (
          <div key={s} className="card" style={{ padding: 12, minWidth: 160, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: vehicleStatusColor[s] }} />
            <div><div style={{ fontSize: 13, fontWeight: 600 }}>{titleCase(s)}</div><div className="muted" style={{ fontSize: 12 }}>{vehicleStatusColor[s]}</div></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Tutorials({ db }: { db: DB }) {
  const toast = useToast();
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      {db.tutorials.map((t) => (
        <Card key={t.id}>
          <CardHeader title={t.title} sub={`key: ${t.key} · ${t.lang}`} actions={<Button size="sm" variant="primary" onClick={() => toast.push('Tutorial saved', 'success')}>Save</Button>} />
          <div className="card-pad stack">
            {t.slides.map((s, i) => (
              <div key={i} className="card" style={{ padding: 12 }}>
                <Field label={`Slide ${i + 1} title`}><Input defaultValue={s.title} /></Field>
                <Field label="Body"><Textarea defaultValue={s.body} /></Field>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Notifications({ db }: { db: DB }) {
  const toast = useToast();
  const [rules, setRules] = useState<NotificationRule[]>(db.notificationRules);
  const [edit, setEdit] = useState<NotificationRule | null>(null);
  const toggle = (id: string) => setRules(rules.map((r) => r.id === id ? { ...r, active: !r.active } : r));
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Alerts & notification rules" sub="event → condition → channels → recipients (seeded from docs/12)" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Rule</th><th>Audience</th><th>Condition</th><th>Channels</th><th>Recipients</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td><Badge tone={r.audience === 'staff' ? 'info' : 'neutral'}>{r.audience}</Badge></td>
                  <td className="mono" style={{ fontSize: 12 }}>{Object.keys(r.condition).length ? JSON.stringify(r.condition) : '—'}</td>
                  <td>{r.channels.map((c) => <span key={c} className="pill-tag">{c}</span>)}</td>
                  <td>{r.recipients.join(', ')}</td>
                  <td><input type="checkbox" checked={r.active} onChange={() => toggle(r.id)} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => toast.push(`Test-fired “${r.label}” to yourself`, 'info')}>Test-fire</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent notification log" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Template</th><th>Channel</th><th>Target</th><th>Status</th></tr></thead>
            <tbody>{db.notificationLog.slice(0, 20).map((l) => <tr key={l.id}><td>{l.template_key}</td><td>{l.channel}</td><td className="mono" style={{ fontSize: 12 }}>{l.target}</td><td><Badge tone={l.status === 'sent' ? 'success' : l.status === 'failed' ? 'danger' : 'neutral'}>{l.status}</Badge></td></tr>)}</tbody>
          </table>
        </div>
      </Card>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit ? `Edit rule — ${edit.label}` : ''} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={() => { if (edit) setRules(rules.map((r) => r.id === edit.id ? edit : r)); toast.push('Rule saved (audited)', 'success'); setEdit(null); }}>Save</Button></>}>
        {edit ? (
          <div className="stack">
            <Field label="Digest"><Select value={edit.digest} onChange={(e) => setEdit({ ...edit, digest: e.target.value as NotificationRule['digest'] })}>{['none', 'hourly', 'daily'].map((d) => <option key={d}>{d}</option>)}</Select></Field>
            <Field label="Channels (comma separated)"><Input value={edit.channels.join(',')} onChange={(e) => setEdit({ ...edit, channels: e.target.value.split(',').map((s) => s.trim()) as NotificationRule['channels'] })} /></Field>
            <Field label="Recipients (comma separated)"><Input value={edit.recipients.join(',')} onChange={(e) => setEdit({ ...edit, recipients: e.target.value.split(',').map((s) => s.trim()) })} /></Field>
            <Field label="Throttle (s)"><Input type="number" value={edit.throttle_s} onChange={(e) => setEdit({ ...edit, throttle_s: Number(e.target.value) })} /></Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
