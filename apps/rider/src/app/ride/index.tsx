import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { evaluateZones, type ZoneLike } from '@penny/geo';
import { formatMoney, formatDuration, formatDistance } from '@penny/ui';
import { theme } from '../../lib/theme';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import type { MapZone, ShareLink } from '../../services/types';
import { useT } from '../../i18n';
import { useTrip } from '../../store/trip';
import {
  Screen, T, Row, Card, Button, SocPill, Badge, Banner, Sheet, SlideToConfirm, Icon,
} from '../../components/ui';
import { CrashCheckin } from '../../components/CrashCheckin';

export default function ActiveRideScreen() {
  const router = useRouter();
  const { t } = useT();
  const api = getApi();
  const { trip, pause, resume } = useTrip();
  const [zones, setZones] = useState<MapZone[]>([]);
  const [share, setShare] = useState<ShareLink | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [crash, setCrash] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.getZones().then(setZones); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!trip || (trip.status !== 'active' && trip.status !== 'paused')) {
      if (!trip) router.replace('/(tabs)/map');
    }
  }, [trip, router]);

  if (!trip) return <Screen><View style={styles.center}><T variant="body">{t('common.loading')}</T></View></Screen>;

  const paused = trip.status === 'paused';
  const pos = trip.route[trip.route.length - 1] ?? trip.start_pos ?? [23.7275, 37.9838];
  const ev = evaluateZones(pos, zones as unknown as ZoneLike[]);

  const doShare = async () => {
    const link = await api.shareRide(trip.id);
    setShare(link);
    setShareOpen(true);
  };

  const togglePause = async () => {
    setBusy(true);
    try {
      if (paused) await resume();
      else await pause();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} scroll={false} bg={theme.color.primary}>
      <View style={styles.top}>
        <Row justify="space-between">
          <Badge tone="neutral" label={trip.vehicle_code} icon="scooter" />
          {trip.group_id ? <Badge tone="primary" icon="referral" label={t('ride.group', { n: 1 })} /> : null}
          <Pressable onPress={() => setCrash(true)} hitSlop={10} accessibilityLabel="Safety">
            <Icon name="shield" size={22} color={theme.color.onPrimary} />
          </Pressable>
        </Row>

        <View style={styles.hero}>
          <T variant="label" color="rgba(255,255,255,0.8)">{paused ? t('ride.paused') : t('ride.time')}</T>
          <T variant="display" color={theme.color.onPrimary} style={styles.timer}>{formatDuration(trip.duration_s)}</T>
          <Row gap={theme.space.xl} justify="center" style={{ marginTop: theme.space.md }}>
            <HeroStat label={t('ride.cost')} value={formatMoney(trip.cost_cents, trip.currency)} />
            <HeroStat label={t('endRide.distance')} value={formatDistance(trip.distance_m)} />
            <HeroStat label={t('ride.battery')} value={`${Math.round(trip.soc_pct)}%`} />
          </Row>
        </View>
      </View>

      <View style={styles.sheet}>
        {/* zone banners */}
        {ev.inNoGo ? <Banner tone="danger" icon="nogo" title={t('ride.noGo')} style={{ marginBottom: theme.space.sm }} /> : null}
        {!ev.inOperating ? <Banner tone="warning" icon="warning" title={t('ride.outside')} style={{ marginBottom: theme.space.sm }} /> : null}
        {ev.speedLimitKmh ? <Banner tone="warning" icon="speed" title={t('ride.speedZone', { kmh: ev.speedLimitKmh })} style={{ marginBottom: theme.space.sm }} /> : null}
        {ev.bonusCents > 0 ? <Banner tone="success" icon="bonus" title={t('endRide.bonus')} body={formatMoney(ev.bonusCents, trip.currency)} style={{ marginBottom: theme.space.sm }} /> : null}
        {trip.soc_pct < 20 ? <Banner tone="warning" icon="battery" title={t('ride.lowBattery')} style={{ marginBottom: theme.space.sm }} /> : null}

        <Row gap={theme.space.md} style={{ marginBottom: theme.space.md }}>
          <Button title={paused ? t('ride.resume') : t('ride.pause')} icon={paused ? 'play' : 'pause'} variant={paused ? 'success' : 'secondary'} onPress={togglePause} loading={busy} style={{ flex: 1 }} />
          <Button title={t('ride.ring')} icon="ring" variant="secondary" onPress={() => { Haptics.medium(); api.ring(trip.vehicle_code); }} style={{ flex: 1 }} />
        </Row>
        <Row gap={theme.space.md} style={{ marginBottom: theme.space.lg }}>
          <Button title={t('ride.locate')} icon="locate" variant="secondary" onPress={() => api.ring(trip.vehicle_code)} style={{ flex: 1 }} />
          <Button title={t('ride.share')} icon="share" variant="secondary" onPress={doShare} style={{ flex: 1 }} />
        </Row>

        <SlideToConfirm label={t('ride.endSlide')} icon="check" tone="danger" onConfirm={() => router.push('/ride/end')} />
      </View>

      <Sheet visible={shareOpen} onClose={() => setShareOpen(false)} title={t('ride.share')}>
        <Banner tone="primary" icon="share" title={share?.url ?? ''} body={`Expires ${share ? new Date(share.expires_at).toLocaleTimeString() : ''}`} />
        <Button title={t('common.done')} onPress={() => setShareOpen(false)} style={{ marginTop: theme.space.md }} />
      </Sheet>

      <CrashCheckin tripId={trip.id} visible={crash} onResolved={() => setCrash(false)} />
    </Screen>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <T variant="subtitle" color={theme.color.onPrimary}>{value}</T>
      <T variant="caption" color="rgba(255,255,255,0.8)">{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.sm },
  hero: { alignItems: 'center', marginTop: theme.space.xl, marginBottom: theme.space.xl },
  timer: { fontSize: 64, fontVariant: ['tabular-nums'], marginTop: 4 },
  sheet: {
    flex: 1,
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    padding: theme.space.lg,
    marginTop: theme.space.md,
  },
});
