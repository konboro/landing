// Task detail — the screen where work actually gets recorded.
//
// Everything here serves one rule: a task cannot be marked done until the
// evidence exists. So the checklist refuses to tick a photo-backed step until
// its photo is attached, and the primary button spends its label explaining
// what is missing instead of just going grey. A greyed button with no reason is
// the single most common way a field app gets abandoned mid-job.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  H1,
  H2,
  Muted,
  Body,
  Button,
  Card,
  Row,
  Badge,
  Field,
  Empty,
  Icon,
  PhotoStrip,
} from '../../components/ui';
import { PhotoButton } from '../../components/PhotoCapture';
import { kindLabel, kindIcon, formatDue, isOverdue, initialsFor } from '../../components/TaskCard';
import { getTask, getVehicle } from '../../offline/repo';
import { useMirror } from '../../lib/useMirror';
import {
  buildChecklist,
  isBatterySwap,
  type ChecklistState,
} from '../../lib/checklists';
import { claimTask, releaseTask, startTask, completeTask } from '../../offline/actions';
import { navigateTo } from '../../lib/nav';
import { getCurrentPos } from '../../lib/geoloc';
import { useOps } from '../../lib/store';
import { useTheme, makeStyles, withAlpha } from '../../brand';
import { OpsTaskStatus } from '@penny/db-types';
import type { OpsTask, UUID } from '@penny/db-types';
import type { OpsVehicle } from '../../lib/types';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const taskId = typeof id === 'string' ? id : '';
  const task = useMirror<OpsTask | null>(
    () => (taskId ? getTask(taskId) : Promise.resolve(null)),
    null,
  );

  if (!task.data) {
    return <Empty text={task.loading ? 'Loading task…' : 'Task not found on this device.'} />;
  }
  // Keyed by id so navigating between two tasks never carries checklist state
  // (or a captured photo) from one job onto another.
  return <TaskBody key={task.data.id} task={task.data} onDone={() => router.back()} />;
}

/**
 * Template + whatever the server already recorded. Photo-backed steps are
 * deliberately NOT restored as ticked: `ops_tasks.checklist` remembers the tick
 * but not which photo satisfied it, so restoring one would let a task complete
 * with evidence that never left someone else's device.
 */
function hydrateChecklist(task: OpsTask): ChecklistState[] {
  const saved = new Map((task.checklist ?? []).map((i) => [i.key, i]));
  return buildChecklist(task.kind).map((i) => ({
    ...i,
    done: i.requiresBeforePhoto || i.requiresAfterPhoto ? false : (saved.get(i.key)?.done ?? false),
  }));
}

function photosSatisfied(i: ChecklistState): boolean {
  return (!i.requiresBeforePhoto || !!i.beforePhoto) && (!i.requiresAfterPhoto || !!i.afterPhoto);
}

