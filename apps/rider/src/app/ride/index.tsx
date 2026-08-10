import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMoney, formatDuration, formatDistance, formatTime } from '@penny/ui';
import { useBrand, useTheme, makeStyles } from '../../brand';
import { Haptics } from '../../lib/native';
import { getApi } from '../../services';
import type { ShareLink } from '../../services/types';
import { useZoneWatch } from '../../lib/useZoneWatch';
import { useT } from '../../i18n';
import { useTrip } from '../../store/trip';
import {
  Screen, T, Row, Card, Button, SocPill, Badge, Banner, Sheet, SlideToConfirm, Icon,
} from '../../components/ui';
import { CrashCheckin } from '../../components/CrashCheckin';

export default function ActiveRideScreen() {
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const styles = useStyles(theme);
  const { isEnabled } = useBrand();
  const api = getApi();
  const { trip, pause, resume } = useTrip();
  const [share, setShare] = useState<ShareLink | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [crash, setCrash] = useState(false);
  const [busy, setBusy] = useState(false);

  // Where the ride STARTED is only the fallback. The banners below have to
  // follow the rider, so the watch polls the device for a real fix.
  const { ev, status: zoneStatus } = useZoneWatch(trip?.start_pos ?? null);

  useEffect(() => {
    if (!trip || (trip.status !== 'active' && trip.status !== 'paused')) {
      if (!trip) router.replace('/(tabs)/map');
    }
  }, [trip, router]);

  if (!trip) return <Screen><View style={styles.center}><T variant="body">{t('common.loading')}</T></View></Screen>;

  const paused = trip.status === 'paused';

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
          {trip.group_id && isEnabled('groupRides') ? <Badge tone="primary" icon="referral" label={t('ride.group', { n: 1 })} /> : null}
          {isEnabled('crashCheckIn') ? (
            <Pressable onPress={() => setCrash(true)} hitSlop={10} accessibilityLabel="Safety">
              <Icon name="shield" size={22} color={theme.color.onPrimary} />
            </Pressable>
          ) : null}
        </Row>

        <View style={styles.hero}>
          <T variant="label" color={theme.color.onPrimary} style={{ opacity: 0.8 }}>{paused ? t('ride.paused') : t('ride.time')}</T>
          <T variant="display" color={theme.color.onPrimary} style={styles.timer}>{formatDuration(trip.duration_s)}</T>
          <Row gap={theme.space.xl} justify="center" style={{ marginTop: theme.space.md }}>
            <HeroStat label={t('ride.cost')} value={formatMoney(trip.cost_cents, trip.currency)} />
            <HeroStat label={t('endRide.distance')} value={formatDistance(trip.distance_m)} />
            <HeroStat label={t('ride.battery')} value={`${Math.round(trip.soc_pct)}%`} />
          </Row>
        </View>
      </View>

      <View style={styles.sheet}>
        {/* Zone banners. Every one of these is gated on `zoneStatus === 'ready'`:
            with no zones and no fix, `evaluateZones` reports `inOperating:false`,
            which used to render "Outside the service area" over a rider standing
            in the middle of it. Not knowing is its own state, and it says so. */}
        {zoneStatus === 'unavailable' ? (
          <Banner tone="neutral" icon="info" title={t('ride.zoneUnknown')} body={t('ride.zoneUnknownBody')} style={{ marginBottom: theme.space.sm }} />
        ) : null}
        {zoneStatus === 'ready' && ev.inNoGo ? <Banner tone="danger" icon="nogo" title={t('ride.noGo')} style={{ marginBottom: theme.space.sm }} /> : null}
        {zoneStatus === 'ready' && !ev.inOperating ? <Banner tone="warning" icon="warning" title={t('ride.outside')} body={t('ride.outsideBody')} style={{ marginBottom: theme.space.sm }} /> : null}
        {zoneStatus === 'ready' && ev.speedLimitKmh ? <Banner tone="warning" icon="speed" title={t('ride.speedZone', { kmh: ev.speedLimitKmh })} style={{ marginBottom: theme.space.sm }} /> : null}
        {zoneStatus === 'ready' && ev.bonusCents > 0 ? <Banner tone="success" icon="bonus" title={t('endRide.bonus')} body={formatMoney(ev.bonusCents, trip.currency)} style={{ marginBottom: theme.space.sm }} /> : null}
        {trip.soc_pct < 20 ? <Banner tone="warning" icon="battery" title={t('ride.lowBattery')} style={{ marginBottom: theme.space.sm }} /> : null}

        <Row gap={theme.space.md} style={{ marginBottom: theme.space.md }}>
          <Button title={paused ? t('ride.resume') : t('ride.pause')} icon={paused ? 'play' : 'pause'} variant={paused ? 'success' : 'secondary'} onPress={togglePause} loading={busy} style={{ flex: 1 }} />
          <Button title={t('ride.ring')} icon="ring" variant="secondary" onPress={() => { Haptics.medium(); api.ring(trip.vehicle_code); }} style={{ flex: 1 }} />
        </Row>
        <Row gap={theme.space.md} style={{ marginBottom: theme.space.lg }}>
          <Button title={t('ride.locate')} icon="locate" variant="secondary" onPress={() => api.ring(trip.vehicle_code)} style={{ flex: 1 }} />
          {isEnabled('shareMyRide') ? (
            <Button title={t('ride.share')} icon="share" variant="secondary" onPress={doShare} style={{ flex: 1 }} />
          ) : null}
        </Row>

        <SlideToConfirm label={t('ride.endSlide')} icon="check" tone="danger" onConfirm={() => router.push('/ride/end')} />
      </View>

      <Sheet visible={shareOpen} onClose={() => setShareOpen(false)} title={t('ride.share')}>
        <Banner tone="primary" icon="share" title={share?.url ?? ''} body={`Expires ${share ? formatTime(share.expires_at) : ''}`} />
        <Button title={t('common.done')} onPress={() => setShareOpen(false)} style={{ marginTop: theme.space.md }} />
      </Sheet>

      {isEnabled('crashCheckIn') ? (
        <CrashCheckin tripId={trip.id} visible={crash} onResolved={() => setCrash(false)} />
      ) : null}
    </Screen>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <T variant="subtitle" color={theme.color.onPrimary}>{value}</T>
      <T variant="caption" color={theme.color.onPrimary} style={{ opacity: 0.8 }}>{label}</T>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { paddingHorizontal: t.space.lg, paddingTop: t.space.sm },
  hero: { alignItems: 'center', marginTop: t.space.xl, marginBottom: t.space.xl },
  timer: { fontSize: 64, fontVariant: ['tabular-nums'], marginTop: 4 },
  sheet: {
    flex: 1,
    backgroundColor: t.color.bg,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    padding: t.space.lg,
    marginTop: t.space.md,
  },
}));
