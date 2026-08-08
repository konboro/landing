import React, { useCallback, useMemo, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatMoney, formatDuration, formatDistance, formatDateTime } from '@penny/ui';
import { theme } from '../../lib/theme';
import { getApi } from '../../services';
import type { HistoryMonthGroup, HistoryFilter, RiderCity, TripView } from '../../services/types';
import { useT } from '../../i18n';
import { Screen, T, Row, Card, Badge, Icon, Button, Sheet, TextField, Chip, Toggle, Divider } from '../../components/ui';
import { MiniRoute } from '../../components/MiniRoute';

const PAGE = 20;

/** Merge a freshly fetched page into the already-rendered month groups. */
function mergeGroups(prev: HistoryMonthGroup[], next: HistoryMonthGroup[]): HistoryMonthGroup[] {
  const byKey = new Map(prev.map((g) => [g.key, { ...g, trips: [...g.trips] }]));
  for (const g of next) {
    const existing = byKey.get(g.key);
    if (!existing) {
      byKey.set(g.key, { ...g, trips: [...g.trips] });
      continue;
    }
    const seen = new Set(existing.trips.map((t) => t.id));
    existing.trips.push(...g.trips.filter((t) => !seen.has(t.id)));
    // Month totals come from the server and cover the whole month, not the page.
    existing.rides = g.rides;
    existing.distance_m = g.distance_m;
    existing.spent_cents = g.spent_cents;
  }
  return [...byKey.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function countActive(f: HistoryFilter): number {
  return [f.from, f.to, f.city_id, f.has_dispute || undefined, f.has_penalty || undefined].filter(Boolean).length;
}

export default function HistoryScreen() {
  const { t } = useT();
  const api = getApi();
  const router = useRouter();

  const [groups, setGroups] = useState<HistoryMonthGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>({});
  const [draft, setDraft] = useState<HistoryFilter>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cities, setCities] = useState<RiderCity[]>([]);

  const fetchPage = useCallback(
    async (offset: number, f: HistoryFilter, q: string) => {
      const page = await api.getHistoryPage({ ...f, search: q || undefined, limit: PAGE, offset });
      setTotal(page.total);
      setHasMore(page.has_more);
      setNextOffset(page.next_offset);
      setGroups((prev) => (offset === 0 ? page.groups : mergeGroups(prev, page.groups)));
    },
    [api],
  );

  const reload = useCallback(
    (f: HistoryFilter, q: string) => {
      setLoading(true);
      setFailed(false);
      fetchPage(0, f, q)
        .catch(() => setFailed(true))
        .finally(() => setLoading(false));
    },
    [fetchPage],
  );

  useFocusEffect(
    useCallback(() => {
      reload(filter, search);
      api.getRiderCities().then(setCities).catch(() => undefined);
      // Re-run only when the query inputs change, not on every render.
    }, [reload, filter, search, api]),
  );

  const loadMore = () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    fetchPage(nextOffset, filter, search)
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  };

  const activeCount = useMemo(() => countActive(filter), [filter]);
  const isEmpty = !loading && groups.length === 0;

  const openFilters = () => {
    setDraft(filter);
    setFiltersOpen(true);
  };

  return (
    <Screen edges={['top']} scroll>
      <Row justify="space-between" align="center" style={{ marginBottom: theme.space.md }}>
        <T variant="title">{t('history.title')}</T>
        <Pressable onPress={() => router.push('/stats')} hitSlop={8} accessibilityRole="button">
          <Row gap={4} align="center">
            <Icon name="points" size={16} color={theme.color.primary} />
            <T variant="caption" style={{ color: theme.color.primary }}>{t('history.seeStats')}</T>
          </Row>
        </Pressable>
      </Row>

      <TextField
        value={search}
        onChangeText={setSearch}
        placeholder={t('history.searchHint')}
        accessibilityLabel={t('history.search')}
      />

      <Row gap={theme.space.sm} align="center" style={{ marginTop: theme.space.sm }}>
        <Button
          variant="secondary"
          title={activeCount ? `${t('history.filters')} · ${t('history.filtersOn', { n: String(activeCount) })}` : t('history.filters')}
          onPress={openFilters}
          style={{ flex: 1 }}
        />
        {activeCount ? (
          <Button variant="ghost" title={t('history.clearFilters')} onPress={() => setFilter({})} />
        ) : null}
      </Row>

      {!loading && total > 0 ? (
        <T variant="caption" style={{ marginTop: theme.space.sm }}>
          {t('history.totalRides', { n: String(total) })}
        </T>
      ) : null}

      {loading ? (
        <Card style={{ marginTop: theme.space.md }}>
          <Row gap={10} align="center">
            <ActivityIndicator />
            <T variant="body">{t('common.loading')}</T>
          </Row>
        </Card>
      ) : null}

      {failed ? (
        <Card style={{ marginTop: theme.space.md }}>
          <T variant="body">{t('history.loadFailed')}</T>
          <Button title={t('common.retry')} onPress={() => reload(filter, search)} style={{ marginTop: theme.space.sm }} />
        </Card>
      ) : null}

      {isEmpty && !failed ? (
        <Card style={{ marginTop: theme.space.md }}>
          <Row gap={10} align="center">
            <Icon name="history" size={20} />
            <T variant="body">{activeCount || search ? t('history.noResults') : t('history.empty')}</T>
          </Row>
        </Card>
      ) : null}

      {groups.map((group) => (
        <View key={group.key} style={{ marginTop: theme.space.lg }}>
          <Row justify="space-between" align="center">
            <T variant="subtitle">{group.label}</T>
            <T variant="caption">
              {t('history.monthRides', { n: String(group.rides) })} · {formatDistance(group.distance_m)} ·{' '}
              {formatMoney(group.spent_cents, 'EUR')}
            </T>
          </Row>
          <Divider style={{ marginVertical: theme.space.sm }} />
          {group.trips.map((trip) => (
            <RideRow key={trip.id} trip={trip} onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })} />
          ))}
        </View>
      ))}

      {hasMore ? (
        <Button
          variant="secondary"
          title={loadingMore ? t('history.loadingMore') : t('history.loadMore')}
          onPress={loadMore}
          disabled={loadingMore}
          style={{ marginTop: theme.space.lg }}
        />
      ) : null}

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('history.filters')}>
        <TextField
          label={t('history.filterFrom')}
          value={draft.from ?? ''}
          onChangeText={(v) => setDraft((d) => ({ ...d, from: v || null }))}
          placeholder="2026-01-01"
        />
        <TextField
          label={t('history.filterTo')}
          value={draft.to ?? ''}
          onChangeText={(v) => setDraft((d) => ({ ...d, to: v || null }))}
          placeholder="2026-12-31"
        />
        {cities.length > 1 ? (
          <>
            <T variant="caption" style={{ marginTop: theme.space.sm }}>{t('history.filterCity')}</T>
            <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 6 }}>
              <Chip
                label={t('history.filterAllCities')}
                active={!draft.city_id}
                onPress={() => setDraft((d) => ({ ...d, city_id: null }))}
              />
              {cities.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  active={draft.city_id === c.id}
                  onPress={() => setDraft((d) => ({ ...d, city_id: c.id }))}
                />
              ))}
            </Row>
          </>
        ) : null}
        <Toggle
          label={t('history.filterDispute')}
          value={!!draft.has_dispute}
          onChange={(v: boolean) => setDraft((d) => ({ ...d, has_dispute: v }))}
        />
        <Toggle
          label={t('history.filterPenalty')}
          value={!!draft.has_penalty}
          onChange={(v: boolean) => setDraft((d) => ({ ...d, has_penalty: v }))}
        />
        <Button
          title={t('history.apply')}
          onPress={() => {
            setFilter(draft);
            setFiltersOpen(false);
          }}
          style={{ marginTop: theme.space.md }}
        />
      </Sheet>
    </Screen>
  );
}

