import React, { useEffect, useState } from 'react';
import { View, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatMoney, formatDuration, formatDistance, formatDateTime, co2SavedKg } from '@penny/ui';
import { theme } from '../../lib/theme';
import { getApi } from '../../services';
import type { TripView } from '../../services/types';
import { useT } from '../../i18n';
import {
  Screen, Header, T, Row, Card, Button, Badge, Banner, Divider, Sheet, TextField, Chip, Icon,
} from '../../components/ui';
import { MiniRoute } from '../../components/MiniRoute';

const REASONS = ['Overcharged', 'Vehicle fault', 'Wrong duration', 'Never rode', 'Other'];

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useT();
  const api = getApi();
  const [trip, setTrip] = useState<TripView | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getHistory().then((all) => setTrip(all.find((x) => x.id === id) ?? null));
  }, [api, id]);

  if (!trip) {
    return <Screen><Header title="" /><View style={{ padding: theme.space.lg }}><T variant="body">{t('common.loading')}</T></View></Screen>;
  }

  const money = (c: number) => formatMoney(c, trip.currency);

  const openReceipt = async () => {
    const url = await api.getReceiptUrl(trip.id);
    Linking.openURL(url).catch(() => {});
  };

  const submitDispute = async () => {
    setBusy(true);
    try {
      const updated = await api.disputeTrip(trip.id, `${reason}: ${note}`, photos);
      setTrip(updated);
      setDisputeOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} scroll>
      <Header title={trip.vehicle_code} subtitle={formatDateTime(trip.started_at)} />
      <View style={{ gap: theme.space.md }}>
        <Card padded={false}>
          <View style={{ alignItems: 'center', padding: theme.space.lg }}>
            <MiniRoute route={trip.route} width={260} height={150} />
          </View>
          <View style={{ padding: theme.space.lg, paddingTop: 0 }}>
            <Row justify="space-between">
              <T variant="title">{money(trip.cost_cents)}</T>
              <Badge tone={trip.status === 'disputed' ? 'warning' : 'success'} label={trip.status === 'disputed' ? t('history.disputed') : t('history.charged')} />
            </Row>
            <Divider />
            <View style={{ gap: 8 }}>
              <Line label={t('endRide.duration')} value={formatDuration(trip.duration_s)} />
              <Line label={t('endRide.distance')} value={formatDistance(trip.distance_m)} />
              <Line label={t('endRide.unlockFee')} value={money(trip.pricing.unlock_cents)} />
              <Line label={t('preUnlock.perMin')} value={money(trip.pricing.per_min_cents)} />
              {trip.discount_cents > 0 ? <Line label={t('preUnlock.packageApplied')} value={`-${money(trip.discount_cents)}`} tone="success" /> : null}
              {trip.bonus_cents > 0 ? <Line label={t('endRide.bonus')} value={`-${money(trip.bonus_cents)}`} tone="success" /> : null}
              <Divider />
              <Line label={t('endRide.total')} value={money(trip.cost_cents)} strong />
            </View>
          </View>
        </Card>

        <Banner tone="success" icon="leaf" title={t('endRide.co2', { kg: co2SavedKg(trip.distance_m) })} />

        <Button title={t('history.receipt')} icon="history" variant="secondary" onPress={openReceipt} />
        {trip.status !== 'disputed' ? (
          <Button title={t('history.dispute')} icon="flag" variant="ghost" onPress={() => setDisputeOpen(true)} />
        ) : (
          <Banner tone="warning" icon="info" title={t('history.disputed')} body="We’ll email you an update." />
        )}
      </View>

      <Sheet visible={disputeOpen} onClose={() => setDisputeOpen(false)} title={t('history.disputeTitle')}>
        <View style={{ gap: theme.space.md }}>
          <T variant="label">{t('history.disputeReason')}</T>
          <Row wrap gap={theme.space.sm}>
            {REASONS.map((r) => <Chip key={r} label={r} active={reason === r} onPress={() => setReason(r)} />)}
          </Row>
          <TextField placeholder="Tell us more…" multiline value={note} onChangeText={setNote} style={{ minHeight: 80 }} />
          <Button title={`${t('history.addPhotos')} (${photos.length})`} icon="camera" variant="secondary" onPress={() => setPhotos((p) => [...p, `mock://photo/dispute-${p.length}.jpg`])} />
          <Button title={t('history.submitDispute')} icon="flag" loading={busy} disabled={!reason} onPress={submitDispute} />
        </View>
      </Sheet>
    </Screen>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: 'success'; strong?: boolean }) {
  return (
    <Row justify="space-between">
      <T variant={strong ? 'subtitle' : 'body'} color={theme.color.textMuted}>{label}</T>
      <T variant={strong ? 'subtitle' : 'body'} color={tone === 'success' ? theme.color.success : theme.color.text} style={{ fontWeight: '700' }}>{value}</T>
    </Row>
  );
}
