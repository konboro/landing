import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../brand';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import { RiderApiError } from '../../services/types';
import { useT } from '../../i18n';
import { useSession } from '../../store/session';
import { Screen, Header, T, Button, TextField } from '../../components/ui';
import { StepDots } from '../../components/onboarding/StepDots';

export default function OtpScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const api = getApi();
  const setUser = useSession((s) => s.setUser);
  const setOnboarding = useSession((s) => s.setOnboarding);

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(30);

  useEffect(() => {
    const id = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await api.verifyOtp(String(phone), code.trim());
      setUser(session.user);
      setOnboarding(session.onboarding);
      Haptics.success();
      router.replace('/onboarding/name');
    } catch (e) {
      Haptics.error();
      setError(e instanceof RiderApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <Header />
      <StepDots current="otp" />
      <View style={{ flex: 1, gap: theme.space.md, paddingTop: theme.space.lg }}>
        <T variant="title">{t('onboarding.otpTitle')}</T>
        <T variant="body" color={theme.color.textMuted}>{t('onboarding.otpHint', { phone: String(phone) })}</T>
        <TextField
          keyboardType="number-pad"
          value={code}
          onChangeText={(v) => { setCode(v); setError(null); }}
          maxLength={6}
          autoFocus
          placeholder="••••••"
          error={error ?? undefined}
          style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center' }}
        />
        <Button
          title={resendIn > 0 ? t('onboarding.resendIn', { s: resendIn }) : t('onboarding.resend')}
          variant="ghost"
          disabled={resendIn > 0}
          onPress={() => { api.sendOtp(String(phone)); setResendIn(30); }}
        />
      </View>
      <Button title={t('common.continue')} onPress={verify} loading={busy} disabled={code.trim().length < 6} />
    </Screen>
  );
}
