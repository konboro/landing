// The Penny backdrop — a soft sky gradient with organic blobs and two hairline
// curves drifting across it. Every screen sits on this instead of a flat grey,
// which is what makes white cards read as floating rather than pasted on.
//
// Drawn with react-native-svg (already a dependency — no expo-linear-gradient,
// no new native module). It is purely decorative: `pointerEvents="none"` so it
// never eats a touch, and it renders once behind the whole screen rather than
// per card.
//
// Deliberately low-contrast. The blobs sit at 0.10–0.30 opacity so body text
// keeps its contrast ratio anywhere on the screen; darken them and the labels
// over the bottom-left blob stop being readable.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Path,
  Rect,
  Ellipse,
} from 'react-native-svg';
import { palette } from '@penny/ui/tokens';

/** Reference box the blob geometry was drawn against; scales to any screen. */
const W = 390;
const H = 844;

export function Backdrop({ tone = 'sky' }: { tone?: 'sky' | 'plain' }) {
  if (tone === 'plain') {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.blue50 }]} pointerEvents="none" />;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          {/* Base wash: brightest at the top, settling into the brand blue. */}
          <LinearGradient id="sky" x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor="#dcf0ff" />
            <Stop offset="0.45" stopColor="#c6e5fe" />
            <Stop offset="1" stopColor="#a9d2fa" />
          </LinearGradient>

          {/* Top-right blob — the deepest note on the screen. */}
          <RadialGradient id="blobTop" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={palette.blue500} stopOpacity="0.55" />
            <Stop offset="0.6" stopColor={palette.indigo400} stopOpacity="0.30" />
            <Stop offset="1" stopColor={palette.indigo400} stopOpacity="0" />
          </RadialGradient>

          {/* Bottom-left, cooler and violet-leaning so the two do not twin. */}
          <RadialGradient id="blobBottom" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={palette.indigo500} stopOpacity="0.38" />
            <Stop offset="0.65" stopColor={palette.violet400} stopOpacity="0.18" />
            <Stop offset="1" stopColor={palette.violet400} stopOpacity="0" />
          </RadialGradient>

          {/* A faint lift under the tab bar so the bar edge is not a hard line. */}
          <LinearGradient id="foot" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.indigo400} stopOpacity="0" />
            <Stop offset="1" stopColor={palette.indigo400} stopOpacity="0.22" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width={W} height={H} fill="url(#sky)" />

        <Ellipse cx={W * 0.86} cy={H * 0.05} rx={W * 0.52} ry={H * 0.17} fill="url(#blobTop)" />
        <Ellipse cx={W * 0.02} cy={H * 0.78} rx={W * 0.46} ry={H * 0.16} fill="url(#blobBottom)" />
        <Ellipse cx={W * 0.94} cy={H * 0.62} rx={W * 0.34} ry={H * 0.12} fill="url(#blobBottom)" />

        <Rect x="0" y={H * 0.82} width={W} height={H * 0.18} fill="url(#foot)" />

        {/* Hairline curves. One long sweep and one shorter echo — they give the
            background a sense of motion without becoming a pattern. */}
        <Path
          d={`M-20 ${H * 0.30} C ${W * 0.28} ${H * 0.24}, ${W * 0.52} ${H * 0.40}, ${W + 20} ${H * 0.17}`}
          stroke={palette.blue600}
          strokeOpacity="0.16"
          strokeWidth="1"
          fill="none"
        />
        <Path
          d={`M-20 ${H * 0.70} C ${W * 0.34} ${H * 0.62}, ${W * 0.46} ${H * 0.86}, ${W + 20} ${H * 0.66}`}
          stroke={palette.indigo500}
          strokeOpacity="0.14"
          strokeWidth="1"
          fill="none"
        />
      </Svg>
    </View>
  );
}
