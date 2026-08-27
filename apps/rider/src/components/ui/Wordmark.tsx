// The Penny wordmark, drawn rather than bundled as an image.
//
// Vector because the mark sits on the sky backdrop at several sizes: a PNG
// would need @2x/@3x variants per brand and would still fringe against the
// gradient. It also means a white-label build re-colours the mark from its own
// brand tokens instead of shipping new artwork.
//
// The shape follows the logo: lowercase "penn" in the on-brand text colour, and
// a final "y" whose descender is the lime tuning-fork stem.
import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../../brand';

export function Wordmark({
  height = 34,
  /** `light` = white letters (over the blue field / dark chrome). */
  tone = 'dark',
}: {
  height?: number;
  tone?: 'dark' | 'light';
}) {
  const theme = useTheme();
  const letters = tone === 'light' ? theme.color.onPrimary : theme.color.text;
  const accent = theme.color.accent;

  // Drawn against 160×48; width follows the caller's height.
  const w = (height / 48) * 160;
  const stroke = 7;

  return (
    <View style={{ width: w, height }} accessibilityRole="image" accessibilityLabel="Penny">
      <Svg width={w} height={height} viewBox="0 0 160 48">
        {/* p — bowl plus the descender stem */}
        <Path
          d="M8 44V26a10 10 0 1 1 10 10 10 10 0 0 1-10-10"
          stroke={letters}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        {/* e */}
        <Path
          d="M36 26h18a9 9 0 0 0-18 0 10 10 0 0 0 10 10h7"
          stroke={letters}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* n */}
        <Path
          d="M70 36V26a9 9 0 0 1 18 0v10"
          stroke={letters}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        {/* n */}
        <Path
          d="M96 36V26a9 9 0 0 1 18 0v10"
          stroke={letters}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        {/* y — the tuning fork: two prongs meeting a lime stem */}
        <Path
          d="M124 17v9a9 9 0 0 0 18 0v-9"
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        <Rect x={129.5} y={31} width={stroke} height={13} rx={stroke / 2} fill={accent} />
      </Svg>
    </View>
  );
}
