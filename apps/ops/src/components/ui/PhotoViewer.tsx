// Full-screen photo viewer — pinch, pan, double-tap, swipe between shots.
//
// Damage evidence is the reason this exists: a mechanic has to be able to zoom
// into a hairline crack on a deck photo taken by a rider three days ago, on a
// phone, in the sun. A thumbnail grid alone is useless for that.
//
// Gesture stack, outermost first:
//   ScrollView (paging)   — horizontal swipe between photos, disabled while zoomed
//     TapGestureHandler   — double-tap toggles 1× / 2.5×
//       PinchGestureHandler
//         PanGestureHandler — enabled only while zoomed, so at 1× the swipe
//                             belongs to the pager
//
// As in BottomSheet, we use the classic handler components + `Animated.event`
// with `useNativeDriver: true`: there is no reanimated in this app, so the
// modern `GestureDetector` would run the whole pinch on the JS thread.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  Animated,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView as RNScrollView,
} from 'react-native';
import {
  GestureHandlerRootView,
  ScrollView,
  PanGestureHandler,
  PinchGestureHandler,
  TapGestureHandler,
  State,
  type PanGestureHandlerStateChangeEvent,
  type PinchGestureHandlerStateChangeEvent,
  type TapGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPhotoLocalUris } from '../../offline/repo';
import { useTheme, makeStyles, withAlpha } from '../../brand';
import { palette } from '../../lib/theme';
import { Icon } from './Icon';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
/** Double-tap target. 2.5× is where a 12 MP photo of a scooter deck starts to show damage detail. */
const DOUBLE_TAP_SCALE = 2.5;
/** Below this we treat the gesture as "back to fit" rather than "slightly zoomed". */
const ZOOMED_EPSILON = 1.02;

const SPRING = { useNativeDriver: true, stiffness: 220, damping: 26, mass: 1 } as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Only some URI schemes can actually be handed to <Image>. Ops photos captured
 * without a camera get a synthetic `placeholder://` URI (see PhotoCapture), and
 * feeding that to Image logs a decode error on every render.
 */
function isDisplayable(uri: string): boolean {
  return /^(https?|file|data|content|asset|ph):/i.test(uri);
}

/**
 * Records store the REMOTE storage path (`ops-photos/<vehicle>/<file>.jpg`)
 * because that is what the server will know the photo by — but until the
 * upload lands, that path points at nothing. So every thumbnail was blank for
 * exactly the window the crew cares about most: just after taking the photo,
 * in the field, offline.
 *
 * Resolving it here rather than in each screen means damages, notes, tasks and
 * status changes all get it for free, and no screen has to remember.
 */
