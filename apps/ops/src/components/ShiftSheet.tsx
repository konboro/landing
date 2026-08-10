// Clock in / clock out, as a self-contained control.
//
// It ships in two shapes on purpose: `ShiftControl` is the card at the top of
// My day, and `ShiftSheet` is the identical control inside a bottom sheet so
// the fleet map can start or end a shift without ever leaving the map. One
// implementation, so the timer and the counters can never disagree between the
// two places a crew member looks at them.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Card, H2, Muted, Button, Row, Field, Icon, BottomSheet } from './ui';
import { useMirror } from '../lib/useMirror';
import { getOpenShift, getShiftStats } from '../offline/repo';
import { startShift, endShift } from '../offline/actions';
import { useTheme, makeStyles, withAlpha } from '../brand';
import type { OpsShift, ShiftStats } from '../lib/types';

const NO_STATS: ShiftStats = { openTasks: 0, completedThisShift: 0, elapsedMs: null };

/** `h:mm:ss`. A shift is read as "how long have I been out", so seconds tick. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Live elapsed time since `startedAt`, or null when no shift is running.
 * Derived from the timestamp rather than counted up, so it stays correct after
 * the app is backgrounded, the device sleeps, or the JS thread stalls.
 */
export function useShiftClock(startedAt: string | null): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(null);
      return;
    }
    const at = Date.parse(startedAt);
    if (Number.isNaN(at)) {
      setElapsed(null);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Date.now() - at));
    tick(); // paint immediately instead of after the first second
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

export function ShiftControl() {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;

  const shift = useMirror<OpsShift | null>(getOpenShift, null);
  const stats = useMirror<ShiftStats>(getShiftStats, NO_STATS);
  const open = shift.data;
  const elapsed = useShiftClock(open?.started_at ?? null);

  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Both actions bump the mirror revision, so `useMirror` re-reads and the card
  // repaints itself — no manual refresh, and it works with no network.
  const begin = useCallback(async () => {
    setBusy(true);
    try {
      await startShift();
    } finally {
      setBusy(false);
    }
  }, []);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      await endShift(note.trim() || undefined);
      setNote('');
      setClosing(false);
    } finally {
      setBusy(false);
    }
  }, [note]);

  return (
    <Card style={{ borderColor: open ? c.success : c.border }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={theme.space.sm}>
          <View style={[st.glyph, { backgroundColor: withAlpha(open ? c.success : c.textMuted, 0.16) }]}>
            <Icon name="shift" size={22} color={open ? c.success : c.textMuted} strokeWidth={2} />
          </View>
          <View>
            <H2>{open ? 'On shift' : 'Off shift'}</H2>
            <Muted>{open ? 'Clocked in — work is being counted.' : 'Start a shift to count your work.'}</Muted>
          </View>
        </Row>
      </Row>

      <Text style={[st.timer, { color: open ? c.text : c.textFaint }]}>
        {elapsed == null ? '0:00:00' : formatElapsed(elapsed)}
      </Text>

      <Row style={st.counters}>
        <Counter label="Open tasks" value={stats.data.openTasks} />
        <View style={st.sep} />
        <Counter label="Completed" value={stats.data.completedThisShift} />
      </Row>

      {closing ? (
        <>
          <Field
            label="Handover note (optional)"
            value={note}
            onChangeText={setNote}
            multiline
            placeholder="Anything the next crew should know…"
          />
          <Row gap={theme.space.sm}>
            <Button
              title="Cancel"
              variant="ghost"
              style={{ flex: 1 }}
              disabled={busy}
              onPress={() => {
                setClosing(false);
                setNote('');
              }}
            />
            <Button title="End shift" variant="danger" style={{ flex: 1 }} loading={busy} onPress={() => void finish()} />
          </Row>
        </>
      ) : open ? (
        <Button title="End my shift" variant="danger" loading={busy} onPress={() => setClosing(true)} />
      ) : (
        <Button title="Start my shift" loading={busy} onPress={() => void begin()} />
      )}
    </Card>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  const st = useStyles(useTheme());
  return (
    <View style={st.counter}>
      <Text style={st.counterValue}>{value}</Text>
      <Text style={st.counterLabel}>{label}</Text>
    </View>
  );
}

/** The same control raised over whatever screen the user is on. */
export function ShiftSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  return (
    <BottomSheet open={open} onClose={onClose} title="My shift" snapPoints={[0.55]}>
      <ScrollView
        contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}
        keyboardShouldPersistTaps="handled"
      >
        <ShiftControl />
      </ScrollView>
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  glyph: { width: 42, height: 42, borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center' },
  // Tabular-ish and large: this is read from the driver's seat at a glance.
  timer: { fontSize: t.font.size.display, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  counters: { justifyContent: 'space-around', paddingVertical: t.space.xs },
  counter: { alignItems: 'center', gap: 2, flex: 1 },
  counterValue: { color: t.c.text, fontSize: t.font.size.xxl, fontWeight: '800' },
  counterLabel: { color: t.c.textMuted, fontSize: t.font.size.xs, fontWeight: '700' },
  sep: { width: 1, alignSelf: 'stretch', backgroundColor: t.c.border },
}));
