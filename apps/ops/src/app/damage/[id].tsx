import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, H1, H2, Muted, Body, Button, Card, Row, Badge, Field, Empty } from '../../components/ui';
import { PhotoButton, PhotoStrip } from '../../components/PhotoCapture';
import { useMirror } from '../../lib/useMirror';
import { getDamageReport, getVehicle } from '../../offline/repo';
import { updateDamage } from '../../offline/actions';
import { formatDateTime } from '@penny/ui';
import { useTheme } from '../../brand';
import type { DamageReport } from '@penny/db-types';
import type { OpsVehicle } from '../../lib/types';

export default function DamageDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = useMirror<DamageReport | null>(() => getDamageReport(id!), null);
  const d = report.data;
  if (!d) return <Screen><Empty text="Report not found." /></Screen>;
  return <DamageBody d={d} />;
}

function DamageBody({ d }: { d: DamageReport }) {
  const router = useRouter();
  const { c } = useTheme();
  const STATUS_COLOR: Record<string, string> = { new: c.warning, confirmed: c.primary, fixed: c.success, rejected: c.textFaint };
  const SEV_COLOR: Record<string, string> = { low: c.surfaceAlt, medium: c.warning, high: c.danger, critical: c.danger };
  const vehicle = useMirror<OpsVehicle | null>(() => getVehicle(d.vehicle_id), null);
  const [resolvePhotos, setResolvePhotos] = useState<string[]>([]);
  const [penalty, setPenalty] = useState('');

  async function act(action: 'confirm' | 'resolve' | 'reject') {
    await updateDamage(d.id, action, action === 'resolve' ? { photos: resolvePhotos } : {});
    router.back();
  }

  function escalate() {
    const cents = Math.round(Number(penalty) * 100);
    if (!cents || cents <= 0) { Alert.alert('Enter a penalty amount'); return; }
    Alert.alert('Escalate to penalty', 'This sends the case to admin review — it does NOT charge the rider directly. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send to review', onPress: () => updateDamage(d.id, 'escalate_penalty', { penalty_cents: cents }).then(() => router.back()) },
    ]);
  }

  return (
    <Screen scroll>
      <Row style={{ justifyContent: 'space-between' }}>
        <H1>{vehicle.data?.code ?? 'Vehicle'}</H1>
        <Row gap={6}>
          <Badge label={d.severity} color={SEV_COLOR[d.severity]} textColor={d.severity === 'low' ? c.text : c.onDanger} />
          <Badge label={d.status} color={STATUS_COLOR[d.status]} textColor={d.status === 'new' ? c.onWarning : c.onPrimary} />
        </Row>
      </Row>
      <Muted>Reported by {d.reporter} · {formatDateTime(d.created_at)}</Muted>

      <Card>
        <H2>Description</H2>
        <Body>{d.description}</Body>
        {d.linked_task_id ? <Badge label="linked to task" color={c.surfaceAlt} /> : null}
      </Card>

      {d.photos.length > 0 && (
        <Card>
          <H2>Photos</H2>
          <PhotoStrip photos={d.photos} />
        </Card>
      )}

      {/* Workflow actions */}
      {d.status === 'new' && (
        <Row>
          <Button title="Confirm" onPress={() => act('confirm')} style={{ flex: 1 }} />
          <Button title="Reject" variant="ghost" onPress={() => act('reject')} style={{ flex: 1 }} />
        </Row>
      )}

      {(d.status === 'new' || d.status === 'confirmed') && (
        <Card>
          <H2>Resolve</H2>
          <PhotoButton label="Repair photo" vehicleId={d.vehicle_id} onCaptured={(p) => setResolvePhotos((prev) => [...prev, p.remotePath])} />
          <PhotoStrip photos={resolvePhotos} />
          <Button title="Mark resolved (fixed)" variant="success" onPress={() => act('resolve')} />
        </Card>
      )}

      {d.status === 'confirmed' && !d.penalty_payment_id && (
        <Card style={{ borderColor: c.danger }}>
          <H2>Escalate to penalty</H2>
          <Muted>Sends to admin review — never a direct charge (Hard Rule: money via ledger + admin).</Muted>
          <Field label="Proposed penalty (€)" value={penalty} onChangeText={setPenalty} keyboardType="numeric" placeholder="25.00" />
          <Button title="Send to admin review" variant="danger" onPress={escalate} />
        </Card>
      )}

      {d.penalty_payment_id ? (
        <Card style={{ borderColor: c.danger }}>
          <Badge label="penalty sent to admin review" color={c.danger} textColor={c.onDanger} />
        </Card>
      ) : null}
    </Screen>
  );
}