function useResolvedPhotos(photos: string[]): string[] {
  const [local, setLocal] = useState<Record<string, string>>({});
  const pending = useMemo(
    () => photos.filter((p) => !isDisplayable(p) && !p.startsWith('placeholder:')),
    [photos],
  );
  const key = pending.join('|');

  useEffect(() => {
    if (!pending.length) return;
    let alive = true;
    void getPhotoLocalUris(pending)
      .then((map) => { if (alive) setLocal((prev) => ({ ...prev, ...map })); })
      // A missing local copy is the normal steady state once a photo has
      // uploaded — fall through to the remote URI rather than surfacing it.
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => photos.map((p) => local[p] ?? p), [photos, local]);
}

export interface PhotoViewerProps {
  photos: string[];
  /** Index to open on. */
  index: number;
  open: boolean;
  onClose: () => void;
}

export function PhotoViewer({ photos: rawPhotos, index, open, onClose }: PhotoViewerProps) {
  const photos = useResolvedPhotos(rawPhotos);
  const theme = useTheme();
  const st = useStyles(theme);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const scrollRef = useRef<RNScrollView>(null);
  const [page, setPage] = useState(index);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPage(index);
    setZoomed(false);
    // The ScrollView is laid out in the same commit, so jump after it exists.
    const id = setTimeout(() => scrollRef.current?.scrollTo({ x: index * width, animated: false }), 0);
    return () => clearTimeout(id);
  }, [open, index, width]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
      setPage(clamp(next, 0, photos.length - 1));
    },
    [width, photos.length],
  );

  if (!open || photos.length === 0) return null;

  return (
    <Modal transparent={false} visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Android modals get their own view tree; without a root here no handler fires. */}
      <GestureHandlerRootView style={st.root}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          // While a photo is zoomed the horizontal swipe means "pan the photo",
          // not "next photo" — otherwise you can never reach its left edge.
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          style={st.root}
        >
          {photos.map((uri, i) => (
            <ZoomablePhoto
              key={`${i}:${uri}`}
              uri={uri}
              width={width}
              height={height}
              // Only the visible page may report zoom, or an off-screen page
              // that was left zoomed would lock the pager.
              onZoomChange={i === page ? setZoomed : undefined}
            />
          ))}
        </ScrollView>

        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={({ pressed }) => [st.close, { top: insets.top + theme.space.sm }, pressed && { opacity: 0.6 }]}
        >
          <Icon name="close" size={24} color={palette.white} />
        </Pressable>

        {photos.length > 1 ? (
          <View style={[st.counter, { bottom: insets.bottom + theme.space.xl }]}>
            <Text style={st.counterText}>
              {page + 1} / {photos.length}
            </Text>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

function ZoomablePhoto({
  uri,
  width,
  height,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);

  const pinchRef = useRef<PinchGestureHandler>(null);
  const panRef = useRef<PanGestureHandler>(null);

  // Resting transform (JS-owned) vs live gesture delta (native-driven).
  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const baseX = useRef(new Animated.Value(0)).current;
  const baseY = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  const scaleRef = useRef(1);
  const xRef = useRef(0);
  const yRef = useRef(0);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    onZoomChange?.(zoomed);
  }, [zoomed, onZoomChange]);

  const scale = useMemo(
    () =>
      Animated.multiply<number>(baseScale, pinchScale).interpolate({
        // Live clamp so a two-finger yank cannot blow the photo up to 40×.
        // The floor is deliberately below 1 — pinching in past "fit" rubber-bands
        // and springs back, which is how you confirm you are already at fit.
        inputRange: [0.55, MAX_SCALE],
        outputRange: [0.55, MAX_SCALE],
        extrapolate: 'clamp',
      }),
    [baseScale, pinchScale],
  );
  const translateX = useMemo(() => Animated.add<number>(baseX, dragX), [baseX, dragX]);
  const translateY = useMemo(() => Animated.add<number>(baseY, dragY), [baseY, dragY]);

  /** How far the photo may be pushed before empty space appears at an edge. */
  const bounds = useCallback(
    (s: number) => ({
      x: Math.max(0, (width * (s - 1)) / 2),
      y: Math.max(0, (height * (s - 1)) / 2),
    }),
    [width, height],
  );

  const reset = useCallback(() => {
    scaleRef.current = 1;
    xRef.current = 0;
    yRef.current = 0;
    setZoomed(false);
    pinchScale.setValue(1);
    dragX.setValue(0);
    dragY.setValue(0);
    Animated.parallel([
      Animated.spring(baseScale, { ...SPRING, toValue: 1 }),
      Animated.spring(baseX, { ...SPRING, toValue: 0 }),
      Animated.spring(baseY, { ...SPRING, toValue: 0 }),
    ]).start();
  }, [baseScale, baseX, baseY, pinchScale, dragX, dragY]);

  const onPinch = useMemo(
    () => Animated.event([{ nativeEvent: { scale: pinchScale } }], { useNativeDriver: true }),
    [pinchScale],
  );

  const onPinchState = useCallback(
    (e: PinchGestureHandlerStateChangeEvent) => {
      const { state, scale: gestureScale } = e.nativeEvent;
      if (state !== State.END && state !== State.CANCELLED && state !== State.FAILED) return;

      const next = clamp(scaleRef.current * gestureScale, 0.55, MAX_SCALE);
      if (next <= ZOOMED_EPSILON) {
        reset();
        return;
      }
      // Fold the gesture factor into the resting scale in one tick: the product
      // baseScale × pinchScale is unchanged, so nothing jumps.
      scaleRef.current = next;
      baseScale.setValue(next);
      pinchScale.setValue(1);
      setZoomed(true);

      // Shrinking can leave the photo off-centre with a gap; pull it back in.
      const b = bounds(next);
      const tx = clamp(xRef.current, -b.x, b.x);
      const ty = clamp(yRef.current, -b.y, b.y);
      if (tx !== xRef.current || ty !== yRef.current) {
        xRef.current = tx;
        yRef.current = ty;
        Animated.parallel([
          Animated.spring(baseX, { ...SPRING, toValue: tx }),
          Animated.spring(baseY, { ...SPRING, toValue: ty }),
        ]).start();
      }
    },
    [baseScale, pinchScale, baseX, baseY, bounds, reset],
  );

  const onPan = useMemo(
    () =>
      Animated.event([{ nativeEvent: { translationX: dragX, translationY: dragY } }], {
        useNativeDriver: true,
      }),
    [dragX, dragY],
  );

  const onPanState = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state, translationX, translationY } = e.nativeEvent;
      if (state !== State.END && state !== State.CANCELLED && state !== State.FAILED) return;

      const nx = xRef.current + translationX;
      const ny = yRef.current + translationY;
      baseX.setValue(nx);
      baseY.setValue(ny);
      dragX.setValue(0);
      dragY.setValue(0);

      const b = bounds(scaleRef.current);
      const tx = clamp(nx, -b.x, b.x);
      const ty = clamp(ny, -b.y, b.y);
      xRef.current = tx;
      yRef.current = ty;
      Animated.parallel([
        Animated.spring(baseX, { ...SPRING, toValue: tx }),
        Animated.spring(baseY, { ...SPRING, toValue: ty }),
      ]).start();
    },
    [baseX, baseY, dragX, dragY, bounds],
  );

  const onDoubleTap = useCallback(
    (e: TapGestureHandlerStateChangeEvent) => {
      if (e.nativeEvent.state !== State.ACTIVE) return;
      if (scaleRef.current > ZOOMED_EPSILON) {
        reset();
        return;
      }
      // Zooms to centre rather than to the tap point: predictable, and the pan
      // that follows is how a mechanic actually hunts across the frame anyway.
      scaleRef.current = DOUBLE_TAP_SCALE;
      setZoomed(true);
      Animated.spring(baseScale, { ...SPRING, toValue: DOUBLE_TAP_SCALE }).start();
    },
    [baseScale, reset],
  );

  return (
    <TapGestureHandler numberOfTaps={2} onHandlerStateChange={onDoubleTap}>
      <Animated.View style={[st.page, { width, height }]}>
        <PinchGestureHandler
          ref={pinchRef}
          simultaneousHandlers={panRef}
          onGestureEvent={onPinch}
          onHandlerStateChange={onPinchState}
        >
          <Animated.View style={st.fill}>
            <PanGestureHandler
              ref={panRef}
              simultaneousHandlers={pinchRef}
              enabled={zoomed}
              minPointers={1}
              onGestureEvent={onPan}
              onHandlerStateChange={onPanState}
            >
              <Animated.View
                style={[st.fill, { transform: [{ translateX }, { translateY }, { scale }] }]}
              >
                {isDisplayable(uri) ? (
                  <Image source={{ uri }} style={[st.photo, { width, height }]} resizeMode="contain" />
                ) : (
                  <View style={[st.fill, st.missing]}>
                    <Icon name="photo" size={40} color={palette.ink300} />
                    <Text style={st.missingText}>Photo not uploaded yet</Text>
                  </View>
                )}
              </Animated.View>
            </PanGestureHandler>
          </Animated.View>
        </PinchGestureHandler>
      </Animated.View>
    </TapGestureHandler>
  );
}

