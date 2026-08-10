// Ops icon set — thin outline vectors on a 24×24 grid.
//
// Ported from the rider app's `components/ui/Icon.tsx`: same API, same drawing
// rules, so a glyph can be copied between the two apps without redrawing it.
// The rider's set is consumer-facing (wallet, promos, referrals); this one is
// field-service (wrench, route, shift, signal, damage photos), so the union
// diverges — only the glyphs that mean the same thing in both apps are shared.
//
// Drawing rules (keep new icons consistent with these):
//   * 24×24 viewBox, round caps and joins, no fills except tiny dots;
//   * shapes inset to roughly 3…21 so they optically match at small sizes;
//   * one visual idea per icon — detail disappears below 20 px anyway.
//
// Default stroke is heavier than the rider's 1.7: this app is read at arm's
// length, outdoors, in sunlight, often through a scratched screen protector.
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Circle, Rect, Line, Polyline } from 'react-native-svg';
import { c as defaultColors } from '../../lib/theme';

export type IconName =
  // navigation & chrome
  | 'map'
  | 'list'
  | 'search'
  | 'zoomIn'
  | 'filter'
  | 'layers'
  | 'locate'
  | 'navigate'
  | 'route'
  | 'place'
  | 'more'
  | 'plus'
  | 'check'
  | 'close'
  | 'chevron'
  | 'chevronDown'
  | 'chevronUp'
  | 'back'
  | 'refresh'
  | 'download'
  | 'settings'
  | 'logout'
  // work
  | 'wrench'
  | 'edit'
  | 'note'
  | 'chat'
  | 'send'
  | 'shift'
  | 'clock'
  | 'calendar'
  | 'flag'
  | 'alert'
  | 'info'
  | 'trash'
  | 'history'
  // capture
  | 'qr'
  | 'scan'
  | 'camera'
  | 'photo'
  // vehicle & telemetry
  | 'bike'
  | 'scooter'
  | 'battery'
  | 'signal'
  | 'lock'
  | 'unlock'
  | 'ring'
  | 'play'
  | 'pause'
  | 'parking'
  | 'nogo'
  // people
  | 'profile'
  | 'user'
  | 'phone'
  | 'bell'
  | 'star';

/** One icon = the children of a 24×24 <Svg>. `c` is the resolved stroke colour. */
type Draw = (c: string) => React.ReactNode;

const S = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

