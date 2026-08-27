// Dispatch chat — the crew member's line to the control room.
//
// A field tech standing next to a scooter with a problem the app has no button
// for (wrong address, key missing, van full, "is this one really stolen?") has
// had exactly one option: phone someone. This is the written channel, and it
// runs through the same message centre the admin panel's Message centre already
// answers — so a reply is a reply, not a second inbox nobody watches.
//
// Unlike everything else in this app, it is ONLINE-ONLY on purpose: see the
// header of `services/supportChat.ts`. A queued cry for help is worse than an
// honest failure, so a send that fails stays on screen with a retry.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Dimensions,
  Platform,
  StyleSheet,
  type KeyboardEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { relativeTime } from '@penny/ui';
import { Screen, Card, Button, Muted, Empty, Icon } from '../components/ui';
import { useTheme, makeStyles, withAlpha } from '../brand';
import {
  getChat,
  isAvailable,
  markRead,
  sendChatMessage,
  subscribeChat,
  SupportChatError,
  type ChatMessage,
} from '../services/supportChat';

/**
 * How much of the window the keyboard actually covers.
 *
 * Copied from `vehicle/[id]/notes.tsx` rather than imported, so the two chat-
 * shaped screens stay independent — but the reasoning is the same one and must
 * not be dropped: Expo ships edge-to-edge and an edge-to-edge window is NOT
 * resized for the keyboard on Android 15+, so <KeyboardAvoidingView> alone
 * leaves the composer underneath it. That bug shipped once in the rider app.
 * The measurement is self-correcting: if the window DID resize, the overlap is
 * ~0 and no extra padding is added, so the two mechanisms never double up.
 */
function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    // iOS reports the frame before the animation, so the layout travels WITH the
    // keyboard instead of snapping after it. Android only has the Did events.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      const screenY = e?.endCoordinates?.screenY;
      if (typeof screenY !== 'number') return;
      setOverlap(Math.max(0, Dimensions.get('window').height - screenY));
    };

    const show = Keyboard.addListener(showEvent, onShow);
    const hide = Keyboard.addListener(hideEvent, () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return overlap;
}

/** A turn that is on its way out, or failed on the way out. */
interface PendingTurn {
  localId: string;
  body: string;
  failed: boolean;
}

type Row =
  | { key: string; kind: 'sent'; message: ChatMessage }
  | { key: string; kind: 'pending'; turn: PendingTurn };

let localSeq = 0;

/** Newest first (the order an inverted list wants), de-duplicated by id.
 *  The realtime socket echoes our own INSERT back, so without this every
 *  message we send would appear twice. */
