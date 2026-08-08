import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Badge, Row, Muted } from './ui';
import { c, space, font } from '../lib/theme';
import { relativeTime } from '@penny/ui';
import type { OpsTask } from '@penny/db-types';

const KIND_ICON: Record<string, string> = {
  battery_swap: '🔋', rebalance: '↔️', repair: '🔧', inspect: '🔍', pickup: '📦', deploy: '📍',
};
const STATUS_COLOR: Record<string, string> = {
  open: c.textMuted, assigned: c.primary, in_progress: c.warning, done: c.success, cancelled: c.textFaint,
};

export function TaskCard({ task, vehicleCode, distanceLabel, onPress }: {
  task: OpsTask; vehicleCode?: string; distanceLabel?: string; onPress?: () => void;
}) {
  return (
    <Card onPress={onPress}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <Text style={{ fontSize: 22 }}>{KIND_ICON[task.kind] ?? '•'}</Text>
          <Text style={st.title}>{task.kind.replace('_', ' ')}</Text>
        </Row>
        <Row gap={6}>
          {task.priority >= 8 && <Badge label="urgent" color={c.danger} textColor="#fff" />}
          <Badge label={task.status.replace('_', ' ')} color={STATUS_COLOR[task.status] ?? c.surfaceAlt} textColor={task.status === 'open' ? c.text : '#fff'} />
        </Row>
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <Muted>
          {vehicleCode ? `${vehicleCode} · ` : ''}P{task.priority}
          {distanceLabel ? ` · ${distanceLabel}` : ''}
        </Muted>
        <Muted>{task.due_at ? `due ${relativeTime(task.due_at)}` : ''}</Muted>
      </Row>
      <Row gap={6}>
        {task.created_by === 'system_rule' && <Badge label="Auto" color={c.primaryDeep} textColor="#fff" />}
        {task.assignee && task.status !== 'open' && <Badge label="claimed" color={c.surfaceAlt} />}
        {task.notes ? <Text style={st.note} numberOfLines={1}>{task.notes}</Text> : null}
      </Row>
    </Card>
  );
}

const st = StyleSheet.create({
  title: { color: c.text, fontWeight: '700', fontSize: font.size.lg, textTransform: 'capitalize' },
  note: { color: c.textFaint, fontSize: font.size.xs, flex: 1 },
});
