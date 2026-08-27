// Vehicle notes — the thread, not the field.
//
// `vehicles.notes` is a single overwritable string: the second mechanic on a
// scooter erases what the first one saw. This screen reads `vehicle_notes`,
// which keeps who wrote what and when, and renders it as a conversation because
// that is what it is — a handover between two people who will never meet on
// shift.
//
// Offline is the normal case here (basements, garages, dead zones), so a note
// appears the instant it is written, dimmed with a clock, and un-dims when the
// outbox flushes it.
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
  Image,
  StyleSheet,
  type KeyboardEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Empty, Muted, Icon, PhotoStrip } from '../../../components/ui';
import { PhotoButton, type CapturedPhoto } from '../../../components/PhotoCapture';
import { useMirror } from '../../../lib/useMirror';
import { getVehicle, getVehicleNotes } from '../../../offline/repo';
import { addVehicleNote } from '../../../offline/actions';
import { useOps } from '../../../lib/store';
import { relativeTime } from '@penny/ui';
import { useTheme, makeStyles, withAlpha } from '../../../brand';
import type { OpsVehicle, VehicleNote } from '../../../lib/types';

/**
 * How much of the window the keyboard actually covers.
 *
 * KeyboardAvoidingView alone is not enough on Android: Expo ships edge-to-edge,
 * and an edge-to-edge window is NOT resized for the keyboard on Android 15+, so
 * the composer ends up underneath it — the exact bug the rider app hit. The
 * measurement is self-correcting: if the window DID resize, the overlap comes
 * out ~0 and we add no padding, so the two mechanisms never double up.
 */
function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    // iOS reports the frame before the animation, so the layout moves WITH the
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

/** Local file URIs preview immediately; a remote storage key cannot. */
function displayable(uri: string): boolean {
  return /^(https?|file|data|content|asset|ph):/i.test(uri);
}

export default function VehicleNotes() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicle = useMirror<OpsVehicle | null>(() => getVehicle(id!), null);
  const v = vehicle.data;

  if (!v) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <Empty text={vehicle.loading ? 'Loading…' : 'Vehicle not found.'} />
      </SafeAreaView>
    );
  }
  return <Thread v={v} />;
}

