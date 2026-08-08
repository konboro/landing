// QR scanner with a hard fallback. Uses expo-camera when available; otherwise
// (or before permission) offers manual entry + a simulate button so the flow is
// always completable in Expo Go.
import React, { useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { theme } from '../../lib/theme';
import { Haptics } from '../../lib/native';
import { T, Button, Row } from '../ui';
import { Icon } from '../ui/Icon';

let CameraMod: typeof import('expo-camera') | null;
try {
  CameraMod = require('expo-camera');
} catch {
  CameraMod = null;
}

export function QrScanner({
  onScan,
  onManual,
  simulateCode = 'PNY-4821',
}: {
  onScan: (code: string) => void;
  onManual: () => void;
  simulateCode?: string;
}) {
  if (CameraMod) return <LiveScanner mod={CameraMod} onScan={onScan} onManual={onManual} simulateCode={simulateCode} />;
  return <FallbackScanner onScan={onScan} onManual={onManual} simulateCode={simulateCode} />;
}

function LiveScanner({
  mod,
  onScan,
  onManual,
  simulateCode,
}: {
  mod: typeof import('expo-camera');
  onScan: (code: string) => void;
  onManual: () => void;
  simulateCode: string;
}) {
  const [permission, requestPermission] = mod.useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const locked = useRef(false);
  const { CameraView } = mod;

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center, { padding: theme.space.xl, gap: theme.space.lg }]}>
        <Icon name="camera" size={48} />
        <T variant="subtitle" center>Camera access</T>
        <T variant="caption" center>Penny needs the camera to scan the scooter QR code.</T>
        <Button title="Allow camera" onPress={requestPermission} icon="camera" />
        <Button title="Enter code manually" variant="ghost" onPress={onManual} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }: { data: string }) => {
          if (locked.current) return;
          locked.current = true;
          Haptics.success();
          // Accept a raw code or a penny://vehicle/{code} deep link.
          const m = data.match(/vehicle\/(.+)$/);
          onScan((m ? m[1]! : data).trim());
        }}
      />
      <ScannerOverlay
        torch={torch}
        onTorch={() => setTorch((t) => !t)}
        onManual={onManual}
        onSimulate={() => onScan(simulateCode)}
      />
    </View>
  );
}

function FallbackScanner({
  onScan,
  onManual,
  simulateCode,
}: {
  onScan: (code: string) => void;
  onManual: () => void;
  simulateCode: string;
}) {
  return (
    <View style={[styles.fill, styles.fallbackBg]}>
      <ScannerOverlay torch={false} onManual={onManual} onSimulate={() => onScan(simulateCode)} noTorch />
    </View>
  );
}

function ScannerOverlay({
  torch,
  onTorch,
  onManual,
  onSimulate,
  noTorch = false,
}: {
  torch?: boolean;
  onTorch?: () => void;
  onManual: () => void;
  onSimulate: () => void;
  noTorch?: boolean;
}) {
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.reticle}>
        <View style={[styles.corner, styles.tl]} />
        <View style={[styles.corner, styles.tr]} />
        <View style={[styles.corner, styles.bl]} />
        <View style={[styles.corner, styles.br]} />
      </View>
      <T variant="body" color={theme.color.textInverse} center style={styles.hint}>
        Point at the QR code on the handlebar
      </T>
      <View style={styles.controls}>
        <Row justify="center" gap={theme.space.md}>
          {!noTorch ? (
            <Pressable onPress={onTorch} style={[styles.round, torch && { backgroundColor: theme.color.primary }]}>
              <Icon name="flash" size={22} color={theme.color.textInverse} />
            </Pressable>
          ) : null}
        </Row>
        <Button title="Simulate scan" onPress={onSimulate} icon="qr" />
        <Button title="Enter code manually" variant="ghost" onPress={onManual} style={styles.ghost} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  fallbackBg: { backgroundColor: theme.palette.ink900 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  reticle: { width: 240, height: 240, position: 'relative' },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: theme.color.onPrimary },
  tl: { top: 0, left: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 12 },
  hint: { marginTop: theme.space.xl, textShadowColor: '#000', textShadowRadius: 6 },
  controls: { position: 'absolute', bottom: 48, left: theme.space.xl, right: theme.space.xl, gap: theme.space.md },
  round: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  ghost: { backgroundColor: 'rgba(255,255,255,0.12)' },
});
