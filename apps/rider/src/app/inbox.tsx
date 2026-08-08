import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { relativeTime } from '@penny/ui';
import { useTheme } from '../brand';
import { getApi } from '../services';
import type { InboxItem } from '../services/types';
import { useT } from '../i18n';
import { Screen, Header, T, Row, Card, Badge, Icon } from '../components/ui';

export default function InboxScreen() {
  const { t } = useT();
  const theme = useTheme();
  const api = getApi();
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);

  useEffect(() => { api.getInbox().then(setItems); }, [api]);

  const openItem = async (m: InboxItem) => {
    await api.markInboxRead(m.id);
    setItems((xs) => xs.map((x) => (x.id === m.id ? { ...x, read: true } : x)));
    if (m.deep_link?.includes('map')) router.replace('/(tabs)/map');
  };

  return (
    <Screen edges={['top']} scroll>
      <Header title={t('support.inbox')} />
      {items.length === 0 ? <Card><T variant="body">{t('support.noMessages')}</T></Card> : null}
      {items.map((m) => (
        <Pressable key={m.id} onPress={() => openItem(m)}>
          <Card style={{ marginBottom: theme.space.sm }}>
            <Row justify="space-between">
              <Row gap={8}>
                {!m.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.primary }} /> : null}
                <T variant="body" style={{ fontWeight: m.read ? '500' : '700' }}>{m.title}</T>
              </Row>
              <T variant="caption">{relativeTime(m.created_at)}</T>
            </Row>
            <T variant="caption" style={{ marginTop: 4 }}>{m.body}</T>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
