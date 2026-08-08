// Slide-to-confirm control (end-ride gesture). Uses core Animated + PanResponder
// so it needs no extra native gesture deps and runs anywhere.
import React, { useRef, useState } from 'react';
import {
  View,
  Animated,
  PanResponder,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { useTheme, makeStyles } from '../../brand';
import { Haptics } from '../../lib/native';
import { T } from './primitives';
import { Icon, type IconName } from './Icon';

const THUMB = 54;

export function SlideToConfirm({
  label,
  onConfirm,
  icon = 'check',
  tone = 'danger',
  disabled = false,
}: {
  label: string;
  onConfirm: () => void;
  icon?: IconName;
  tone?: 'primary' | 'danger' | 'success';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles(theme);
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const confirmed = useRef(false);
  const max = Math.max(0, width - THUMB - 8);

  const bg =
    tone === 'danger' ? theme.color.danger : tone === 'success' ? theme.color.success : theme.color.primary;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderMove: (_, g) => {
        const nx = Math.max(0, Math.min(max, g.dx));
        x.setValue(nx);
      },
      onPanResponderRelease: (_, g) => {
        const nx = Math.max(0, Math.min(max, g.dx));
        if (nx >= max - 6 && !confirmed.current) {
          confirmed.current = true;
          Haptics.success();
          Animated.timing(x, { toValue: max, duration: 120, useNativeDriver: true }).start(() => {
            onConfirm();
            confirmed.current = false;
            Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true }).start();
          });
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        }
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const trackOpacity = x.interpolate({ inputRange: [0, Math.max(1, max)], outputRange: [1, 0.15] });

  return (
    <View style={[styles.track, disabled && { opacity: 0.5 }]} onLayout={onLayout}>
      <Animated.View style={{ opacity: trackOpacity }}>
        <T variant="body" color={theme.color.textMuted} style={{ fontWeight: '700' }}>
          {label}
        </T>
      </Animated.View>
      <Animated.View
        {...responder.panHandlers}
        style={[styles.thumb, { backgroundColor: bg, transform: [{ translateX: x }] }]}
      >
        <Icon name={icon} size={22} color={theme.color.textInverse} />
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  track: {
    height: THUMB + 8,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    left: 4,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
