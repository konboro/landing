// The always-visible sync status pill: "N pending • syncing…" / "All synced",
// plus an OFFLINE indicator. Tapping it jumps to the dev/outbox screen.
import React from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useOps } from '../lib/store';
import { c, space, radius, font } from '../lib/theme';

export function SyncPill() {
  const router = useRouter();
  const online = useOps((s) => s.online);
  const pending = useOps((s) => s.pending);
  const syncing = useOps((s) => s.syncing);
  const lastError = useOps((s) => s.lastError);

  const offline = !online;
  const label = offline
    ? pending > 0
      ? `Offline • ${pending} queued`
      : 'Offline'
    : syncing
      ? `${pending} pending • syncing…`
      : pending > 0
        ? `${pending} pending`
        : 'All synced';

  const bg = offline ? c.warning : pending > 0 || syncing ? c.primaryDeep : c.surfaceAlt;
  const fg = offline ? '#1a1200' : pending > 0 || syncing ? c.onPrimary : c.textMuted;

  return (
    <Pressable onPress={() => router.push('/dev')} style={[st.pill, { backgroundColor: bg }]}>
      <View style={[st.dot, { backgroundColor: offline ? '#7a5b00' : online ? c.success : c.danger }]} />
      {syncing && !offline ? <ActivityIndicator size="small" color={fg} /> : null}
      <Text style={[st.text, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
      {lastError && !offline ? <Text style={st.err}>⚠</Text> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, maxWidth: 220 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: font.size.sm, fontWeight: '700' },
  err: { color: '#fff' },
});