/**
 * Row of thumbnails for damage reports and note attachments. With no `onPress`
 * it opens the full-screen viewer itself, which is what almost every call site
 * wants; pass `onPress` when the row is a picker rather than a gallery.
 */
export function PhotoStrip({
  photos: rawPhotos,
  onPress,
  size = 72,
}: {
  photos: string[];
  onPress?: (index: number) => void;
  size?: number;
}) {
  // Thumbnails resolve the same way the viewer does — a strip of blank tiles
  // over a queued upload is the exact case this is for.
  const photos = useResolvedPhotos(rawPhotos);
  const theme = useTheme();
  const st = useStyles(theme);
  const [viewer, setViewer] = useState<number | null>(null);

  if (photos.length === 0) return null;

  return (
    <>
      <View style={st.strip}>
        {photos.map((uri, i) => (
          <Pressable
            key={`${i}:${uri}`}
            onPress={() => (onPress ? onPress(i) : setViewer(i))}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
            style={({ pressed }) => [
              st.thumb,
              { width: size, height: size, borderRadius: theme.radius.md },
              pressed && { opacity: 0.7 },
            ]}
          >
            {isDisplayable(uri) ? (
              <Image source={{ uri }} style={st.thumbImage} resizeMode="cover" />
            ) : (
              <Icon name="photo" size={Math.round(size / 3)} color={theme.c.textMuted} />
            )}
          </Pressable>
        ))}
      </View>
      <PhotoViewer
        photos={photos}
        index={viewer ?? 0}
        open={viewer !== null}
        onClose={() => setViewer(null)}
      />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  // Viewer chrome is deliberately black in every theme — a photo is judged
  // against neutral ground, not against the brand surface. That also means its
  // ink comes from the palette, not from `c.text`, which inverts with the mode.
  root: { flex: 1, backgroundColor: palette.black },
  page: { alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photo: { backgroundColor: palette.black },
  missing: { gap: t.space.sm },
  missingText: { color: palette.ink300, fontSize: t.font.size.sm },
  close: {
    position: 'absolute',
    right: t.space.lg,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(palette.ink900, 0.55),
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.xs,
    borderRadius: t.radius.pill,
    backgroundColor: withAlpha(palette.ink900, 0.65),
  },
  counterText: { color: palette.white, fontSize: t.font.size.md, fontWeight: '700' },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  thumb: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  thumbImage: { width: '100%', height: '100%' },
}));
