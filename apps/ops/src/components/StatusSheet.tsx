// "Set status" — the single sheet that changes what a vehicle IS.
//
// Design rules that are not obvious from the markup:
//
//  * Every status in the brand legend gets a row, including the ones you cannot
//    pick right now. A crew member has to be able to SEE that `in_trip` exists
//    and is not theirs to set; hiding it just gets asked about over the radio.
//  * `in_trip` / `reserved` belong to the trip engine (docs/07, migration 00390)
//    and are permanently disabled here — the ops app must never fake a rider
//    state, because `trips.status` is a cache of `trip_events` (Hard Rule #4).
//  * The transition matrix (`lib/status-matrix.ts`, from docs/07) is honoured
//    exactly where it has an opinion. It predates the four field-service
//    statuses, so those are handled by an explicit fallback — see
//    `resolveTransition`.
//  * The change is queued, never sent directly: `changeStatus` writes the mirror
//    + `vehicle_status_log` + one outbox row, and the edge function re-validates
//    on sync (server wins on vehicle status).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { BottomSheet, Icon, Badge, Button, Field, StatusDot } from './ui';
import { PhotoButton, PhotoStrip } from './PhotoCapture';
import { useTheme, makeStyles, withAlpha } from '../brand';
import { changeStatus } from '../offline/actions';
import { getCurrentPos } from '../lib/geoloc';
import { useOps } from '../lib/store';
import { findTransition, STOLEN_CONFIRM_EFFECTS, type OpsRole, type Transition } from '../lib/status-matrix';
import { labelForStatus } from './VehicleSheet';
import { VehicleStatus } from '@penny/db-types';
import type { OpsVehicle } from '../lib/types';

/** Owned by the trip engine. Never settable from the field app. */
const TRIP_ENGINE_OWNED: string[] = [VehicleStatus.in_trip, VehicleStatus.reserved];

/**
 * The vocabulary docs/07's transition matrix actually reasons about. Anything
 * outside this set arrived with migration 00390 (charging / storage / not_ready
 * / needs_investigation), which explicitly says it is an ADDITION to the matrix
 * rather than a replacement — so the matrix has no row for it in either
 * direction and would otherwise make those statuses one-way traps.
 */
const MATRIX_VOCABULARY: string[] = [
  VehicleStatus.available,
  VehicleStatus.maintenance,
  VehicleStatus.transport,
  VehicleStatus.low_battery,
  VehicleStatus.offline,
  VehicleStatus.stolen,
  VehicleStatus.decommissioned,
  VehicleStatus.in_trip,
  VehicleStatus.reserved,
];

function isFieldServiceStatus(status: string): boolean {
  return !MATRIX_VOCABULARY.includes(status);
}

/**
 * The transition to apply, or null when this move is not the field app's to
 * make. Order matters: the matrix wins wherever it has an entry.
 */
function resolveTransition(from: VehicleStatus, to: VehicleStatus, role: OpsRole): Transition | null {
  if (from === to) return null;
  if (TRIP_ENGINE_OWNED.includes(to)) return null;
  const known = findTransition(from, to, role);
  if (known) return known;
  // Decommission is destructive and admin-only; it exists in the matrix, so a
  // missing entry there means "not allowed", never "fall through".
  if (to === VehicleStatus.decommissioned) return null;
  if (!isFieldServiceStatus(from) && !isFieldServiceStatus(to)) return null;
  // Field-service move the matrix does not cover yet. A reason is required
  // precisely BECAUSE the rule is undocumented: the log row has to say why a
  // human made this call, and the edge function still has the final word.
  return {
    to,
    label: `Set ${to.replace(/_/g, ' ')}`,
    requiresPhoto: false,
    requiresChecklist: false,
    requiresReason: true,
    adminReview: false,
    adminOnly: false,
  };
}

export interface StatusSheetProps {
  vehicle: OpsVehicle | null;
  open: boolean;
  onClose: () => void;
  /** Land on a specific row (e.g. opened from "Decommission"). */
  initialStatus?: VehicleStatus | null;
  onApplied?: (to: VehicleStatus) => void;
}

