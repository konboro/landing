import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../../lib/theme';
import { getApi } from '../../services';
import { useT } from '../../i18n';
import { useSession } from '../../store/session';
import { Screen, Header, T, Button, Card, Badge, Banner, Row, Icon } from '../../components/ui';
import { StepDots } from '../../components/onboarding/StepDots';

export default function CardScreen() {
  const router = useRouter();
  const { t } = useT();
  const api = getApi();
  const advance = useSession((s) => s.advance);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const next = async () => {
    await advance('tutorial');
    router.push('/onboarding/tutorial');
  };

  const addCard = async () => {
    setBusy('card');
    try { await api.addCard(); setAdded(true); } finally { setBusy(null); }
  };

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <Header />
      <StepDots current="card" />
      <View style={{ flex: 1, gap: theme.space.md, paddingTop: theme.space.lg }}>
        <T variant="title">{t('onboarding.cardTitle')}</T>
        <T variant="body" color={theme.color.textMuted}>{t('onboarding.cardBody')}</T>

        {/* Apple/Google Pay as primary CTA (docs/05 2nd-pass) */}
        <Card style={{ borderColor: theme.color.primary, borderWidth: 1 }}>
          <Row justify="space-between">
            <Row gap={10}><Icon name="applepay" size={24} /><T variant="body" style={{ fontWeight: '700' }}>{t('wallet.walletPay')}</T></Row>
            <Badge tone="primary" label="Fastest" />
          </Row>
        </Card>

        {added ? (
          <Banner tone="success" icon="check" title="Card added" />
        ) : (
          <Button title={t('wallet.addCard')} icon="card" variant="secondary" onPress={addCard} loading={busy === 'card'} />
        )}
      </View>

      <View style={{ gap: theme.space.sm }}>
        <Button title={t('common.continue')} onPress={next} />
        {!added ? <Button title={t('common.skip')} variant="ghost" onPress={next} /> : null}
      </View>
    </Screen>
  );
}
