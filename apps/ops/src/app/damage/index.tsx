import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, Muted, Badge, Row, Empty, Button } from '../../components/ui';
import { SyncPill } from '../../components/SyncPill';
import { useMirror } from '../../lib/useMirror';
import { getDamageReports, getVehicles } from '../../offline/repo';
import { relativeTime } from '@penny/ui';
import { useTheme, makeStyles } from '../../brand';
import type { DamageReport } from '@penny/db-types';
import type { OpsVehicle } from '../../lib/types';

const FILTERS = ['all', 'new', 'confirmed', 'fixed'] as const;

export default function DamageList() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;
  const STATUS_COLOR: Record<string, string> = { new: c.warning, confirmed: c.primary, fixed: c.success, rejected: c.textFaint };
  const SEV_COLOR: Record<string, string> = { low: c.surfaceAlt, medium: c.warning, high: c.danger, critical: c.danger };
  const reports = useMirror(getDamageReports, [] as DamageReport[]);
  const vehicles = useMirror(getVehicles, [] as OpsVehicle[]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const vmap = useMemo(() => new Map(vehicles.data.map((v) => [v.id, v])), [vehicles.data]);

  const filtered = reports.data.filter((r) => (filter === 'all' ? true : r.status === filter));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={st.header}>
        <SyncPill />
        <Button title="+ New" variant="secondary" onPress={() => router.push('/damage/new')} />
      </View>
      <View style={st.filterRow}>
        {FILTERS.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[st.chip, filter === f && st.chipOn]}>
            <Text style={[st.chipText, filter === f && st.chipTextOn]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxxl }}
        ListEmptyComponent={<Empty text="No damage reports." />}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/damage/${item.id}`)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={st.code}>{vmap.get(item.vehicle_id)?.code ?? 'Vehicle'}</Text>
              <Row gap={6}>
                <Badge label={item.severity} color={SEV_COLOR[item.severity]} textColor={item.severity === 'low' ? c.text : c.onDanger} />
                <Badge label={item.status} color={STATUS_COLOR[item.status]} textColor={item.status === 'new' ? c.onWarning : c.onPrimary} />
              </Row>
            </Row>
            <Text style={st.desc} numberOfLines={2}>{item.description}</Text>
            <Row style={{ justifyContent: 'space-between' }}>
              <Muted>by {item.reporter} · {relativeTime(item.created_at)}</Muted>
              {item.penalty_payment_id ? <Badge label="penalty→review" color={c.danger} textColor={c.onDanger} /> : null}
            </Row>
          </Card>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: t.space.md, backgroundColor: t.c.surface },
  filterRow: { flexDirection: 'row', gap: t.space.sm, padding: t.space.sm, backgroundColor: t.c.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.c.border },
  chip: { paddingHorizontal: t.space.md, paddingVertical: 6, borderRadius: t.radius.pill, backgroundColor: t.c.surfaceAlt, borderWidth: 1, borderColor: t.c.border },
  chipOn: { backgroundColor: t.c.primary, borderColor: t.c.primary },
  chipText: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '700', textTransform: 'capitalize' },
  chipTextOn: { color: t.c.onPrimary },
  code: { color: t.c.text, fontWeight: '700', fontSize: t.font.size.md },
  desc: { color: t.c.text, fontSize: t.font.size.md },
}));
