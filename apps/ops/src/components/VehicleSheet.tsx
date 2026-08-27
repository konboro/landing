// The vehicle bottom sheet — what a mechanic gets the instant they tap a pin or
// a fleet row. It answers the three questions asked while standing next to the
// scooter (where is it / is this the right one / what state is it in) and offers
// the three actions taken without ever leaving the map: navigate, ring, restate.
//
// It deliberately does NOT re-implement `app/vehicle/[id]`: that screen owns the
// long tail (full telemetry, note thread, service history, device swap). Every
// entry under "More" routes there instead of duplicating it, so there is exactly
// one implementation of each flow.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { formatSoc, socColor } from '@penny/ui';
import { BottomSheet, Icon, Badge, type IconName } from './ui';
import { useBrand, useTheme, makeStyles, withAlpha, type OpsTheme } from '../brand';
import { sendCommand } from '../offline/actions';
import { navigateTo } from '../lib/nav';
import { useOps } from '../lib/store';
import { hasAlarm } from './FleetMap';
import { VehicleStatus } from '@penny/db-types';
import type { OpsVehicle } from '../lib/types';

/** How long the "queued" confirmation stays up after a command is enqueued. */
const PULSE_MS = 1600;

// ---------------------------------------------------------------------------
// Shared vehicle presentation — also used by the fleet list rows.
// ---------------------------------------------------------------------------

/**
 * The mirror has no vehicle photo column yet (`photo_url` lives on
 * `vehicle_models`, and the ops bootstrap does not carry it). Read it
 * defensively so the day it starts arriving the thumbnail lights up without a
 * change here, and fall back to the status-tinted placeholder until then.
 */
export function vehiclePhotoUri(v: OpsVehicle): string | null {
  const candidate = (v as OpsVehicle & { photo_url?: string | null }).photo_url;
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  // `placeholder://` URIs (PhotoCapture without a camera) make <Image> log a
  // decode error on every render — only hand it schemes it can actually load.
  return /^(https?|file|data|content|asset|ph):/i.test(candidate) ? candidate : null;
}

/** The word the crew says out loud for a status, from the brand legend. */
export function labelForStatus(theme: OpsTheme, status: string): string {
  return theme.legend.find((l) => l.status === status)?.label ?? status.replace(/_/g, ' ');
}

/**
 * Compact staleness for a row read at arm's length: minutes for the first hour,
 * then hours, then days. `relativeTime` from @penny/ui is wordier than a stat
 * cell can afford ("34m ago" vs "34 min" under a "Last seen" caption).
 */
