import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../lib/theme';
import { Haptics } from '../lib/native';
import { getApi } from '../services';
import { useT } from '../i18n';
import { useFlags } from '../store/flags';
import { Screen, T, Button, Icon } from '../components/ui';

const PASS_MS = 700;
const MAX_ATTEMPTS = 3;

type Phase = 'intro' | 'waiting' | 'go' | 'result' | 'blocked';

export default function ReactionTestScreen() {
  const router = useRouter();
  const { t } = useT();
  const api = getApi();
  const flags = useFlags();

  const [phase, setPhase] = useState<Phase>('intro');
  const [ms, setMs] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const goAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const begin = () => {
    setPhase('waiting');
    const delay = 1500 + Math.random() * 2500;
    timer.current = setTimeout(() => {
      goAt.current = Date.now();
      Haptics.medium();
      setPhase('go');
    }, delay);
  };

  const onTap = () => {
    if (phase === 'waiting') {
      if (timer.current) clearTimeout(timer.current);
      setPhase('intro');
      return; // too soon
    }
    if (phase === 'go') {
      const reaction = Date.now() - goAt.current;
      setMs(reaction);
      const passed = reaction <= PASS_MS;
      api.recordReaction(reaction, passed);
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      if (passed) {
        Haptics.success();
        flags.passReaction();
        setPhase('result');
      } else if (nextAttempts >= MAX_ATTEMPTS) {
        Haptics.error();
        flags.failReaction();
        setPhase('blocked');
      } else {
        Haptics.warning();
        setPhase('result');
      }
    }
  };

  if (phase === 'intro') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.center}>
          <Icon name="moon" size={48} />
          <T variant="title" center style={{ marginTop: theme.space.lg }}>{t('reaction.title')}</T>
          <T variant="body" center color={theme.color.textMuted} style={{ marginTop: theme.space.md }}>{t('reaction.intro')}</T>
        </View>
        <View style={{ padding: theme.space.lg }}>
          <Button title={t('reaction.start')} icon="play" onPress={begin} />
        </View>
      </Screen>
    );
  }

  if (phase === 'blocked') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.center}>
          <Icon name="lock" size={48} />
          <T variant="title" center style={{ marginTop: theme.space.lg }}>{t('reaction.fail')}</T>
          <T variant="body" center color={theme.color.textMuted} style={{ marginTop: theme.space.md }}>{t('reaction.blocked')}</T>
        </View>
        <View style={{ padding: theme.space.lg }}>
          <Button title={t('common.back')} onPress={() => router.replace('/(tabs)/map')} />
        </View>
      </Screen>
    );
  }

  if (phase === 'result') {
    const passed = ms <= PASS_MS;
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.center}>
          <Icon name={passed ? 'check' : 'warning'} size={48} color={passed ? theme.color.success : theme.color.warning} />
          <T variant="title" center style={{ marginTop: theme.space.lg }}>{t('reaction.result', { ms })}</T>
          <T variant="body" center color={passed ? theme.color.success : theme.color.textMuted} style={{ marginTop: theme.space.md }}>
            {passed ? t('reaction.pass') : `${MAX_ATTEMPTS - attempts} attempts left`}
          </T>
        </View>
        <View style={{ padding: theme.space.lg }}>
          {passed ? (
            <Button title={t('common.continue')} icon="check" variant="success" onPress={() => router.back()} />
          ) : (
            <Button title={t('common.retry')} icon="play" onPress={() => setPhase('intro')} />
          )}
        </View>
      </Screen>
    );
  }

  // waiting / go — full-screen tap target
  const isGo = phase === 'go';
  return (
    <Pressable style={[styles.tap, { backgroundColor: isGo ? theme.color.success : theme.color.danger }]} onPress={onTap}>
      <T variant="display" color={theme.color.onPrimary}>{isGo ? t('reaction.tapNow') : t('reaction.wait')}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space.xl },
  tap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
