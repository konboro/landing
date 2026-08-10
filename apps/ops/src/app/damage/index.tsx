// Damages — the defect list, grouped by where each report sits in the review
// workflow rather than by raw status.
//
// Three tabs because that is the only question a mechanic asks of this screen:
// "what still needs a decision" (new), "what am I cleared to fix" (confirmed),
// "what is closed" (fixed + rejected). Fixed and rejected share the Done tab —
// neither needs work — but each card keeps a badge saying WHICH, because
// "we repaired it" and "it was never real" are very different facts about a
// vehicle and collapsing them loses history.
//
// With `?vehicleId=` the list is scoped to one vehicle (the damage tab of a
// vehicle); without it, it is the whole fleet and every card carries its code.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Card, Muted, Badge, Row, Empty,
  Icon, PhotoStrip, SegmentedControl,
} from '../../components/ui';
import { SyncPill } from '../../components/SyncPill';
import { useMirror } from '../../lib/useMirror';
import { getDamageReports, getVehicles } from '../../offline/repo';
import { relativeTime } from '@penny/ui';
import { useTheme, makeStyles, type OpsTheme } from '../../brand';
import type { OpsDamageReport, OpsVehicle } from '../../lib/types';

type TabKey = 'review' | 'approved' | 'done';

const TAB_FOR_STATUS: Record<string, TabKey> = {
  new: 'review',
  confirmed: 'approved',
  fixed: 'done',
  rejected: 'done',
};

const EMPTY_TEXT: Record<TabKey, string> = {
  review: 'Nothing waiting for review.',
  approved: 'Nothing approved for repair.',
  done: 'Nothing closed yet.',
};

/** Fill + ink for a severity badge. `low` stays neutral so the loud colours
 *  keep meaning something when half the list is scratches. */
function severityColors(t: OpsTheme, severity: string): { color: string; textColor: string } {
  switch (severity) {
    case 'critical':
    case 'high':
      return { color: t.c.danger, textColor: t.c.onDanger };
    case 'medium':
      return { color: t.c.warning, textColor: t.c.onWarning };
    default:
      return { color: t.c.surfaceAlt, textColor: t.c.text };
  }
}