export function StatusSheet({ vehicle, open, onClose, initialStatus, onApplied }: StatusSheetProps) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const role = (useOps((s) => s.session?.role) ?? 'ops') as OpsRole;
  const [target, setTarget] = useState<VehicleStatus | null>(null);
  const [reason, setReason] = useState('');
  const [police, setPolice] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // A sheet is a fresh form every time it opens; carrying a half-typed reason
  // from the previous vehicle into this one would be an audit-log hazard.
  useEffect(() => {
    setTarget(open ? (initialStatus ?? null) : null);
    setReason('');
    setPolice('');
    setPhotos([]);
    setSaving(false);
  }, [open, vehicle?.id, initialStatus]);

  const from = vehicle?.status ?? null;
  const rows = useMemo(
    () =>
      theme.legend.map((item) => {
        const to = item.status as VehicleStatus;
        const isCurrent = from === to;
        const tripOwned = TRIP_ENGINE_OWNED.includes(to);
        const transition = from && !isCurrent && !tripOwned ? resolveTransition(from, to, role) : null;
        const hint = isCurrent
          ? 'Current status'
          : tripOwned
            ? 'Set by the trip engine when a rider books or rides'
            : transition
              ? null
              : `Not available from ${from ? labelForStatus(theme, from).toLowerCase() : '—'} for your role`;
        return { status: to, label: item.label, color: item.color, transition, hint, disabled: !transition };
      }),
    [theme, from, role],
  );

  const selected = target ? (rows.find((r) => r.status === target) ?? null) : null;
  const transition = selected?.transition ?? null;

  const missing: string[] = [];
  if (transition) {
    if (transition.requiresPhoto && photos.length === 0) missing.push('photo');
    if (transition.requiresReason && !reason.trim()) missing.push('reason');
    // Return-to-service is gated on the maintenance checklist, which lives on
    // the task, not here — same rule the vehicle status screen enforces.
    if (transition.requiresChecklist) missing.push('completed maintenance checklist');
  }

  const apply = useCallback(async () => {
    if (!vehicle || !transition || missing.length > 0) return;
    setSaving(true);
    const { pos } = await getCurrentPos();
    await changeStatus(
      vehicle,
      transition,
      reason.trim() || null,
      photos,
      pos,
      transition.adminReview ? police.trim() || null : null,
    );
    setSaving(false);
    onApplied?.(transition.to);
    onClose();
  }, [vehicle, transition, missing.length, reason, photos, police, onApplied, onClose]);

  if (!vehicle) return null;

  return (
    <BottomSheet open={open} onClose={onClose} title={`Set status · ${vehicle.code}`} snapPoints={[0.7, 0.94]} initialSnap={1}>
      <View style={st.body}>
        <ScrollView style={st.scroll} contentContainerStyle={st.list} keyboardShouldPersistTaps="handled">
          {rows.map((row) => {
            const isSelected = row.status === target;
            return (
              <Pressable
                key={row.status}
                disabled={row.disabled}
                onPress={() => setTarget(row.status)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled: row.disabled }}
                accessibilityLabel={row.label}
                style={({ pressed }) => [
                  st.row,
                  isSelected && { borderColor: row.color, backgroundColor: withAlpha(row.color, 0.12) },
                  row.disabled && st.rowDisabled,
                  pressed && !row.disabled && { opacity: 0.7 },
                ]}
              >
                <StatusDot status={row.status} size={14} />
                <View style={st.rowText}>
                  <Text style={st.rowLabel} numberOfLines={1}>
                    {row.label}
                  </Text>
                  {row.hint ? <Text style={st.rowHint}>{row.hint}</Text> : null}
                </View>
                {row.transition ? (
                  <View style={st.reqRow}>
                    {row.transition.requiresPhoto && <Badge label="photo" color={c.warning} textColor={c.onWarning} />}
                    {row.transition.requiresReason && <Badge label="reason" color={c.surfaceAlt} />}
                    {row.transition.adminReview && <Badge label="review" color={c.danger} textColor={c.onDanger} />}
                  </View>
                ) : null}
                <View style={[st.check, isSelected && { backgroundColor: row.color, borderColor: row.color }]}>
                  {isSelected ? <Icon name="check" size={16} color={c.onPrimary} strokeWidth={2.6} /> : null}
                </View>
              </Pressable>
            );
          })}

          {transition ? (
            <View style={st.form}>
              {transition.adminReview ? (
                <View style={st.warnCard}>
                  <Text style={st.warnTitle}>Goes to admin review — status does not change yet</Text>
                  {STOLEN_CONFIRM_EFFECTS.map((e) => (
                    <Text key={e} style={st.warnLine}>
                      • {e}
                    </Text>
                  ))}
                  <Field
                    label="Police report ref (optional)"
                    value={police}
                    onChangeText={setPolice}
                    placeholder="AB-2026-…"
                  />
                </View>
              ) : null}

              <Field
                label={transition.requiresReason ? 'Reason *' : 'Reason (optional)'}
                value={reason}
                onChangeText={setReason}
                multiline
                placeholder="Why this change…"
              />

              {transition.requiresPhoto ? (
                <View style={st.photoBlock}>
                  <PhotoButton
                    label={photos.length ? `Photo added (${photos.length})` : 'Add required photo *'}
                    vehicleId={vehicle.id}
                    onCaptured={(p) => setPhotos((prev) => [...prev, p.remotePath])}
                  />
                  <PhotoStrip photos={photos} />
                </View>
              ) : null}

              {transition.requiresChecklist ? (
                <Text style={st.blockNote}>
                  Return to service needs the maintenance checklist done. Complete the related task first, then set
                  this status.
                </Text>
              ) : null}

              {transition.sideEffects?.map((e) => (
                <Text key={e} style={st.rowHint}>
                  • {e}
                </Text>
              ))}
            </View>
          ) : null}
        </ScrollView>

        <View style={st.footer}>
          {missing.length > 0 ? <Text style={st.missing}>Missing: {missing.join(', ')}</Text> : null}
          <Button
            title={
              !transition
                ? 'Pick a status'
                : transition.adminReview
                  ? 'Send to admin review'
                  : `Set ${selected?.label ?? ''}`
            }
            onPress={() => void apply()}
            loading={saving}
            disabled={!transition || missing.length > 0}
          />
          <Text style={st.queuedNote}>Queued and audit-logged on sync. Server wins on vehicle status.</Text>
        </View>
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  body: { flex: 1 },
  // The scroller must be bounded by the sheet, otherwise it grows to its
  // content height and pushes the confirm footer off the bottom edge.
  scroll: { flex: 1 },
  list: { paddingHorizontal: t.space.lg, paddingBottom: t.space.lg, gap: t.space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    minHeight: t.tap.row,
    paddingHorizontal: t.space.md,
    borderRadius: t.radius.md,
    borderWidth: 1.5,
    borderColor: t.c.border,
    backgroundColor: t.c.surfaceAlt,
  },
  rowDisabled: { opacity: 0.45, backgroundColor: 'transparent' },
  rowText: { flex: 1, gap: 1 },
  rowLabel: { color: t.c.text, fontSize: t.font.size.md, fontWeight: '700' },
  rowHint: { color: t.c.textMuted, fontSize: t.font.size.xs },
  reqRow: { flexDirection: 'row', gap: 4 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: t.c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: { gap: t.space.md, paddingTop: t.space.md },
  warnCard: {
    gap: t.space.xs,
    padding: t.space.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.c.danger,
    backgroundColor: t.c.surfaceAlt,
  },
  warnTitle: { color: t.c.danger, fontSize: t.font.size.sm, fontWeight: '700' },
  warnLine: { color: t.c.textMuted, fontSize: t.font.size.xs },
  photoBlock: { gap: t.space.sm },
  blockNote: { color: t.c.warning, fontSize: t.font.size.sm, fontWeight: '600' },
  footer: {
    gap: t.space.xs,
    padding: t.space.lg,
    borderTopWidth: 1,
    borderColor: t.c.border,
    backgroundColor: t.c.surface,
  },
  missing: { color: t.c.danger, fontSize: t.font.size.sm, fontWeight: '700' },
  queuedNote: { color: t.c.textFaint, fontSize: t.font.size.xs, textAlign: 'center' },
}));
