import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Badge, Row, Muted } from './ui';
import { useTheme, makeStyles } from '../brand';
import { relativeTime } from '@penny/ui';
import type { OpsTask } from '@penny/db-types';

const KIND_ICON: Record<string, string> = {
  battery_swap: '🔋', rebalance: '↔️', repair: '🔧', inspect: '🔍', pickup: '📦', deploy: '📍',
};
export function TaskCard({ task, vehicleCode, distanceLabel, onPress }: {
  task: OpsTask; vehicleCode?: string; distanceLabel?: string; onPress?: () => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const statusBg: Record<string, string> = {
    open: c.textMuted, assigned: c.primary, in_progress: c.warning, done: c.success, cancelled: c.textFaint,
  };
  return (
    <Card onPress={onPress}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <Text style={{ fontSize: 22 }}>{KIND_ICON[task.kind] ?? '•'}</Text>
          <Text style={st.title}>{task.kind.replace('_', ' ')}</Text>
        </Row>
        <Row gap={6}>
          {task.priority >= 8 && <Badge label="urgent" color={c.danger} textColor={c.textInverse} />}
          <Badge label={task.status.replace('_', ' ')} color={statusBg[task.status] ?? c.surfaceAlt} textColor={task.status === 'open' ? c.text : c.textInverse} />
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
        {task.created_by === 'system_rule' && <Badge label="Auto" color={c.primaryDeep} textColor={c.textInverse} />}
        {task.assignee && task.status !== 'open' && <Badge label="claimed" color={c.surfaceAlt} />}
        {task.notes ? <Text style={st.note} numberOfLines={1}>{task.notes}</Text> : null}
      </Row>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  title: { color: t.c.text, fontWeight: '700', fontSize: t.font.size.lg, textTransform: 'capitalize' },
  note: { color: t.c.textFaint, fontSize: t.font.size.xs, flex: 1 },
}));
