import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../brand';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import { RiderApiError } from '../../services/types';
import { useT } from '../../i18n';
import { useSession } from '../../store/session';
import { Screen, Header, T, Button, TextField } from '../../components/ui';
import { StepDots } from '../../components/onboarding/StepDots';

export default function NameScreen() {
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const api = getApi();
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const advance = useSession((s) => s.advance);

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  // customer_forms extra fields (panel-configurable in prod)
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      const u = await api.updateProfile({ full_name: fullName.trim(), email: email.trim(), date_of_birth: dob || null });
      setUser(u);
      await advance('consents');
      router.push('/onboarding/consents');
    } catch (e) {
      // Without this the screen looked frozen: the try/finally had no catch, so
      // a failed save just stopped the spinner and reported nothing. Same
      // pattern as the OTP screen.
      Haptics.error();
      setError(e instanceof RiderApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <Header />
      <StepDots current="name" />
      <View style={{ flex: 1, gap: theme.space.md, paddingTop: theme.space.lg }}>
        <T variant="title">{t('onboarding.nameTitle')}</T>
        <TextField label={t('onboarding.fullName')} value={fullName} onChangeText={setFullName} autoFocus />
        <TextField label={t('onboarding.email')} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
        <TextField
          label={`Date of birth (${t('common.optional')})`}
          placeholder="YYYY-MM-DD"
          value={dob}
          onChangeText={setDob}
          error={error ?? undefined}
        />
      </View>
      <Button title={t('common.continue')} onPress={next} loading={busy} disabled={fullName.trim().length < 2 || !email.includes('@')} />
    </Screen>
  );
}
