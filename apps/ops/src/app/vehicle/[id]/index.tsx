import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, H1, H2, Muted, Body, Button, Card, Row, Badge, StatusDot, Field, Divider, Empty } from '../../../components/ui';
import { PhotoButton, PhotoStrip } from '../../../components/PhotoCapture';
import { SyncPill } from '../../../components/SyncPill';
import { useMirror } from '../../../lib/useMirror';
import { getVehicle, getStatusLog, getBatterySwaps, getMaintenance } from '../../../offline/repo';
import { sendCommand, toggleVisibility, addVehicleNote, decommission } from '../../../offline/actions';
import { navigateTo } from '../../../lib/nav';
import { useOps } from '../../../lib/store';
import { formatSoc, relativeTime, formatDateTime } from '@penny/ui';
import { colorForStatus, c, space, font, radius } from '../../../lib/theme';
import { hasAlarm } from '../../../components/FleetMap';
import type { OpsVehicle, StatusLogEntry, BatterySwap, MaintenanceEntry } from '../../../lib/types';

export default function VehicleSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicle = useMirror<OpsVehicle | null>(() => getVehicle(id!), null);
  const v = vehicle.data;
  if (!v) return <Screen><Empty text="Vehicle not found." /></Screen>;
  return <Sheet v={v} />;
}