function Thread({ v }: { v: OpsVehicle }) {
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c, space } = theme;
  const insets = useSafeAreaInsets();
  const overlap = useKeyboardOverlap();

  const notes = useMirror<VehicleNote[]>(() => getVehicleNotes(v.id), []);
  const myStaffId = useOps((s) => s.session?.staff_id ?? null);

  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<CapturedPhoto[]>([]);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const canSend = draft.trim().length > 0 || attached.length > 0;

  const send = useCallback(async () => {
    if (!canSend || sending) return;
    const body = draft.trim();
    const photos = attached.map((p) => p.remotePath);
    // Clear first so the composer feels instant; the note is written to the
    // mirror synchronously by the action, so it reappears as a bubble anyway.
    setDraft('');
    setAttached([]);
    setSending(true);
    try {
      await addVehicleNote(v, body, photos);
    } catch {
      setDraft(body); // hand the words back rather than losing them
    } finally {
      setSending(false);
    }
  }, [attached, canSend, draft, sending, v]);

  // Repo returns newest first, which is exactly the order an inverted list
  // wants: index 0 renders at the bottom, next to the composer.
  const data = notes.data;

  // On iOS the KeyboardAvoidingView above already lifts the composer, so the
  // measured overlap is only used to drop the home-indicator inset. On Android
  // the avoider is a no-op (see useKeyboardOverlap) and the overlap IS the lift.
  const composerPad = useMemo(() => {
    const lift = Platform.OS === 'ios' ? 0 : overlap;
    return lift + (overlap > 0 ? space.sm : Math.max(insets.bottom, space.sm));
  }, [overlap, insets.bottom, space.sm]);

  return (
    <SafeAreaView style={st.screen} edges={['top', 'left', 'right']}>
      {/* Own header: the thread needs a subtitle (which vehicle) and the
          composer needs the keyboard offset to be zero. */}
      <Stack.Screen options={{ headerShown: false }} />

      <View style={st.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace(`/vehicle/${v.id}`))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [st.headerBtn, pressed && st.pressed]}
        >
          <Icon name="back" size={24} color={c.text} />
        </Pressable>
        <View style={st.headerTitle}>
          <Text style={st.title} numberOfLines={1}>
            Notes
          </Text>
          <Muted>Vehicle № {v.code}</Muted>
        </View>
        {/* Balances the back button so the title stays optically centred. */}
        <View style={st.headerBtn} />
      </View>

      <KeyboardAvoidingView
        style={st.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={data}
          inverted
          keyExtractor={(n) => n.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          // Wrapped in a View because VirtualizedList clones the empty element
          // with the inversion transform — a component that ignores `style`
          // would render the text upside down.
          ListEmptyComponent={
            <View>
              <Empty text="No notes yet. Write the first one." />
            </View>
          }
          renderItem={({ item }) => <NoteBubble note={item} mine={!!myStaffId && item.staff_id === myStaffId} />}
        />

        <View style={[st.composer, { paddingBottom: composerPad }]}>
          {attached.length > 0 ? (
            <View style={st.attachRow}>
              {attached.map((p, i) => (
                <View key={p.remotePath} style={st.attach}>
                  {displayable(p.localUri) ? (
                    <Image source={{ uri: p.localUri }} style={st.attachImage} resizeMode="cover" />
                  ) : (
                    <Icon name="photo" size={22} color={c.textMuted} />
                  )}
                  <Pressable
                    onPress={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
                    hitSlop={14}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove attachment ${i + 1}`}
                    style={({ pressed }) => [st.attachRemove, pressed && st.pressed]}
                  >
                    <Icon name="close" size={13} color={c.text} strokeWidth={2.4} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <View style={st.composerRow}>
            {/* Reuses the app's one camera path (permissions, queueing, the
                placeholder fallback) instead of a second capture flow. */}
            <View style={st.camSlot}>
              <PhotoButton
                label=""
                vehicleId={v.id}
                onCaptured={(p) => setAttached((prev) => [...prev, p])}
              />
            </View>

            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder="Enter text…"
              placeholderTextColor={c.textFaint}
              multiline
              style={st.input}
            />

            <Pressable
              onPress={() => void send()}
              disabled={!canSend || sending}
              accessibilityRole="button"
              accessibilityLabel="Send note"
              style={({ pressed }) => [
                st.send,
                (!canSend || sending) && { opacity: 0.4 },
                pressed && st.pressed,
              ]}
            >
              <Icon name="send" size={22} color={c.onPrimary} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function NoteBubble({ note, mine }: { note: VehicleNote; mine: boolean }) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;

  const ink = mine ? c.onPrimary : c.text;
  const inkDim = withAlpha(ink, 0.75);

  return (
    <View
      style={[
        st.bubble,
        mine ? st.bubbleMine : st.bubbleTheirs,
        // Pending notes are dimmed, not hidden: the mechanic must be able to
        // read back what they just wrote while still offline.
        note.pending ? { opacity: 0.65 } : null,
      ]}
    >
      <View style={st.bubbleHead}>
        <Text style={[st.author, { color: inkDim }]} numberOfLines={1}>
          {mine ? 'You' : (note.staff_name ?? 'Ops')}
        </Text>
        <View style={st.stamp}>
          {note.pending ? <Icon name="clock" size={13} color={inkDim} strokeWidth={2} /> : null}
          <Text style={[st.time, { color: inkDim }]}>{relativeTime(note.created_at)}</Text>
        </View>
      </View>

      {note.body.trim() ? <Text style={[st.body, { color: ink }]}>{note.body.trim()}</Text> : null}

      {note.photos.length > 0 ? <PhotoStrip photos={note.photos} size={84} /> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.c.bg },
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

  bubble: {
    maxWidth: '86%',
    gap: t.space.xs,
    padding: t.space.md,
    borderRadius: t.radius.lg,
    borderWidth: 1,
  },
  // The corner nearest the speaker is squared off so the column reads as a
  // conversation rather than as two stacks of identical pills.
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
  // Wide enough that the camera glyph is not squeezed by the button's padding.
  camSlot: { width: 64 },
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
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm, paddingTop: t.space.xs },
  attach: {
    width: 60,
    height: 60,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  attachImage: { width: '100%', height: '100%', borderRadius: t.radius.md },
  attachRemove: {
    // Kept INSIDE the tile: Android does not deliver touches to a child drawn
    // outside its parent's bounds, so a prettier overhang would be a dead tap.
    position: 'absolute',
    top: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
  },
}));
