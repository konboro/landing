import React, { useCallback, useEffect, useState } from 'react';
import { View, Linking, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  formatMoney,
  formatDuration,
  formatDistance,
  formatDateTime,
  co2SavedKg,
} from '@penny/ui';
import { useBrand, useTheme } from '../../brand';
import { getApi } from '../../services';
import type { TripDetail, CostBreakdown } from '../../services/types';
import { useT } from '../../i18n';
import {
  Screen, Header, T, Row, Card, Button, Badge, Banner, Divider, Sheet, TextField, Chip, Icon,
} from '../../components/ui';
import { RouteMap } from '../../components/RouteMap';

const REASONS = ['Overcharged', 'Vehicle fault', 'Wrong duration', 'Never rode', 'Other'];

/** One line of the cost breakdown. Credits render negative and in green. */
function CostLine({
  label,
  cents,
  currency,
  credit = false,
  strong = false,
}: {
  label: string;
  cents: number;
  currency: string;
  credit?: boolean;
  strong?: boolean;
}) {
  const theme = useTheme();
  if (!cents && !strong) return null;
  return (
    <Row justify="space-between" style={{ paddingVertical: 5 }}>
      <T variant={strong ? 'subtitle' : 'body'} style={strong ? undefined : { color: theme.color.textMuted }}>
        {label}
      </T>
      <T
        variant={strong ? 'subtitle' : 'body'}
        style={{ color: credit ? theme.color.success : theme.color.text }}
      >
        {credit ? '−' : ''}
        {formatMoney(Math.abs(cents), currency)}
      </T>
    </Row>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 88 }}>
      <T variant="caption">{label}</T>
      <T variant="subtitle">{value}</T>
    </View>
  );
}

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useT();
  const theme = useTheme();
  const { isEnabled } = useBrand();
  const api = getApi();

  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const [rating, setRating] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [rateSaved, setRateSaved] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api
      .getTripDetail(id)
      .then((d) => {
        setTrip(d);
        setRating(d.rating);
        setTags(d.tags ?? []);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [api, id]);

  useEffect(load, [load]);

  if (loading) {
    return (
      <Screen edges={['top']}>
        <Header title={t('rideDetail.title')} onBack={() => router.back()} />
        <Card><T variant="body">{t('common.loading')}</T></Card>
      </Screen>
    );
  }
  if (failed || !trip) {
    return (
      <Screen edges={['top']}>
        <Header title={t('rideDetail.title')} onBack={() => router.back()} />
        <Card>
          <T variant="body">{t('rideDetail.notFound')}</T>
          <Button title={t('common.retry')} onPress={load} style={{ marginTop: theme.space.md }} />
        </Card>
      </Screen>
    );
  }

  const b: CostBreakdown = trip.breakdown;
  const cur = b.currency;
  const review = trip.photo_review_info;
  const co2 = co2SavedKg(trip.distance_m);

  const submitRating = async () => {
    if (rating == null) return;
    const updated = await api.rateTrip(trip.id, rating, tags);
    setTrip(updated);
    setRateSaved(true);
  };

  return (
    <Screen edges={['top']} scroll>
      <Header title={t('rideDetail.title')} onBack={() => router.back()} />

      {/* ---- route ---- */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <RouteMap route={trip.route} height={200} emptyLabel={t('rideDetail.noRoute')} />
      </Card>

      <Row justify="space-between" style={{ marginTop: theme.space.sm }}>
        <T variant="caption">{formatDateTime(trip.started_at)}</T>
        <T variant="caption">{trip.vehicle_code}</T>
      </Row>

      {(trip.start_address || trip.end_address) ? (
        <Card style={{ marginTop: theme.space.sm }}>
          <Row gap={8} align="center">
            <Icon name="location" size={14} color={theme.color.textMuted} />
            <T variant="caption">{t('rideDetail.from')}: {trip.start_address ?? '—'}</T>
          </Row>
          <Row gap={8} align="center" style={{ marginTop: 4 }}>
            <Icon name="flag" size={14} color={theme.color.success} />
            <T variant="caption">{t('rideDetail.to')}: {trip.end_address ?? '—'}</T>
          </Row>
        </Card>
      ) : null}

      {/* ---- stats ---- */}
      <Card style={{ marginTop: theme.space.md }}>
        <Row gap={theme.space.md} style={{ flexWrap: 'wrap' }}>
          <StatBox label={t('rideDetail.distance')} value={formatDistance(trip.distance_m)} />
          <StatBox label={t('rideDetail.duration')} value={formatDuration(trip.duration_s)} />
          {trip.pause_s > 0 ? (
            <StatBox label={t('rideDetail.paused')} value={formatDuration(trip.pause_s)} />
          ) : null}
          <StatBox label={t('rideDetail.avgSpeed')} value={`${trip.avg_speed_kmh.toFixed(1)} km/h`} />
          <StatBox label={t('rideDetail.co2')} value={`${co2} kg`} />
        </Row>
      </Card>

      {/* ---- cost breakdown ---- */}
      <Card style={{ marginTop: theme.space.md }}>
        <T variant="subtitle" style={{ marginBottom: 4 }}>{t('rideDetail.costTitle')}</T>
        {trip.pricing.multiplier > 1 ? (
          <Badge
            tone="warning"
            label={t('rideDetail.surge', { mult: String(trip.pricing.multiplier) })}
            style={{ alignSelf: 'flex-start', marginBottom: 6 }}
          />
        ) : null}
        <CostLine label={t('rideDetail.unlock')} cents={b.unlock_cents} currency={cur} />
        <CostLine label={t('rideDetail.riding')} cents={b.ride_cents} currency={cur} />
        <CostLine label={t('rideDetail.pause')} cents={b.pause_cents} currency={cur} />
        <CostLine label={t('rideDetail.paidParking')} cents={b.paid_parking_cents} currency={cur} />
        <CostLine label={t('rideDetail.addon')} cents={b.addon_cents} currency={cur} />
        <CostLine label={t('rideDetail.penalty')} cents={b.penalty_cents} currency={cur} />
        <CostLine label={t('rideDetail.bonusZone')} cents={b.bonus_cents} currency={cur} credit />
        <CostLine label={t('rideDetail.packageMinutes')} cents={b.discount_cents} currency={cur} credit />
        <CostLine
          label={t('rideDetail.promo', { code: trip.promo_code ?? '' })}
          cents={b.promo_cents}
          currency={cur}
          credit
        />
        <Divider style={{ marginVertical: 6 }} />
        <CostLine label={t('rideDetail.total')} cents={b.total_cents} currency={cur} strong />
      </Card>

      {/* ---- parking photo + review outcome ---- */}
      {trip.end_photo_url || review.outcome ? (
        <Card style={{ marginTop: theme.space.md }}>
          <T variant="subtitle" style={{ marginBottom: 6 }}>{t('rideDetail.parkingPhoto')}</T>
          <View
            style={{
              height: 140,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Icon name="camera" size={26} color={theme.color.textMuted} />
            <T variant="caption">{t('rideDetail.photoPlaceholder')}</T>
          </View>
          {review.outcome === 'rejected' ? (
            <Banner
              tone="danger"
              title={t('rideDetail.reviewRejected')}
              body={review.reason ?? undefined}
              style={{ marginTop: theme.space.sm }}
            />
          ) : review.outcome === 'pending' ? (
            <Banner tone="primary" title={t('rideDetail.reviewPending')} style={{ marginTop: theme.space.sm }} />
          ) : review.outcome ? (
            <Banner tone="success" title={t('rideDetail.reviewOk')} style={{ marginTop: theme.space.sm }} />
          ) : null}
          {review.reviewed_at ? (
            <T variant="caption" style={{ marginTop: 4 }}>
              {t('rideDetail.reviewedAt', { when: formatDateTime(review.reviewed_at) })}
            </T>
          ) : null}
          {review.outcome === 'rejected' && isEnabled('parkingSchool') ? (
            <Button
              variant="ghost"
              title={t('rideDetail.parkingSchool')}
              onPress={() => router.push('/parking-school')}
              style={{ marginTop: theme.space.sm }}
            />
          ) : null}
        </Card>
      ) : null}

      {/* ---- rating ---- */}
      <Card style={{ marginTop: theme.space.md }}>
        <T variant="subtitle">{trip.rating_editable ? t('rideDetail.rateTitle') : t('rideDetail.rated')}</T>
        <Row gap={6} style={{ marginTop: 8 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              disabled={!trip.rating_editable}
              onPress={() => setRating(n)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${n} stars`}
            >
              <T style={{ fontSize: 28, color: (rating ?? 0) >= n ? theme.color.warning : theme.color.border }}>
                ★
              </T>
            </Pressable>
          ))}
        </Row>
        {trip.rating_editable ? (
          <>
            <T variant="caption" style={{ marginTop: 8 }}>{t('rideDetail.rateHint')}</T>
            <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 6 }}>
              {trip.available_tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  active={tags.includes(tag)}
                  onPress={() => setTags((c) => (c.includes(tag) ? c.filter((x) => x !== tag) : [...c, tag]))}
                />
              ))}
            </Row>
            <Button
              title={rateSaved ? t('rideDetail.rateThanks') : t('rideDetail.submitRating')}
              disabled={rating == null || rateSaved}
              onPress={submitRating}
              style={{ marginTop: theme.space.md }}
            />
          </>
        ) : null}
      </Card>

      {/* ---- dispute status ---- */}
      {trip.dispute ? (
        <Banner
          tone={trip.dispute.status === 'rejected' ? 'danger' : trip.dispute.status === 'resolved' ? 'success' : 'primary'}
          title={
            trip.dispute.status === 'open'
              ? t('rideDetail.disputeOpen')
              : trip.dispute.status === 'resolved'
                ? t('rideDetail.disputeResolved')
                : t('rideDetail.disputeRejected')
          }
          body={
            trip.dispute.refund_cents
              ? t('rideDetail.refunded', { amount: formatMoney(trip.dispute.refund_cents, cur) })
              : (trip.dispute.resolution ?? trip.dispute.reason)
          }
          style={{ marginTop: theme.space.md }}
        />
      ) : null}

      {/* ---- actions ---- */}
      <Row gap={theme.space.sm} style={{ marginTop: theme.space.lg }}>
        <Button
          style={{ flex: 1 }}
          variant="secondary"
          title={t('rideDetail.receipt')}
          onPress={async () => {
            const url = await api.getReceiptUrl(trip.id);
            Linking.openURL(url).catch(() => undefined);
          }}
        />
        {!trip.dispute ? (
          <Button
            style={{ flex: 1 }}
            variant="ghost"
            title={t('rideDetail.reportProblem')}
            onPress={() => setDisputeOpen(true)}
          />
        ) : null}
      </Row>

      <Sheet visible={disputeOpen} onClose={() => setDisputeOpen(false)} title={t('history.disputeTitle')}>
        <Row gap={6} style={{ flexWrap: 'wrap', marginBottom: theme.space.md }}>
          {REASONS.map((r) => (
            <Chip key={r} label={r} active={reason === r} onPress={() => setReason(r)} />
          ))}
        </Row>
        <TextField
          label={t('history.disputeReason')}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="…"
        />
        <Button
          title={t('history.addPhotos')}
          variant="secondary"
          onPress={() => setPhotos((p) => [...p, `local://dispute-${p.length + 1}.jpg`])}
          style={{ marginTop: theme.space.sm }}
        />
        {photos.length ? <T variant="caption">{photos.length} photo(s) attached</T> : null}
        <Button
          title={t('history.submitDispute')}
          disabled={!reason}
          onPress={async () => {
            await api.disputeTrip(trip.id, `${reason}: ${note}`, photos);
            setDisputeOpen(false);
            load();
          }}
          style={{ marginTop: theme.space.md }}
        />
      </Sheet>
    </Screen>
  );
}
