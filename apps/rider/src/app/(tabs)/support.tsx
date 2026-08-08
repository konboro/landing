import React, { useEffect, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../../lib/theme';
import { getApi } from '../../services';
import type { FaqEntry } from '../../services/types';
import { useT, useI18n } from '../../i18n';
import { Screen, T, Row, Card, Button, Divider, ListRow, Icon } from '../../components/ui';

export default function SupportScreen() {
  const { t } = useT();
  const { lang } = useI18n();
  const api = getApi();
  const router = useRouter();
  const [faq, setFaq] = useState<FaqEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { api.getFaq(lang).then(setFaq); }, [api, lang]);

  return (
    <Screen edges={['top']} scroll>
      <T variant="title" style={{ marginBottom: theme.space.md }}>{t('support.title')}</T>

      <Card style={{ marginBottom: theme.space.md }}>
        <ListRow icon="flag" title={t('support.reportVehicle')} onPress={() => router.push({ pathname: '/report/[code]', params: { code: 'none' } })} />
        <Divider />
        <ListRow icon="inbox" title={t('support.inbox')} onPress={() => router.push('/inbox')} />
      </Card>

      <T variant="label" style={{ marginBottom: theme.space.sm }}>{t('support.faq')}</T>
      <Card style={{ marginBottom: theme.space.md }}>
        {faq.map((f, i) => (
          <View key={f.id}>
            {i > 0 ? <Divider /> : null}
            <Pressable onPress={() => setOpen((o) => (o === f.id ? null : f.id))}>
              <Row justify="space-between" style={{ paddingVertical: 10 }}>
                <T variant="body" style={{ fontWeight: '600', flex: 1, paddingRight: 8 }}>{f.question}</T>
                <Icon name="chevron" size={20} color={theme.color.textMuted} style={{ transform: [{ rotate: open === f.id ? '90deg' : '0deg' }] }} />
              </Row>
            </Pressable>
            {open === f.id ? <T variant="caption" style={{ paddingBottom: 10 }}>{f.answer}</T> : null}
          </View>
        ))}
      </Card>

      <T variant="label" style={{ marginBottom: theme.space.sm }}>{t('support.contact')}</T>
      <Row gap={theme.space.md}>
        <Button title={t('support.email')} icon="mail" variant="secondary" style={{ flex: 1 }} onPress={() => Linking.openURL('mailto:support@penny.rent')} />
        <Button title={t('support.whatsapp')} icon="whatsapp" variant="secondary" style={{ flex: 1 }} onPress={() => Linking.openURL('https://wa.me/302100000000')} />
      </Row>
    </Screen>
  );
}
