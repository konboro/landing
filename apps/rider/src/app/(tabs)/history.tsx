import React, { useCallback, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMoney, formatDuration, formatDistance, formatDateTime } from '@penny/ui';
import { theme } from '../../lib/theme';
import { getApi } from '../../services';
import type { TripView } from '../../services/types';
import { useT } from '../../i18n';
import { Screen, T, Row, Card, Badge, Icon } from '../../components/ui';
import { MiniRoute } from '../../components/MiniRoute';

export default function HistoryScreen() {
  const { t } = useT();
  const api = getApi();
  const router = useRouter();
  const [trips, setTrips] = useState<TripView[]>([]);

  useFocusEffect(useCallback(() => { api.getHistory().then(setTrips); }, [api]));

  return (
    <Screen edges={['top']} scroll>
      <T variant="title" style={{ marginBottom: theme.space.md }}>{t('history.title')}</T>
      {trips.length === 0 ? (
        <Card><Row gap={10}><Icon name="history" size={20} /><T variant="body">{t('history.empty')}</T></Row></Card>
      ) : null}
      {trips.map((trip) => {
        const tone = trip.status === 'disputed' ? 'warning' : trip.status === 'charged' ? 'success' : 'neutral';
        const statusLabel = trip.status === 'disputed' ? t('history.disputed') : trip.status === 'charged' ? t('history.charged') : t('history.ended');
        return (
          <Pressable key={trip.id} onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })}>
            <Card style={{ marginBottom: theme.space.sm }}>
              <Row gap={theme.space.md} align="center">
                <MiniRoute route={trip.route} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Row justify="space-between">
                    <T variant="subtitle">{formatMoney(trip.cost_cents, trip.currency)}</T>
                    <Badge tone={tone} label={statusLabel} />
                  </Row>
                  <T variant="caption">{trip.vehicle_code} · {formatDateTime(trip.started_at)}</T>
                  <Row gap={theme.space.md}>
                    <Row gap={4}><Icon name="reserve" size={13} color={theme.color.textMuted} /><T variant="caption">{formatDuration(trip.duration_s)}</T></Row>
                    <Row gap={4}><Icon name="range" size={13} color={theme.color.textMuted} /><T variant="caption">{formatDistance(trip.distance_m)}</T></Row>
                  </Row>
                </View>
                <Icon name="chevron" size={22} color={theme.color.textMuted} />
              </Row>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
