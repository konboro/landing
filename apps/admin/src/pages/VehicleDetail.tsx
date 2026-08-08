import { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button, KV, Field, Select, Textarea } from '@/components/ui/primitives';
import { VehicleStatusBadge, TripStatusBadge, Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { MapView, type MapMarker } from '@/components/map/MapView';
import { LineTrend, chartPalette } from '@/components/charts/Charts';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/feedback';
import { Qr } from '@/components/ui/Qr';
import { TimelineFeed } from '@/components/ui/Timeline';
import { VehicleRideHistoryTable } from '@/components/rides/RideHistoryTable';
import { useTableState } from '@/hooks/useTableState';
import { formatSoc, formatDateTime, relativeTime, titleCase, formatDistance, formatDuration, formatMoney } from '@/lib/format';
import { colors, vehicleStatusColor } from '@penny/ui';
import type { Command } from '@penny/db-types';

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="card-pad" style={{ padding: 'var(--space-md) var(--space-lg)' }}>
        <div className="muted" style={{ fontSize: 12 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
        {sub ? <div className="muted" style={{ fontSize: 12 }}>{sub}</div> : null}
      </div>
    </Card>
  );
}

const CMD_BUTTONS: Array<{ kind: string; label: string; danger?: boolean }> = [
  { kind: 'unlock', label: 'Unlock' },
  { kind: 'lock', label: 'Lock' },
  { kind: 'locate', label: 'Locate' },
  { kind: 'ring', label: 'Ring' },
  { kind: 'alarm_on', label: 'Siren ON', danger: true },
  { kind: 'alarm_off', label: 'Siren OFF' },
  { kind: 'reboot', label: 'Reboot', danger: true },
];

export function VehicleDetailPage() {
  const { id = '' } = useParams();
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['vehicle', id], queryFn: () => ds.getVehicle(id) });
  const [tab, setTab] = useState('overview');

  // Exhaustive per-vehicle history (docs/08 Vehicles → detail).
  const vehicleRidesState = useTableState({ pageSize: 25, sort: [{ field: 'started_at', dir: 'desc' }] });
  const vehicleHistoryQ = useQuery({
    queryKey: ['vehicle-history', id],
    queryFn: () => ds.getVehicleHistory(id, { page: 1, pageSize: 1 }),
    enabled: tab === 'rides' || tab === 'timeline',
  });
  const vehicleRidesQ = useQuery({
    queryKey: ['vehicle-rides', id, vehicleRidesState.params],
    queryFn: () => ds.getVehicleRides(id, vehicleRidesState.params),
    enabled: tab === 'rides',
  });
  const vehicleTimelineQ = useQuery({
    queryKey: ['vehicle-timeline', id],
    queryFn: () => ds.getVehicleTimeline(id, { page: 1, pageSize: 500 }),
    enabled: tab === 'timeline',
  });
  const vstats = vehicleHistoryQ.data?.stats;
  const [rawOpen, setRawOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [confirmCmd, setConfirmCmd] = useState<string | null>(null);

  const cmd = useMutation({
    mutationFn: ({ kind, payload }: { kind: string; payload?: Record<string, unknown> }) => ds.sendCommand(id, kind, payload),
    onSuccess: (_r, v) => { toast.push(`Command ${v.kind} acked`, 'success'); qc.invalidateQueries({ queryKey: ['vehicle', id] }); },
  });

  const telemetry = useMemo(() => (data?.telemetry ?? []).map((s) => ({
    t: new Date(s.device_ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    speed: s.speed_kmh, soc: s.soc_pct, volts: +(s.batt_voltage_mv / 1000).toFixed(2), gsm: s.gsm_signal,
  })), [data]);

  if (isLoading) return <div><PageHeader title="Vehicle" back={{ to: '/vehicles', label: 'Vehicles' }} /><Card pad>Loading…</Card></div>;
  if (!data) return <div><PageHeader title="Vehicle not found" back={{ to: '/vehicles', label: 'Vehicles' }} /><Card><EmptyState emoji="🔍" title="No such vehicle" /></Card></div>;

  const { vehicle, device } = data;
  const marker: MapMarker[] = [{ id: vehicle.id, lng: vehicle.lng, lat: vehicle.lat, color: vehicleStatusColor[vehicle.status] ?? colors.textMuted, label: vehicle.code }];

  const sendCmd = (kind: string, danger?: boolean) => {
    if (!can('vehicles.command')) return;
    if (danger) setConfirmCmd(kind); else cmd.mutate({ kind });
  };

  const printLabel = () => window.open(`/vehicles/${id}/label`, '_blank', 'width=420,height=560');

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title={<span className="mono">{vehicle.code} <VehicleStatusBadge status={vehicle.status} /></span>}
        sub={<>{vehicle.model_name} · {vehicle.city_name} · {formatSoc(vehicle.soc_pct)} · last seen {relativeTime(vehicle.last_seen)}</>}
        back={{ to: '/vehicles', label: 'Vehicles' }}
        actions={
          <>
            <Button onClick={printLabel}>🖨 QR label</Button>
            <Button disabled={!can('vehicles.status')} onClick={() => setSwapOpen(true)}>Swap device</Button>
          </>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'telemetry', label: 'Telemetry' },
          { key: 'console', label: 'Command console' },
          { key: 'iot', label: 'IoT log' },
          { key: 'rides', label: `Rides (${vstats?.total_rides ?? data.rides.length})` },
          { key: 'timeline', label: 'Timeline' },
          { key: 'damage', label: `Damage (${data.damage.length})` },
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          <Card>
            <CardHeader title="Live position" />
            <div className="card-pad"><MapView height={320} markers={marker} center={[vehicle.lng, vehicle.lat]} zoom={14} /></div>
          </Card>
          <div className="stack" style={{ gap: 'var(--space-lg)' }}>
            <Card>
              <CardHeader title="Device info" sub="IMEI = device identity, code = business identity" />
              <div className="card-pad">
                <KV items={[
                  ['IMEI', <span className="mono">{device?.imei ?? '—'}</span>],
                  ['ICCID', <span className="mono">{device?.iccid ?? '—'}</span>],
                  ['SIM MSISDN', <span className="mono">{device?.phone_number ?? '—'}</span>],
                  ['Model', device?.model ?? '—'],
                  ['Firmware', device?.fw_version ?? '—'],
                  ['Server profile', device ? <Badge tone={device.server_profile === 'penny' ? 'success' : 'warning'}>{device.server_profile}</Badge> : '—'],
                  ['Device status', device?.status ?? '—'],
                ]} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Vehicle" />
              <div className="card-pad">
                <KV items={[
                  ['Plate', vehicle.plate ?? '—'], ['VIN', vehicle.vin ?? '—'],
                  ['Visible on map', vehicle.visible ? 'Yes' : 'No'],
                  ['Rides today', vehicle.rides_today], ['Idle', `${vehicle.idle_hours}h`],
                  ['Notes', vehicle.notes ?? '—'],
                ]} />
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'telemetry' ? (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Card><CardHeader title="Speed & battery" /><div className="card-pad"><LineTrend data={telemetry} xKey="t" series={[{ key: 'speed', name: 'Speed km/h', color: chartPalette[0]! }, { key: 'soc', name: 'Battery %', color: chartPalette[1]! }]} /></div></Card>
          <Card><CardHeader title="Voltage & GSM" /><div className="card-pad"><LineTrend data={telemetry} xKey="t" series={[{ key: 'volts', name: 'Batt V', color: chartPalette[4]! }, { key: 'gsm', name: 'GSM signal', color: chartPalette[2]! }]} /></div></Card>
        </div>
      ) : null}

      {tab === 'console' ? (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
          <Card>
            <CardHeader title="Command console" sub="Codec 12 command bus" />
            <div className="card-pad">
              {!can('vehicles.command') ? <p className="muted">Your role cannot send commands.</p> : (
                <div className="row-wrap">
                  {CMD_BUTTONS.map((b) => (
                    <Button key={b.kind} variant={b.danger ? 'danger' : 'default'} onClick={() => sendCmd(b.kind, b.danger)} disabled={cmd.isPending}>{b.label}</Button>
                  ))}
                  <Button variant="ghost" onClick={() => setRawOpen(true)} disabled={cmd.isPending}>Raw command…</Button>
                </div>
              )}
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                DOUT2 = siren. Ring/alarm have a failsafe OFF. No unlock during an active trip without ACK. Every command is audited.
              </p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent commands" />
            <CommandTable commands={data.commands} />
          </Card>
        </div>
      ) : null}

      {tab === 'iot' ? (
        <Card>
          <CardHeader title="IoT data log" sub="Merged command + telemetry timeline" actions={<Link className="btn btn-sm" to="/fleet">Full IoT log</Link>} />
          <CommandTable commands={data.commands} />
        </Card>
      ) : null}

      {tab === 'rides' ? (
        <div className="stack" style={{ gap: 'var(--space-lg)' }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-md)' }}>
            <StatTile label="Total rides" value={String(vstats?.total_rides ?? 0)} />
            <StatTile label="Rides 7d / 30d" value={`${vstats?.rides_7d ?? 0} / ${vstats?.rides_30d ?? 0}`} />
            <StatTile label="Revenue" value={formatMoney(vstats?.revenue_cents ?? 0)} />
            <StatTile label="Distance" value={formatDistance(vstats?.total_distance_m ?? 0)} />
            <StatTile label="Avg trip" value={formatDistance(vstats?.avg_distance_m ?? 0)} sub={formatDuration(vstats?.avg_duration_s ?? 0)} />
            <StatTile label="Utilization" value={`${(vstats?.utilization_rides_per_day ?? 0).toFixed(1)}/day`} />
            <StatTile label="Unique riders" value={String(vstats?.unique_riders ?? 0)} />
            <StatTile label="Last ride" value={vstats?.last_ride_at ? relativeTime(vstats.last_ride_at) : '—'} />
          </div>
          <Card>
            <CardHeader
              title="Ride history"
              sub="Every trip on this vehicle · rider phone masked (PII minimization)"
            />
            <VehicleRideHistoryTable
              data={vehicleRidesQ.data}
              state={vehicleRidesState}
              loading={vehicleRidesQ.isLoading}
              csvName={`vehicle-${vehicle.code}-rides`}
              emptyTitle="No rides on this vehicle yet"
              onRowClick={(r) => navigate(`/rides/${r.id}`)}
            />
          </Card>
        </div>
      ) : null}

      {tab === 'timeline' ? (
        <Card>
          <CardHeader
            title="Full vehicle timeline"
            sub="Rides, commands, status changes, alerts, damage, battery swaps and maintenance"
          />
          <div className="card-pad">
            {/* TimelineFeed brings its own per-kind filter chips with counts. */}
            <TimelineFeed
              events={vehicleTimelineQ.data?.rows ?? []}
              loading={vehicleTimelineQ.isLoading}
              emptyTitle="Nothing recorded for this vehicle yet"
              maxHeight={620}
            />
          </div>
        </Card>
      ) : null}

      {tab === 'damage' ? (
        <Card>
          <CardHeader title="Damage reports" />
          <div className="table-wrap">
            {data.damage.length === 0 ? <EmptyState emoji="✅" title="No damage reports" /> : (
              <table className="data">
                <thead><tr><th>ID</th><th>Description</th><th>Severity</th><th>Status</th><th>Reporter</th><th>When</th></tr></thead>
                <tbody>
                  {data.damage.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.id}</td><td>{d.description}</td>
                      <td><Badge tone={d.severity === 'critical' || d.severity === 'high' ? 'danger' : d.severity === 'medium' ? 'warning' : 'neutral'}>{d.severity}</Badge></td>
                      <td>{titleCase(d.status)}</td><td>{d.reporter}</td><td>{relativeTime(d.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      ) : null}

      {/* QR preview also inline */}
      {tab === 'overview' ? (
        <Card>
          <CardHeader title="QR label" sub="Printable via the QR label button" />
          <div className="card-pad" style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <Qr value={`penny://vehicle/${vehicle.code}`} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }} className="mono">{vehicle.code}</div>
              <div className="muted">Scan to start a ride</div>
              <Button style={{ marginTop: 10 }} onClick={printLabel}>Open printable label</Button>
            </div>
          </div>
        </Card>
      ) : null}

      <RawCommandModal open={rawOpen} onClose={() => setRawOpen(false)} onSend={(payload) => { cmd.mutate({ kind: 'custom', payload }); setRawOpen(false); }} />
      <SwapDeviceModal open={swapOpen} onClose={() => setSwapOpen(false)} vehicleId={id} currentImei={device?.imei ?? null} onDone={() => { toast.push('Device swap recorded (audited)', 'success'); setSwapOpen(false); }} />
      <ConfirmModal
        open={confirmCmd !== null}
        onClose={() => setConfirmCmd(null)}
        onConfirm={(reason) => { if (confirmCmd) cmd.mutate({ kind: confirmCmd, payload: { reason } }); setConfirmCmd(null); }}
        title={`Confirm ${confirmCmd}`}
        message="This is a sensitive command. It will be sent to the device and audited."
        requireReason
        danger
        confirmLabel="Send command"
      />
    </div>
  );
}

function CommandTable({ commands }: { commands: Command[] }) {
  return (
    <div className="table-wrap">
      {commands.length === 0 ? <EmptyState title="No commands" /> : (
        <table className="data">
          <thead><tr><th>Kind</th><th>Status</th><th>Channel</th><th>Sent</th><th>ACK</th></tr></thead>
          <tbody>
            {commands.slice(0, 30).map((c) => (
              <tr key={c.id}>
                <td>{titleCase(c.kind)}</td>
                <td><Badge tone={c.status === 'acked' ? 'success' : c.status === 'failed' || c.status === 'expired' ? 'danger' : 'info'}>{c.status}</Badge></td>
                <td>{c.channel.toUpperCase()}</td>
                <td>{relativeTime(c.sent_at)}</td>
                <td>{c.acked_at ? `${Math.round((new Date(c.acked_at).getTime() - new Date(c.sent_at ?? c.acked_at).getTime()))}ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RawCommandModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (payload: Record<string, unknown>) => void }) {
  const [text, setText] = useState('{\n  "param_id": 1234,\n  "value": 1\n}');
  const [err, setErr] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Raw command (permission-gated)" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => { try { const p = JSON.parse(text); setErr(''); onSend(p); } catch { setErr('Invalid JSON'); } }}>Send</Button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Sends a raw Codec 12 payload. Use only if you know the Teltonika parameter IDs (docs/03).</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 140, fontFamily: 'var(--font-mono)' }} />
      {err ? <div style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>{err}</div> : null}
    </Modal>
  );
}

function SwapDeviceModal({ open, onClose, vehicleId, currentImei, onDone }: { open: boolean; onClose: () => void; vehicleId: string; currentImei: string | null; onDone: () => void }) {
  const ds = useDS();
  const [step, setStep] = useState(1);
  const [newImei, setNewImei] = useState('');
  const checklist = ['Power off old device', 'Mount new device', 'Verify IMEI reads on server', 'Test unlock/lock ACK', 'Re-link vehicle'];
  const [checked, setChecked] = useState<boolean[]>(checklist.map(() => false));
  const reset = () => { setStep(1); setNewImei(''); setChecked(checklist.map(() => false)); };
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Swap device wizard"
      footer={
        step < 3
          ? <><Button onClick={() => { reset(); onClose(); }}>Cancel</Button><Button variant="primary" disabled={step === 2 && newImei.length < 10} onClick={() => setStep(step + 1)}>Next</Button></>
          : <><Button onClick={() => setStep(2)}>Back</Button><Button variant="primary" disabled={!checked.every(Boolean)} onClick={async () => { await ds.logAudit({ action: 'device_swap', entity: 'vehicle', entity_id: vehicleId, reason: `Swap ${currentImei} → ${newImei}` }); reset(); onDone(); }}>Complete swap</Button></>
      }>
      {step === 1 ? <div><p>Current device IMEI: <span className="mono">{currentImei ?? '—'}</span></p><p className="muted">This wizard re-links the vehicle to a new device. The business identity (vehicle code) stays the same.</p></div> : null}
      {step === 2 ? <Field label="New device IMEI" required hint="Store exactly as printed — never reformat."><input className="input mono" value={newImei} onChange={(e) => setNewImei(e.target.value.replace(/\s/g, ''))} placeholder="86xxxxxxxxxxxxx" /></Field> : null}
      {step === 3 ? (
        <div className="stack">
          <div className="muted">Provisioning checklist</div>
          {checklist.map((c, i) => (
            <label key={c} className="checkbox-row"><input type="checkbox" checked={checked[i]} onChange={() => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))} /><span>{c}</span></label>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
