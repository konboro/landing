import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, H2, Muted, Button, Field, Card, Row } from '../../components/ui';
import { SyncPill } from '../../components/SyncPill';
import { findVehicleByCode } from '../../offline/repo';
import { useTheme, makeStyles } from '../../brand';

let Camera: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Camera = require('expo-camera');
} catch {
  Camera = null;
}

export default function ScanTab() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const perms = Camera?.useCameraPermissions?.();
  const permission = perms?.[0] ?? null;
  const request = perms?.[1];
  const locked = useRef(false);

  async function resolve(raw: string) {
    setError(null);
    // Accept a bare code or a pennyops://vehicle/CODE deep link.
    const parsed = raw.includes('/') ? raw.split('/').pop()! : raw;
    const v = await findVehicleByCode(parsed);
    if (!v) {
      setError(`No vehicle found for "${parsed}". Check the code.`);
      return;
    }
    router.push(`/vehicle/${v.id}`);
  }

  function onBarcode({ data }: { data: string }) {
    if (locked.current) return;
    locked.current = true;
    setScanning(false);
    resolve(data).finally(() => {
      setTimeout(() => (locked.current = false), 1200);
    });
  }

  const CameraView = Camera?.CameraView;
  const canScan = !!CameraView && permission?.granted;

  return (
    <Screen scroll>
      <SyncPill />
      <H2>Scan or search a vehicle</H2>
      <Muted>Scan the QR on the scooter, or type its fleet code (e.g. ATH-1042).</Muted>

      <Card>
        <View style={st.scanBox}>
          {scanning && canScan ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13'] }}
              onBarcodeScanned={onBarcode}
            />
          ) : (
            <View style={st.scanPlaceholder}>
              <Text style={{ fontSize: 40 }}>🔦</Text>
              <Muted>{canScan ? 'Camera ready' : 'Camera unavailable — use code search below'}</Muted>
            </View>
          )}
        </View>
        {canScan ? (
          <Button title={scanning ? 'Stop scanning' : 'Start QR scan'} onPress={() => setScanning((v) => !v)} />
        ) : permission && !permission.granted ? (
          <Button title="Enable camera" variant="secondary" onPress={() => request?.()} />
        ) : null}
      </Card>

      <Card>
        <Field label="Fleet code" value={code} onChangeText={setCode} placeholder="ATH-1042" autoFocus />
        <Button title="Find vehicle" onPress={() => resolve(code)} disabled={!code.trim()} />
        {error && <Text style={st.err}>{error}</Text>}
      </Card>

      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable style={st.link} onPress={() => router.push('/deploy')}>
          <Text style={st.linkText}>📍 Deploy mode (batch)</Text>
        </Pressable>
        <Pressable style={st.link} onPress={() => router.push('/damage/new')}>
          <Text style={st.linkText}>⚠ Report damage</Text>
        </Pressable>
      </Row>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  scanBox: { height: 220, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: t.c.border },
  scanPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: t.space.sm },
  err: { color: t.c.danger, fontSize: t.font.size.sm, fontWeight: '600' },
  link: { flex: 1, padding: t.space.md, alignItems: 'center', borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.border, backgroundColor: t.c.surface },
  linkText: { color: t.c.text, fontWeight: '700', fontSize: t.font.size.sm },
}));
