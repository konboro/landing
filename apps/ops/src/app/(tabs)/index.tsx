// The fleet screen — map and list are two lenses on ONE filtered set, not two
// screens. Everything a field crew does starts here: find the scooter (search /
// QR / pin), see its state at a glance, act on it in the sheet.
//
// Offline-first consequences visible in this file:
//   * data comes from the SQLite mirror via `useMirror`, never from the network;
//   * pull-to-refresh nudges the sync worker and re-reads the mirror — it can
//     never block on a request, because there may not be one;
//   * "only mine" is derived from the tasks assigned to me, since a vehicle has
//     no owner column — the task is what makes it mine today.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { FleetMap, hasAlarm, type MapLayers } from '../../components/FleetMap';
import { SyncPill } from '../../components/SyncPill';
import {
  VehicleSheet,
  VehicleThumb,
  VehicleStatGrid,
  labelForStatus,
} from '../../components/VehicleSheet';
import { StatusSheet } from '../../components/StatusSheet';
import {
  BottomSheet,
  ChipGroup,
  Icon,
  SearchBar,
  SegmentedControl,
  Button,
  Badge,
  Empty,
  type IconName,
  type SegmentOption,
} from '../../components/ui';
import { useMirror } from '../../lib/useMirror';
import { getVehicles, getZones, getHeatCells, getMyTasks } from '../../offline/repo';
import { nudgeSync } from '../../offline/sync';
import { getCurrentPos } from '../../lib/geoloc';
import { useTheme, makeStyles } from '../../brand';
import type { OpsVehicle } from '../../lib/types';
import type { LngLat, OpsTask, VehicleStatus } from '@penny/db-types';

/**
 * Below this the vehicle is a swap candidate. Per-model thresholds are
 * configured server-side (`battery_curves` / model config) and are not mirrored
 * to the device, so the field filter uses one conservative default rather than
 * pretending to know the model's curve.
 */
const LOW_SOC_PCT = 20;

/** iOS cannot present a modal while another is still dismissing. */
const SHEET_HANDOFF_MS = 260;

const MODES: SegmentOption[] = [
  { key: 'map', label: 'Map', icon: 'map' },
  { key: 'list', label: 'List', icon: 'list' },
];

const LAYER_DEFS: { key: keyof MapLayers; label: string; hint: string }[] = [
  { key: 'showAlarms', label: 'Alarms', hint: 'Ring pins with fall / power-cut / moved alerts' },
  { key: 'showZones', label: 'Rebalancing zones', hint: 'Target vs current counts' },
  { key: 'showHeatmap', label: 'Idle heat', hint: 'Where vehicles have sat unused' },
  { key: 'showHidden', label: 'Hidden vehicles', hint: 'visible = false (staged, held)' },
];

interface FleetFilters {
  statuses: string[];
  onlyMine: boolean;
  lowBattery: boolean;
  offline: boolean;
  alarm: boolean;
}

const NO_FILTERS: FleetFilters = {
  statuses: [],
  onlyMine: false,
  lowBattery: false,
  offline: false,
  alarm: false,
};

function activeFilterCount(f: FleetFilters): number {
  return f.statuses.length + [f.onlyMine, f.lowBattery, f.offline, f.alarm].filter(Boolean).length;
}

function isLowBattery(v: OpsVehicle): boolean {
  return v.status === 'low_battery' || (v.soc_pct != null && v.soc_pct < LOW_SOC_PCT);
}