export default function DamageList() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;
  const params = useLocalSearchParams<{ vehicleId?: string }>();
  const vehicleId = params.vehicleId ?? null;

  const reports = useMirror<OpsDamageReport[]>(getDamageReports, []);
  const vehicles = useMirror<OpsVehicle[]>(getVehicles, []);
  const [tab, setTab] = useState<TabKey>('review');
  const [refreshing, setRefreshing] = useState(false);

  const vmap = useMemo(
    () => new Map(vehicles.data.map((v) => [v.id, v] as const)),
    [vehicles.data],
  );

  const scoped = useMemo(
    () => (vehicleId ? reports.data.filter((r) => r.vehicle_id === vehicleId) : reports.data),
    [reports.data, vehicleId],
  );

  const counts = useMemo(() => {
    const acc: Record<TabKey, number> = { review: 0, approved: 0, done: 0 };
    for (const r of scoped) acc[TAB_FOR_STATUS[r.status] ?? 'done'] += 1;
    return acc;
  }, [scoped]);

  const visible = useMemo(
    () => scoped.filter((r) => (TAB_FOR_STATUS[r.status] ?? 'done') === tab),
    [scoped, tab],
  );

  const { reload } = reports;
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reload();
  }, [reload]);

  // The mirror re-read is synchronous-ish; drop the spinner as soon as the
  // loader settles rather than on a timer, so a slow SQLite read still shows.
  useEffect(() => {
    if (!reports.loading) setRefreshing(false);
  }, [reports.loading]);

  const closeHref = '/(tabs)';
  const scopedVehicle = vehicleId ? vmap.get(vehicleId) : undefined;

  return (
    <SafeAreaView style={st.screen} edges={['top', 'left', 'right']}>
      {/* Own header: the close/title/add triad has to sit above the tabs, and a
          native header cannot hold the "+" without a second layout. */}
      <Stack.Screen options={{ headerShown: false }} />

      <View style={st.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace(closeHref))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close damages"
          style={({ pressed }) => [st.headerBtn, pressed && st.pressed]}
        >
          <Icon name="close" size={24} color={c.text} />
        </Pressable>

        <View style={st.headerTitle}>
          <Text style={st.title} numberOfLines={1}>
            Damages
          </Text>
          {scopedVehicle ? <Muted>{scopedVehicle.code}</Muted> : null}
        </View>

        <Pressable
          onPress={() =>
            router.push({
              pathname: '/damage/new',
              params: vehicleId ? { vehicleId } : {},
            })
          }
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Add damage"
          style={({ pressed }) => [st.headerBtn, st.headerAdd, pressed && st.pressed]}
        >
          <Icon name="plus" size={24} color={c.onPrimary} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={st.tabs}>
        <SegmentedControl
          value={tab}
          onChange={(k) => setTab(k as TabKey)}
          options={[
            { key: 'review', label: `In review ${counts.review}` },
            { key: 'approved', label: `Approved ${counts.approved}` },
            { key: 'done', label: `Done ${counts.done}` },
          ]}
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />
        }
        ListHeaderComponent={
          <Row style={{ justifyContent: 'flex-end', paddingBottom: space.xs }}>
            <SyncPill />
          </Row>
        }
        ListEmptyComponent={<Empty text={EMPTY_TEXT[tab]} />}
        renderItem={({ item }) => (
          <DamageCard
            report={item}
            vehicleCode={vehicleId ? null : (vmap.get(item.vehicle_id)?.code ?? 'Unknown vehicle')}
            onPress={() => router.push(`/damage/${item.id}`)}
          />
        )}
      />
    </SafeAreaView>
  );
}

function DamageCard({
  report,
  vehicleCode,
  onPress,
}: {
  report: OpsDamageReport;
  /** null when the list is already scoped to one vehicle. */
  vehicleCode: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const sev = severityColors(theme, report.severity);
  const closed = report.status === 'fixed' || report.status === 'rejected';

  return (
    <Card onPress={onPress}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={st.cardTitle} numberOfLines={2}>
          {report.part ?? 'Damage report'}
        </Text>
        <Row gap={6}>
          {closed ? (
            <Badge
              label={report.status === 'fixed' ? 'fixed' : 'rejected'}
              color={report.status === 'fixed' ? c.success : c.surfaceAlt}
              textColor={report.status === 'fixed' ? c.onSuccess : c.textMuted}
            />
          ) : null}
          <Badge label={report.severity} color={sev.color} textColor={sev.textColor} />
        </Row>
      </Row>

      <Muted>
        {vehicleCode ? `${vehicleCode} · ` : ''}
        {relativeTime(report.created_at)} · by {report.reporter}
      </Muted>

      {/* Thumbnails sit above the text: the photo is what identifies a defect
          faster than any wording a rider typed at 2am. */}
      <PhotoStrip photos={report.photos} size={68} />

      {report.description.trim() ? (
        <Text style={st.desc} numberOfLines={3}>
          {report.description.trim()}
        </Text>
      ) : (
        <Muted>No description.</Muted>
      )}

      {report.penalty_payment_id ? (
        <Badge label="penalty → admin review" color={c.danger} textColor={c.onDanger} />
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.c.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    backgroundColor: t.c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.c.border,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAdd: { backgroundColor: t.c.primary },
  headerTitle: { flex: 1, alignItems: 'center' },
  title: { color: t.c.text, fontSize: t.font.size.lg, fontWeight: '700' },
  pressed: { opacity: 0.6 },
  tabs: { paddingHorizontal: t.space.lg, paddingTop: t.space.md },
  cardTitle: { flex: 1, color: t.c.text, fontSize: t.font.size.lg, fontWeight: '700' },
  desc: { color: t.c.text, fontSize: t.font.size.md },
}));
