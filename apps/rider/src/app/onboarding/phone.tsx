import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../brand';
import { getApi } from '../../services';
import { useT } from '../../i18n';
import { Screen, Header, T, Button, TextField, Banner } from '../../components/ui';
import { StepDots } from '../../components/onboarding/StepDots';

export default function PhoneScreen() {
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const api = getApi();
  const [phone, setPhone] = useState('+30 ');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const res = await api.sendOtp(phone.trim());
      setDevCode(res.devCode ?? null);
      router.push({ pathname: '/onboarding/otp', params: { phone: phone.trim() } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <Header />
      <StepDots current="phone" />
      <View style={{ flex: 1, gap: theme.space.md, paddingTop: theme.space.lg }}>
        <T variant="title">{t('onboarding.phoneTitle')}</T>
        <T variant="body" color={theme.color.textMuted}>{t('onboarding.phoneHint')}</T>
        <TextField
          label={t('onboarding.phonePlaceholder')}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          autoFocus
        />
        {devCode ? <Banner tone="neutral" icon="info" title={`Mock code: ${devCode}`} body="Live mode sends a real SMS." /> : null}
      </View>
      <Button title={t('onboarding.sendCode')} onPress={send} loading={busy} disabled={phone.trim().length < 6} />
    </Screen>
  );
}
