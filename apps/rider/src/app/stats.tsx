import React, { useEffect, useState } from 'react';
import { View, Share, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMoney, formatDuration, formatDistance, formatDateTime } from '@penny/ui';
import { useBrand, useTheme } from '../brand';
import { getApi } from '../services';
import type { RiderStatsDetail, MonthBucket } from '../services/types';
import { useT } from '../i18n';
import { Screen, Header, T, Row, Card, Button, Badge, Icon, Divider, ProgressBar } from '../components/ui';

/** Dependency-free bar chart — plain Views, no chart library. */
function MonthBars({ months }: { months: MonthBucket[] }) {
  const theme = useTheme();
  const max = Math.max(1, ...months.map((m) => m.rides));
  return (
    <Row gap={6} align="flex-end" style={{ height: 120, marginTop: theme.space.sm }}>
      {months.map((m) => {
        const h = Math.max(3, Math.round((m.rides / max) * 96));
        return (
          <View key={m.key} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <T variant="caption" style={{ fontSize: 10 }}>{m.rides || ''}</T>
            <View
              accessibilityLabel={`${m.label}: ${m.rides} rides`}
              style={{
                width: '100%',
                height: h,
                borderRadius: 4,
                backgroundColor: m.rides ? theme.color.primary : theme.color.border,
              }}
            />
            <T variant="caption" style={{ fontSize: 9 }}>{m.label.split(' ')[0]}</T>
          </View>
        );
      })}
    </Row>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ flexBasis: '30%', flexGrow: 1, minWidth: 96 }}>
      <T variant="caption">{label}</T>
      <T variant="subtitle">{value}</T>
      {sub ? <T variant="caption">{sub}</T> : null}
    </View>
  );
}

export default function StatsScreen() {
  const { t } = useT();
  const theme = useTheme();
  const { brand, isEnabled } = useBrand();
  const api = getApi();
  const router = useRouter();
  const [stats, setStats] = useState<RiderStatsDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getStatsDetail()
      .then(setStats)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) {
    return (
      <Screen edges={['top']}>
        <Header title={t('stats.title')} onBack={() => router.back()} />
        <Card>
          <Row gap={10} align="center">
            <ActivityIndicator />
            <T variant="body">{t('common.loading')}</T>
          </Row>
        </Card>
      </Screen>
    );
  }

  if (!stats || stats.rides === 0) {
    return (
      <Screen edges={['top']}>
        <Header title={t('stats.title')} onBack={() => router.back()} />
        <Card>
          <Row gap={10} align="center">
            <Icon name="history" size={20} />
            <T variant="body">{t('stats.noData')}</T>
          </Row>
        </Card>
      </Screen>
    );
  }

  const shareRecap = () => {
    Share.share({
      message: t('stats.recapLine', {
        year: String(stats.year),
        rides: String(stats.rides),
        distance: formatDistance(stats.distance_m),
        co2: String(stats.co2_kg),
      }),
    }).catch(() => undefined);
  };

  return (
    <Screen edges={['top']} scroll>
      <Header title={t('stats.title')} onBack={() => router.back()} />

      {/* ---- lifetime ---- */}
      <Card>
        <T variant="subtitle">{t('stats.lifetime')}</T>
        <Row gap={theme.space.md} style={{ flexWrap: 'wrap', marginTop: theme.space.sm }}>
          <Tile label={t('history.title')} value={String(stats.rides)} />
          <Tile label={t('rideDetail.distance')} value={formatDistance(stats.distance_m)} />
          <Tile label={t('rideDetail.duration')} value={formatDuration(stats.duration_s)} />
          <Tile label={t('rideDetail.co2')} value={`${stats.co2_kg} kg`} />
          <Tile label={t('endRide.total')} value={formatMoney(stats.spent_cents, brand.currency)} />
          <Tile
            label={t('stats.avgRide')}
            value={formatDistance(stats.avg_distance_m)}
            sub={formatDuration(stats.avg_duration_s)}
          />
        </Row>
      </Card>

      {/* ---- rides per month ---- */}
      <Card style={{ marginTop: theme.space.md }}>
        <T variant="subtitle">{t('stats.ridesPerMonth')}</T>
        <MonthBars months={stats.months} />
        {stats.best_month ? (
          <T variant="caption" style={{ marginTop: theme.space.sm }}>
            {t('stats.bestMonth')}: {stats.best_month.label} · {stats.best_month.rides}
          </T>
        ) : null}
      </Card>

      {/* ---- streak + favourites ---- */}
      <Card style={{ marginTop: theme.space.md }}>
        <Row justify="space-between" align="center">
          <Row gap={8} align="center">
            <Icon name="fire" size={18} color={theme.color.warning} />
            <T variant="subtitle">{t('stats.streak')}</T>
          </Row>
          <Badge tone="success" label={String(stats.parking_streak)} />
        </Row>
        <T variant="caption" style={{ marginTop: 4 }}>
          {t('stats.bestStreak')}: {stats.longest_parking_streak}
        </T>
        <Divider style={{ marginVertical: theme.space.sm }} />
        <Row gap={theme.space.md} style={{ flexWrap: 'wrap' }}>
          <Tile label={t('stats.favouriteModel')} value={stats.favourite_model ?? '—'} />
          <Tile label={t('stats.favouriteCity')} value={stats.favourite_city ?? '—'} />
          <Tile label={t('stats.firstRide')} value={formatDateTime(stats.first_ride_at)} />
          <Tile label={t('stats.lastRide')} value={formatDateTime(stats.last_ride_at)} />
        </Row>
      </Card>

      {/* ---- loyalty ---- */}
      {isEnabled('loyalty') ? (
      <Card style={{ marginTop: theme.space.md }}>
        <Row justify="space-between" align="center">
          <Row gap={8} align="center">
            <Icon name="crown" size={18} color={theme.color.warning} />
            <T variant="subtitle">{t('stats.loyalty')}</T>
          </Row>
          <Badge tone="primary" label={t('stats.tier', { name: stats.tier.name })} />
        </Row>
        <View style={{ marginTop: theme.space.sm }}>
          <ProgressBar value={stats.tier.progress} />
        </View>
        <T variant="caption" style={{ marginTop: 4 }}>
          {stats.tier.next_name && stats.tier.next_at_points != null
            ? t('stats.toNextTier', {
                n: String(Math.max(0, stats.tier.next_at_points - stats.tier.points)),
                name: stats.tier.next_name,
              })
            : t('stats.topTier')}
        </T>
      </Card>
      ) : null}

      {/* ---- referrals ---- */}
      {isEnabled('referrals') ? (
      <Card style={{ marginTop: theme.space.md }}>
        <Row gap={8} align="center">
          <Icon name="referral" size={18} color={theme.color.primary} />
          <T variant="subtitle">{t('stats.referral')}</T>
        </Row>
        <Row gap={theme.space.md} style={{ flexWrap: 'wrap', marginTop: theme.space.sm }}>
          <Tile label={t('stats.invited')} value={String(stats.referral.invited)} />
          <Tile label={t('stats.converted')} value={String(stats.referral.converted)} />
          <Tile label={t('stats.earned')} value={formatMoney(stats.referral.earned_cents, brand.currency)} />
        </Row>
        <Badge tone="neutral" label={stats.referral.code} style={{ alignSelf: 'flex-start', marginTop: theme.space.sm }} />
      </Card>
      ) : null}

      <Button title={t('stats.shareRecap')} onPress={shareRecap} style={{ marginTop: theme.space.lg }} />
    </Screen>
  );
}