export function sinceLabel(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  // Device clocks drift (Hard Rule #9); a future timestamp reads as "now"
  // rather than as a negative age.
  if (!Number.isFinite(ms) || ms < 60_000) return 'now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

function kindIcon(kind: string): IconName {
  return kind.toLowerCase().includes('bike') ? 'bike' : 'scooter';
}

/** Photo thumbnail, or a status-tinted silhouette when there is no photo. */
export function VehicleThumb({ vehicle, size = 56 }: { vehicle: OpsVehicle; size?: number }) {
  const theme = useTheme();
  const uri = vehiclePhotoUri(vehicle);
  const tint = theme.colorForStatus(vehicle.status);
  const box = {
    width: size,
    height: size,
    borderRadius: theme.radius.md,
    backgroundColor: withAlpha(tint, 0.18),
    borderWidth: 1,
    borderColor: withAlpha(tint, 0.55),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    opacity: vehicle.visible ? 1 : 0.55,
  };
  if (uri) {
    return <Image source={{ uri }} style={{ ...box, backgroundColor: theme.c.surfaceAlt }} resizeMode="cover" />;
  }
  return (
    <View style={box}>
      <Icon name={kindIcon(vehicle.kind)} size={Math.round(size * 0.52)} color={tint} />
    </View>
  );
}

interface StatCell {
  icon: IconName;
  value: string;
  label: string;
  color: string;
}

function statCells(v: OpsVehicle, theme: OpsTheme): StatCell[] {
  const { c } = theme;
  const soc = socColor(v.soc_pct);
  return [
    {
      icon: 'battery',
      value: formatSoc(v.soc_pct),
      label: 'Battery',
      color: soc === 'ok' ? c.success : soc === 'warn' ? c.warning : c.danger,
    },
    {
      icon: v.locked ? 'lock' : 'unlock',
      value: v.locked ? 'Locked' : 'Open',
      label: 'Lock',
      color: v.locked ? c.text : c.warning,
    },
    {
      // The mirror carries no RSSI/CSQ — `online` (has the device reported
      // recently) is the only link-quality signal the field app has, so it is
      // shown as a state rather than as the reference app's fake percentage.
      icon: 'signal',
      value: v.online ? 'Online' : 'Offline',
      label: 'IoT',
      color: v.online ? c.success : c.textMuted,
    },
    { icon: 'clock', value: sinceLabel(v.last_seen), label: 'Last seen', color: c.text },
  ];
}

/** The four numbers that decide whether this vehicle needs a hand, or not. */
export function VehicleStatGrid({ vehicle, compact = false }: { vehicle: OpsVehicle; compact?: boolean }) {
  const theme = useTheme();
  const st = useStyles(theme);
  return (
    <View style={compact ? st.statRowCompact : st.statRow}>
      {statCells(vehicle, theme).map((cell) => (
        <View key={cell.label} style={compact ? st.statCellCompact : st.statCell}>
          <View style={st.statValueRow}>
            <Icon name={cell.icon} size={compact ? 15 : 18} color={cell.color} strokeWidth={2} />
            <Text
              style={[compact ? st.statValueCompact : st.statValue, { color: cell.color }]}
              numberOfLines={1}
            >
              {cell.value}
            </Text>
          </View>
          {compact ? null : <Text style={st.statLabel}>{cell.label}</Text>}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export interface VehicleSheetProps {
  vehicle: OpsVehicle | null;
  open: boolean;
  onClose: () => void;
  /**
   * The status sheet is owned by the PARENT, not opened from in here: both are
   * RN Modals, and presenting one while the other is still dismissing is the
   * classic iOS "already presenting" failure. The parent closes this sheet,
   * then opens that one. `preselect` lets an entry like Decommission land on
   * its row instead of making the user find it.
   */
  onChangeStatus: (v: OpsVehicle, preselect?: VehicleStatus) => void;
}

export function VehicleSheet({ vehicle, open, onClose, onChangeStatus }: VehicleSheetProps) {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const { isEnabled } = useBrand();
  const role = useOps((s) => s.session?.role ?? 'ops');
  const isAdmin = role === 'admin' || role === 'ops_manager';
  const [expanded, setExpanded] = useState(false);
  const [pulse, setPulse] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "More" is collapsed for each visit: the expanded state belongs to the visit,
  // not to the component, and a sheet that reopens half-scrolled reads as stale.
  useEffect(() => {
    setExpanded(false);
  }, [open, vehicle?.id]);

  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    },
    [],
  );

  const command = useCallback(
    async (v: OpsVehicle, kind: Parameters<typeof sendCommand>[1], label: string) => {
      await sendCommand(v, kind);
      setPulse(label);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(null), PULSE_MS);
    },
    [],
  );

  /** Leaving for another screen must not leave the sheet stacked underneath. */
  const go = useCallback(
    (run: () => void) => {
      onClose();
      run();
    },
    [onClose],
  );

  if (!vehicle) return null;
  const v = vehicle;
  const statusTint = theme.colorForStatus(v.status);

  const moreActions: { key: string; icon: IconName; label: string; onPress: () => void; danger?: boolean }[] = [
    {
      key: 'lock',
      icon: v.locked ? 'unlock' : 'lock',
      label: v.locked ? 'Unlock' : 'Lock',
      onPress: () => void command(v, v.locked ? 'unlock' : 'lock', v.locked ? 'unlock' : 'lock'),
    },
    { key: 'locate', icon: 'locate', label: 'Locate', onPress: () => void command(v, 'locate', 'locate') },
    { key: 'reboot', icon: 'refresh', label: 'Reboot', onPress: () => void command(v, 'reboot', 'reboot') },
    { key: 'notes', icon: 'note', label: 'Notes', onPress: () => go(() => router.push(`/vehicle/${v.id}/notes`)) },
    {
      // The LIST scoped to this vehicle, not the report form — "Damages" on a
      // vehicle means "what is wrong with it", and the list has its own + button.
      key: 'damage',
      icon: 'alert',
      label: 'Damages',
      onPress: () => go(() => router.push({ pathname: '/damage', params: { vehicleId: v.id } })),
    },
    {
      key: 'report',
      icon: 'camera',
      label: 'Report damage',
      onPress: () => go(() => router.push({ pathname: '/damage/new', params: { vehicleId: v.id } })),
    },
    { key: 'last-ride', icon: 'route', label: 'Last ride', onPress: () => go(() => router.push(`/vehicle/${v.id}/last-ride`)) },
    { key: 'history', icon: 'history', label: 'History', onPress: () => go(() => router.push(`/vehicle/${v.id}/history`)) },
  ];
  if (isEnabled('opsDeviceSwap')) {
    moreActions.push({
      key: 'swap',
      icon: 'settings',
      label: 'Swap device',
      onPress: () => go(() => router.push(`/vehicle/${v.id}/swap-device`)),
    });
  }
  if (isAdmin) {
    // Decommission is a status transition in the matrix (admin-only, photo +
    // reason required), so it goes through the status sheet rather than a
    // second confirm dialog that would bypass those requirements.
    moreActions.push({
      key: 'decommission',
      icon: 'trash',
      label: 'Decommission',
      danger: true,
      onPress: () => onChangeStatus(v, VehicleStatus.decommissioned),
    });
  }

  return (
    <BottomSheet open={open} onClose={onClose} snapPoints={[0.58, 0.92]} initialSnap={0}>
      <ScrollView style={st.scroll} contentContainerStyle={st.sheetBody} keyboardShouldPersistTaps="handled">
        <View style={st.headRow}>
          <VehicleThumb vehicle={v} size={72} />
          <View style={st.headText}>
            <Text style={st.code} numberOfLines={1}>
              № {v.code}
            </Text>
            <Text style={[st.statusLine, { color: statusTint }]} numberOfLines={1}>
              {labelForStatus(theme, v.status)}
            </Text>
            <Text style={st.model} numberOfLines={1}>
              {v.model_name}
            </Text>
          </View>
        </View>

        {(hasAlarm(v) || !v.visible) && (
          <View style={st.badgeRow}>
            {v.fall && <Badge label="fall" color={c.danger} textColor={c.onDanger} />}
            {v.power_cut && <Badge label="power cut" color={c.danger} textColor={c.onDanger} />}
            {v.moved_while_locked && <Badge label="moved while locked" color={c.danger} textColor={c.onDanger} />}
            {!v.visible && <Badge label="hidden" color={c.surfaceAlt} />}
          </View>
        )}

        <VehicleStatGrid vehicle={v} />

        {pulse ? (
          <View style={st.pulse}>
            <Icon name="check" size={16} color={c.onPrimary} strokeWidth={2.4} />
            <Text style={st.pulseText}>Queued: {pulse} — sends when online</Text>
          </View>
        ) : null}

        <View style={st.quickRow}>
          <QuickAction
            icon="navigate"
            label="Navigate"
            disabled={!v.pos}
            onPress={() => {
              if (v.pos) void navigateTo(v.pos, v.code);
            }}
          />
          <QuickAction icon="ring" label="Ring" onPress={() => void command(v, 'ring', 'ring')} />
          <QuickAction
            icon={expanded ? 'chevronUp' : 'more'}
            label="More"
            active={expanded}
            onPress={() => setExpanded((e) => !e)}
          />
        </View>

        {expanded ? (
          <View style={st.moreCard}>
            {moreActions.map((a, i) => (
              <Pressable
                key={a.key}
                onPress={a.onPress}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={({ pressed }) => [
                  st.moreRow,
                  i > 0 && st.moreRowDivided,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Icon name={a.icon} size={22} color={a.danger ? c.danger : c.text} />
                <Text style={[st.moreLabel, a.danger && { color: c.danger }]}>{a.label}</Text>
                <Icon name="chevron" size={18} color={c.textFaint} />
              </Pressable>
            ))}
            <Text style={st.serviceNote}>Lock / unlock run in service mode — never billed.</Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => onChangeStatus(v)}
          accessibilityRole="button"
          accessibilityLabel="Change status"
          style={({ pressed }) => [st.cta, pressed && { opacity: 0.75 }]}
        >
          <Text style={st.ctaTitle}>CHANGE STATUS</Text>
          <Text style={st.ctaSub}>Now: {labelForStatus(theme, v.status)}</Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  disabled,
  active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        st.quick,
        active && { borderColor: theme.c.primary },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={24} color={active ? theme.c.primary : theme.c.text} />
      <Text style={[st.quickLabel, active && { color: theme.c.primary }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  // Bounded by the sheet: an unbounded ScrollView takes its content height and
  // the sheet stops being able to scroll at its shorter snap point.
  scroll: { flex: 1 },
  sheetBody: { padding: t.space.lg, paddingBottom: t.space.xxxl, gap: t.space.md },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  headText: { flex: 1, gap: 2 },
  code: { color: t.c.text, fontSize: t.font.size.xxl, fontWeight: '800' },
  statusLine: { fontSize: t.font.size.md, fontWeight: '700' },
  model: { color: t.c.textMuted, fontSize: t.font.size.sm },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs },

  statRow: {
    flexDirection: 'row',
    backgroundColor: t.c.surfaceAlt,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.c.border,
    paddingVertical: t.space.sm,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statRowCompact: { flexDirection: 'row', gap: t.space.md },
  statCellCompact: { flexDirection: 'row', alignItems: 'center' },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: t.font.size.md, fontWeight: '800' },
  statValueCompact: { fontSize: t.font.size.sm, fontWeight: '700' },
  statLabel: { color: t.c.textMuted, fontSize: t.font.size.xs },

  pulse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.xs,
    backgroundColor: t.c.primaryDeep,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
  },
  pulseText: { color: t.c.onPrimary, fontSize: t.font.size.sm, fontWeight: '700', flex: 1 },

  quickRow: { flexDirection: 'row', gap: t.space.sm },
  quick: {
    flex: 1,
    minHeight: t.tap.fab,
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.lg,
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1.5,
    borderColor: t.c.border,
  },
  quickLabel: { color: t.c.text, fontSize: t.font.size.sm, fontWeight: '700' },

  moreCard: {
    backgroundColor: t.c.surfaceAlt,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.c.border,
    paddingHorizontal: t.space.md,
  },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: t.tap.row },
  moreRowDivided: { borderTopWidth: 1, borderColor: t.c.border },
  moreLabel: { flex: 1, color: t.c.text, fontSize: t.font.size.md, fontWeight: '600' },
  serviceNote: {
    color: t.c.textFaint,
    fontSize: t.font.size.xs,
    paddingVertical: t.space.sm,
    borderTopWidth: 1,
    borderColor: t.c.border,
  },

  cta: {
    minHeight: t.tap.fab,
    borderRadius: t.radius.lg,
    backgroundColor: t.c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  ctaTitle: { color: t.c.onPrimary, fontSize: t.font.size.md, fontWeight: '800', letterSpacing: 0.6 },
  ctaSub: { color: t.c.onPrimary, fontSize: t.font.size.xs, opacity: 0.85 },
}));