function merge(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (list.some((m) => m.id === incoming.id)) return list;
  return [incoming, ...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export default function DispatchChat() {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;
  const insets = useSafeAreaInsets();
  const overlap = useKeyboardOverlap();
  const available = isAvailable();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Row>>(null);

  const load = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    try {
      const thread = await getChat();
      // Held newest-first because the list is inverted.
      setMessages([...thread].reverse());
      setError(null);
      // Opening the thread IS reading it; the badge must clear even if dispatch
      // replied while the app was closed.
      void markRead().catch(() => undefined);
    } catch (e) {
      setError(e instanceof SupportChatError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!available) return undefined;
    // The unsubscribe is the whole point of the return value: without it the
    // channel outlives the screen and keeps pushing into a dead setState.
    return subscribeChat((m) => {
      setMessages((prev) => merge(prev, m));
      if (m.sender === 'staff') void markRead().catch(() => undefined);
    });
  }, [available]);

  const rows = useMemo<Row[]>(() => {
    // Pending turns are the newest thing on screen, and an inverted list draws
    // index 0 at the bottom — so they come first, newest of them first.
    const p: Row[] = [...pending]
      .reverse()
      .map((turn) => ({ key: turn.localId, kind: 'pending' as const, turn }));
    const s: Row[] = messages.map((message) => ({ key: message.id, kind: 'sent' as const, message }));
    return [...p, ...s];
  }, [messages, pending]);

  // Newest lives at offset 0 on an inverted list.
  useEffect(() => {
    if (rows.length === 0) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [rows.length]);

  const deliver = useCallback(async (localId: string, body: string) => {
    try {
      const saved = await sendChatMessage(body);
      setMessages((prev) => merge(prev, saved));
      setPending((prev) => prev.filter((t) => t.localId !== localId));
    } catch {
      // Kept on screen, marked failed. Losing what someone typed in a stairwell
      // is how a chat channel stops being trusted.
      setPending((prev) => prev.map((t) => (t.localId === localId ? { ...t, failed: true } : t)));
    }
  }, []);

  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || !available) return;
    const localId = `local-${(localSeq += 1)}`;
    setDraft('');
    setPending((prev) => [...prev, { localId, body, failed: false }]);
    void deliver(localId, body);
  }, [available, deliver, draft]);

  const retry = useCallback(
    (turn: PendingTurn) => {
      setPending((prev) => prev.map((t) => (t.localId === turn.localId ? { ...t, failed: false } : t)));
      void deliver(turn.localId, turn.body);
    },
    [deliver],
  );

  // On iOS the avoider above lifts the composer, so the measured overlap only
  // drops the home-indicator inset. On Android the avoider is a no-op and the
  // overlap IS the lift.
  const composerPad = useMemo(() => {
    const lift = Platform.OS === 'ios' ? 0 : overlap;
    return lift + (overlap > 0 ? space.sm : Math.max(insets.bottom, space.sm));
  }, [overlap, insets.bottom, space.sm]);

  return (
    <Screen pad={false} style={st.flex}>
      {/* Own header: the keyboard offset must be zero for the composer to sit
          exactly on the keyboard, and the title needs a subtitle. */}
      <Stack.Screen options={{ headerShown: false }} />

      <View style={st.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [st.headerBtn, pressed && st.pressed]}
        >
          <Icon name="back" size={24} color={c.text} />
        </Pressable>
        <View style={st.headerTitle}>
          <Text style={st.title} numberOfLines={1}>
            Dispatch
          </Text>
          <Muted>Support &amp; control room</Muted>
        </View>
        <View style={st.headerBtn} />
      </View>

      {!available ? (
        <Card style={st.banner}>
          <View style={st.bannerRow}>
            <Icon name="info" size={20} color={c.warning} />
            <Text style={st.bannerText}>
              Demo mode — dispatch chat needs the live backend. Nothing you type here is sent.
            </Text>
          </View>
        </Card>
      ) : null}

      {error ? (
        <Card style={st.banner}>
          <View style={st.bannerRow}>
            <Icon name="alert" size={20} color={c.danger} />
            <Text style={st.bannerText}>{error}</Text>
          </View>
          <Button title="Try again" variant="secondary" icon="refresh" onPress={() => void load()} />
        </Card>
      ) : null}

      <KeyboardAvoidingView
        style={st.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={rows}
          inverted
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          // Wrapped in a View because VirtualizedList clones the empty element
          // with the inversion transform — a bare component would render upside
          // down.
          ListEmptyComponent={
            <View>
              {loading ? (
                <Empty text="Loading the conversation…" />
              ) : (
                <Empty text="Ask dispatch — they see your vehicle and your shift. Anything the app has no button for goes here." />
              )}
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'sent' ? (
              <SentBubble message={item.message} />
            ) : (
              <PendingBubble turn={item.turn} onRetry={retry} />
            )
          }
        />

        <View style={[st.composer, { paddingBottom: composerPad }]}>
          <View style={st.composerRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={available ? 'Message dispatch…' : 'Unavailable in demo mode'}
              placeholderTextColor={c.textFaint}
              editable={available}
              multiline
              style={st.input}
              accessibilityLabel="Message to dispatch"
            />
            <Pressable
              onPress={send}
              disabled={!available || draft.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={({ pressed }) => [
                st.send,
                (!available || draft.trim().length === 0) && st.sendOff,
                pressed && st.pressed,
              ]}
            >
              <Icon name="send" size={22} color={c.onPrimary} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function SentBubble({ message }: { message: ChatMessage }) {
  const theme = useTheme();
  const st = useStyles(theme);
  const mine = message.sender !== 'staff';
  const ink = mine ? theme.c.onPrimary : theme.c.text;
  const inkDim = withAlpha(ink, 0.75);

  // `staff_id` names the agent in the DB, but `staff` is readable only for your
  // OWN row (policy staff_self_read, migration 00360) — the ops app genuinely
  // cannot resolve a colleague's name with the anon key, so the desk is named
  // instead of the person. Give it a name here the moment a staff directory
  // view exists.
  const author = mine ? 'You' : 'Dispatch';

  return (
    <View style={[st.bubble, mine ? st.bubbleMine : st.bubbleTheirs]}>
      <View style={st.bubbleHead}>
        <Text style={[st.author, { color: inkDim }]} numberOfLines={1}>
          {author}
        </Text>
        <Text style={[st.time, { color: inkDim }]}>{relativeTime(message.created_at)}</Text>
      </View>
      <Text style={[st.body, { color: ink }]}>{message.body.trim()}</Text>
    </View>
  );
}

function PendingBubble({
  turn,
  onRetry,
}: {
  turn: PendingTurn;
  onRetry: (turn: PendingTurn) => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const ink = c.onPrimary;
  const inkDim = withAlpha(ink, 0.75);

  const bubble = (
    <View
      style={[
        st.bubble,
        st.bubbleMine,
        // Dimmed, never hidden: you must be able to read back what you wrote.
        turn.failed ? st.bubbleFailed : st.bubblePending,
      ]}
    >
      <View style={st.bubbleHead}>
        <Text style={[st.author, { color: inkDim }]} numberOfLines={1}>
          You
        </Text>
        <View style={st.stamp}>
          <Icon
            name={turn.failed ? 'alert' : 'clock'}
            size={13}
            color={turn.failed ? c.danger : inkDim}
            strokeWidth={2}
          />
          <Text style={[st.time, { color: turn.failed ? c.danger : inkDim }]}>
            {turn.failed ? 'Not sent — tap to retry' : 'Sending…'}
          </Text>
        </View>
      </View>
      <Text style={[st.body, { color: ink }]}>{turn.body}</Text>
    </View>
  );

  if (!turn.failed) return bubble;
  return (
    <Pressable
      onPress={() => onRetry(turn)}
      accessibilityRole="button"
      accessibilityLabel="Retry sending this message"
      style={({ pressed }) => [st.retryWrap, pressed && st.pressed]}
    >
      {bubble}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    backgroundColor: t.c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.c.border,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.md },
  headerTitle: { flex: 1, alignItems: 'center' },
  title: { color: t.c.text, fontSize: t.font.size.lg, fontWeight: '700' },
  pressed: { opacity: 0.6 },

  banner: { marginHorizontal: t.space.lg, marginTop: t.space.md },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  bannerText: { flex: 1, color: t.c.text, fontSize: t.font.size.sm, lineHeight: t.font.size.sm * 1.35 },

  bubble: {
    maxWidth: '86%',
    gap: t.space.xs,
    padding: t.space.md,
    borderRadius: t.radius.lg,
    borderWidth: 1,
  },
  // The corner nearest the speaker is squared off so the column reads as a
  // conversation rather than two stacks of identical pills.
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: t.c.primaryDeep,
    borderColor: t.c.primaryDeep,
    borderBottomRightRadius: t.radius.sm,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: t.c.surface,
    borderColor: t.c.border,
    borderBottomLeftRadius: t.radius.sm,
  },
  bubblePending: { opacity: 0.65 },
  bubbleFailed: { borderColor: t.c.danger },
  retryWrap: { alignSelf: 'flex-end', maxWidth: '100%' },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space.md },
  author: { fontSize: t.font.size.xs, fontWeight: '700', flexShrink: 1 },
  stamp: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: t.font.size.xs, fontWeight: '600' },
  body: { fontSize: t.font.size.md, lineHeight: t.font.size.md * 1.35 },

  composer: {
    gap: t.space.sm,
    paddingHorizontal: t.space.md,
    paddingTop: t.space.sm,
    backgroundColor: t.c.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: t.c.border,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: t.space.sm },
  input: {
    flex: 1,
    minHeight: t.tap.min,
    maxHeight: 132,
    paddingHorizontal: t.space.md,
    paddingTop: t.space.sm,
    paddingBottom: t.space.sm,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.c.border,
    backgroundColor: t.c.surfaceAlt,
    color: t.c.text,
    fontSize: t.font.size.md,
  },
  send: {
    width: t.tap.min,
    height: t.tap.min,
    borderRadius: t.tap.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.primary,
  },
  sendOff: { opacity: 0.4 },
}));
