import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../brand';
import { getApi } from '../../services';
import type { KycStatus } from '@penny/db-types';
import { useT } from '../../i18n';
import { useSession } from '../../store/session';
import { Screen, Header, T, Button, Card, Banner, Icon } from '../../components/ui';
import { StepDots } from '../../components/onboarding/StepDots';

export default function KycScreen() {
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const api = getApi();
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const onboarding = useSession((s) => s.onboarding);
  const advance = useSession((s) => s.advance);

  const [status, setStatus] = useState<KycStatus>(user?.kyc_status ?? 'none');
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const inOnboarding = onboarding ? onboarding.step !== 'done' : false;

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const start = async () => {
    setBusy(true);
    try {
      await api.startKyc(); // Sumsub SDK placeholder
      setStatus('pending');
      // Live status via webhook→realtime. Mock advances to approved shortly.
      poll.current = setInterval(async () => {
        const s = await api.getKycStatus();
        setStatus(s);
        if (s === 'approved' || s === 'rejected') {
          if (poll.current) clearInterval(poll.current);
          if (user) setUser({ ...user, kyc_status: s });
        }
      }, 1200);
    } finally {
      setBusy(false);
    }
  };

  const proceed = async () => {
    if (inOnboarding) {
      await advance('card');
      router.push('/onboarding/card');
    } else {
      router.back();
    }
  };

  const tone = status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'pending' ? 'primary' : 'neutral';

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <Header />
      {inOnboarding ? <StepDots current="kyc" /> : null}
      <View style={{ flex: 1, gap: theme.space.md, paddingTop: theme.space.lg }}>
        <View style={{ alignItems: 'center', marginVertical: theme.space.lg }}>
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.color.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={44} color={theme.color.primary} />
          </View>
        </View>
        <T variant="title" center>{t('onboarding.kycTitle')}</T>
        <T variant="body" center color={theme.color.textMuted}>{t('onboarding.kycBody')}</T>

        {status !== 'none' ? (
          <Banner tone={tone} icon={status === 'approved' ? 'check' : status === 'rejected' ? 'warning' : 'info'} title={t(`kyc.${status}`)} body={status === 'pending' ? 'Live status via Sumsub webhook…' : undefined} />
        ) : null}
      </View>

      <View style={{ gap: theme.space.sm }}>
        {status === 'approved' ? (
          <Button title={t('common.continue')} icon="check" variant="success" onPress={proceed} />
        ) : status === 'pending' ? (
          <Button title={t('common.continue')} onPress={proceed} />
        ) : (
          <>
            <Button title={t('onboarding.startKyc')} icon="shield" onPress={start} loading={busy} />
            {inOnboarding ? <Button title={t('onboarding.kycLater')} variant="ghost" onPress={proceed} /> : null}
          </>
        )}
      </View>
    </Screen>
  );
}
