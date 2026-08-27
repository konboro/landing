// Damage detail — the report, its evidence, and the two decisions a field crew
// is allowed to make on it (confirm/reject, then resolve).
//
// The escalation card stays deliberately loud and deliberately indirect: ops
// can PROPOSE a penalty, never charge one. Money moves through the ledger after
// admin review (CLAUDE.md hard rules 2 and 8), so this button only files a case.
import React, { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen, H1, H2, Muted, Body, Button, Card, Row, Badge, Field, Divider, Empty,
  Icon, PhotoStrip,
} from '../../components/ui';
import { PhotoButton, type CapturedPhoto } from '../../components/PhotoCapture';
import { useMirror } from '../../lib/useMirror';
import { getDamageReport, getVehicle } from '../../offline/repo';
import { updateDamage } from '../../offline/actions';
import { formatDateTime, relativeTime } from '@penny/ui';
import { useTheme, makeStyles, type OpsTheme } from '../../brand';
import type { OpsDamageReport, OpsVehicle } from '../../lib/types';

/** Fill + ink per workflow state. Mirrors the tab grouping on the list screen. */
function statusColors(t: OpsTheme, status: string): { color: string; textColor: string } {
  switch (status) {
    case 'new':
      return { color: t.c.warning, textColor: t.c.onWarning };
    case 'confirmed':
      return { color: t.c.primary, textColor: t.c.onPrimary };
    case 'fixed':
      return { color: t.c.success, textColor: t.c.onSuccess };
    default:
      return { color: t.c.surfaceAlt, textColor: t.c.textMuted };
  }
}

function severityColors(t: OpsTheme, severity: string): { color: string; textColor: string } {
  switch (severity) {
    case 'critical':
    case 'high':
      return { color: t.c.danger, textColor: t.c.onDanger };
    case 'medium':
      return { color: t.c.warning, textColor: t.c.onWarning };
    default:
      return { color: t.c.surfaceAlt, textColor: t.c.text };
  }
}

const STATUS_LABEL: Record<string, string> = {
  new: 'In review',
  confirmed: 'Approved',
  fixed: 'Fixed',
  rejected: 'Rejected',
};

export default function DamageDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = useMirror<OpsDamageReport | null>(() => getDamageReport(id!), null);
  const d = report.data;
  if (!d) {
    return <Screen><Empty text={report.loading ? 'Loading…' : 'Report not found.'} /></Screen>;
  }
  return <DamageBody d={d} />;
}

function DamageBody({ d }: { d: OpsDamageReport }) {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const vehicle = useMirror<OpsVehicle | null>(() => getVehicle(d.vehicle_id), null);
  const [repairShots, setRepairShots] = useState<CapturedPhoto[]>([]);
  const [penalty, setPenalty] = useState('');

  const sev = severityColors(theme, d.severity);
  const stat = statusColors(theme, d.status);
  const closed = d.status === 'fixed' || d.status === 'rejected';

  async function act(action: 'confirm' | 'resolve' | 'reject') {
    await updateDamage(
      d.id,
      action,
      action === 'resolve' ? { photos: repairShots.map((p) => p.remotePath) } : {},
    );
    router.back();
  }

  function escalate() {
    const cents = Math.round(Number(penalty) * 100);
    if (!cents || cents <= 0) {
      Alert.alert('Enter a penalty amount');
      return;
    }
    Alert.alert(
      'Escalate to penalty',
      'This sends the case to admin review — it does NOT charge the rider directly. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send to review',
          onPress: () => {
            void updateDamage(d.id, 'escalate_penalty', { penalty_cents: cents }).then(() => router.back());
          },
        },
      ],
    );
  }

  return (
    <Screen scroll>
      <Card style={{ borderColor: stat.color }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <H1>{d.part ?? 'Damage report'}</H1>
            <Muted>{vehicle.data?.code ?? 'Vehicle'}</Muted>
          </View>
          <Row gap={6}>
            <Badge label={d.severity} color={sev.color} textColor={sev.textColor} />
            <Badge label={STATUS_LABEL[d.status] ?? d.status} color={stat.color} textColor={stat.textColor} />
          </Row>
        </Row>
        <Divider />
        <Meta label="Reported by" value={d.reporter} />
        <Meta label="Reported" value={`${formatDateTime(d.created_at)} · ${relativeTime(d.created_at)}`} />
        {d.linked_task_id ? <Meta label="Linked task" value={d.linked_task_id} /> : null}
      </Card>

      {d.photos.length > 0 ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>Evidence</H2>
            <Muted>tap to zoom</Muted>
          </Row>
          <PhotoStrip photos={d.photos} size={84} />
        </Card>
      ) : null}

      <Card>
        <H2>Description</H2>
        {d.description.trim() ? <Body>{d.description.trim()}</Body> : <Muted>None given.</Muted>}
      </Card>

      <Card>
        <H2>Vehicle</H2>
        <Button
          title="Open vehicle"
          variant="secondary"
          onPress={() => router.push(`/vehicle/${d.vehicle_id}`)}
        />
        <Button
          title="Note thread"
          variant="secondary"
          onPress={() => router.push(`/vehicle/${d.vehicle_id}/notes`)}
        />
      </Card>

      {/* Workflow actions — hidden once the report is closed, because a second
          decision on a closed case is how audit trails get confusing. */}
      {d.status === 'new' ? (
        <Row>
          <Button title="Approve" onPress={() => act('confirm')} style={{ flex: 1 }} />
          <Button title="Reject" variant="ghost" onPress={() => act('reject')} style={{ flex: 1 }} />
        </Row>
      ) : null}

      {!closed ? (
        <Card>
          <H2>Resolve</H2>
          <Muted>Attach the repair photo — it is the only proof the fix happened.</Muted>
          <PhotoButton
            label="Repair photo"
            vehicleId={d.vehicle_id}
            onCaptured={(p) => setRepairShots((prev) => [...prev, p])}
          />
          {/* Local file URIs, so these preview immediately; the report stores
              the remote paths that the outbox uploads. */}
          <PhotoStrip photos={repairShots.map((p) => p.localUri)} size={72} />
          <Button title="Mark fixed" variant="success" onPress={() => act('resolve')} />
        </Card>
      ) : null}

      {d.status === 'confirmed' && !d.penalty_payment_id ? (
        <Card style={{ borderColor: c.danger }}>
          <Row gap={6}>
            <Icon name="alert" size={20} color={c.danger} />
            <H2>Escalate to penalty</H2>
          </Row>
          <Muted>Sends the case to admin review — never a direct charge.</Muted>
          <Field
            label="Proposed penalty (€)"
            value={penalty}
            onChangeText={setPenalty}
            keyboardType="numeric"
            placeholder="25.00"
          />
          <Button title="Send to admin review" variant="danger" onPress={escalate} />
        </Card>
      ) : null}

      {d.penalty_payment_id ? (
        <Card style={{ borderColor: c.danger }}>
          <Badge label="penalty sent to admin review" color={c.danger} textColor={c.onDanger} />
        </Card>
      ) : null}

      {closed ? <Muted style={{ textAlign: 'center' }}>This report is closed.</Muted> : null}
    </Screen>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  const st = useStyles(useTheme());
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Text style={st.metaLabel}>{label}</Text>
      <Text style={st.metaValue} numberOfLines={2}>
        {value}
      </Text>
    </Row>
  );
}

const useStyles = makeStyles((t) => ({
  metaLabel: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '600' },
  metaValue: { flex: 1, color: t.c.text, fontSize: t.font.size.sm, fontWeight: '600', textAlign: 'right' },
}));
