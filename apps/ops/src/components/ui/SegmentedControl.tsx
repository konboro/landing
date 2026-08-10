// Two/three-way toggle — Map ↔ List, Place ↔ Heatmap, Today ↔ Week.
//
// A segmented control instead of tabs because these are *views of the same
// data*, not different destinations: the choice belongs next to the content, it
// has to survive being placed on top of a map, and it has to read at a glance
// from a metre away.
//
// The thumb slides rather than cutting, which is the only cue that says "same
// list, different lens" — and it doubles as feedback that a gloved tap landed.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Animated,
  Pressable,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme, makeStyles } from '../../brand';
import { Icon, type IconName } from './Icon';

/** Outer height. Above the 44 px floor because this is used with gloves on. */
const HEIGHT = 48;
const PAD = 4;

export interface SegmentOption {
  key: string;
  label: string;
  icon?: IconName;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  style,
}: {
  options: SegmentOption[];
  value: string;
  onChange: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const [trackW, setTrackW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  const count = Math.max(1, options.length);
  const segW = trackW > 0 ? (trackW - PAD * 2) / count : 0;
  const index = Math.max(0, options.findIndex((o) => o.key === value));

  useEffect(() => {
    if (segW === 0) return;
    Animated.spring(x, {
      toValue: index * segW,
      useNativeDriver: true,
      stiffness: 300,
      damping: 30,
      mass: 0.9,
    }).start();
  }, [index, segW, x]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width), []);

  return (
    <View style={[st.track, style]} onLayout={onLayout} accessibilityRole="tablist">
      {segW > 0 ? (
        <Animated.View
          style={[st.thumb, { width: segW, transform: [{ translateX: x }] }]}
          pointerEvents="none"
        />
      ) : null}
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            style={st.segment}
          >
            {o.icon ? (
              <Icon name={o.icon} size={19} color={active ? theme.c.text : theme.c.textMuted} />
            ) : null}
            <Text style={[st.label, active ? st.labelActive : null]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  track: {
    flexDirection: 'row',
    height: HEIGHT,
    padding: PAD,
    borderRadius: t.radius.pill,
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    bottom: PAD,
    borderRadius: t.radius.pill,
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.space.xs,
  },
  label: { color: t.c.textMuted, fontSize: t.font.size.md, fontWeight: '600' },
  labelActive: { color: t.c.text, fontWeight: '700' },
}));