const DRAW: Record<IconName, Draw> = {
  /* ── navigation & chrome ────────────────────────────────────────────────── */
  map: (c) => (
    <>
      <Path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8Z" stroke={c} {...S} />
      <Line x1="9" y1="4.5" x2="9" y2="17.2" stroke={c} {...S} />
      <Line x1="15" y1="6.8" x2="15" y2="19.5" stroke={c} {...S} />
    </>
  ),
  list: (c) => (
    <>
      <Path d="M9 6.4h11.6M9 12h11.6M9 17.6h11.6" stroke={c} {...S} />
      <Circle cx="4.4" cy="6.4" r="1.15" fill={c} />
      <Circle cx="4.4" cy="12" r="1.15" fill={c} />
      <Circle cx="4.4" cy="17.6" r="1.15" fill={c} />
    </>
  ),
  search: (c) => (
    <>
      <Circle cx="10.8" cy="10.8" r="6.8" stroke={c} {...S} />
      <Path d="m15.8 15.8 4.8 4.8" stroke={c} {...S} />
    </>
  ),
  zoomIn: (c) => (
    <>
      <Circle cx="10.8" cy="10.8" r="6.8" stroke={c} {...S} />
      <Path d="m15.8 15.8 4.8 4.8M10.8 7.8v6M7.8 10.8h6" stroke={c} {...S} />
    </>
  ),
  filter: (c) => (
    <Path d="M3.8 5.2h16.4l-6.4 7.6v6.2l-3.6 2v-8.2Z" stroke={c} {...S} />
  ),
  layers: (c) => (
    <>
      <Path d="m12 3.4 8.6 4.4L12 12.2 3.4 7.8Z" stroke={c} {...S} />
      <Path d="m4.2 12 7.8 4 7.8-4M4.2 16.2l7.8 4 7.8-4" stroke={c} {...S} />
    </>
  ),
  locate: (c) => (
    <>
      <Circle cx="12" cy="12" r="6.6" stroke={c} {...S} />
      <Circle cx="12" cy="12" r="2.2" stroke={c} {...S} />
      <Path d="M12 2.4v2.6M12 19v2.6M2.4 12H5M19 12h2.6" stroke={c} {...S} />
    </>
  ),
  navigate: (c) => <Path d="M20.6 3.4 12.2 20.6l-2-7.2-7.2-2Z" stroke={c} {...S} />,
  route: (c) => (
    <>
      <Circle cx="6" cy="18.4" r="2.6" stroke={c} {...S} />
      <Circle cx="18" cy="5.6" r="2.6" stroke={c} {...S} />
      <Path d="M8.6 18.4h5.8a3.4 3.4 0 0 0 0-6.8H9.6a3.4 3.4 0 0 1 0-6.8h5.8" stroke={c} {...S} />
    </>
  ),
  place: (c) => (
    <>
      <Path d="M12 21.2c4-4.2 6-7.4 6-10a6 6 0 1 0-12 0c0 2.6 2 5.8 6 10Z" stroke={c} {...S} />
      <Circle cx="12" cy="11" r="2.4" stroke={c} {...S} />
    </>
  ),
  more: (c) => (
    <>
      <Circle cx="5.2" cy="12" r="1.5" fill={c} />
      <Circle cx="12" cy="12" r="1.5" fill={c} />
      <Circle cx="18.8" cy="12" r="1.5" fill={c} />
    </>
  ),
  plus: (c) => <Path d="M12 4.8v14.4M4.8 12h14.4" stroke={c} {...S} />,
  check: (c) => <Polyline points="4.6,12.6 9.6,17.4 19.4,6.8" stroke={c} {...S} />,
  close: (c) => <Path d="M6 6l12 12M18 6 6 18" stroke={c} {...S} />,
  chevron: (c) => <Polyline points="9.4,4.8 16.6,12 9.4,19.2" stroke={c} {...S} />,
  chevronDown: (c) => <Polyline points="4.8,9 12,16.2 19.2,9" stroke={c} {...S} />,
  chevronUp: (c) => <Polyline points="4.8,15 12,7.8 19.2,15" stroke={c} {...S} />,
  back: (c) => <Polyline points="14.6,4.8 7.4,12 14.6,19.2" stroke={c} {...S} />,
  refresh: (c) => (
    <>
      <Path d="M20.4 12a8.4 8.4 0 1 1-2.6-6.1" stroke={c} {...S} />
      <Polyline points="20.8,3.4 20.8,8.2 16,8.2" stroke={c} {...S} />
    </>
  ),
  download: (c) => (
    <>
      <Path d="M12 3.6v11M7.6 10.4 12 14.8l4.4-4.4" stroke={c} {...S} />
      <Path d="M4.4 16.2v2.6a1.8 1.8 0 0 0 1.8 1.8h11.6a1.8 1.8 0 0 0 1.8-1.8v-2.6" stroke={c} {...S} />
    </>
  ),
  settings: (c) => (
    <>
      <Circle cx="12" cy="12" r="3.3" stroke={c} {...S} />
      <Path
        d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"
        stroke={c}
        {...S}
      />
    </>
  ),
  logout: (c) => (
    <>
      <Path d="M9.6 20.6H5.8a1.8 1.8 0 0 1-1.8-1.8V5.2a1.8 1.8 0 0 1 1.8-1.8h3.8" stroke={c} {...S} />
      <Path d="m15.4 16.4 4.6-4.4-4.6-4.4M20 12H9.2" stroke={c} {...S} />
    </>
  ),

  /* ── work ───────────────────────────────────────────────────────────────── */
  // Feather's "tool" outline — the only wrench shape that stays readable at 18 px.
  wrench: (c) => (
    <Path
      d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94Z"
      stroke={c}
      {...S}
    />
  ),
  edit: (c) => (
    <>
      <Path d="M16.6 4.4a2.35 2.35 0 0 1 3.3 3.3L8.3 19.4l-4.5 1.2 1.2-4.5Z" stroke={c} {...S} />
      <Path d="m15 6.2 3.3 3.3" stroke={c} {...S} />
    </>
  ),
  note: (c) => (
    <>
      <Path d="M14.2 3.4H7a1.6 1.6 0 0 0-1.6 1.6v14a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6V7.8Z" stroke={c} {...S} />
      <Path d="M14.2 3.4v4.4h4.4M8.8 12.6h6.4M8.8 16.2h4.2" stroke={c} {...S} />
    </>
  ),
  chat: (c) => (
    <>
      <Path d="M20.5 12.2c0 3.9-3.8 7-8.5 7a9.7 9.7 0 0 1-2.6-.35L4.6 20.4l1.2-3.5A6.6 6.6 0 0 1 3.5 12.2c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" stroke={c} {...S} />
      <Circle cx="8.8" cy="12.2" r="0.75" fill={c} />
      <Circle cx="12" cy="12.2" r="0.75" fill={c} />
      <Circle cx="15.2" cy="12.2" r="0.75" fill={c} />
    </>
  ),
  send: (c) => (
    <>
      <Path d="M21 3 3.4 10.2l7.4 3.1 3.1 7.4Z" stroke={c} {...S} />
      <Path d="M10.8 13.3 21 3" stroke={c} {...S} />
    </>
  ),
  // A shift is a bounded stretch of time, so: stopwatch, not clock face.
  shift: (c) => (
    <>
      <Circle cx="12" cy="13.6" r="7.2" stroke={c} {...S} />
      <Path d="M12 9.8v3.8l2.6 1.6" stroke={c} {...S} />
      <Path d="M9.6 2.8h4.8M12 2.8v3.6M18.6 6.4l1.6-1.6" stroke={c} {...S} />
    </>
  ),
  clock: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.4" stroke={c} {...S} />
      <Path d="M12 6.8V12l3.6 2.2" stroke={c} {...S} />
    </>
  ),
  calendar: (c) => (
    <>
      <Rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.6" stroke={c} {...S} />
      <Path d="M3.4 10h17.2M8.2 3.4v3.6M15.8 3.4v3.6" stroke={c} {...S} />
    </>
  ),
  flag: (c) => <Path d="M5.6 21V3.6M5.6 4.6h11.8l-2 3.6 2 3.6H5.6" stroke={c} {...S} />,
  alert: (c) => (
    <>
      <Path d="M12 3.8 21 19.6H3Z" stroke={c} {...S} />
      <Path d="M12 10v4" stroke={c} {...S} />
      <Circle cx="12" cy="16.8" r="0.8" fill={c} />
    </>
  ),
  info: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="M12 11.2v5" stroke={c} {...S} />
      <Circle cx="12" cy="8.2" r="0.8" fill={c} />
    </>
  ),
  trash: (c) => (
    <>
      <Path d="M4.6 6.8h14.8M9.4 6.8V4.6h5.2v2.2" stroke={c} {...S} />
      <Path d="M6.6 6.8 7.6 20a1.4 1.4 0 0 0 1.4 1.2h6a1.4 1.4 0 0 0 1.4-1.2l1-13.2" stroke={c} {...S} />
      <Path d="M10.4 10.6v6.4M13.6 10.6v6.4" stroke={c} {...S} />
    </>
  ),
  history: (c) => (
    <>
      <Path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" stroke={c} {...S} />
      <Polyline points="3.2,4.6 3.2,9.2 7.8,9.2" stroke={c} {...S} />
      <Polyline points="12,7.6 12,12.4 15.4,14.2" stroke={c} {...S} />
    </>
  ),

  /* ── capture ────────────────────────────────────────────────────────────── */
  qr: (c) => (
    <>
      <Rect x="3.4" y="3.4" width="6.4" height="6.4" rx="1.6" stroke={c} {...S} />
      <Rect x="14.2" y="3.4" width="6.4" height="6.4" rx="1.6" stroke={c} {...S} />
      <Rect x="3.4" y="14.2" width="6.4" height="6.4" rx="1.6" stroke={c} {...S} />
      <Path d="M14.2 14.2h3v3h-3zM19.6 19.6h1" stroke={c} {...S} />
    </>
  ),
  scan: (c) => (
    <>
      <Path d="M3.4 8.4V6a2.6 2.6 0 0 1 2.6-2.6h2.4M15.6 3.4H18A2.6 2.6 0 0 1 20.6 6v2.4M20.6 15.6V18a2.6 2.6 0 0 1-2.6 2.6h-2.4M8.4 20.6H6A2.6 2.6 0 0 1 3.4 18v-2.4" stroke={c} {...S} />
      <Line x1="3.4" y1="12" x2="20.6" y2="12" stroke={c} {...S} />
    </>
  ),
  camera: (c) => (
    <>
      <Path d="M3.4 8.6h3.2l1.4-2.4h7.6l1.4 2.4h3a1.6 1.6 0 0 1 1.6 1.6v7.2a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6v-7.2a1.6 1.6 0 0 1 1.6-1.6Z" stroke={c} {...S} />
      <Circle cx="12" cy="13.6" r="3.4" stroke={c} {...S} />
    </>
  ),
  photo: (c) => (
    <>
      <Rect x="3" y="4.6" width="18" height="14.8" rx="2.8" stroke={c} {...S} />
      <Path d="m3.4 16.6 4.8-4.6 4 3.6 3-2.6 5.4 4.6" stroke={c} {...S} />
      <Circle cx="8.6" cy="9.2" r="1.5" stroke={c} {...S} />
    </>
  ),

  /* ── vehicle & telemetry ────────────────────────────────────────────────── */
  bike: (c) => (
    <>
      <Circle cx="5.6" cy="17.2" r="3.4" stroke={c} {...S} />
      <Circle cx="18.4" cy="17.2" r="3.4" stroke={c} {...S} />
      <Path d="M5.6 17.2 9.6 8.8h5l3.8 8.4M9.6 8.8l4.8 8.4M8 8.8h3.4M14.4 6.4h2.6" stroke={c} {...S} />
    </>
  ),
  scooter: (c) => (
    <>
      <Circle cx="5.6" cy="17.4" r="3" stroke={c} {...S} />
      <Circle cx="18.4" cy="17.4" r="3" stroke={c} {...S} />
      <Path d="M8.6 17.4h6.8l1.4-8.2h-3.2" stroke={c} {...S} />
      <Path d="M13.6 9.2 12 5.2h2.6M5.6 17.4l3.2-6.6h5" stroke={c} {...S} />
    </>
  ),
  battery: (c) => (
    <>
      <Rect x="2.8" y="7.4" width="15.4" height="9.2" rx="2.6" stroke={c} {...S} />
      <Path d="M21.2 10.6v2.8" stroke={c} {...S} />
      <Rect x="5.4" y="10" width="6" height="4" rx="1" fill={c} />
    </>
  ),
  // Ascending bars — same mental model as the OS status bar, so it needs no legend.
  signal: (c) => (
    <Path d="M4.4 19.6v-3.4M9.6 19.6v-6.6M14.8 19.6v-9.8M20 19.6V6" stroke={c} {...S} />
  ),
  lock: (c) => (
    <>
      <Rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.6" stroke={c} {...S} />
      <Path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" stroke={c} {...S} />
    </>
  ),
  unlock: (c) => (
    <>
      <Rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.6" stroke={c} {...S} />
      <Path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.3-1.4" stroke={c} {...S} />
    </>
  ),
  ring: (c) => (
    <>
      <Path d="M5.6 10.6 15 6.2v11.6l-9.4-4.4Z" stroke={c} {...S} />
      <Path d="M18 9.2a4 4 0 0 1 0 5.6M5.6 10.6H4.2a1.6 1.6 0 0 0-1.6 1.6v-.4a1.6 1.6 0 0 0 1.6 1.6h1.4" stroke={c} {...S} />
    </>
  ),
  play: (c) => <Path d="M7.6 4.8 19 12 7.6 19.2Z" stroke={c} {...S} />,
  pause: (c) => (
    <>
      <Rect x="8" y="4.6" width="3" height="14.8" rx="1.4" stroke={c} {...S} />
      <Rect x="13" y="4.6" width="3" height="14.8" rx="1.4" stroke={c} {...S} />
    </>
  ),
  parking: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="M9.8 16.6V8h2.9a2.7 2.7 0 0 1 0 5.4H9.8" stroke={c} {...S} />
    </>
  ),
  nogo: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="m6 6 12 12" stroke={c} {...S} />
    </>
  ),

  /* ── people ─────────────────────────────────────────────────────────────── */
  profile: (c) => (
    <>
      <Circle cx="12" cy="8.4" r="3.7" stroke={c} {...S} />
      <Path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" stroke={c} {...S} />
    </>
  ),
  // `user` is the avatar form (bounded) — `profile` is the bare bust.
  user: (c) => (
    <>
      <Circle cx="12" cy="12" r="9" stroke={c} {...S} />
      <Circle cx="12" cy="9.8" r="3" stroke={c} {...S} />
      <Path d="M6.3 18.7a6.1 6.1 0 0 1 11.4 0" stroke={c} {...S} />
    </>
  ),
  phone: (c) => (
    <Path d="M7.4 3.6 9.6 8l-2 2a12 12 0 0 0 6.4 6.4l2-2 4.4 2.2v3a1.6 1.6 0 0 1-1.8 1.6C10.8 20.4 3.6 13.2 2.8 5.4A1.6 1.6 0 0 1 4.4 3.6Z" stroke={c} {...S} />
  ),
  bell: (c) => (
    <>
      <Path d="M18 16.4H6l1.4-2.2V11a4.6 4.6 0 0 1 9.2 0v3.2Z" stroke={c} {...S} />
      <Path d="M10.4 19.2a1.8 1.8 0 0 0 3.2 0" stroke={c} {...S} />
    </>
  ),
  star: (c) => (
    <Path d="m12 3.6 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6L3.2 10l6.1-.9Z" stroke={c} {...S} />
  ),
};

/**
 * Runtime guard so components that take a loose `string` icon prop can tell a
 * vector glyph name from the emoji the app used before this set existed.
 */
export function isIconName(v: string): v is IconName {
  return Object.prototype.hasOwnProperty.call(DRAW, v);
}

export function Icon({
  name,
  size = 24,
  color = defaultColors.text,
  strokeWidth = 1.8,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** Optical weight. Bump slightly for icons drawn very small. */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth}>
        {DRAW[name](color)}
      </Svg>
    </View>
  );
}
