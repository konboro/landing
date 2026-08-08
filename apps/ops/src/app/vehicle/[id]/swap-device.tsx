import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, H1, H2, Muted, Body, Button, Card, Row, Badge, Field, Empty } from '../../../components/ui';
import { useMirror } from '../../../lib/useMirror';
import { getVehicle } from '../../../offline/repo';
import { swapDevice } from '../../../offline/actions';
import { useTheme, makeStyles } from '../../../brand';
import type { OpsVehicle } from '../../../lib/types';

type TestKey = 'online' | 'gps' | 'unlock';
const TESTS: { key: TestKey; label: string; hint: string }[] = [
  { key: 'online', label: 'Online / session', hint: 'Device registers with the gateway (GPRS session up).' },
  { key: 'gps', label: 'GPS fix', hint: 'Device reports a valid position.' },
  { key: 'unlock', label: 'Unlock relay', hint: 'DOUT1 fires — lock opens on command.' },
];

export default function SwapDevice() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicle = useMirror<OpsVehicle | null>(() => getVehicle(id!), null);
  const v = vehicle.data;
  if (!v) return <Screen><Empty text="Vehicle not found." /></Screen>;
  return <Wizard v={v} />;
}

function Wizard({ v }: { v: OpsVehicle }) {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [newImei, setNewImei] = useState('');
  const [tests, setTests] = useState<Record<TestKey, boolean>>({ online: false, gps: false, unlock: false });
  const [running, setRunning] = useState<TestKey | null>(null);
  const [saving, setSaving] = useState(false);

  const imeiValid = /^\d{15}$/.test(newImei.trim());
  const allPassed = tests.online && tests.gps && tests.unlock;

  function runTest(key: TestKey) {
    setRunning(key);
    // Guided test — in production this pings the gateway. Mock simulates it.
    setTimeout(() => {
      setTests((prev) => ({ ...prev, [key]: true }));
      setRunning(null);
    }, 1200);
  }

  async function finish() {
    setSaving(true);
    await swapDevice(v, null, newImei.trim(), tests);
    setSaving(false);
    router.back();
  }

  return (
    <Screen scroll>
      <H1>Swap IoT device</H1>
      <Muted>{v.code} · re-link a new Teltonika unit (IMEI). IMEI is the device identity; vehicle code stays.</Muted>

      <Row gap={space.sm}>
        {[0, 1, 2].map((s) => (
          <View key={s} style={[st.step, step >= s && st.stepOn]}>
            <Text style={[st.stepText, step >= s && { color: '#fff' }]}>{s + 1}</Text>
          </View>
        ))}
      </Row>

      {step === 0 && (
        <Card>
          <H2>1 · New device IMEI</H2>
          <Muted>Scan or type the 15-digit IMEI from the new unit.</Muted>
          <Field label="IMEI" value={newImei} onChangeText={setNewImei} keyboardType="number-pad" placeholder="356938035643809" autoFocus />
          {!imeiValid && newImei.length > 0 && <Text style={st.err}>IMEI must be exactly 15 digits.</Text>}
          <Button title="Next: run tests" onPress={() => setStep(1)} disabled={!imeiValid} />
        </Card>
      )}

      {step === 1 && (
        <Card>
          <H2>2 · Guided tests</H2>
          <Muted>Run each test before linking. All three must pass.</Muted>
          {TESTS.map((t) => (
            <Card key={t.key} style={{ borderColor: tests[t.key] ? c.success : c.border }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Body>{t.label}</Body>
                  <Muted>{t.hint}</Muted>
                </View>
                {tests[t.key] ? (
                  <Badge label="pass ✓" color={c.success} textColor="#fff" />
                ) : running === t.key ? (
                  <ActivityIndicator color={c.primary} />
                ) : (
                  <Button title="Run" variant="secondary" onPress={() => runTest(t.key)} />
                )}
              </Row>
            </Card>
          ))}
          <Row>
            <Button title="Back" variant="ghost" onPress={() => setStep(0)} style={{ flex: 1 }} />
            <Button title="Next: confirm" onPress={() => setStep(2)} disabled={!allPassed} style={{ flex: 1 }} />
          </Row>
        </Card>
      )}

      {step === 2 && (
        <Card style={{ borderColor: c.primary }}>
          <H2>3 · Confirm re-link</H2>
          <Body>Link IMEI {newImei} to {v.code}.</Body>
          <Row gap={6}>
            <Badge label="online ✓" color={c.success} textColor="#fff" />
            <Badge label="gps ✓" color={c.success} textColor="#fff" />
            <Badge label="unlock ✓" color={c.success} textColor="#fff" />
          </Row>
          <Muted>Queued offline-safe; the old device is unlinked and this is audit-logged on sync.</Muted>
          <Button title="Link device" variant="success" onPress={finish} loading={saving} />
          <Button title="Back" variant="ghost" onPress={() => setStep(1)} />
        </Card>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  step: { flex: 1, height: 6, borderRadius: 3, backgroundColor: t.c.border, alignItems: 'center' },
  stepOn: { backgroundColor: t.c.primary },
  stepText: { display: 'none' },
  err: { color: t.c.danger, fontSize: t.font.size.sm, fontWeight: '600' },
}));
