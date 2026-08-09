import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { evaluateZones, canEndHere, OPERATING_CITY, type ZoneLike } from '@penny/geo';
import { formatMoney, formatDuration, formatDistance, co2SavedKg } from '@penny/ui';
import { useBrand, useTheme, makeStyles } from '../../brand';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import type { MapZone, TripView } from '../../services/types';
import { useT } from '../../i18n';
import { useTrip } from '../../store/trip';
import {
  Screen, Header, T, Row, Card, Button, Badge, Banner, Chip, Divider, Icon,
} from '../../components/ui';
import { PhotoCamera } from '../../components/camera/PhotoCamera';

const TAGS = ['smooth', 'fast', 'clean', 'comfy', 'dirty', 'damaged'];

export default function EndRideScreen() {
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const styles = useStyles(theme);
  const { isEnabled } = useBrand();
  const api = getApi();
  const { trip, setTrip } = useTrip();

  const [phase, setPhase] = useState<'photo' | 'form' | 'receipt'>('photo');
  const [photo, setPhoto] = useState<string | null>(null);
  const [zones, setZones] = useState<MapZone[]>([]);
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [ended, setEnded] = useState<TripView | null>(null);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => { api.getZones().then(setZones); /* eslint-disable-next-line */ }, []);

  const endPos: [number, number] = trip?.route[trip.route.length - 1] ?? trip?.start_pos ?? OPERATING_CITY.center;
  const ev = useMemo(() => evaluateZones(endPos, zones as unknown as ZoneLike[]), [endPos, zones]);
  const zoneCheck = canEndHere(ev);

  if (!trip) {
    return <Screen><Header title={t('endRide.title')} /><View style={styles.center}><T variant="body">{t('common.loading')}</T></View></Screen>;
  }

  const onCaptured = (uri: string) => {
    Haptics.success();
    setPhoto(uri);
    setPhase('form');
  };

  const confirmEnd = async () => {
    if (!photo) return;
    setBusy(true);
    try {
      const result = await api.endTrip({ trip_id: trip.id, pos: endPos, end_photo_url: photo, rating: rating || undefined, tags });
      setEnded(result);
      setTrip(null);
      setPhase('receipt');
      Haptics.success();
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'photo') {
    return (
      <View style={{ flex: 1 }}>
        <PhotoCamera onCapture={onCaptured} hint={t('endRide.photoHint')} />
        <View style={styles.photoHeader}>
          <Header title={t('endRide.photoTitle')} transparent right={<Icon name="camera" size={20} color={theme.color.textInverse} />} />
        </View>
      </View>
    );
  }

  const money = (c: number) => formatMoney(c, trip.currency);

  if (phase === 'form') {
    return (
      <Screen edges={['top']} scroll={false} padded={false}>
        <Header title={t('endRide.title')} onBack={() => setPhase('photo')} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md, paddingBottom: 140 }}>
          <Card>
            <Row justify="space-between">
              <Row gap={8}><Icon name="camera" size={20} color={theme.color.success} /><T variant="body" style={{ fontWeight: '700' }}>{t('endRide.photoTitle')}</T></Row>
              <Badge tone="success" icon="check" label={t('common.done')} />
            </Row>
          </Card>

          {zoneCheck.ok ? (
            <Banner tone="success" icon="check" title={t('endRide.zoneOk')} body={ev.bonusCents > 0 ? `${t('endRide.bonus')}: ${money(ev.bonusCents)}` : undefined} />
          ) : (
            <Banner
              tone="danger"
              icon="warning"
              title={t('endRide.zoneBad')}
              body={t(`ride.${zoneCheck.reason === 'no_parking_zone' ? 'noGo' : 'outside'}`)}
              action={isEnabled('parkingSchool') ? <Button title={t('endRide.parkingSchool')} size="sm" full={false} variant="ghost" onPress={() => router.push('/parking-school')} /> : undefined}
            />
          )}

          <Card>
            <T variant="label" style={{ marginBottom: 8 }}>{t('endRide.rate_us')}</T>
            <Row gap={theme.space.sm}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => { Haptics.select(); setRating(n); }} hitSlop={6}>
                  <Icon name="star" size={36} color={n <= rating ? theme.color.warning : theme.color.border} />
                </Pressable>
              ))}
            </Row>
            <T variant="label" style={{ marginTop: theme.space.md, marginBottom: 8 }}>{t('endRide.tags')}</T>
            <Row wrap gap={theme.space.sm}>
              {TAGS.map((tag) => (
                <Chip key={tag} label={tag} active={tags.includes(tag)} onPress={() => setTags((s) => (s.includes(tag) ? s.filter((x) => x !== tag) : [...s, tag]))} />
              ))}
            </Row>
          </Card>

          <Button title={t('endRide.reportDamage')} icon="flag" variant="ghost" onPress={() => router.push({ pathname: '/report/[code]', params: { code: trip.vehicle_code } })} />
        </ScrollView>
        <View style={styles.footer}>
          <Button title={t('endRide.finish')} icon="check" size="lg" onPress={confirmEnd} loading={busy} />
        </View>
      </Screen>
    );
  }

  // receipt
  const r = ended ?? trip;
  return (
    <Screen edges={['top']} scroll bg={theme.color.bg}>
      <Header title={t('endRide.receiptTitle')} onBack={() => router.replace('/(tabs)/map')} />
      <View style={{ gap: theme.space.md }}>
        <Card>
          <Row justify="center" style={{ marginBottom: theme.space.md }}>
            <View style={styles.okCircle}><Icon name="check" size={36} color={theme.color.onPrimary} /></View>
          </Row>
          <T variant="title" center>{money(r.cost_cents)}</T>
          <T variant="caption" center>{r.vehicle_code} · {new Date(r.ended_at ?? Date.now()).toLocaleString()}</T>

          <Divider />
          <View style={{ gap: 8 }}>
            <Line label={t('endRide.duration')} value={formatDuration(r.duration_s)} />
            <Line label={t('endRide.distance')} value={formatDistance(r.distance_m)} />
            <Line label={t('endRide.unlockFee')} value={money(r.pricing.unlock_cents)} />
            {r.discount_cents > 0 ? <Line label={t('preUnlock.packageApplied')} value={`-${money(r.discount_cents)}`} tone="success" /> : null}
            {r.bonus_cents > 0 ? <Line label={t('endRide.bonus')} value={`-${money(r.bonus_cents)}`} tone="success" /> : null}
            <Divider />
            <Line label={t('endRide.total')} value={money(r.cost_cents)} strong />
          </View>
        </Card>

        <Banner tone="success" icon="leaf" title={t('endRide.co2', { kg: co2SavedKg(r.distance_m) })} />

        {r.status === 'ended' ? (
          <Banner tone="warning" icon="warning" title={t('preUnlock.hasDebt')} body={t('wallet.payNow')} action={<Button title={t('wallet.payNow')} size="sm" full={false} onPress={() => router.replace('/(tabs)/wallet')} />} />
        ) : null}

        <Button title={t('history.receipt')} icon="history" variant="secondary" onPress={() => router.replace({ pathname: '/trip/[id]', params: { id: r.id } })} />
        <Button title={t('endRide.finish')} icon="check" onPress={() => router.replace('/(tabs)/map')} />
      </View>
    </Screen>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: 'success'; strong?: boolean }) {
  const theme = useTheme();
  return (
    <Row justify="space-between">
      <T variant={strong ? 'subtitle' : 'body'} color={theme.color.textMuted}>{label}</T>
      <T variant={strong ? 'subtitle' : 'body'} color={tone === 'success' ? theme.color.success : theme.color.text} style={{ fontWeight: '700' }}>{value}</T>
    </Row>
  );
}

const useStyles = makeStyles((t) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photoHeader: { position: 'absolute', top: 0, left: 0, right: 0 },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0, padding: t.space.lg, paddingBottom: t.space.xl,
    backgroundColor: t.color.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.color.border,
  },
  okCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: t.color.success, alignItems: 'center', justifyContent: 'center' },
}));