function RideRow({ trip, onPress }: { trip: TripView; onPress: () => void }) {
  const { t } = useT();
  const tone = trip.status === 'disputed' ? 'warning' : trip.status === 'charged' ? 'success' : 'neutral';
  const statusLabel =
    trip.status === 'disputed' ? t('history.disputed') : trip.status === 'charged' ? t('history.charged') : t('history.ended');
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={{ marginBottom: theme.space.sm }}>
        <Row gap={theme.space.md} align="center">
          <MiniRoute route={trip.route} />
          <View style={{ flex: 1, gap: 4 }}>
            <Row justify="space-between">
              <T variant="subtitle">{formatMoney(trip.cost_cents, trip.currency)}</T>
              <Badge tone={tone} label={statusLabel} />
            </Row>
            <T variant="caption">{trip.vehicle_code} · {formatDateTime(trip.started_at)}</T>
            <Row gap={theme.space.md} style={{ flexWrap: 'wrap' }}>
              <Row gap={4}>
                <Icon name="reserve" size={13} color={theme.color.textMuted} />
                <T variant="caption">{formatDuration(trip.duration_s)}</T>
              </Row>
              <Row gap={4}>
                <Icon name="range" size={13} color={theme.color.textMuted} />
                <T variant="caption">{formatDistance(trip.distance_m)}</T>
              </Row>
              {trip.photo_review === 'pending' ? (
                <Badge tone="neutral" label={t('history.inReview')} />
              ) : trip.photo_review === 'rejected' ? (
                <Badge tone="danger" label={t('history.parkingRejected')} />
              ) : null}
              {trip.penalty_cents > 0 ? <Badge tone="danger" label={t('history.penalty')} /> : null}
              {trip.bonus_cents > 0 ? <Badge tone="success" label={t('history.bonus')} /> : null}
            </Row>
          </View>
          <Icon name="chevron" size={22} color={theme.color.textMuted} />
        </Row>
      </Card>
    </Pressable>
  );
}
