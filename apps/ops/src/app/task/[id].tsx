import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, H1, H2, Muted, Body, Button, Card, Row, Badge, Field, Divider, Empty } from '../../components/ui';
import { PhotoButton, PhotoStrip } from '../../components/PhotoCapture';
import { getTask, getVehicle } from '../../offline/repo';
import { useMirror } from '../../lib/useMirror';
import { buildChecklist, checklistComplete, checklistBlockers, isBatterySwap, type ChecklistState } from '../../lib/checklists';
import { claimTask, startTask, completeTask } from '../../offline/actions';
import { navigateTo } from '../../lib/nav';
import { getCurrentPos } from '../../lib/geoloc';
import { useOps } from '../../lib/store';
import { useTheme, makeStyles } from '../../brand';
import type { OpsTask } from '@penny/db-types';
import type { OpsVehicle } from '../../lib/types';

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const staffId = useOps((s) => s.session?.staff_id);
  const task = useMirror<OpsTask | null>(() => getTask(id!), null);
  const t = task.data;

  if (!t) {
    return (
      <Screen>
        <Empty text="Task not found." />
      </Screen>
    );
  }
  return <TaskBody task={t} staffId={staffId} onDone={() => router.back()} />;
}

function TaskBody({ task, staffId, onDone }: { task: OpsTask; staffId?: string; onDone: () => void }) {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;
  const vehicle = useMirror<OpsVehicle | null>(() => (task.vehicle_id ? getVehicle(task.vehicle_id) : Promise.resolve(null)), null);
  const [checklist, setChecklist] = useState<ChecklistState[]>(() => buildChecklist(task.kind));
  const [notes, setNotes] = useState(task.notes ?? '');
  const [vBefore, setVBefore] = useState('');
  const [vAfter, setVAfter] = useState('');
  const [saving, setSaving] = useState(false);

  const isDone = task.status === 'done';
  const isMine = task.assignee === staffId;
  const battery = isBatterySwap(task.kind);

  const blockers = useMemo(() => {
    const b = checklistBlockers(checklist);
    if (battery) {
      if (!vBefore.trim()) b.push('voltage before required');
      if (!vAfter.trim()) b.push('voltage after required');
    }
    return b;
  }, [checklist, battery, vBefore, vAfter]);

  const canComplete = checklistComplete(checklist) && blockers.length === 0;

  function toggleItem(key: string) {
    setChecklist((prev) => prev.map((i) => (i.key === key ? { ...i, done: !i.done } : i)));
  }
  function attach(key: string, which: 'before' | 'after', remotePath: string) {
    setChecklist((prev) =>
      prev.map((i) =>
        i.key === key ? { ...i, [which === 'before' ? 'beforePhoto' : 'afterPhoto']: remotePath, done: true } : i,
      ),
    );
  }

  async function complete() {
    if (!canComplete) {
      Alert.alert('Not ready', blockers.join('\n'));
      return;
    }
    setSaving(true);
    const { pos } = await getCurrentPos();
    await completeTask(
      task,
      checklist,
      [],
      notes.trim() || null,
      battery ? { before: Number(vBefore) || null, after: Number(vAfter) || null } : {},
      pos,
    );
    setSaving(false);
    onDone();
  }

  return (
    <Screen scroll>
      <Row style={{ justifyContent: 'space-between' }}>
        <H1>{task.kind.replace('_', ' ')}</H1>
        <Row gap={6}>
          {task.created_by === 'system_rule' && <Badge label="Auto" color={c.primaryDeep} textColor={c.onPrimary} />}
          <Badge label={task.status.replace('_', ' ')} color={isDone ? c.success : c.primary} textColor={isDone ? c.onSuccess : c.onPrimary} />
        </Row>
      </Row>

      {vehicle.data && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <H2>{vehicle.data.code}</H2>
              <Muted>{vehicle.data.model_name} · {vehicle.data.status.replace('_', ' ')}</Muted>
            </View>
            <Button title="Open" variant="ghost" onPress={() => router.push(`/vehicle/${vehicle.data!.id}`)} />
          </Row>
          {vehicle.data.pos && <Button title="Navigate" icon="🧭" variant="secondary" onPress={() => navigateTo(vehicle.data!.pos!, vehicle.data!.code)} />}
        </Card>
      )}

      {task.notes && (
        <Card style={{ borderColor: c.primary }}>
          <Muted>Note</Muted>
          <Body>{task.notes}</Body>
        </Card>
      )}

      {/* Claim / start controls */}
      {!isDone && (
        <Row>
          {!task.assignee && <Button title="Claim task" onPress={() => claimTask(task.id)} style={{ flex: 1 }} />}
          {task.assignee && task.status !== 'in_progress' && (
            <Button title="Start" variant="secondary" onPress={() => startTask(task.id)} style={{ flex: 1 }} />
          )}
          {task.assignee && !isMine && <Badge label="claimed by another" color={c.surfaceAlt} />}
        </Row>
      )}

      {/* Checklist */}
      <H2>Checklist</H2>
      {checklist.map((item) => (
        <Card key={item.key}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ flex: 1 }}>
              <Button title={item.done ? '✓' : ' '} variant={item.done ? 'success' : 'ghost'} onPress={() => toggleItem(item.key)} style={st.check} />
              <Text style={[st.itemLabel, item.done && { color: c.textMuted }]}>{item.label}</Text>
            </Row>
          </Row>
          <Row gap={space.sm}>
            {item.requiresBeforePhoto && (
              <View style={{ flex: 1, gap: 4 }}>
                <PhotoButton label={item.beforePhoto ? 'Before ✓' : 'Before photo *'} vehicleId={task.vehicle_id ?? 'task'} onCaptured={(p) => attach(item.key, 'before', p.remotePath)} />
                {item.beforePhoto && <PhotoStrip photos={[item.beforePhoto]} />}
              </View>
            )}
            {item.requiresAfterPhoto && (
              <View style={{ flex: 1, gap: 4 }}>
                <PhotoButton label={item.afterPhoto ? 'After ✓' : 'After photo *'} vehicleId={task.vehicle_id ?? 'task'} onCaptured={(p) => attach(item.key, 'after', p.remotePath)} />
                {item.afterPhoto && <PhotoStrip photos={[item.afterPhoto]} />}
              </View>
            )}
          </Row>
        </Card>
      ))}

      {/* Battery voltage prompt */}
      {battery && (
        <Card style={{ borderColor: c.warning }}>
          <H2>Battery voltage</H2>
          <Muted>Record pack voltage in millivolts (e.g. 34200 = 34.2V).</Muted>
          <Row gap={space.md}>
            <View style={{ flex: 1 }}>
              <Field label="Before (mV)" value={vBefore} onChangeText={setVBefore} keyboardType="number-pad" placeholder="34200" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="After (mV)" value={vAfter} onChangeText={setVAfter} keyboardType="number-pad" placeholder="41800" />
            </View>
          </Row>
        </Card>
      )}

      <Field label="Completion notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="Anything worth recording…" />

      {!isDone ? (
        <>
          {blockers.length > 0 && (
            <Card style={{ borderColor: c.border }}>
              <Muted>To complete:</Muted>
              {blockers.map((b, i) => (
                <Text key={i} style={st.blocker}>• {b}</Text>
              ))}
            </Card>
          )}
          <Button title="Complete task" variant="success" onPress={complete} loading={saving} disabled={!canComplete} />
          <Muted style={{ textAlign: 'center' }}>Completion is queued and never lost — syncs when online.</Muted>
        </>
      ) : (
        <Card style={{ borderColor: c.success }}>
          <H2>✓ Completed</H2>
          <Muted>{task.completed_at}</Muted>
          <PhotoStrip photos={task.photos} />
        </Card>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  check: { width: 48, minHeight: 48, paddingHorizontal: 0 },
  itemLabel: { color: t.c.text, fontSize: t.font.size.md, fontWeight: '600', flex: 1 },
  blocker: { color: t.c.textMuted, fontSize: t.font.size.sm },
}));
