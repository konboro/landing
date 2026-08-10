// The unit of work as it appears in every ops list.
//
// Read at arm's length, outdoors, with a glove on. Two questions decide what a
// mechanic does next — *is it late* and *is it mine* — so those two get colour
// and position; everything else (kind, code, distance) is supporting text.
//
// The kind/label/due helpers live here rather than in `lib/` because every
// consumer of them already imports this file, and a task's presentation is one
// idea: change the glyph set and the card, filter chips and detail header all
// move together.
import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Card, Row, Badge, Icon, type IconName } from './ui';
import { useTheme, makeStyles, withAlpha } from '../brand';
import { formatDistance } from '@penny/ui';
import { OpsTaskKind, OpsTaskStatus } from '@penny/db-types';
import type { OpsTask, OpsTaskKind as Kind, UUID } from '@penny/db-types';

/** Render order everywhere kinds are listed (chips, legends). */
export const TASK_KINDS: readonly Kind[] = [
  OpsTaskKind.rebalance,
  OpsTaskKind.battery_swap,
  OpsTaskKind.pickup,
  OpsTaskKind.repair,
  OpsTaskKind.inspect,
  OpsTaskKind.deploy,
];

export const KIND_ICON: Record<Kind, IconName> = {
  rebalance: 'route',
  battery_swap: 'battery',
  pickup: 'download',
  repair: 'wrench',
  inspect: 'search',
  deploy: 'place',
};

export const KIND_LABEL: Record<Kind, string> = {
  rebalance: 'Rebalance',
  battery_swap: 'Battery swap',
  pickup: 'Pickup',
  repair: 'Repair',
  inspect: 'Inspect',
  deploy: 'Deploy',
};

export function kindLabel(kind: Kind | string): string {
  return KIND_LABEL[kind as Kind] ?? String(kind).replace(/_/g, ' ');
}

export function kindIcon(kind: Kind | string): IconName {
  return KIND_ICON[kind as Kind] ?? 'list';
}

/** A task nobody can act on any more. */
export function isClosed(task: OpsTask): boolean {
  return task.status === OpsTaskStatus.done || task.status === OpsTaskStatus.cancelled;
}

export function isOverdue(task: OpsTask, now = Date.now()): boolean {
  if (isClosed(task) || !task.due_at) return false;
  const due = Date.parse(task.due_at);
  return !Number.isNaN(due) && due < now;
}

/**
 * `relativeTime` from @penny/ui only ever looks backwards ("3h ago"), so a due
 * date in the future came out as "-7200s ago". Due dates need both directions,
 * and being late is the whole point of showing them.
 */
export function formatDue(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const due = Date.parse(iso);
  if (Number.isNaN(due)) return null;
  const lateMs = now - due;
  const mins = Math.round(Math.abs(lateMs) / 60_000);
  if (mins < 1) return 'due now';
  const span =
    mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return lateMs > 0 ? `${span} overdue` : `due in ${span}`;
}

/**
 * Two-letter avatar. The ops app never mirrors a staff directory (PII
 * minimization, docs/10), so a colleague's name is unknown — their id is
 * hashed down to a stable stub instead, which still answers "same person?".
 */
export function initialsFor(name: string | null | undefined, id: UUID | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  const stub = (id ?? '').replace(/[^a-z0-9]/gi, '');
  return stub ? stub.slice(0, 2).toUpperCase() : '··';
}

export interface TaskCardProps {
  task: OpsTask;
  vehicleCode?: string;
  /** Metres from the user. Omit when there is no fix — never render a guess. */
  distanceMeters?: number | null;
  /** Only ever known for the signed-in user; see `initialsFor`. */
  assigneeName?: string | null;
  /** Held by the signed-in user. Drives the accent and the Release affordance. */
  mine?: boolean;
  onPress?: () => void;
  /** Supply exactly one: unassigned tasks get Claim, mine get Release. */
  onClaim?: () => void;
  onRelease?: () => void;
  /** A claim/release round-trip is local + instant, but the outbox write is not. */
  busy?: boolean;
}

