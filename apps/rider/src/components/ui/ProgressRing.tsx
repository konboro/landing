// Circular progress ring (unlock wake indicator). Uses react-native-svg.
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../brand';
import { T } from './primitives';

export function ProgressRing({
  progress,
  size = 160,
  stroke = 10,
  color,
  trackColor,
  label,
  sublabel,
}: {
  progress: number; // 0..1
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
}) {
  const theme = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  const offset = c * (1 - p);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor ?? theme.color.surfaceAlt}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? theme.color.primary}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        {label ? <T variant="title">{label}</T> : null}
        {sublabel ? <T variant="caption">{sublabel}</T> : null}
      </View>
    </View>
  );
}
