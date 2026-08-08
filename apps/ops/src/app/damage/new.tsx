import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, H1, H2, Muted, Button, Card, Row, Field, Badge } from '../../components/ui';
import { PhotoButton, PhotoStrip } from '../../components/PhotoCapture';
import { findVehicleByCode, getVehicle } from '../../offline/repo';
import { createDamage } from '../../offline/actions';
import { getCurrentPos } from '../../lib/geoloc';
import { c, space, font } from '../../lib/theme';
import type { OpsVehicle } from '../../lib/types';

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const SEV_COLOR: Record<string, string> = { low: c.surfaceAlt, medium: c.warning, high: c.danger, critical: c.danger };

export default function NewDamage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ vehicleId?: string; taskId?: string }>();
  const [vehicle, setVehicle] = useState<OpsVehicle | null>(null);
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.vehicleId) getVehicle(params.vehicleId).then(setVehicle);
  }, [params.vehicleId]);

  async function findVehicle() {
    const v = await findVehicleByCode(code);
    if (!v) setError(`No vehicle "${code}"`);
    else { setVehicle(v); setError(null); }
  }

  async function submit() {
    if (!vehicle || !desc.trim()) return;
    setSaving(true);
    const { pos } = await getCurrentPos();
    await createDamage(vehicle.id, desc.trim(), severity, photos, params.taskId ?? null, pos);
    setSaving(false);
    router.back();
  }

  return (
    <Screen scroll>
      <H1>New damage report</H1>

      {vehicle ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>{vehicle.code}</H2>
            <Button title="Change" variant="ghost" onPress={() => setVehicle(null)} />
          </Row>
          <Muted>{vehicle.model_name} · {vehicle.status.replace('_', ' ')}</Muted>
        </Card>
      ) : (
        <Card>
          <Field label="Vehicle code" value={code} onChangeText={setCode} placeholder="ATH-1042" />
          <Button title="Find vehicle" onPress={findVehicle} disabled={!code.trim()} />
          {error && <Text style={st.err}>{error}</Text>}
        </Card>
      )}

      <Field label="Description" value={desc} onChangeText={setDesc} multiline placeholder="What's damaged…" />

      <View style={{ gap: space.xs }}>
        <Text style={st.label}>Severity</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {SEVERITIES.map((s) => (
            <Pressable key={s} onPress={() => setSeverity(s)} style={[st.sev, severity === s && { borderColor: SEV_COLOR[s], borderWidth: 2 }]}>
              <Badge label={s} color={SEV_COLOR[s]} textColor={s === 'low' ? c.text : '#fff'} />
            </Pressable>
          ))}
        </Row>
      </View>

      <Card>
        <H2>Photos</H2>
        <PhotoButton label="Add damage photo" vehicleId={vehicle?.id ?? 'unknown'} onCaptured={(p) => setPhotos((prev) => [...prev, p.remotePath])} />
        <PhotoStrip photos={photos} />
      </Card>

      <Button title="Create report" variant="success" onPress={submit} loading={saving} disabled={!vehicle || !desc.trim()} />
      <Muted style={{ textAlign: 'center' }}>Queued offline. Links to task {params.taskId ? '(linked)' : '(none)'}.</Muted>
    </Screen>
  );
}

const st = StyleSheet.create({
  err: { color: c.danger, fontSize: font.size.sm, fontWeight: '600' },
  label: { color: c.textMuted, fontSize: font.size.sm, fontWeight: '600' },
  sev: { padding: 4, borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
});
