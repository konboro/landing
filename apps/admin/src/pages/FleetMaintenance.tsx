import { useState, type ReactNode } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { useToast } from '@/components/ui/Toast';
import { useDS } from '@/context/DataContext';
import { Card, CardHeader, Button, Field, Input, Select } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { HexFrame } from '@/components/ui/HexFrame';
import { EmptyState } from '@/components/ui/feedback';
import { titleCase, relativeTime, formatMoney, formatDateTime } from '@/lib/format';
import { colors } from '@penny/ui';

export function FleetMaintenancePage() {
  const { data: db, isLoading } = usePanelData();
  const [tab, setTab] = useState('tasks');
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Fleet maintenance" sub="Tasks, damage, IoT registry, IoT log, scan log, error log" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'tasks', label: 'Task manager' },
        { key: 'damage', label: 'Damage reports' },
        { key: 'iot', label: 'Manage IoT' },
        { key: 'iotlog', label: 'IoT data log' },
        { key: 'scan', label: 'Scan data log' },
        { key: 'errors', label: 'Vehicle error log' },
      ]} />
      {isLoading || !db ? <Card pad>Loading…</Card> : (
        <>
          {tab === 'tasks' ? <TasksTab db={db} /> : null}
          {tab === 'damage' ? <DamageTab db={db} /> : null}
          {tab === 'iot' ? <IotRegistryTab db={db} /> : null}
          {tab === 'iotlog' ? <IotLogTab db={db} /> : null}
          {tab === 'scan' ? <ScanTab db={db} /> : null}
          {tab === 'errors' ? <ErrorTab db={db} /> : null}
        </>
      )}
    </div>
  );
}

type DB = NonNullable<ReturnType<typeof usePanelData>['data']>;

