// Forced parking-photo camera — NO gallery access (docs/06 #4). Uses expo-camera
// when present; falls back to a simulated capture so the end-ride flow always
// completes in Expo Go.
import React, { useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useTheme, makeStyles } from '../../brand';
import type { RiderTheme } from '../../brand';
import { Haptics } from '../../lib/native';
import { T, Button } from '../ui';
import { Icon } from '../ui/Icon';

let CameraMod: typeof import('expo-camera') | null;
try {
  CameraMod = require('expo-camera');
} catch {
  CameraMod = null;
}

export function PhotoCamera({ onCapture, hint }: { onCapture: (uri: string) => void; hint?: string }) {
  if (CameraMod) return <LivePhoto mod={CameraMod} onCapture={onCapture} hint={hint} />;
  return <FallbackPhoto onCapture={onCapture} hint={hint} />;
}

function usePhotoStyles(): { theme: RiderTheme; styles: ReturnType<typeof useStyles> } {
  const theme = useTheme();
  return { theme, styles: useStyles(theme) };
}

function LivePhoto({
  mod,
  onCapture,
  hint,
}: {
  mod: typeof import('expo-camera');
  onCapture: (uri: string) => void;
  hint?: string;
}) {
  const [permission, requestPermission] = mod.useCameraPermissions();
  const ref = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const { theme, styles } = usePhotoStyles();
  const { CameraView } = mod;

  if (!permission) return <View style={styles.fill} />;
  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Icon name="camera" size={48} />
        <T variant="subtitle" center style={{ marginVertical: theme.space.md }}>Camera access</T>
        <Button title="Allow camera" onPress={requestPermission} icon="camera" />
        <Button title="Simulate photo" variant="ghost" onPress={() => onCapture('mock://photo/parked.jpg')} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={ref} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.frameHint} pointerEvents="none">
        <View style={styles.frame} />
      </View>
      {hint ? (
        <T variant="caption" color={theme.color.textInverse} center style={styles.hint}>
          {hint}
        </T>
      ) : null}
      <View style={styles.shutterWrap}>
        <Pressable
          onPress={async () => {
            if (busy) return;
            setBusy(true);
            Haptics.medium();
            try {
              const pic = await ref.current?.takePictureAsync?.({ quality: 0.7 });
              onCapture(pic?.uri ?? 'mock://photo/parked.jpg');
            } catch {
              onCapture('mock://photo/parked.jpg');
            } finally {
              setBusy(false);
            }
          }}
          style={styles.shutter}
        >
          <View style={styles.shutterInner} />
        </Pressable>
      </View>
    </View>
  );
}

function FallbackPhoto({ onCapture, hint }: { onCapture: (uri: string) => void; hint?: string }) {
  const { theme, styles } = usePhotoStyles();
  return (
    <View style={[styles.fill, styles.fallbackBg, styles.center]}>
      <Icon name="camera" size={56} color={theme.color.textInverse} />
      <T variant="subtitle" color={theme.color.textInverse} center style={{ marginVertical: theme.space.md }}>
        Parking photo
      </T>
      {hint ? <T variant="caption" color={theme.color.textInverse} center style={{ marginBottom: theme.space.lg }}>{hint}</T> : null}
      <Button title="Take photo (simulated)" icon="camera" onPress={() => onCapture('mock://photo/parked.jpg')} full={false} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.surface, padding: t.space.xl },
  fallbackBg: { backgroundColor: t.palette.ink900 },
  frameHint: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '80%', height: '55%', borderRadius: t.radius.lg,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', borderStyle: 'dashed',
  },
  hint: { position: 'absolute', top: 60, left: t.space.xl, right: t.space.xl, textShadowColor: '#000', textShadowRadius: 6 },
  shutterWrap: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
  shutter: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#ffffff',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#ffffff' },
}));
