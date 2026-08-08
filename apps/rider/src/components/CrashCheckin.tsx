// Crash check-in overlay (docs/06 2nd-pass): fall detected → full-screen prompt
// → no response in 60 s → emergency SMS + support alert (placeholder in mock).
import React, { useEffect, useState } from 'react';
import { View, Modal } from 'react-native';
import { useTheme, makeStyles } from '../brand';
import { Haptics } from '../lib/native';
import { getApi } from '../services';
import { useT } from '../i18n';
import { T, Button, Icon, ProgressRing } from './ui';

const WINDOW_S = 60;

export function CrashCheckin({ tripId, visible, onResolved }: { tripId: string; visible: boolean; onResolved: () => void }) {
  const { t } = useT();
  const theme = useTheme();
  const styles = useStyles(theme);
  const api = getApi();
  const [remaining, setRemaining] = useState(WINDOW_S);
  const [alerted, setAlerted] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRemaining(WINDOW_S);
      setAlerted(false);
      return;
    }
    Haptics.error();
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          api.triggerCrashAlert(tripId).catch(() => {});
          setAlerted(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tripId]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.iconWrap}><Icon name="crash" size={44} /></View>
        <T variant="title" color={theme.color.onPrimary} center style={{ marginTop: theme.space.lg }}>
          {t('crash.title')}
        </T>
        {alerted ? (
          <>
            <T variant="body" color={theme.color.onPrimary} center style={{ opacity: 0.9, marginTop: theme.space.md, paddingHorizontal: theme.space.xl }}>
              {t('crash.alerted')}
            </T>
            <Button title={t('common.close')} variant="secondary" full={false} onPress={onResolved} style={{ marginTop: theme.space.xl }} />
          </>
        ) : (
          <>
            <T variant="body" color={theme.color.onPrimary} center style={{ opacity: 0.9, marginTop: theme.space.md, paddingHorizontal: theme.space.xl }}>
              {t('crash.body')}
            </T>
            <View style={{ marginVertical: theme.space.xxl }}>
              <ProgressRing
                progress={remaining / WINDOW_S}
                size={140}
                color={theme.color.onPrimary}
                trackColor="rgba(255,255,255,0.25)"
                label={String(remaining)}
                sublabel={t('crash.countdown', { s: remaining })}
              />
            </View>
            <View style={{ gap: theme.space.sm, alignSelf: 'stretch', paddingHorizontal: theme.space.xl }}>
              <Button title={t('crash.imOk')} icon="check" variant="success" onPress={() => { Haptics.success(); onResolved(); }} />
              <Button title={t('crash.needHelp')} icon="crash" variant="secondary" onPress={() => { api.triggerCrashAlert(tripId).catch(() => {}); setAlerted(true); }} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: {
    flex: 1,
    backgroundColor: t.color.danger,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.space.xl,
  },
  iconWrap: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
}));