export function TaskCard({
  task,
  vehicleCode,
  distanceMeters,
  assigneeName,
  mine = false,
  onPress,
  onClaim,
  onRelease,
  busy = false,
}: TaskCardProps) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;

  const overdue = isOverdue(task);
  const done = task.status === OpsTaskStatus.done;
  const due = formatDue(task.due_at);
  const urgent = task.priority >= 8;
  const held = !!task.assignee;

  const statusColor: Record<string, string> = {
    open: c.surfaceAlt,
    assigned: c.primary,
    in_progress: c.warning,
    done: c.success,
    cancelled: c.surfaceAlt,
  };
  const statusInk: Record<string, string> = {
    open: c.text,
    assigned: c.onPrimary,
    in_progress: c.onWarning,
    done: c.onSuccess,
    cancelled: c.textMuted,
  };

  // The left rail is the only thing scannable while walking: red = late,
  // brand = yours, nothing = up for grabs.
  const rail = overdue ? c.danger : mine ? c.primary : 'transparent';

  return (
    <Card onPress={onPress} style={[st.card, { borderLeftWidth: 5, borderLeftColor: rail }]}>
      <Row style={st.topRow}>
        <View style={[st.glyph, { backgroundColor: withAlpha(c.primary, 0.14) }]}>
          <Icon name={kindIcon(task.kind)} size={22} color={c.primary} strokeWidth={2} />
        </View>

        <View style={st.headings}>
          <Text style={st.title} numberOfLines={1}>
            {kindLabel(task.kind)}
          </Text>
          <Text style={st.subtitle} numberOfLines={1}>
            {vehicleCode ?? 'No vehicle'}
            {distanceMeters != null ? ` · ${formatDistance(distanceMeters)}` : ''}
          </Text>
        </View>

        <View style={st.rightStack}>
          <Badge
            label={task.status.replace(/_/g, ' ')}
            color={statusColor[task.status] ?? c.surfaceAlt}
            textColor={statusInk[task.status] ?? c.text}
          />
          {urgent ? (
            <Row gap={4}>
              <Icon name="flag" size={14} color={c.danger} strokeWidth={2.2} />
              <Text style={[st.meta, { color: c.danger }]}>P{task.priority}</Text>
            </Row>
          ) : (
            <Text style={st.meta}>P{task.priority}</Text>
          )}
        </View>
      </Row>

      <Row style={st.bottomRow}>
        <Row gap={6} style={st.bottomLeft}>
          {held ? (
            <View style={[st.avatar, mine && { backgroundColor: c.primary, borderColor: c.primary }]}>
              <Text style={[st.avatarText, mine && { color: c.onPrimary }]}>
                {initialsFor(mine ? assigneeName : null, task.assignee)}
              </Text>
            </View>
          ) : (
            <View style={[st.avatar, st.avatarEmpty]}>
              <Icon name="user" size={16} color={c.textFaint} />
            </View>
          )}
          <Text style={st.meta} numberOfLines={1}>
            {mine ? 'You' : held ? 'Another crew member' : 'Unassigned'}
          </Text>
        </Row>

        {due ? (
          <Row gap={4}>
            {overdue ? <Icon name="alert" size={14} color={c.danger} strokeWidth={2.2} /> : null}
            <Text style={[st.meta, overdue && { color: c.danger, fontWeight: '800' }]}>{due}</Text>
          </Row>
        ) : null}
      </Row>

      {task.notes ? (
        <Text style={st.note} numberOfLines={1}>
          {task.notes}
        </Text>
      ) : null}

      {/* Assignment is the action the field crew takes most, so it is a real
          button on the card — not something you have to open the task to find. */}
      {!done && (onClaim || onRelease) ? (
        <ActionButton
          label={onRelease ? 'Release' : 'Claim'}
          tone={onRelease ? 'neutral' : 'primary'}
          icon={onRelease ? 'close' : 'check'}
          busy={busy}
          onPress={onRelease ?? onClaim}
        />
      ) : null}
    </Card>
  );
}

/** Full-width, 52 px tall. A claim you have to aim for is a claim you miss. */
function ActionButton({
  label,
  tone,
  icon,
  busy,
  onPress,
}: {
  label: string;
  tone: 'primary' | 'neutral';
  icon: IconName;
  busy: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const bg = tone === 'primary' ? c.primary : c.surfaceAlt;
  const ink = tone === 'primary' ? c.onPrimary : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || !onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        st.action,
        { backgroundColor: bg, borderColor: tone === 'primary' ? bg : c.border },
        (pressed || busy) && { opacity: 0.65 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          <Icon name={icon} size={18} color={ink} strokeWidth={2.2} />
          <Text style={[st.actionText, { color: ink }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  card: { gap: t.space.sm },
  topRow: { alignItems: 'flex-start', gap: t.space.sm },
  glyph: { width: 42, height: 42, borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center' },
  headings: { flex: 1, gap: 2 },
  title: { color: t.c.text, fontSize: t.font.size.lg, fontWeight: '700' },
  subtitle: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '600' },
  rightStack: { alignItems: 'flex-end', gap: 4 },
  bottomRow: { justifyContent: 'space-between', gap: t.space.sm },
  bottomLeft: { flex: 1 },
  meta: { color: t.c.textMuted, fontSize: t.font.size.xs, fontWeight: '600' },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  avatarEmpty: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  avatarText: { color: t.c.text, fontSize: t.font.size.xs, fontWeight: '800' },
  note: { color: t.c.textFaint, fontSize: t.font.size.xs },
  action: {
    minHeight: 52,
    borderRadius: t.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.space.xs,
  },
  actionText: { fontSize: t.font.size.md, fontWeight: '800' },
}));
