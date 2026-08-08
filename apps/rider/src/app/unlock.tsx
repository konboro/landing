import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBrand, useTheme, makeStyles } from '../brand';
import { Haptics, Notifications } from '../lib/native';
import { getApi } from '../services';
import type { UnlockProgress } from '../services/types';
import { RiderApiError } from '../services/types';
import { useT } from '../i18n';
import { useTrip } from '../store/trip';
import { useFlags } from '../store/flags';
import { Screen, T, Button, ProgressRing, Icon, Banner } from '../components/ui';
import { uuid } from '../lib/ids';

const PHASE_PROGRESS: Record<UnlockProgress['phase'], number> = {
  sending: 0.15,
  waking: 0.5,
  waiting_ack: 0.85,
  acked: 1,
  failed: 1,
};

export default function UnlockScreen() {
  const params = useLocalSearchParams<{ code: string; insurance?: string; promo?: string; cmd?: string }>();
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const styles = useStyles(theme);
  const { brand } = useBrand();
  const api = getApi();
  const setTrip = useTrip((s) => s.setTrip);
  const flags = useFlags();

  const [progress, setProgress] = useState<UnlockProgress>({ phase: 'sending', elapsed_ms: 0, message_key: 'unlock.sending' });
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !params.code) return;
    started.current = true;
    (async () => {
      try {
        const trip = await api.unlock(
          {
            vehicle_code: params.code,
            client_command_id: params.cmd ?? uuid(),
            pos: [23.7275, 37.9838],
            addon_insurance: params.insurance === '1',
            promo_code: params.promo || undefined,
          },
          (p) => setProgress(p),
        );
        Haptics.success();
        setTrip(trip);
        // Notifications permission asked AFTER first success (higher grant rate).
        if (!flags.askedNotifications) {
          flags.setAsked('askedNotifications');
          await Notifications.requestPermission();
          Notifications.notify(
            `Unlocked ${brand.assets.emoji ?? ''}`.trim(),
            'Enjoy your ride! Your timer is running.',
          );
        }
        setTimeout(() => router.replace('/ride'), 700);
      } catch (e) {
        Haptics.error();
        const msg = e instanceof RiderApiError ? e.message : t('unlock.failedBody');
        setFailure(msg);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  if (failure) {
    return (
      <Screen edges={['top', 'bottom']} bg={theme.color.bg}>
        <View style={styles.center}>
          <View style={styles.failIcon}><Icon name="warning" size={40} /></View>
          <T variant="title" center style={{ marginTop: theme.space.lg }}>{t('unlock.failedTitle')}</T>
          <T variant="body" center color={theme.color.textMuted} style={{ marginTop: 8 }}>{failure}</T>
          <Banner tone="success" icon="check" title={t('unlock.abortedNoCharge')} style={{ marginTop: theme.space.xl, alignSelf: 'stretch' }} />
        </View>
        <View style={styles.footer}>
          <Button title={t('unlock.tryAnother')} icon="scan" onPress={() => router.replace('/scan')} />
          <Button title={t('common.back')} variant="ghost" onPress={() => router.replace('/(tabs)/map')} />
        </View>
      </Screen>
    );
  }

  const isDone = progress.phase === 'acked';
  return (
    <Screen edges={['top', 'bottom']} bg={theme.color.primary} padded>
      <View style={styles.center}>
        <ProgressRing
          progress={PHASE_PROGRESS[progress.phase]}
          size={200}
          stroke={12}
          color={theme.color.onPrimary}
          trackColor="rgba(255,255,255,0.25)"
          label={isDone ? '✓' : `${Math.min(20, Math.round(progress.elapsed_ms / 1000))}s`}
        />
        <T variant="title" color={theme.color.onPrimary} center style={{ marginTop: theme.space.xxl }}>
          {isDone ? t('unlock.success') : t('unlock.waking')}
        </T>
        <T variant="body" color={theme.color.onPrimary} center style={{ opacity: 0.85, marginTop: 8 }}>
          {t(progress.message_key)}
        </T>
        {!isDone ? (
          <T variant="caption" color={theme.color.onPrimary} center style={{ opacity: 0.7, marginTop: theme.space.lg }}>
            {t('unlock.upTo')}
          </T>
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.space.xl },
  footer: { padding: t.space.lg, gap: t.space.sm },
  failIcon: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: t.color.warningSoft,
    alignItems: 'center', justifyContent: 'center',
  },
}));
