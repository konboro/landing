import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, H1, H2, Muted, Body, Button, Card, Row, Badge, StatusDot, Field, Empty } from '../../../components/ui';
import { PhotoButton, PhotoStrip } from '../../../components/PhotoCapture';
import { useMirror } from '../../../lib/useMirror';
import { getVehicle } from '../../../offline/repo';
import { allowedTransitions, STOLEN_CONFIRM_EFFECTS, type Transition, type OpsRole } from '../../../lib/status-matrix';
import { changeStatus } from '../../../offline/actions';
import { getCurrentPos } from '../../../lib/geoloc';
import { useOps } from '../../../lib/store';
import { colorForStatus, c, space, font } from '../../../lib/theme';
import type { OpsVehicle } from '../../../lib/types';

export default function StatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicle = useMirror<OpsVehicle | null>(() => getVehicle(id!), null);
  const v = vehicle.data;
  if (!v) return <Screen><Empty text="Vehicle not found." /></Screen>;
  return <StatusBody v={v} />;
}

function StatusBody({ v }: { v: OpsVehicle }) {
  const router = useRouter();
  const role = (useOps((s) => s.session?.role) ?? 'ops') as OpsRole;
  const transitions = allowedTransitions(v.status, role);
  const [selected, setSelected] = useState<Transition | null>(null);
  const [reason, setReason] = useState('');
  const [police, setPolice] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const needsPhoto = selected?.requiresPhoto ?? false;
  const needsReason = selected?.requiresReason ?? false;
  const missing: string[] = [];
  if (selected) {
    if (needsPhoto && photos.length === 0) missing.push('photo required');
    if (needsReason && !reason.trim()) missing.push('reason required');
    if (selected.requiresChecklist) missing.push('maintenance checklist must be done (complete the task first)');
  }

  async function apply() {
    if (!selected) return;
    if (missing.length > 0) {
      Alert.alert('Cannot apply', missing.join('\n'));
      return;
    }
    setSaving(true);
    const { pos } = await getCurrentPos();
    await changeStatus(v, selected, reason.trim() || null, photos, pos, selected.adminReview ? police.trim() || null : null);
    setSaving(false);
    router.back();
  }

  return (
    <Screen scroll>
      <Row>
        <StatusDot status={v.status} size={16} />
        <H1>{v.code}</H1>
      </Row>
      <Muted>Current status: {v.status.replace('_', ' ')}</Muted>

      <H2>Change to</H2>
      {transitions.length === 0 ? (
        <Empty text="No transitions available from this status for your role." />
      ) : (
        transitions.map((t) => (
          <Card key={t.to} onPress={() => setSelected(t)} style={selected?.to === t.to ? { borderColor: colorForStatus(t.to), borderWidth: 2 } : undefined}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <StatusDot status={t.to} />
                <Text style={st.tLabel}>{t.label}</Text>
              </Row>
              <Row gap={4}>
                {t.requiresPhoto && <Badge label="photo" color={c.warning} textColor="#1a1200" />}
                {t.requiresReason && <Badge label="reason" color={c.surfaceAlt} />}
                {t.adminReview && <Badge label="admin review" color={c.danger} textColor="#fff" />}
              </Row>
            </Row>
            {t.sideEffects && t.sideEffects.map((e, i) => <Muted key={i}>• {e}</Muted>)}
          </Card>
        ))
      )}

      {selected && (
        <Card style={{ borderColor: c.primary }}>
          <H2>{selected.label}</H2>

          {selected.adminReview && (
            <Card style={{ borderColor: c.danger }}>
              <Muted>This flags the vehicle for admin review. It does NOT change status locally. On admin confirm:</Muted>
              {STOLEN_CONFIRM_EFFECTS.map((e, i) => <Text key={i} style={st.effect}>• {e}</Text>)}
              <Field label="Police report ref (optional)" value={police} onChangeText={setPolice} placeholder="AB-2026-…" />
            </Card>
          )}

          {(selected.requiresReason || true) && (
            <Field label={`Reason${selected.requiresReason ? ' *' : ' (optional)'}`} value={reason} onChangeText={setReason} multiline placeholder="Why this change…" />
          )}

          {selected.requiresPhoto && (
            <View style={{ gap: space.sm }}>
              <PhotoButton label={photos.length ? `Photo added (${photos.length})` : 'Add required photo *'} vehicleId={v.id} onCaptured={(p) => setPhotos((prev) => [...prev, p.remotePath])} />
              <PhotoStrip photos={photos} />
            </View>
          )}

          {selected.requiresChecklist && (
            <Muted>Return-to-service requires the maintenance task checklist done. Complete the related task, then set available.</Muted>
          )}

          {missing.length > 0 && <Text style={st.missing}>Missing: {missing.join(', ')}</Text>}
          <Button title={selected.adminReview ? 'Send to admin review' : 'Apply status change'} onPress={apply} loading={saving} disabled={missing.length > 0} />
          <Muted style={{ textAlign: 'center' }}>Server wins on status. Change is queued and audit-logged on sync.</Muted>
        </Card>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  tLabel: { color: c.text, fontWeight: '700', fontSize: font.size.md },
  effect: { color: c.textMuted, fontSize: font.size.sm },
  missing: { color: c.danger, fontSize: font.size.sm, fontWeight: '600' },
});
