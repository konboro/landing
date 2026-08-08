import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Screen, H2, Card, Muted, Button, Row, Badge, Divider } from '../components/ui';
import { useMirror } from '../lib/useMirror';
import { allOutbox, clearDone } from '../offline/outbox';
import { flushOnce, pullOnce } from '../offline/sync';
import { resetAndReseed } from '../offline/bootstrap';
import { net } from '../lib/net';
import { useOps } from '../lib/store';
import { relativeTime } from '@penny/ui';
import { c, space, radius, font } from '../lib/theme';
import type { OutboxRow } from '../lib/types';

const STATUS_COLOR: Record<string, string> = {
  pending: c.warning, syncing: c.primary, done: c.success, error: c.danger,
};

export default function DevScreen() {
  const online = useOps((s) => s.online);
  const override = useOps((s) => s.overrideOnline);
  const setOverride = useOps((s) => s.setOverrideOnline);
  const pending = useOps((s) => s.pending);
  const lastSyncAt = useOps((s) => s.lastSyncAt);
  const lastError = useOps((s) => s.lastError);
  const bumpRev = useOps((s) => s.bumpRev);
  const outbox = useMirror(() => allOutbox(200), [] as OutboxRow[]);
  const [busy, setBusy] = useState(false);

  function toggleOnline() {
    const next = online ? false : true;
    net.setOverride(next);
    setOverride(next);
  }
  function followHardware() {
    net.setOverride(null);
    setOverride(null);
  }

  async function forceSync() {
    setBusy(true);
    await flushOnce();
    await pullOnce();
    outbox.reload();
    setBusy(false);
  }

  return (
    <Screen scroll>
      <Card style={{ borderColor: online ? c.success : c.warning }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <H2>{online ? '🟢 Online' : '🟠 Offline'}</H2>
          <Badge label={override === null ? 'auto (hardware)' : 'forced'} color={c.surfaceAlt} />
        </Row>
        <Muted>
          Toggle connectivity to watch the outbox drain. When offline, actions still work and queue locally.
        </Muted>
        <Row>
          <Button title={online ? 'Go OFFLINE' : 'Go ONLINE'} variant={online ? 'secondary' : 'success'} onPress={toggleOnline} style={{ flex: 1 }} />
          {override !== null && <Button title="Follow device" variant="ghost" onPress={followHardware} style={{ flex: 1 }} />}
        </Row>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <H2>{pending} pending</H2>
            <Muted>Last sync: {lastSyncAt ? relativeTime(lastSyncAt) : 'never'}</Muted>
          </View>
          <Button title="Sync now" onPress={forceSync} loading={busy} disabled={!online} />
        </Row>
        {lastError ? <Text style={st.err}>Last error: {lastError}</Text> : null}
        <Row>
          <Button title="Clear completed" variant="ghost" onPress={() => clearDone().then(() => { bumpRev(); outbox.reload(); })} style={{ flex: 1 }} />
          <Button title="Reset & reseed" variant="ghost" onPress={() => resetAndReseed().then(() => outbox.reload())} style={{ flex: 1 }} />
        </Row>
      </Card>

      <H2>Outbox ({outbox.data.length})</H2>
      {outbox.data.length === 0 ? (
        <Muted>Empty — every action has synced.</Muted>
      ) : (
        outbox.data.map((row) => (
          <Card key={row.id} style={{ gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={st.kind}>{row.kind}</Text>
              <Badge label={row.status} color={STATUS_COLOR[row.status] ?? c.surfaceAlt} textColor={row.status === 'pending' ? '#1a1200' : '#fff'} />
            </Row>
            <Text style={st.id} numberOfLines={1}>id {row.id}</Text>
            <Muted>{relativeTime(row.created_at)} · attempts {row.attempts}</Muted>
            {row.last_error ? <Text style={st.rowErr}>{row.last_error}</Text> : null}
          </Card>
        ))
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  err: { color: c.danger, fontSize: font.size.sm, fontWeight: '600' },
  rowErr: { color: c.danger, fontSize: font.size.xs },
  kind: { color: c.text, fontWeight: '700', fontSize: font.size.md },
  id: { color: c.textFaint, fontSize: font.size.xs, fontFamily: font.family.mono },
});