export default function FleetTab() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;

  const vehicles = useMirror(getVehicles, [] as OpsVehicle[]);
  const zones = useMirror(getZones, []);
  const heat = useMirror(getHeatCells, []);
  const myTasks = useMirror(getMyTasks, [] as OpsTask[]);

  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FleetFilters>(NO_FILTERS);
  const [layers, setLayers] = useState<MapLayers>({
    showAlarms: true,
    showZones: true,
    showHeatmap: false,
    showHidden: true,
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [preselectStatus, setPreselectStatus] = useState<VehicleStatus | null>(null);
  const [center, setCenter] = useState<LngLat | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Measured, not guessed: the map's no-token fallback renders its own list and
  // would otherwise start underneath the floating controls.
  const [controlsH, setControlsH] = useState(0);
  const handoff = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (handoff.current) clearTimeout(handoff.current);
    },
    [],
  );

  const mineVehicleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of myTasks.data) if (t.vehicle_id) ids.add(t.vehicle_id);
    return ids;
  }, [myTasks.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = vehicles.data.filter((v) => {
      if (q && !v.code.toLowerCase().includes(q)) return false;
      if (filters.statuses.length > 0 && !filters.statuses.includes(v.status)) return false;
      if (filters.onlyMine && !mineVehicleIds.has(v.id)) return false;
      if (filters.lowBattery && !isLowBattery(v)) return false;
      if (filters.offline && v.online) return false;
      if (filters.alarm && !hasAlarm(v)) return false;
      return true;
    });
    // Anything screaming for attention floats to the top; the rest is by code,
    // because that is the order a crew reads a van manifest in.
    return list.sort((a, b) => {
      const alarmDelta = Number(hasAlarm(b)) - Number(hasAlarm(a));
      if (alarmDelta !== 0) return alarmDelta;
      return a.code.localeCompare(b.code, undefined, { numeric: true });
    });
  }, [vehicles.data, query, filters, mineVehicleIds]);

  const selected = useMemo(
    // Re-read from the mirror list rather than storing the object, so the sheet
    // reflects a status change (or an incoming telemetry patch) immediately.
    () => vehicles.data.find((v) => v.id === selectedId) ?? null,
    [vehicles.data, selectedId],
  );

  const openVehicle = useCallback((v: OpsVehicle) => {
    setSelectedId(v.id);
    setSheetOpen(true);
  }, []);

  const openStatusSheet = useCallback((v: OpsVehicle, preselect?: VehicleStatus) => {
    setSelectedId(v.id);
    setPreselectStatus(preselect ?? null);
    setSheetOpen(false);
    if (handoff.current) clearTimeout(handoff.current);
    handoff.current = setTimeout(() => setStatusOpen(true), SHEET_HANDOFF_MS);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Nudge, don't await a pull: offline this returns instantly and the mirror
    // re-read below is still the honest answer to "what do I know right now".
    await nudgeSync();
    vehicles.reload();
    myTasks.reload();
    zones.reload();
    heat.reload();
    setRefreshing(false);
  }, [vehicles, myTasks, zones, heat]);

  const locateMe = useCallback(async () => {
    const { pos } = await getCurrentPos();
    setCenter(pos);
  }, []);

  /** Typing a full code and hitting search should just open it. */
  const onSubmitSearch = useCallback(() => {
    const exact = filtered.find((v) => v.code.toLowerCase() === query.trim().toLowerCase());
    const only = filtered.length === 1 ? filtered[0] : undefined;
    const hit = exact ?? only;
    if (hit) openVehicle(hit);
  }, [filtered, query, openVehicle]);

  const filterCount = activeFilterCount(filters);
  const controls = (
    <View
      style={[st.controls, mode === 'list' && st.controlsSolid]}
      // Only the actual controls swallow touches — the gaps between them belong
      // to the map underneath.
      pointerEvents="box-none"
      onLayout={(e) => setControlsH(e.nativeEvent.layout.height)}
    >
      <View style={st.controlRow}>
        <SegmentedControl
          options={MODES}
          value={mode}
          onChange={(k) => setMode(k === 'list' ? 'list' : 'map')}
          style={st.segmented}
        />
        <SyncPill />
      </View>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={onSubmitSearch}
        placeholder="Search by №"
        trailing={
          <>
            <RoundButton icon="qr" label="Scan QR" onPress={() => router.push('/scan')} />
            <RoundButton
              icon="filter"
              label="Filters"
              badge={filterCount}
              active={filterCount > 0}
              onPress={() => setFilterOpen(true)}
            />
          </>
        }
      />
    </View>
  );

  return (
    <View style={st.screen}>
      {mode === 'map' ? (
        <View style={st.mapWrap}>
          <FleetMap
            vehicles={filtered}
            zones={zones.data}
            heat={heat.data}
            layers={layers}
            center={center}
            contentInsetTop={controlsH}
            onSelect={openVehicle}
          />
          <View style={st.floatTop} pointerEvents="box-none">
            {controls}
          </View>
          <View style={st.rail} pointerEvents="box-none">
            <RoundButton
              icon="filter"
              label="Filters"
              size="fab"
              badge={filterCount}
              active={filterCount > 0}
              onPress={() => setFilterOpen(true)}
            />
            <RoundButton icon="qr" label="Scan QR" size="fab" onPress={() => router.push('/scan')} />
            <RoundButton icon="layers" label="Layers" size="fab" onPress={() => setLayersOpen(true)} />
            <RoundButton icon="locate" label="Centre on me" size="fab" onPress={() => void locateMe()} />
          </View>
        </View>
      ) : (
        <View style={st.listWrap}>
          {controls}
          <FlatList
            data={filtered}
            keyExtractor={(v) => v.id}
            renderItem={({ item }) => <FleetRow vehicle={item} onPress={openVehicle} />}
            contentContainerStyle={st.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={c.text} colors={[c.primary]} />
            }
            ListEmptyComponent={
              vehicles.loading ? null : vehicles.data.length === 0 ? (
                <Empty text="No vehicles in the local mirror yet. Pull down to sync." />
              ) : (
                <View style={st.emptyBox}>
                  <Empty text={`No vehicle matches${query ? ` “${query}”` : ''}${filterCount > 0 ? ' with these filters' : ''}.`} />
                  {filterCount > 0 || query ? (
                    <Button
                      title="Clear search & filters"
                      variant="secondary"
                      onPress={() => {
                        setQuery('');
                        setFilters(NO_FILTERS);
                      }}
                    />
                  ) : null}
                </View>
              )
            }
          />
        </View>
      )}

      <VehicleSheet
        vehicle={selected}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onChangeStatus={openStatusSheet}
      />

      <StatusSheet
        vehicle={selected}
        open={statusOpen}
        initialStatus={preselectStatus}
        onClose={() => setStatusOpen(false)}
      />

      <BottomSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filter fleet"
        snapPoints={[0.6, 0.92]}
        initialSnap={1}
      >
        <View style={st.sheetBody}>
          <ScrollView style={st.grow} contentContainerStyle={st.sheetScroll} keyboardShouldPersistTaps="handled">
            <Text style={st.sectionTitle}>Status</Text>
            <ChipGroup
              options={theme.legend.map((l) => ({ key: l.status, label: l.label }))}
              multiple
              value={filters.statuses}
              onChange={(statuses) => setFilters((f) => ({ ...f, statuses }))}
            />

            <Text style={st.sectionTitle}>Only show</Text>
            <ToggleRow
              label="Only mine"
              hint="Vehicles on a task assigned to me"
              value={filters.onlyMine}
              onChange={(onlyMine) => setFilters((f) => ({ ...f, onlyMine }))}
            />
            <ToggleRow
              label="Low battery"
              hint={`Under ${LOW_SOC_PCT}% or flagged discharged`}
              value={filters.lowBattery}
              onChange={(lowBattery) => setFilters((f) => ({ ...f, lowBattery }))}
            />
            <ToggleRow
              label="Offline"
              hint="Device has not reported recently"
              value={filters.offline}
              onChange={(offline) => setFilters((f) => ({ ...f, offline }))}
            />
            <ToggleRow
              label="Has alarm"
              hint="Fall, power cut, moved while locked, stolen-suspect"
              value={filters.alarm}
              onChange={(alarm) => setFilters((f) => ({ ...f, alarm }))}
            />
          </ScrollView>
          <View style={st.sheetFooter}>
            <Button title="Clear all" variant="ghost" onPress={() => setFilters(NO_FILTERS)} disabled={filterCount === 0} />
            <Button title={`Show ${filtered.length}`} onPress={() => setFilterOpen(false)} style={st.grow} />
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        title="Map layers"
        snapPoints={[0.5]}
        initialSnap={0}
      >
        <View style={st.sheetBody}>
          <ScrollView style={st.grow} contentContainerStyle={st.sheetScroll}>
            {LAYER_DEFS.map((l) => (
              <ToggleRow
                key={l.key}
                label={l.label}
                hint={l.hint}
                value={layers[l.key]}
                onChange={(next) => setLayers((prev) => ({ ...prev, [l.key]: next }))}
              />
            ))}
          </ScrollView>
        </View>
      </BottomSheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function FleetRow({ vehicle, onPress }: { vehicle: OpsVehicle; onPress: (v: OpsVehicle) => void }) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const tint = theme.colorForStatus(vehicle.status);
  return (
    <Pressable
      onPress={() => onPress(vehicle)}
      accessibilityRole="button"
      accessibilityLabel={`Vehicle ${vehicle.code}, ${labelForStatus(theme, vehicle.status)}`}
      style={({ pressed }) => [st.row, pressed && { opacity: 0.7 }]}
    >
      <VehicleThumb vehicle={vehicle} size={56} />
      <View style={st.rowBody}>
        <View style={st.rowTitle}>
          <Text style={st.rowCode} numberOfLines={1}>
            № {vehicle.code}
          </Text>
          <Text style={[st.rowStatus, { color: tint }]} numberOfLines={1}>
            {labelForStatus(theme, vehicle.status)}
          </Text>
          {hasAlarm(vehicle) ? <Badge label="alarm" color={c.danger} textColor={c.onDanger} /> : null}
          {!vehicle.visible ? <Badge label="hidden" color={c.surfaceAlt} /> : null}
        </View>
        <VehicleStatGrid vehicle={vehicle} compact />
      </View>
      <Icon name="chevron" size={18} color={c.textFaint} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function RoundButton({
  icon,
  label,
  onPress,
  badge,
  active,
  size = 'md',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
  active?: boolean;
  size?: 'md' | 'fab';
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        size === 'fab' ? st.fab : st.roundBtn,
        active && { borderColor: theme.c.primary },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={size === 'fab' ? 24 : 22} color={active ? theme.c.primary : theme.c.text} />
      {badge && badge > 0 ? (
        <View style={st.badgeDot}>
          <Text style={st.badgeDotText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={({ pressed }) => [st.toggleRow, value && { borderColor: theme.c.primary }, pressed && { opacity: 0.7 }]}
    >
      <View style={st.toggleText}>
        <Text style={st.toggleLabel}>{label}</Text>
        {hint ? <Text style={st.toggleHint}>{hint}</Text> : null}
      </View>
      <View style={[st.checkbox, value && { backgroundColor: theme.c.primary, borderColor: theme.c.primary }]}>
        {value ? <Icon name="check" size={16} color={theme.c.onPrimary} strokeWidth={2.6} /> : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.c.bg },
  mapWrap: { flex: 1 },
  listWrap: { flex: 1 },

  controls: { gap: t.space.sm, paddingHorizontal: t.space.md, paddingVertical: t.space.sm },
  // Over the map the controls float; in list mode they are the header, so they
  // need a ground of their own or the rows scroll visibly under the search bar.
  controlsSolid: { backgroundColor: t.c.surface, borderBottomWidth: 1, borderColor: t.c.border },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  segmented: { flex: 1 },
  floatTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  rail: {
    position: 'absolute',
    right: t.space.md,
    bottom: t.space.xxl,
    gap: t.space.sm,
  },

  roundBtn: {
    width: t.tap.min,
    height: t.tap.min,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  fab: {
    width: t.tap.fab,
    height: t.tap.fab,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
    // The map behind can be any colour; a shadow is what keeps the button
    // readable over a satellite tile as well as over a dark street map.
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  badgeDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: t.c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDotText: { color: t.c.onPrimary, fontSize: t.font.size.xs, fontWeight: '800' },

  listContent: { padding: t.space.md, gap: t.space.sm, paddingBottom: t.space.xxxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    minHeight: t.tap.row + 8,
    padding: t.space.md,
    borderRadius: t.radius.lg,
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  rowBody: { flex: 1, gap: 6 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' },
  rowCode: { color: t.c.text, fontSize: t.font.size.lg, fontWeight: '800' },
  rowStatus: { fontSize: t.font.size.sm, fontWeight: '700' },
  emptyBox: { gap: t.space.md, padding: t.space.lg },

  sheetBody: { flex: 1 },
  sheetScroll: { padding: t.space.lg, gap: t.space.sm, paddingBottom: t.space.xl },
  sheetFooter: {
    flexDirection: 'row',
    gap: t.space.sm,
    padding: t.space.lg,
    borderTopWidth: 1,
    borderColor: t.c.border,
    backgroundColor: t.c.surface,
  },
  grow: { flex: 1 },
  sectionTitle: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '700', marginTop: t.space.sm },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    minHeight: t.tap.row,
    paddingHorizontal: t.space.md,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
    borderColor: t.c.border,
    backgroundColor: t.c.surfaceAlt,
  },
  toggleText: { flex: 1, gap: 1, paddingVertical: t.space.sm },
  toggleLabel: { color: t.c.text, fontSize: t.font.size.md, fontWeight: '700' },
  toggleHint: { color: t.c.textMuted, fontSize: t.font.size.xs },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: t.c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
