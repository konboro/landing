import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, H1, H2, Muted, Body, Button, Card, Row, Badge, Field, Empty } from '../components/ui';
import { PhotoButton, PhotoStrip } from '../components/PhotoCapture';
import { findVehicleByCode } from '../offline/repo';
import { deployDrop } from '../offline/actions';
import { getCurrentPos } from '../lib/geoloc';
import { c, space, font } from '../lib/theme';
import type { OpsVehicle } from '../lib/types';
import type { LngLat } from '@penny/db-types';

interface BatchItem {
  vehicle: OpsVehicle;
  photo?: string;
  pos?: LngLat;
  deployed: boolean;
}

export default function Deploy() {
  const [code, setCode] = useState('');
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const v = await findVehicleByCode(code.trim());
    if (!v) { setError(`No vehicle "${code}"`); return; }
    if (batch.some((b) => b.vehicle.id === v.id)) { setError('Already in batch'); return; }
    setBatch((prev) => [...prev, { vehicle: v, deployed: false }]);
    setCode('');
  }

  async function pinHere(id: string) {
    const { pos } = await getCurrentPos();
    setBatch((prev) => prev.map((b) => (b.vehicle.id === id ? { ...b, pos } : b)));
  }

  function attach(id: string, remotePath: string) {
    setBatch((prev) => prev.map((b) => (b.vehicle.id === id ? { ...b, photo: remotePath } : b)));
  }

  async function drop(item: BatchItem) {
    if (!item.pos || !item.photo) return;
    await deployDrop(item.vehicle, item.pos, [item.photo]);
    setBatch((prev) => prev.map((b) => (b.vehicle.id === item.vehicle.id ? { ...b, deployed: true } : b)));
  }

  const pending = batch.filter((b) => !b.deployed);
  const doneCount = batch.length - pending.length;

  return (
    <Screen scroll>
      <H1>Deploy mode</H1>
      <Muted>Batch place vehicles: scan/enter code → drop pin + photo → set available. Works offline.</Muted>

      <Card>
        <Field label="Add by code" value={code} onChangeText={setCode} placeholder="ATH-1042" />
        <Button title="Add to batch" onPress={add} disabled={!code.trim()} />
        {error && <Text style={st.err}>{error}</Text>}
      </Card>

      {batch.length > 0 && (
        <Row style={{ justifyContent: 'space-between' }}>
          <H2>Batch ({batch.length})</H2>
          <Badge label={`${doneCount} deployed`} color={c.success} textColor="#fff" />
        </Row>
      )}

      {batch.length === 0 ? (
        <Empty text="Add vehicles to start deploying." />
      ) : (
        batch.map((item) => (
          <Card key={item.vehicle.id} style={{ borderColor: item.deployed ? c.success : c.border }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <H2>{item.vehicle.code}</H2>
              {item.deployed ? <Badge label="available ✓" color={c.success} textColor="#fff" /> : <Badge label="staged" color={c.surfaceAlt} />}
            </Row>
            {!item.deployed && (
              <>
                <Row gap={space.sm}>
                  <View style={{ flex: 1 }}>
                    <Button title={item.pos ? '📍 Pin set ✓' : '📍 Drop pin here'} variant="secondary" onPress={() => pinHere(item.vehicle.id)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PhotoButton label={item.photo ? 'Photo ✓' : 'Confirm photo'} vehicleId={item.vehicle.id} onCaptured={(p) => attach(item.vehicle.id, p.remotePath)} />
                  </View>
                </Row>
                {item.photo && <PhotoStrip photos={[item.photo]} />}
                <Button title="Deploy (set available)" variant="success" onPress={() => drop(item)} disabled={!item.pos || !item.photo} />
                {(!item.pos || !item.photo) && <Muted>Need a pin and a confirmation photo to deploy.</Muted>}
              </>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  err: { color: c.danger, fontSize: font.size.sm, fontWeight: '600' },
});
