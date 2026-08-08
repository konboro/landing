import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../lib/theme';
import { getApi } from '../services';
import { useT } from '../i18n';
import { useFlags } from '../store/flags';
import { QrScanner } from '../components/camera/QrScanner';
import { Sheet, TextField, Button, Icon, T } from '../components/ui';

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const api = getApi();
  const flags = useFlags();
  const [manualOpen, setManualOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    flags.setAsked('askedCamera');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = async (raw: string, method: 'qr' | 'manual') => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    const v = await api.getVehicle(c);
    if (!v) {
      setError(t('scan.notFound', { code: c }));
      return;
    }
    await api.logScan(c, method); // funnel: scan logged to scan_data_log
    setManualOpen(false);
    router.replace({ pathname: '/vehicle/[code]', params: { code: c } });
  };

  return (
    <View style={styles.fill}>
      <QrScanner onScan={(c) => go(c, 'qr')} onManual={() => setManualOpen(true)} />

      <Pressable style={[styles.close, { top: insets.top + 8 }]} onPress={() => router.back()} hitSlop={12}>
        <Icon name="close" size={22} color={theme.color.textInverse} />
      </Pressable>

      <Sheet visible={manualOpen} onClose={() => setManualOpen(false)} title={t('scan.manualTitle')}>
        <View style={{ gap: theme.space.md }}>
          <TextField
            label={t('scan.manualTitle')}
            placeholder={t('scan.manualPlaceholder')}
            autoCapitalize="characters"
            autoFocus
            value={code}
            onChangeText={(v) => { setCode(v); setError(null); }}
            error={error ?? undefined}
          />
          <Button title={t('vehicle.unlock')} icon="unlock" onPress={() => go(code, 'manual')} />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.palette.ink900 },
  close: {
    position: 'absolute', left: theme.space.lg, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
});
