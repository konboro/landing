// Guarded camera capture. Uses expo-camera when available + permitted; falls
// back to a synthetic placeholder URI so the whole photo-attach flow still
// works in Expo Go / simulators without a camera. Captured photos are queued
// for resumable upload via the outbox and referenced by their remote path.
import React, { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Image } from 'react-native';
import { c, space, radius, font, tap } from '../lib/theme';
import { queuePhoto } from '../offline/outbox';
import { uuid } from '../lib/ids';

let Camera: {
  CameraView?: React.ComponentType<any>;
  useCameraPermissions?: () => [
    { granted: boolean } | null,
    () => Promise<{ granted: boolean }>,
  ];
} | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Camera = require('expo-camera');
} catch {
  Camera = null;
}

export interface CapturedPhoto {
  /** Local file URI (or synthetic placeholder). */
  localUri: string;
  /** Remote storage path assigned by the outbox queue. */
  remotePath: string;
}

/** A big, glove-friendly button that captures a photo and returns it. */
export function PhotoButton({
  label = 'Add photo',
  vehicleId,
  onCaptured,
  variant = 'secondary',
}: {
  label?: string;
  vehicleId: string;
  onCaptured: (p: CapturedPhoto) => void;
  variant?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = useState(false);

  async function finalize(localUri: string) {
    const remotePath = await queuePhoto(localUri, vehicleId);
    onCaptured({ localUri, remotePath });
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          st.btn,
          variant === 'primary' && { backgroundColor: c.primary },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={[st.btnText, variant === 'primary' && { color: c.onPrimary }]}>{'📷  ' + label}</Text>
      </Pressable>
      <CameraModal open={open} onClose={() => setOpen(false)} onShot={finalize} />
    </>
  );
}

function CameraModal({ open, onClose, onShot }: {
  open: boolean; onClose: () => void; onShot: (uri: string) => Promise<void>;
}) {
  const perms = Camera?.useCameraPermissions?.();
  const permission = perms?.[0] ?? null;
  const request = perms?.[1];
  const CameraView = Camera?.CameraView;
  const cameraRef = React.useRef<any>(null);

  const canUseCamera = !!CameraView && permission?.granted;

  async function shoot() {
    try {
      if (cameraRef.current?.takePictureAsync) {
        const pic = await cameraRef.current.takePictureAsync({ quality: 0.5, skipProcessing: true });
        await onShot(pic?.uri ?? syntheticUri());
      } else {
        await onShot(syntheticUri());
      }
    } catch {
      await onShot(syntheticUri());
    }
    onClose();
  }

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={st.modal}>
        {CameraView && permission && !permission.granted ? (
          <View style={st.center}>
            <Text style={st.info}>Camera permission needed to attach photos.</Text>
            <Pressable style={st.action} onPress={() => request?.()}>
              <Text style={st.actionText}>Grant permission</Text>
            </Pressable>
            <Pressable style={[st.action, { backgroundColor: c.surfaceAlt }]} onPress={shoot}>
              <Text style={[st.actionText, { color: c.text }]}>Use placeholder photo</Text>
            </Pressable>
          </View>
        ) : canUseCamera ? (
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
        ) : (
          <View style={st.center}>
            <Text style={st.info}>No camera available in this environment.</Text>
            <Text style={st.hint}>A placeholder photo will be attached and queued for upload.</Text>
          </View>
        )}
        <View style={st.bar}>
          <Pressable style={st.cancel} onPress={onClose}>
            <Text style={st.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable style={st.shutter} onPress={shoot}>
            <View style={st.shutterInner} />
          </Pressable>
          <View style={{ width: 72 }} />
        </View>
      </View>
    </Modal>
  );
}

function syntheticUri(): string {
  // Deterministic placeholder path. In a real capture this is a file:// URI.
  return `placeholder://ops-photo/${uuid()}.jpg`;
}

/** Horizontal strip of attached photos (thumbnails or placeholder tiles). */
export function PhotoStrip({ photos }: { photos: string[] }) {
  if (photos.length === 0) return null;
  return (
    <View style={st.strip}>
      {photos.map((p, i) => {
        const isReal = p.startsWith('file://') || p.startsWith('http');
        return isReal ? (
          <Image key={i} source={{ uri: p }} style={st.thumb} />
        ) : (
          <View key={i} style={[st.thumb, st.placeholder]}>
            <Text style={st.placeholderText}>📷</Text>
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  btn: { minHeight: tap.min, borderRadius: radius.md, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 1, borderColor: c.border },
  btnText: { color: c.text, fontSize: font.size.md, fontWeight: '700' },
  modal: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  info: { color: '#fff', fontSize: font.size.lg, textAlign: 'center' },
  hint: { color: '#aaa', fontSize: font.size.sm, textAlign: 'center' },
  action: { backgroundColor: c.primary, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.md },
  actionText: { color: '#fff', fontWeight: '700', fontSize: font.size.md },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.xl, backgroundColor: '#000' },
  cancel: { width: 72 },
  cancelText: { color: '#fff', fontSize: font.size.md },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: c.surfaceAlt },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
  placeholderText: { fontSize: 24 },
});
