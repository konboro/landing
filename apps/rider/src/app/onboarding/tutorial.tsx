import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../../lib/theme';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import { useT } from '../../i18n';
import { useSession } from '../../store/session';
import { Screen, Header, T, Button, Card, Row, Icon, type IconName } from '../../components/ui';
import { StepDots } from '../../components/onboarding/StepDots';

interface Step { icon: IconName; title: string; body: string }

export default function TutorialScreen() {
  const router = useRouter();
  const { t } = useT();
  const api = getApi();
  const advance = useSession((s) => s.advance);
  const load = useSession((s) => s.load);
  const [i, setI] = useState(0);

  const steps: Step[] = [
    { icon: 'map', title: 'Find a scooter', body: 'Open the map, tap a pin to see battery, range and walking distance.' },
    { icon: 'scan', title: 'Scan to unlock', body: 'Tap Scan and point at the QR code. Unlocking can take up to 20s on 2G.' },
    { icon: 'scooter', title: 'Ride & pause', body: 'Big timer, live cost, pause when you stop. Watch the zone banners.' },
    { icon: 'camera', title: 'End with a photo', body: 'Park in a green zone and take a photo — green is good, red is a no-go.' },
    { icon: 'wallet', title: 'Pay your way', body: 'Apple Pay, Google Pay, cards, wallet, packages or a subscription.' },
  ];

  const finish = async () => {
    Haptics.success();
    await advance('done');
    await api.setOnboardingStep('done');
    await load(); // refresh session so the root gate routes to the map
    router.replace('/(tabs)/map');
  };

  const step = steps[i]!;
  const last = i === steps.length - 1;

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <Header right={<Button title={t('common.skip')} size="sm" variant="ghost" full={false} onPress={finish} />} onBack={() => (i > 0 ? setI(i - 1) : router.back())} />
      <StepDots current="tutorial" />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Card style={{ alignItems: 'center', padding: theme.space.xxl }}>
          <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: theme.color.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={step.icon} size={56} />
          </View>
          <T variant="title" center style={{ marginTop: theme.space.xl }}>{step.title}</T>
          <T variant="body" center color={theme.color.textMuted} style={{ marginTop: theme.space.md }}>{step.body}</T>
        </Card>
        <Row gap={6} justify="center" style={{ marginTop: theme.space.lg }}>
          {steps.map((_, idx) => (
            <View key={idx} style={{ height: 6, width: idx === i ? 22 : 6, borderRadius: 3, backgroundColor: idx === i ? theme.color.primary : theme.color.border }} />
          ))}
        </Row>
      </View>
      <Button title={last ? t('onboarding.finish') : t('common.next')} icon={last ? 'scooter' : undefined} onPress={() => (last ? finish() : setI(i + 1))} size="lg" />
    </Screen>
  );
}
