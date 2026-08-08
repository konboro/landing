import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, H2, Card, Muted, Button, Row } from '../../components/ui';
import { StatusLegend } from '../../components/StatusLegend';
import { SyncPill } from '../../components/SyncPill';
import { useOps } from '../../lib/store';
import { clearSession } from '../../lib/auth';
import { resetDb } from '../../offline/db';
import { env } from '../../lib/env';
import { c, space, font } from '../../lib/theme';

export default function MoreTab() {
  const router = useRouter();
  const session = useOps((s) => s.session);
  const setSession = useOps((s) => s.setSession);

  async function logout() {
    await clearSession();
    await resetDb();
    setSession(null);
    router.replace('/login');
  }

  return (
    <Screen scroll>
      <SyncPill />

      <Card>
        <H2>{session?.name ?? 'Ops'}</H2>
        <Muted>{session?.phone} · role: {session?.role}</Muted>
        <Muted>Backend: {env.dataSource}{env.dataSource === 'mock' ? ' (standalone)' : ''}</Muted>
      </Card>

      <Card>
        <H2>Status legend</H2>
        <StatusLegend />
      </Card>

      <MenuItem icon="⚠" label="Damage reports" onPress={() => router.push('/damage/index')} />
      <MenuItem icon="📍" label="Deploy mode" onPress={() => router.push('/deploy')} />
      <MenuItem icon="🔁" label="Sync & dev tools" onPress={() => router.push('/dev')} />
      <MenuItem icon="🎓" label="Replay onboarding" onPress={() => router.push('/onboarding')} />

      <Button title="Sign out" variant="danger" onPress={logout} />
      <Muted style={{ textAlign: 'center' }}>Penny Ops · offline-first field service</Muted>
    </Screen>
  );
}

function MenuItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Card onPress={onPress}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <Text style={{ fontSize: 22 }}>{icon}</Text>
          <Text style={st.label}>{label}</Text>
        </Row>
        <Text style={st.chevron}>›</Text>
      </Row>
    </Card>
  );
}

const st = StyleSheet.create({
  label: { color: c.text, fontSize: font.size.md, fontWeight: '700' },
  chevron: { color: c.textMuted, fontSize: font.size.xl },
});