function TasksTab({ db }: { db: DB }) {
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const vehCode = (id: string | null) => db.vehicles.find((v) => v.id === id)?.code ?? '—';
  const staffName = (id: string | null) => db.staff.find((s) => s.id === id)?.name ?? 'Unassigned';
  const byStatus = (s: string) => db.opsTasks.filter((t) => t.status === s).length;
  return (
    <>
      <div className="row-wrap">
        {['open', 'assigned', 'in_progress', 'done'].map((s) => <MiniStat key={s} label={titleCase(s)} value={byStatus(s)} />)}
      </div>
      <Card>
        <CardHeader title="Ops tasks" actions={<Button variant="primary" onClick={() => setCreateOpen(true)}>+ Create task</Button>} />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Kind</th><th>Vehicle</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Source</th><th>Due</th></tr></thead>
            <tbody>
              {db.opsTasks.map((t) => (
                <tr key={t.id}>
                  <td>{titleCase(t.kind)}</td><td className="mono">{vehCode(t.vehicle_id)}</td>
                  <td><Badge tone={t.priority >= 4 ? 'danger' : t.priority >= 2 ? 'warning' : 'neutral'}>P{t.priority}</Badge></td>
                  <td><Badge tone={t.status === 'done' ? 'success' : t.status === 'in_progress' ? 'info' : 'neutral'}>{titleCase(t.status)}</Badge></td>
                  <td>{staffName(t.assignee)}</td>
                  <td>{t.created_by === 'system_rule' ? <Badge tone="info">Auto</Badge> : 'Admin'}</td>
                  <td>{relativeTime(t.due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create ops task" footer={<><Button onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => { toast.push('Task created', 'success'); setCreateOpen(false); }}>Create</Button></>}>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Kind"><Select>{['rebalance', 'battery_swap', 'pickup', 'repair', 'inspect', 'deploy'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
          <Field label="Priority"><Select>{[1, 2, 3, 4, 5].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        </div>
        <Field label="Vehicle code"><Input placeholder="ATH-1000" /></Field>
        <Field label="Assign to"><Select><option>Unassigned</option>{db.staff.filter((s) => s.role.startsWith('ops')).map((s) => <option key={s.id}>{s.name}</option>)}</Select></Field>
      </Modal>
    </>
  );
}

function DamageTab({ db }: { db: DB }) {
  const toast = useToast();
  const [penaltyFor, setPenaltyFor] = useState<string | null>(null);
  const vehCode = (id: string) => db.vehicles.find((v) => v.id === id)?.code ?? '—';
  return (
    <Card>
      <CardHeader title="Damage reports review" sub="Confirm → penalty flow" />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>ID</th><th>Vehicle</th><th>Description</th><th>Severity</th><th>Reporter</th><th>Status</th><th>When</th><th></th></tr></thead>
          <tbody>
            {db.damageReports.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.id}</td><td className="mono">{vehCode(d.vehicle_id)}</td><td>{d.description}</td>
                <td><Badge tone={d.severity === 'critical' || d.severity === 'high' ? 'danger' : d.severity === 'medium' ? 'warning' : 'neutral'}>{d.severity}</Badge></td>
                <td>{d.reporter}</td><td>{titleCase(d.status)}</td><td>{relativeTime(d.created_at)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button size="sm" onClick={() => toast.push('Marked confirmed', 'success')}>Confirm</Button>{' '}
                  <Button size="sm" variant="danger" disabled={!d.user_id} onClick={() => setPenaltyFor(d.id)}>Penalty</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmModal open={penaltyFor !== null} onClose={() => setPenaltyFor(null)} onConfirm={() => { toast.push('Penalty charge queued (reason + photo evidence attached)', 'success'); setPenaltyFor(null); }} title="Issue damage penalty" message="Creates a penalty charge on the linked rider with the damage photos as evidence. Appealable." requireReason danger confirmLabel="Issue penalty" />
    </Card>
  );
}

function IotRegistryTab({ db }: { db: DB }) {
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const vehCode = (id: string | null) => db.vehicles.find((v) => v.id === id)?.code ?? '— (bench)';
  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <div className="row-wrap">
        <MiniStat label="Active devices" value={db.devices.filter((d) => d.status === 'active').length} />
        <MiniStat label="On bench" value={db.devices.filter((d) => d.status === 'bench').length} />
        <MiniStat label="Faulty" value={db.devices.filter((d) => d.status === 'faulty').length} />
        <MiniStat label="Penny profile" value={db.devices.filter((d) => d.server_profile === 'penny').length} />
      </div>
      <Card>
        <CardHeader title="Device registry" actions={<Button variant="primary" onClick={() => setAddOpen(true)}>+ Add device</Button>} />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>IMEI</th><th>ICCID</th><th>MSISDN</th><th>FW</th><th>Vehicle</th><th>Profile</th><th>FOTA</th><th>Status</th></tr></thead>
            <tbody>
              {db.devices.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.imei}</td><td className="mono" style={{ fontSize: 12 }}>{d.iccid}</td><td className="mono">{d.phone_number}</td>
                  <td>{d.fw_version}</td><td className="mono">{vehCode(d.vehicle_id)}</td>
                  <td><Badge tone={d.server_profile === 'penny' ? 'success' : 'warning'}>{d.server_profile}</Badge></td>
                  <td>{d.fw_version === '03.28.03' ? <Badge tone="success">up to date</Badge> : <Badge tone="warning">pending</Badge>}</td>
                  <td><Badge tone={d.status === 'active' ? 'success' : d.status === 'faulty' ? 'danger' : 'neutral'}>{d.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <AddDeviceWizard open={addOpen} onClose={() => setAddOpen(false)} onDone={() => { toast.push('Device provisioned', 'success'); setAddOpen(false); }} />
    </div>
  );
}

function AddDeviceWizard({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ imei: '', iccid: '', msisdn: '' });
  const checklist = ['SIM activated (MSISDN reachable)', 'Device boots & registers to gateway :5027', 'Penny server profile applied', 'No-deep-sleep profile set', 'Test unlock/lock ACK', 'Link to vehicle code'];
  const [checked, setChecked] = useState(checklist.map(() => false));
  const reset = () => { setStep(1); setForm({ imei: '', iccid: '', msisdn: '' }); setChecked(checklist.map(() => false)); };
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Add device — provisioning" size="lg"
      footer={step === 1
        ? <><Button onClick={() => { reset(); onClose(); }}>Cancel</Button><Button variant="primary" disabled={form.imei.length < 10} onClick={() => setStep(2)}>Next: checklist</Button></>
        : <><Button onClick={() => setStep(1)}>Back</Button><Button variant="primary" disabled={!checked.every(Boolean)} onClick={() => { reset(); onDone(); }}>Complete</Button></>}>
      {step === 1 ? (
        <div className="row-wrap">
          <Field label="IMEI" required hint="Exactly as printed."><Input className="mono" value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value.replace(/\s/g, '') })} /></Field>
          <Field label="ICCID"><Input className="mono" value={form.iccid} onChange={(e) => setForm({ ...form, iccid: e.target.value })} /></Field>
          <Field label="SIM MSISDN"><Input className="mono" value={form.msisdn} onChange={(e) => setForm({ ...form, msisdn: e.target.value })} placeholder="+3069…" /></Field>
        </div>
      ) : (
        <div className="stack">
          <div className="muted">Provisioning checklist</div>
          {checklist.map((c, i) => <label key={c} className="checkbox-row"><input type="checkbox" checked={checked[i]} onChange={() => setChecked((prev) => prev.map((v, j) => j === i ? !v : v))} /><span>{c}</span></label>)}
        </div>
      )}
    </Modal>
  );
}

function IotLogTab({ db }: { db: DB }) {
  const vehCode = (id: string) => db.vehicles.find((v) => v.id === id)?.code ?? id;
  type LogRow = { kind: 'command' | 'telemetry'; at: string; text: string; veh: string };
  const merged: LogRow[] = [
    ...db.commands.slice(0, 30).map((c): LogRow => ({ kind: 'command', at: c.sent_at ?? c.created_at, text: `${titleCase(c.kind)} → ${c.status}`, veh: vehCode(c.vehicle_id) })),
    ...db.alerts.slice(0, 20).map((a): LogRow => ({ kind: 'telemetry', at: a.created_at, text: `Alert: ${titleCase(a.kind)}`, veh: vehCode(a.vehicle_id) })),
  ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
      <Card>
        <CardHeader title="Merged timeline" sub="commands + telemetry/alerts" />
        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
          {merged.map((m, i) => (
            <div key={i} className="between" style={{ padding: '9px var(--space-lg)', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Badge tone={m.kind === 'command' ? 'info' : 'warning'} dot={false}>{m.kind}</Badge>
                <span style={{ fontSize: 13 }}>{m.text}</span>
              </div>
              <span className="muted" style={{ fontSize: 12 }}><span className="mono">{m.veh}</span> · {relativeTime(m.at)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Hex frame viewer" sub="Sample Codec 8E frame, field-decoded" />
        <div className="card-pad"><HexFrame /></div>
      </Card>
    </div>
  );
}

function ScanTab({ db }: { db: DB }) {
  return (
    <Card>
      <CardHeader title="Scan data log" sub="QR scans → resolution" />
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>User</th><th>Scanned code</th><th>Result</th><th>When</th></tr></thead>
          <tbody>{db.scanLog.map((s) => <tr key={s.id}><td>{s.user_name}</td><td className="mono">{s.vehicle_code_scanned}</td><td><Badge tone={s.result === 'ok' ? 'success' : s.result === 'not_found' ? 'danger' : 'warning'}>{titleCase(s.result)}</Badge></td><td>{relativeTime(s.created_at)}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}

function ErrorTab({ db }: { db: DB }) {
  const errors = db.alerts.filter((a) => a.kind === 'error');
  const vehCode = (id: string) => db.vehicles.find((v) => v.id === id)?.code ?? id;
  return (
    <Card>
      <CardHeader title="Vehicle error log" sub="vehicle_alerts kind=error" />
      <div className="table-wrap">
        {errors.length === 0 ? <EmptyState emoji="✅" title="No errors" /> : (
          <table className="data">
            <thead><tr><th>Vehicle</th><th>Code</th><th>Acked</th><th>When</th></tr></thead>
            <tbody>{errors.map((e) => <tr key={e.id}><td className="mono">{vehCode(e.vehicle_id)}</td><td className="mono">{String((e.payload as { code?: string }).code ?? '—')}</td><td>{e.ack_at ? <Badge tone="neutral">Acked</Badge> : <Badge tone="warning">Open</Badge>}</td><td>{relativeTime(e.created_at)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="card stat-card" style={{ minWidth: 150, flex: 1 }}><span className="stat-label">{label}</span><span style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>{value}</span></div>;
}
