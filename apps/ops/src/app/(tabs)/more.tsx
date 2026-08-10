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
import { useBrand, useTheme, makeStyles } from '../../brand';

export default function MoreTab() {
  const router = useRouter();
  const session = useOps((s) => s.session);
  const setSession = useOps((s) => s.setSession);
  const { brand, opsName, isEnabled } = useBrand();

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

      <MenuItem icon="alert" label="Damage reports" onPress={() => router.push('/damage')} />
      {isEnabled('opsDeployMode') ? (
        <MenuItem icon="place" label="Deploy mode" onPress={() => router.push('/deploy')} />
      ) : null}
      <MenuItem icon="refresh" label="Sync & dev tools" onPress={() => router.push('/dev')} />
      <MenuItem icon="info" label="Replay onboarding" onPress={() => router.push('/onboarding')} />

      <Button title="Sign out" variant="danger" onPress={logout} />
      <Muted style={{ textAlign: 'center' }}>{opsName} · offline-first field service</Muted>
      <Muted style={{ textAlign: 'center' }}>{brand.legal.legalName} · support {brand.support.email}</Muted>
    </Screen>
  );
}

function MenuItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const st = useStyles(useTheme());
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

const useStyles = makeStyles((t) => ({
  label: { color: t.c.text, fontSize: t.font.size.md, fontWeight: '700' },
  chevron: { color: t.c.textMuted, fontSize: t.font.size.xl },
}));