function Sheet({ v }: { v: OpsVehicle }) {
  const router = useRouter();
  const role = useOps((s) => s.session?.role ?? 'ops');
  const isAdmin = role === 'admin' || role === 'ops_manager';
  const statusLog = useMirror<StatusLogEntry[]>(() => getStatusLog(v.id), []);
  const swaps = useMirror<BatterySwap[]>(() => getBatterySwaps(v.id), []);
  const maint = useMirror<MaintenanceEntry[]>(() => getMaintenance(v.id), []);
  const [note, setNote] = useState('');
  const [notePhotos, setNotePhotos] = useState<string[]>([]);
  const [pulse, setPulse] = useState<string | null>(null);

  async function cmd(kind: Parameters<typeof sendCommand>[1], label: string) {
    setPulse(label);
    await sendCommand(v, kind);
    setTimeout(() => setPulse(null), 1500);
  }

  function confirmDecommission() {
    Alert.alert('Decommission vehicle', `Permanently retire ${v.code}? Device will be unlinked.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decommission', style: 'destructive', onPress: () => decommission(v, 'ops decommission', []) },
    ]);
  }

  async function saveNote() {
    if (!note.trim()) return;
    await addVehicleNote(v, note.trim(), notePhotos);
    setNote('');
    setNotePhotos([]);
  }

  return (
    <Screen scroll>
      <SyncPill />

      {/* Header */}
      <Card style={{ borderColor: colorForStatus(v.status) }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row>
            <StatusDot status={v.status} size={16} />
            <H1>{v.code}</H1>
          </Row>
          <Row gap={6}>
            {hasAlarm(v) && <Badge label="alarm" color={c.danger} textColor="#fff" />}
            {!v.visible && <Badge label="hidden" color={c.surfaceAlt} />}
          </Row>
        </Row>
        <Muted>{v.model_name} · {v.status.replace('_', ' ')} · {v.online ? 'online' : `offline (${relativeTime(v.last_seen)})`}</Muted>
      </Card>

      {/* Telemetry */}
      <Card>
        <H2>Live telemetry</H2>
        <Row style={{ flexWrap: 'wrap' }}>
          <Metric label="Battery" value={formatSoc(v.soc_pct)} />
          <Metric label="Voltage" value={v.voltage_mv ? `${(v.voltage_mv / 1000).toFixed(1)}V` : '—'} />
          <Metric label="Speed" value={`${v.speed_kmh ?? 0} km/h`} />
          <Metric label="Lock" value={v.locked ? 'Locked' : 'Unlocked'} />
        </Row>
        {(v.fall || v.power_cut || v.moved_while_locked) && (
          <Row gap={6} style={{ flexWrap: 'wrap' }}>
            {v.fall && <Badge label="fall" color={c.danger} textColor="#fff" />}
            {v.power_cut && <Badge label="power cut" color={c.danger} textColor="#fff" />}
            {v.moved_while_locked && <Badge label="moved while locked" color={c.danger} textColor="#fff" />}
          </Row>
        )}
        {v.pos && <Button title="Navigate to vehicle" icon="🧭" variant="secondary" onPress={() => navigateTo(v.pos!, v.code)} />}
      </Card>

      {/* Last errors */}
      {v.last_errors.length > 0 && (
        <Card style={{ borderColor: c.warning }}>
          <H2>Last errors</H2>
          {v.last_errors.map((e, i) => (
            <Row key={i} style={{ justifyContent: 'space-between' }}>
              <Body>{e.code} · {e.label}</Body>
              <Muted>{relativeTime(e.at)}</Muted>
            </Row>
          ))}
        </Card>
      )}

      {/* Commands */}
      <Card>
        <H2>Commands (service mode — no billing)</H2>
        {pulse && <Badge label={`Queued: ${pulse}`} color={c.primaryDeep} textColor="#fff" />}
        <Row style={{ flexWrap: 'wrap' }}>
          <Cmd label={v.locked ? 'Service unlock' : 'Service lock'} onPress={() => cmd(v.locked ? 'unlock' : 'lock', v.locked ? 'unlock' : 'lock')} />
          <Cmd label="Locate / beep" onPress={() => cmd('locate', 'locate')} />
          <Cmd label="Reboot IoT" onPress={() => cmd('reboot', 'reboot')} />
        </Row>
        <Divider />
        <H2>Ring / siren</H2>
        <Row style={{ flexWrap: 'wrap' }}>
          <Cmd label="🔔 Ring (3 pulses)" onPress={() => cmd('ring', 'ring')} />
          <Cmd label="📢 Siren 30s" onPress={() => cmd('alarm_on', 'siren on')} danger />
          <Cmd label="🔇 Stop siren" onPress={() => cmd('alarm_off', 'siren off')} />
        </Row>
      </Card>

      {/* Status + visibility + swap + damage */}
      <Card>
        <H2>Manage</H2>
        <Button title="Full history" icon="🕓" variant="secondary" onPress={() => router.push(`/vehicle/${v.id}/history`)} />
        <Button title="Change status" icon="🔄" onPress={() => router.push(`/vehicle/${v.id}/status`)} />
        <Button
          title={v.visible ? 'Hide from rider map' : 'Make visible'}
          variant="secondary"
          onPress={() => toggleVisibility(v, !v.visible, v.visible ? 'staged' : 'unstaged')}
        />
        <Button title="Report damage" icon="⚠" variant="secondary" onPress={() => router.push({ pathname: '/damage/new', params: { vehicleId: v.id } })} />
        <Button title="Swap IoT device" icon="🔁" variant="secondary" onPress={() => router.push(`/vehicle/${v.id}/swap-device`)} />
        {v.status === 'transport' && <Button title="Deploy here (available)" icon="📍" variant="success" onPress={() => router.push('/deploy')} />}
        {isAdmin && <Button title="Decommission" variant="danger" onPress={confirmDecommission} />}
      </Card>

      {/* Free-form note */}
      <Card>
        <H2>Add note</H2>
        <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="Observation, follow-up…" />
        <Row>
          <View style={{ flex: 1 }}>
            <PhotoButton label="Photo" vehicleId={v.id} onCaptured={(p) => setNotePhotos((prev) => [...prev, p.remotePath])} />
          </View>
          <Button title="Save note" onPress={saveNote} disabled={!note.trim()} style={{ flex: 1 }} />
        </Row>
        <PhotoStrip photos={notePhotos} />
        {v.notes ? <Muted>Current: {v.notes}</Muted> : null}
      </Card>

      {/* Service history */}
      <H2>Service history</H2>
      {statusLog.data.length === 0 && swaps.data.length === 0 && maint.data.length === 0 ? (
        <Muted>No history yet.</Muted>
      ) : (
        <Card>
          {statusLog.data.map((e) => (
            <View key={e.id} style={st.histRow}>
              <StatusDot status={e.to_status} />
              <View style={{ flex: 1 }}>
                <Body>{e.from_status ?? '—'} → {e.to_status}</Body>
                <Muted>{e.role} · {e.reason ?? ''} · {formatDateTime(e.at)}</Muted>
              </View>
              {e.photos.length > 0 && <Badge label={`${e.photos.length}📷`} color={c.surfaceAlt} />}
            </View>
          ))}
          {swaps.data.map((s) => (
            <View key={s.id} style={st.histRow}>
              <Text>🔋</Text>
              <View style={{ flex: 1 }}>
                <Body>Battery swap</Body>
                <Muted>{s.voltage_before ? `${(s.voltage_before / 1000).toFixed(1)}V` : '—'} → {s.voltage_after ? `${(s.voltage_after / 1000).toFixed(1)}V` : '—'} · {formatDateTime(s.at)}</Muted>
              </View>
            </View>
          ))}
          {maint.data.map((m) => (
            <View key={m.id} style={st.histRow}>
              <Text>🔧</Text>
              <View style={{ flex: 1 }}>
                <Body>{m.kind} · €{(m.cost_cents / 100).toFixed(2)}</Body>
                <Muted>{m.notes} · {formatDateTime(m.at)}</Muted>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.metric}>
      <Text style={st.metricValue}>{value}</Text>
      <Text style={st.metricLabel}>{label}</Text>
    </View>
  );
}
function Cmd({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Button title={label} variant={danger ? 'danger' : 'secondary'} onPress={onPress} style={st.cmd} />
  );
}

const st = StyleSheet.create({
  metric: { width: '25%', paddingVertical: space.xs },
  metricValue: { color: c.text, fontSize: font.size.lg, fontWeight: '800' },
  metricLabel: { color: c.textMuted, fontSize: font.size.xs },
  cmd: { flexGrow: 1, minWidth: '46%' },
  histRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border },
});
