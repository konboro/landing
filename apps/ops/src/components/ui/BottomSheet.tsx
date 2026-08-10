// Draggable bottom sheet — the ops app's main way of showing detail without
// leaving the map.
//
// Why the *classic* gesture-handler API (`PanGestureHandler` + `Animated.event`)
// and not `Gesture.Pan()`: this app has no react-native-reanimated. Without it
// `GestureDetector` quietly falls back to running every frame of the drag on the
// JS thread, which stutters the moment the map or a list is doing work. The
// classic handler feeds `Animated.event` with `useNativeDriver: true`, so the
// finger-tracking runs on the UI thread regardless of what JS is busy with.
//
// Geometry: the sheet is always the height of the TALLEST snap point and is
// pinned to the bottom edge. A snap point is expressed as an offset — how far
// down the sheet is pushed — so the partially-open state simply shows the top
// slice of the sheet and dragging up reveals the rest. Offset 0 = tallest snap,
// offset = sheetHeight = fully dismissed.
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Animated,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  State,
  type PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, makeStyles, withAlpha } from '../../brand';
import { palette } from '../../lib/theme';
import { Icon } from './Icon';

/**
 * Drag further than this past the smallest snap point and we read it as "get
 * this off my screen" rather than "resize it". 72 px ≈ a deliberate thumb
 * flick — small enough to feel light, large enough that a glove resting on the
 * handle while the van moves does not dismiss the sheet.
 */
const DISMISS_TRAVEL = 72;

/** Release faster than this (px/s) and direction wins over position. */
const FLING_VELOCITY = 1100;

/**
 * How far ahead a release is projected, in seconds. A flick is judged by where
 * it was *going*, not where the finger happened to leave the glass.
 */
const PROJECTION_S = 0.12;

const SPRING = { useNativeDriver: true, stiffness: 260, damping: 28, mass: 1 } as const;

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  /** Heights as fractions of the screen, ascending. */
  snapPoints?: number[];
  /** Index into the (sorted) snap points to open at. */
  initialSnap?: number;
  showHandle?: boolean;
}

