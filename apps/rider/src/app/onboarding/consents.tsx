import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../../lib/theme';
import { getApi } from '../../services';
import { useT } from '../../i18n';
import { useSession } from '../../store/session';
import { Screen, Header, T, Button, Card, Toggle, Divider } from '../../components/ui';
import { StepDots } from '../../components/onboarding/StepDots';

export default function ConsentsScreen() {
  const router = useRouter();
  const { t } = useT();
  const api = getApi();
  const setUser = useSession((s) => s.setUser);
  const advance = useSession((s) => s.advance);

  const [tos, setTos] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [mktPush, setMktPush] = useState(false);
  const [mktEmail, setMktEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  const next = async () => {
    setBusy(true);
    try {
      const u = await api.updateProfile({
        tos_accepted: tos,
        privacy_accepted: privacy,
        marketing_push: mktPush,
        marketing_email: mktEmail,
      });
      setUser(u);
      await advance('kyc');
      router.push('/onboarding/kyc');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} scroll>
      <Header />
      <StepDots current="consents" />
      <T variant="title" style={{ marginTop: theme.space.md }}>{t('onboarding.consentTitle')}</T>
      <Card style={{ marginTop: theme.space.lg }}>
        <Toggle label={t('onboarding.tos')} value={tos} onChange={setTos} />
        <Divider />
        <Toggle label={t('onboarding.privacy')} value={privacy} onChange={setPrivacy} />
        <Divider />
        <Toggle label={t('onboarding.marketingPush')} description={t('common.optional')} value={mktPush} onChange={setMktPush} />
        <Divider />
        <Toggle label={t('onboarding.marketingEmail')} description={t('common.optional')} value={mktEmail} onChange={setMktEmail} />
      </Card>
      <View style={{ flex: 1 }} />
      <Button title={t('common.continue')} onPress={next} loading={busy} disabled={!tos || !privacy} style={{ marginTop: theme.space.lg }} />
    </Screen>
  );
}