function TaskBody({ task, onDone }: { task: OpsTask; onDone: () => void }) {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;

  const session = useOps((s) => s.session);
  const staffId: UUID | null = session?.staff_id ?? null;

  const vehicle = useMirror<OpsVehicle | null>(
    () => (task.vehicle_id ? getVehicle(task.vehicle_id) : Promise.resolve(null)),
    null,
  );

  const [checklist, setChecklist] = useState<ChecklistState[]>(() => hydrateChecklist(task));
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [vBefore, setVBefore] = useState('');
  const [vAfter, setVAfter] = useState('');
  const [nudged, setNudged] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const battery = isBatterySwap(task.kind);
  const done = task.status === OpsTaskStatus.done;
  const cancelled = task.status === OpsTaskStatus.cancelled;
  const mine = !!staffId && task.assignee === staffId;
  const held = !!task.assignee;
  const started = task.status === OpsTaskStatus.in_progress;
  const overdue = isOverdue(task);
  const due = formatDue(task.due_at);

  const ticked = checklist.filter((i) => i.done).length;
  const missingPhotos = checklist.reduce(
    (n, i) =>
      n +
      (i.requiresBeforePhoto && !i.beforePhoto ? 1 : 0) +
      (i.requiresAfterPhoto && !i.afterPhoto ? 1 : 0),
    0,
  );
  const untickedSteps = checklist.length - ticked;
  const voltageMissing = battery && (!isVoltage(vBefore) || !isVoltage(vAfter));

  /** Short enough to fit on the button, specific enough to act on. */
  const blockedReason = useMemo(() => {
    const parts: string[] = [];
    if (missingPhotos > 0) parts.push(`${missingPhotos} photo${missingPhotos === 1 ? '' : 's'}`);
    if (untickedSteps > 0) parts.push(`${untickedSteps} step${untickedSteps === 1 ? '' : 's'}`);
    if (voltageMissing) parts.push('voltage');
    return parts.length === 0 ? null : `Need ${parts.join(' · ')}`;
  }, [missingPhotos, untickedSteps, voltageMissing]);

  const toggleItem = useCallback((key: string) => {
    setChecklist((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i;
        if (!i.done && !photosSatisfied(i)) {
          // Refuse the tick and say why, instead of accepting it and failing at
          // the bottom of the screen where the reason is no longer on-screen.
          setNudged(key);
          return i;
        }
        return { ...i, done: !i.done };
      }),
    );
  }, []);

  const attach = useCallback((key: string, which: 'before' | 'after', remotePath: string) => {
    setNudged(null);
    setChecklist((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i;
        const next: ChecklistState = {
          ...i,
          ...(which === 'before' ? { beforePhoto: remotePath } : { afterPhoto: remotePath }),
        };
        // Attaching the last required photo is the tick — one less tap in the rain.
        return photosSatisfied(next) ? { ...next, done: true } : next;
      }),
    );
  }, []);

  const complete = useCallback(async () => {
    if (blockedReason) return;
    setSaving(true);
    const { pos } = await getCurrentPos();
    await completeTask(
      task,
      checklist,
      extraPhotos,
      notes.trim() || null,
      battery ? { before: Number(vBefore), after: Number(vAfter) } : {},
      pos,
    );
    if (alive.current) setSaving(false);
    onDone();
  }, [blockedReason, task, checklist, extraPhotos, notes, battery, vBefore, vAfter, onDone]);

  const act = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
    } finally {
      if (alive.current) setSaving(false);
    }
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ---- Header --------------------------------------------------- */}
          <Card style={overdue ? { borderColor: c.danger } : undefined}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={space.sm} style={{ flex: 1 }}>
                <View style={[st.glyph, { backgroundColor: withAlpha(c.primary, 0.14) }]}>
                  <Icon name={kindIcon(task.kind)} size={24} color={c.primary} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <H1>{kindLabel(task.kind)}</H1>
                  <Muted>
                    Priority {task.priority}
                    {task.created_by === 'system_rule' ? ' · auto-generated' : ''}
                  </Muted>
                </View>
              </Row>
              <Badge
                label={task.status.replace(/_/g, ' ')}
                color={done ? c.success : started ? c.warning : held ? c.primary : c.surfaceAlt}
                textColor={done ? c.onSuccess : started ? c.onWarning : held ? c.onPrimary : c.text}
              />
            </Row>

            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={6}>
                <Icon name="user" size={16} color={c.textMuted} />
                <Muted>
                  {mine ? `You (${initialsFor(session?.name, staffId)})` : held ? 'Another crew member' : 'Unassigned'}
                </Muted>
              </Row>
              {due ? (
                <Row gap={6}>
                  <Icon name="clock" size={16} color={overdue ? c.danger : c.textMuted} />
                  <Text style={[st.meta, overdue && { color: c.danger, fontWeight: '800' }]}>{due}</Text>
                </Row>
              ) : null}
            </Row>
          </Card>

          {/* ---- Vehicle -------------------------------------------------- */}
          {vehicle.data ? (
            <Card onPress={() => router.push(`/vehicle/${vehicle.data!.id}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <H2>{vehicle.data.code}</H2>
                  <Muted>
                    {vehicle.data.model_name} · {vehicle.data.status.replace(/_/g, ' ')}
                    {vehicle.data.soc_pct != null ? ` · ${Math.round(vehicle.data.soc_pct)}%` : ''}
                  </Muted>
                </View>
                <Icon name="chevron" size={20} color={c.textFaint} />
              </Row>
              {vehicle.data.pos ? (
                <Button
                  title="Navigate to vehicle"
                  variant="secondary"
                  onPress={() => void navigateTo(vehicle.data!.pos!, vehicle.data!.code)}
                />
              ) : null}
            </Card>
          ) : null}

          {task.notes ? (
            <Card style={{ borderColor: c.primary }}>
              <Muted>Brief</Muted>
              <Body>{task.notes}</Body>
            </Card>
          ) : null}

          {/* ---- Checklist ------------------------------------------------ */}
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>Checklist</H2>
            <Text style={st.progress}>
              {ticked} / {checklist.length}
            </Text>
          </Row>
          <View style={st.progressTrack}>
            <View
              style={[
                st.progressFill,
                {
                  backgroundColor: ticked === checklist.length ? c.success : c.primary,
                  width: `${checklist.length === 0 ? 0 : (ticked / checklist.length) * 100}%`,
                },
              ]}
            />
          </View>

          {checklist.length === 0 ? (
            <Empty text="This task kind has no checklist." />
          ) : (
            checklist.map((item) => (
              <ChecklistRow
                key={item.key}
                item={item}
                vehicleId={task.vehicle_id ?? 'task'}
                locked={done || cancelled}
                nudge={nudged === item.key}
                onToggle={() => toggleItem(item.key)}
                onAttach={(which, path) => attach(item.key, which, path)}
              />
            ))
          )}

          {/* ---- Battery voltage (docs/07: battery_swap prompts before/after) */}
          {battery && !done ? (
            <Card style={{ borderColor: voltageMissing ? c.warning : c.border }}>
              <H2>Pack voltage</H2>
              <Muted>Millivolts, as read on the pack (e.g. 34200 = 34.2 V).</Muted>
              <Row gap={space.md}>
                <View style={{ flex: 1 }}>
                  <Field label="Before" value={vBefore} onChangeText={setVBefore} keyboardType="number-pad" placeholder="34200" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="After" value={vAfter} onChangeText={setVAfter} keyboardType="number-pad" placeholder="41800" />
                </View>
              </Row>
            </Card>
          ) : null}

          {/* ---- Notes + extra photos ------------------------------------- */}
          {!done && !cancelled ? (
            <>
              <Field
                label="Completion notes (optional)"
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Anything worth recording…"
              />
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <H2>Extra photos</H2>
                  <Muted>{extraPhotos.length} attached</Muted>
                </Row>
                <PhotoButton
                  label="Add photo"
                  vehicleId={task.vehicle_id ?? 'task'}
                  onCaptured={(p) => setExtraPhotos((prev) => [...prev, p.remotePath])}
                />
                <PhotoStrip photos={extraPhotos} size={64} />
              </Card>
            </>
          ) : null}

          {done ? (
            <Card style={{ borderColor: c.success }}>
              <Row gap={space.sm}>
                <Icon name="check" size={22} color={c.success} strokeWidth={2.4} />
                <H2>Completed</H2>
              </Row>
              <Muted>{task.completed_at ?? '—'}</Muted>
              <PhotoStrip photos={task.photos} size={64} />
            </Card>
          ) : null}

          {blockedReason && !done && !cancelled ? (
            <Card style={{ borderColor: c.border }}>
              <Muted>Before this task can be completed:</Muted>
              {missingPhotos > 0 ? <Text style={st.blocker}>• {missingPhotos} required photo(s) not attached</Text> : null}
              {untickedSteps > 0 ? <Text style={st.blocker}>• {untickedSteps} checklist step(s) not ticked</Text> : null}
              {voltageMissing ? <Text style={st.blocker}>• pack voltage before and after</Text> : null}
            </Card>
          ) : null}
        </ScrollView>

        {/* ---- Action bar: Claim → Start → Complete ------------------------ */}
        <View style={st.bar}>
          {done || cancelled ? (
            <Button title="Back to tasks" variant="secondary" onPress={onDone} />
          ) : !held ? (
            <Button title="Claim task" loading={saving} onPress={() => void act(() => claimTask(task.id))} />
          ) : !mine ? (
            <Row gap={space.sm}>
              <Icon name="alert" size={18} color={c.warning} />
              <Muted>Held by another crew member — ask them to release it first.</Muted>
            </Row>
          ) : (
            <Row gap={space.sm}>
              <Button
                title="Release"
                variant="ghost"
                style={{ flex: 1 }}
                disabled={saving}
                onPress={() => void act(() => releaseTask(task.id))}
              />
              {started ? (
                <Button
                  title={blockedReason ?? 'Complete task'}
                  variant={blockedReason ? 'secondary' : 'success'}
                  style={{ flex: 2 }}
                  loading={saving}
                  disabled={!!blockedReason}
                  onPress={() => void complete()}
                />
              ) : (
                <Button
                  title="Start task"
                  style={{ flex: 2 }}
                  loading={saving}
                  onPress={() => void act(() => startTask(task.id))}
                />
              )}
            </Row>
          )}
          <Muted style={{ textAlign: 'center' }}>Queued locally — nothing is lost offline.</Muted>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A step. The whole row is the checkbox — aiming at a 20 px square with a glove is a bug. */
function ChecklistRow({
  item,
  vehicleId,
  locked,
  nudge,
  onToggle,
  onAttach,
}: {
  item: ChecklistState;
  vehicleId: string;
  locked: boolean;
  nudge: boolean;
  onToggle: () => void;
  onAttach: (which: 'before' | 'after', remotePath: string) => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;
  const blocked = !item.done && !photosSatisfied(item);

  return (
    <Card style={nudge ? { borderColor: c.warning } : undefined}>
      <Pressable
        onPress={locked ? undefined : onToggle}
        disabled={locked}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done, disabled: locked }}
        accessibilityLabel={item.label}
        style={({ pressed }) => [st.checkRow, pressed && { opacity: 0.7 }]}
      >
        <View
          style={[
            st.box,
            item.done
              ? { backgroundColor: c.success, borderColor: c.success }
              : { borderColor: blocked ? c.warning : c.border },
          ]}
        >
          {item.done ? <Icon name="check" size={22} color={c.onSuccess} strokeWidth={2.6} /> : null}
        </View>
        <Text style={[st.itemLabel, item.done && { color: c.textMuted }]}>{item.label}</Text>
      </Pressable>

      {nudge ? <Text style={[st.blocker, { color: c.warning }]}>Attach the required photo first.</Text> : null}

      {item.requiresBeforePhoto || item.requiresAfterPhoto ? (
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          {item.requiresBeforePhoto ? (
            <PhotoSlot
              which="before"
              path={item.beforePhoto}
              vehicleId={vehicleId}
              locked={locked}
              onCaptured={(p) => onAttach('before', p)}
            />
          ) : null}
          {item.requiresAfterPhoto ? (
            <PhotoSlot
              which="after"
              path={item.afterPhoto}
              vehicleId={vehicleId}
              locked={locked}
              onCaptured={(p) => onAttach('after', p)}
            />
          ) : null}
        </Row>
      ) : null}
    </Card>
  );
}

function PhotoSlot({
  which,
  path,
  vehicleId,
  locked,
  onCaptured,
}: {
  which: 'before' | 'after';
  path?: string;
  vehicleId: string;
  locked: boolean;
  onCaptured: (remotePath: string) => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const label = which === 'before' ? 'Before' : 'After';
  return (
    <View style={st.slot}>
      <Row gap={6}>
        <Icon
          name={path ? 'check' : 'camera'}
          size={16}
          color={path ? theme.c.success : theme.c.warning}
          strokeWidth={2.2}
        />
        <Text style={st.slotLabel}>{path ? `${label} photo` : `${label} photo required`}</Text>
      </Row>
      {path ? <PhotoStrip photos={[path]} size={56} /> : null}
      {locked ? null : (
        <PhotoButton label={path ? `Retake ${which}` : `Take ${which}`} vehicleId={vehicleId} onCaptured={(p) => onCaptured(p.remotePath)} />
      )}
    </View>
  );
}

/** Plausible pack voltage in mV. Rejects blanks, zeroes and fat-fingered decimals. */
function isVoltage(raw: string): boolean {
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0;
}

const useStyles = makeStyles((t) => ({
  glyph: { width: 46, height: 46, borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center' },
  meta: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '600' },
  progress: { color: t.c.text, fontSize: t.font.size.lg, fontWeight: '800' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: t.c.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: t.tap.row },
  box: {
    width: 36,
    height: 36,
    borderRadius: t.radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: { color: t.c.text, fontSize: t.font.size.md, fontWeight: '600', flex: 1 },
  blocker: { color: t.c.textMuted, fontSize: t.font.size.sm },
  slot: { flex: 1, gap: t.space.xs },
  slotLabel: { color: t.c.textMuted, fontSize: t.font.size.xs, fontWeight: '700' },
  bar: {
    gap: t.space.xs,
    padding: t.space.lg,
    backgroundColor: t.c.surface,
    borderTopWidth: 1,
    borderColor: t.c.border,
  },
}));