export function BottomSheet({
  open,
  onClose,
  children,
  title,
  snapPoints = [0.4, 0.85],
  initialSnap = 0,
  showHandle = true,
}: BottomSheetProps) {
  const theme = useTheme();
  const st = useStyles(theme);
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();

  // Never let a sheet reach the status bar: the strip of map left above it is
  // what tells the user they are still on the map, and it is the tap target for
  // dismissing without a drag.
  const ceiling = Math.max(240, winH - insets.top - theme.space.xxl);
  const snapKey = snapPoints.join(',');

  const { heights, sheetH } = useMemo(() => {
    const hs = snapPoints
      .map((f) => Math.min(ceiling, Math.round(winH * f)))
      .filter((h) => h > 0)
      .sort((a, b) => a - b);
    const list = hs.length > 0 ? hs : [Math.round(winH * 0.4)];
    return { heights: list, sheetH: list[list.length - 1] ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapKey, winH, ceiling]);

  /** Snap offsets, descending (offsets[0] = smallest sheet = biggest offset). */
  const offsets = useMemo(() => heights.map((h) => sheetH - h), [heights, sheetH]);
  const closedOffset = sheetH;
  const restOffset = offsets[Math.min(Math.max(initialSnap, 0), offsets.length - 1)] ?? 0;
  const lowestOffset = offsets[0] ?? 0;

  // `base` = where the sheet rests, `drag` = the live finger delta. Keeping them
  // separate is what lets the drag stay native-driven while JS owns the snapping.
  const base = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const restRef = useRef(0);

  const translateY = useMemo(
    () =>
      Animated.add<number>(base, drag).interpolate({
        // Identity mapping whose only job is the clamp: you cannot drag the
        // sheet above its tallest snap point, so there is never a gap under it.
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolateLeft: 'clamp',
      }),
    [base, drag],
  );

  const scrimOpacity = useMemo(
    () =>
      translateY.interpolate({
        inputRange: [lowestOffset, closedOffset],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      }),
    [translateY, lowestOffset, closedOffset],
  );

  useEffect(() => {
    drag.setValue(0);
    if (!open) {
      // Park it off-screen while hidden so the next open never flashes a frame
      // at the previous resting position.
      base.setValue(closedOffset);
      restRef.current = closedOffset;
      return;
    }
    base.setValue(closedOffset);
    restRef.current = restOffset;
    Animated.spring(base, { ...SPRING, toValue: restOffset }).start();
  }, [open, base, drag, closedOffset, restOffset]);

  /**
   * Animate down first, THEN tell the parent — so by the time `open` flips to
   * false and this renders null, the sheet is already off the glass and the
   * unmount is invisible.
   */
  const dismiss = useCallback(() => {
    Animated.timing(base, { toValue: closedOffset, duration: 190, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) onClose();
      },
    );
  }, [base, closedOffset, onClose]);

  const onPan = useMemo(
    () => Animated.event([{ nativeEvent: { translationY: drag } }], { useNativeDriver: true }),
    [drag],
  );

  const onPanState = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state, translationY, velocityY } = e.nativeEvent;

      if (state === State.BEGAN) {
        // Grabbing mid-spring must continue from where the sheet actually is.
        base.stopAnimation((v) => {
          restRef.current = v;
          base.setValue(v);
        });
        return;
      }
      if (state !== State.END && state !== State.CANCELLED && state !== State.FAILED) return;

      // Fold the finger delta back into `base` in the same tick we zero `drag`,
      // so the composed translation never jumps.
      const settled = Math.min(Math.max(restRef.current + translationY, 0), closedOffset);
      base.setValue(settled);
      drag.setValue(0);
      restRef.current = settled;

      const projected = settled + velocityY * PROJECTION_S;
      const flungDown = velocityY > FLING_VELOCITY;
      const flungUp = velocityY < -FLING_VELOCITY;

      if (!flungUp && (flungDown || projected > lowestOffset + DISMISS_TRAVEL)) {
        dismiss();
        return;
      }

      let target = offsets[0] ?? 0;
      for (const o of offsets) {
        if (Math.abs(o - projected) < Math.abs(target - projected)) target = o;
      }
      restRef.current = target;
      Animated.spring(base, { ...SPRING, toValue: target }).start();
    },
    [base, drag, offsets, closedOffset, lowestOffset, dismiss],
  );

  if (!open) return null;

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={dismiss}>
      {/*
        A RN Modal hosts its own native view tree on Android, outside the root
        view mounted in _layout.tsx — without a root here the pan handler never
        sees a touch.
      */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, st.scrim, { opacity: scrimOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>

        <Animated.View
          style={[
            st.sheet,
            { height: sheetH, paddingBottom: insets.bottom, transform: [{ translateY }] },
          ]}
        >
          <PanGestureHandler
            onGestureEvent={onPan}
            onHandlerStateChange={onPanState}
            // Let a tap on the header's close button through: the pan only takes
            // over once the finger has actually travelled.
            activeOffsetY={[-8, 8]}
          >
            <Animated.View style={st.grab}>
              {showHandle ? <View style={st.handle} /> : null}
              {title ? <SheetHeader title={title} onClose={dismiss} /> : null}
            </Animated.View>
          </PanGestureHandler>

          <View style={st.body}>{children}</View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Title row for a sheet: title on the left, caller actions then close on the right. */
export function SheetHeader({
  title,
  actions,
  onClose,
}: {
  title: string;
  actions?: React.ReactNode;
  onClose?: () => void;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  return (
    <View style={st.header}>
      <Text style={st.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={st.headerActions}>
        {actions}
        {onClose ? (
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [st.closeBtn, pressed && { opacity: 0.6 }]}
          >
            <Icon name="close" size={22} color={theme.c.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // A scrim is black in every theme — deriving it from `c.bg` would produce a
  // white veil in light mode, which reads as a bug rather than as depth.
  scrim: { backgroundColor: withAlpha(palette.ink900, 0.55) },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.c.surface,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    borderTopWidth: 1,
    borderColor: t.c.border,
  },
  // The whole strip is the grab target, not just the 40 px handle — a gloved
  // thumb cannot reliably land on a bar that thin.
  grab: { paddingTop: t.space.sm, minHeight: t.tap.min },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: t.c.border,
    marginBottom: t.space.xs,
  },
  body: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.space.sm,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.sm,
  },
  headerTitle: { flex: 1, color: t.c.text, fontSize: t.font.size.lg, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.pill,
  },
}));
