// Penny icon set — thin outline vectors on a 24×24 grid.
//
// This used to be an emoji map. Emoji cost nothing to ship, but they carry
// their own colour, weight and vertical metrics, so nothing lined up: the tab
// bar could not tint them, a row of "icons" mixed flat and 3-D artwork, and
// sizes drifted between platforms.
//
// The API is unchanged — same `IconName` union, same `<Icon name size color />`
// props — so every existing call site keeps working untouched.
//
// Drawing rules (keep new icons consistent with these):
//   * 24×24 viewBox, ~1.7 stroke, round caps and joins, no fills;
//   * shapes inset to roughly 3…21 so they optically match at small sizes;
//   * one visual idea per icon — detail disappears below 20 px anyway.
//
// react-native-svg is already a dependency (the maps and progress ring use it),
// so this adds no native module.
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Circle, Rect, Line, Polyline } from 'react-native-svg';

export type IconName =
  | 'map'
  | 'wallet'
  | 'history'
  | 'profile'
  | 'help'
  | 'scan'
  | 'qr'
  | 'flash'
  | 'battery'
  | 'range'
  | 'walk'
  | 'reserve'
  | 'bell'
  | 'ring'
  | 'pause'
  | 'play'
  | 'locate'
  | 'share'
  | 'camera'
  | 'check'
  | 'close'
  | 'chevron'
  | 'back'
  | 'star'
  | 'card'
  | 'applepay'
  | 'package'
  | 'crown'
  | 'shield'
  | 'promo'
  | 'warning'
  | 'danger'
  | 'info'
  | 'lock'
  | 'unlock'
  | 'leaf'
  | 'fire'
  | 'points'
  | 'referral'
  | 'lang'
  | 'trash'
  | 'phone'
  | 'mail'
  | 'whatsapp'
  | 'inbox'
  | 'flag'
  | 'transit'
  | 'charge'
  | 'station'
  | 'parking'
  | 'speed'
  | 'nogo'
  | 'bonus'
  | 'scooter'
  | 'crash'
  | 'moon'
  | 'location';

/** One icon = the children of a 24×24 <Svg>. `c` is the resolved stroke colour. */
type Draw = (c: string) => React.ReactNode;

const S = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

const DRAW: Record<IconName, Draw> = {
  /* ── navigation ─────────────────────────────────────────────────────────── */
  map: (c) => (
    <>
      <Path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8Z" stroke={c} {...S} />
      <Line x1="9" y1="4.5" x2="9" y2="17.2" stroke={c} {...S} />
      <Line x1="15" y1="6.8" x2="15" y2="19.5" stroke={c} {...S} />
    </>
  ),
  wallet: (c) => (
    <>
      <Rect x="3" y="6" width="18" height="13" rx="3.2" stroke={c} {...S} />
      <Path d="M3 10h18" stroke={c} {...S} />
      <Circle cx="16.6" cy="14.4" r="1.15" stroke={c} {...S} />
    </>
  ),
  history: (c) => (
    <>
      <Path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" stroke={c} {...S} />
      <Polyline points="3.2,4.6 3.2,9.2 7.8,9.2" stroke={c} {...S} />
      <Polyline points="12,7.6 12,12.4 15.4,14.2" stroke={c} {...S} />
    </>
  ),
  profile: (c) => (
    <>
      <Circle cx="12" cy="8.4" r="3.7" stroke={c} {...S} />
      <Path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" stroke={c} {...S} />
    </>
  ),
  help: (c) => (
    <>
      <Path d="M20.5 12.2c0 3.9-3.8 7-8.5 7a9.7 9.7 0 0 1-2.6-.35L4.6 20.4l1.2-3.5A6.6 6.6 0 0 1 3.5 12.2c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" stroke={c} {...S} />
      <Path d="M10.2 10.3a1.9 1.9 0 1 1 2.6 1.8v1.1" stroke={c} {...S} />
      <Circle cx="12.8" cy="15.4" r="0.65" fill={c} />
    </>
  ),

  /* ── unlocking a scooter ────────────────────────────────────────────────── */
  scan: (c) => (
    <>
      <Path d="M3.4 8.4V6a2.6 2.6 0 0 1 2.6-2.6h2.4M15.6 3.4H18A2.6 2.6 0 0 1 20.6 6v2.4M20.6 15.6V18a2.6 2.6 0 0 1-2.6 2.6h-2.4M8.4 20.6H6A2.6 2.6 0 0 1 3.4 18v-2.4" stroke={c} {...S} />
      <Line x1="3.4" y1="12" x2="20.6" y2="12" stroke={c} {...S} />
    </>
  ),
  qr: (c) => (
    <>
      <Rect x="3.4" y="3.4" width="6.4" height="6.4" rx="1.6" stroke={c} {...S} />
      <Rect x="14.2" y="3.4" width="6.4" height="6.4" rx="1.6" stroke={c} {...S} />
      <Rect x="3.4" y="14.2" width="6.4" height="6.4" rx="1.6" stroke={c} {...S} />
      <Path d="M14.2 14.2h3v3h-3zM19.6 19.6h1" stroke={c} {...S} />
    </>
  ),
  flash: (c) => <Path d="M13.4 2.8 5.6 13.4h5.2l-.6 7.8 7.8-10.6h-5.2Z" stroke={c} {...S} />,
  battery: (c) => (
    <>
      <Rect x="2.8" y="7.4" width="15.4" height="9.2" rx="2.6" stroke={c} {...S} />
      <Path d="M21.2 10.6v2.8" stroke={c} {...S} />
      <Rect x="5.4" y="10" width="6" height="4" rx="1" fill={c} />
    </>
  ),
  range: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.4" stroke={c} {...S} />
      <Path d="M12 6.4v5.6l3.6 2" stroke={c} {...S} />
    </>
  ),
  walk: (c) => (
    <>
      <Circle cx="13.2" cy="4.6" r="1.9" stroke={c} {...S} />
      <Path d="M10 21l2.2-5.4-2-2.2.8-4.6 3.2 1.6 2.4 2.2" stroke={c} {...S} />
      <Path d="M12.2 15.6 15 21M8.4 11.4l2.6-2.2" stroke={c} {...S} />
    </>
  ),
  reserve: (c) => (
    <>
      <Circle cx="12" cy="13.2" r="7.4" stroke={c} {...S} />
      <Path d="M12 9.4v3.8l2.8 1.6M9.4 2.8h5.2" stroke={c} {...S} />
    </>
  ),

  /* ── in-trip controls ───────────────────────────────────────────────────── */
  bell: (c) => (
    <>
      <Path d="M18 16.4H6l1.4-2.2V11a4.6 4.6 0 0 1 9.2 0v3.2Z" stroke={c} {...S} />
      <Path d="M10.4 19.2a1.8 1.8 0 0 0 3.2 0" stroke={c} {...S} />
    </>
  ),
  ring: (c) => (
    <>
      <Path d="M5.6 10.6 15 6.2v11.6l-9.4-4.4Z" stroke={c} {...S} />
      <Path d="M18 9.2a4 4 0 0 1 0 5.6M5.6 10.6H4.2a1.6 1.6 0 0 0-1.6 1.6v-.4a1.6 1.6 0 0 0 1.6 1.6h1.4" stroke={c} {...S} />
    </>
  ),
  pause: (c) => (
    <>
      <Rect x="8" y="4.6" width="3" height="14.8" rx="1.4" stroke={c} {...S} />
      <Rect x="13" y="4.6" width="3" height="14.8" rx="1.4" stroke={c} {...S} />
    </>
  ),
  play: (c) => <Path d="M7.6 4.8 19 12 7.6 19.2Z" stroke={c} {...S} />,
  locate: (c) => (
    <>
      <Circle cx="12" cy="12" r="6.6" stroke={c} {...S} />
      <Circle cx="12" cy="12" r="2.2" stroke={c} {...S} />
      <Path d="M12 2.4v2.6M12 19v2.6M2.4 12H5M19 12h2.6" stroke={c} {...S} />
    </>
  ),
  share: (c) => (
    <>
      <Path d="M10.4 13.6a3.2 3.2 0 1 1 0-3.2l3.4-2a3.2 3.2 0 1 1 .7 1.4l-3.4 2a3.2 3.2 0 0 1 0 .4l3.4 2a3.2 3.2 0 1 1-.7 1.4Z" stroke={c} {...S} />
    </>
  ),
  camera: (c) => (
    <>
      <Path d="M3.4 8.6h3.2l1.4-2.4h7.6l1.4 2.4h3a1.6 1.6 0 0 1 1.6 1.6v7.2a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6v-7.2a1.6 1.6 0 0 1 1.6-1.6Z" stroke={c} {...S} />
      <Circle cx="12" cy="13.6" r="3.4" stroke={c} {...S} />
    </>
  ),

  /* ── chrome ─────────────────────────────────────────────────────────────── */
  check: (c) => <Polyline points="4.6,12.6 9.6,17.4 19.4,6.8" stroke={c} {...S} />,
  close: (c) => <Path d="M6 6l12 12M18 6 6 18" stroke={c} {...S} />,
  chevron: (c) => <Polyline points="9.4,4.8 16.6,12 9.4,19.2" stroke={c} {...S} />,
  back: (c) => <Polyline points="14.6,4.8 7.4,12 14.6,19.2" stroke={c} {...S} />,
  star: (c) => (
    <Path d="m12 3.6 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.9-5.4 2.9 1-6L3.2 10l6.1-.9Z" stroke={c} {...S} />
  ),
  info: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="M12 11.2v5" stroke={c} {...S} />
      <Circle cx="12" cy="8.2" r="0.75" fill={c} />
    </>
  ),
  warning: (c) => (
    <>
      <Path d="M12 3.8 21 19.6H3Z" stroke={c} {...S} />
      <Path d="M12 10v4" stroke={c} {...S} />
      <Circle cx="12" cy="16.8" r="0.75" fill={c} />
    </>
  ),
  danger: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="M12 7.4v5.2" stroke={c} {...S} />
      <Circle cx="12" cy="16.2" r="0.8" fill={c} />
    </>
  ),
  trash: (c) => (
    <>
      <Path d="M4.6 6.8h14.8M9.4 6.8V4.6h5.2v2.2" stroke={c} {...S} />
      <Path d="M6.6 6.8 7.6 20a1.4 1.4 0 0 0 1.4 1.2h6a1.4 1.4 0 0 0 1.4-1.2l1-13.2" stroke={c} {...S} />
      <Path d="M10.4 10.6v6.4M13.6 10.6v6.4" stroke={c} {...S} />
    </>
  ),
  lang: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="M3.4 12h17.2M12 3.4c2.4 2.6 3.6 5.6 3.6 8.6s-1.2 6-3.6 8.6c-2.4-2.6-3.6-5.6-3.6-8.6s1.2-6 3.6-8.6Z" stroke={c} {...S} />
    </>
  ),
  moon: (c) => <Path d="M20 14.6A8.6 8.6 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6Z" stroke={c} {...S} />,

  /* ── money & rewards ────────────────────────────────────────────────────── */
  card: (c) => (
    <>
      <Rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2.8" stroke={c} {...S} />
      <Path d="M2.8 10h18.4M6.4 14.6h3.2" stroke={c} {...S} />
    </>
  ),
  applepay: (c) => (
    <>
      <Rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2.8" stroke={c} {...S} />
      <Path d="M9.6 14.4c-.7-1.3-.3-3 .9-3.6.6-.3 1.2-.1 1.7.1.4.2.7.2 1.1 0 .5-.2 1.1-.4 1.7-.1 1.2.6 1.6 2.3.9 3.6-.4.7-1 1.4-1.7 1.3-.4 0-.6-.2-1-.2s-.6.2-1 .2c-.7.1-1.3-.6-1.6-1.3Z" stroke={c} {...S} />
      <Path d="M13 8.6c.4-.5.6-1.1.5-1.7-.6 0-1.2.4-1.6.9-.3.4-.6 1-.5 1.6.6 0 1.2-.3 1.6-.8Z" stroke={c} {...S} />
    </>
  ),
  package: (c) => (
    <>
      <Path d="M12 3.4 20.4 8v8L12 20.6 3.6 16V8Z" stroke={c} {...S} />
      <Path d="M3.6 8 12 12.6 20.4 8M12 12.6v8" stroke={c} {...S} />
    </>
  ),
  crown: (c) => (
    <>
      <Path d="M3.6 7.6 7 12l5-6.4L17 12l3.4-4.4-1.6 10.8H5.2Z" stroke={c} {...S} />
      <Path d="M5.2 18.4h13.6" stroke={c} {...S} />
    </>
  ),
  promo: (c) => (
    <>
      <Path d="M11.2 3.4H20a.6.6 0 0 1 .6.6v8.8L11.8 21a1.4 1.4 0 0 1-2 0L3 14.2a1.4 1.4 0 0 1 0-2Z" stroke={c} {...S} />
      <Circle cx="16.4" cy="7.6" r="1.5" stroke={c} {...S} />
    </>
  ),
  points: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="m12 7.8 1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4Z" stroke={c} {...S} />
    </>
  ),
  referral: (c) => (
    <>
      <Rect x="3.4" y="8.6" width="17.2" height="4.4" rx="1.4" stroke={c} {...S} />
      <Path d="M4.8 13v6.2a1.4 1.4 0 0 0 1.4 1.4h11.6a1.4 1.4 0 0 0 1.4-1.4V13M12 8.6v12" stroke={c} {...S} />
      <Path d="M12 8.6S10.8 4 8.6 4a2.3 2.3 0 0 0 0 4.6ZM12 8.6S13.2 4 15.4 4a2.3 2.3 0 0 1 0 4.6Z" stroke={c} {...S} />
    </>
  ),
  bonus: (c) => (
    <>
      <Path d="m12 3.4 1.9 4.5 4.7.6-3.5 3.3.9 4.8L12 14.3 8 16.6l.9-4.8-3.5-3.3 4.7-.6Z" stroke={c} {...S} />
      <Path d="M18.6 17.6v3.2M17 19.2h3.2" stroke={c} {...S} />
    </>
  ),
  leaf: (c) => (
    <>
      <Path d="M20 4.4C11.6 3.6 5.2 7.2 5.2 13.6a6.2 6.2 0 0 0 1.6 4.2C9.4 20.4 19.6 17 20 4.4Z" stroke={c} {...S} />
      <Path d="M14.4 9.2 4.6 19.8" stroke={c} {...S} />
    </>
  ),
  fire: (c) => (
    <>
      <Path d="M12.6 2.8c.6 3-1.4 4.2-2.8 5.8-1.6 1.8-2.6 3.4-2.6 5.6a5.8 5.8 0 0 0 11.6 0c0-3.2-2-5-3.4-6.6" stroke={c} {...S} />
      <Path d="M12 20.2a2.7 2.7 0 0 1-1.4-5c.9 1 2 .7 2.2-.6 1 .8 1.6 2 1.6 3a2.5 2.5 0 0 1-2.4 2.6Z" stroke={c} {...S} />
    </>
  ),

  /* ── security ───────────────────────────────────────────────────────────── */
  shield: (c) => (
    <>
      <Path d="M12 3 4.8 6v5.6c0 4.4 3 7.8 7.2 9.4 4.2-1.6 7.2-5 7.2-9.4V6Z" stroke={c} {...S} />
      <Polyline points="9,12 11.2,14.2 15.4,10" stroke={c} {...S} />
    </>
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
  crash: (c) => (
    <>
      <Path d="m12 2.8 2.4 3.6 4.2-.8-1 4.2 3.4 2.6-3.4 2.6 1 4.2-4.2-.8L12 22l-2.4-3.6-4.2.8 1-4.2L3 12.4l3.4-2.6-1-4.2 4.2.8Z" stroke={c} {...S} />
      <Path d="M12 8.6v4.2" stroke={c} {...S} />
      <Circle cx="12" cy="16" r="0.8" fill={c} />
    </>
  ),

  /* ── contact ────────────────────────────────────────────────────────────── */
  phone: (c) => (
    <Path d="M7.4 3.6 9.6 8l-2 2a12 12 0 0 0 6.4 6.4l2-2 4.4 2.2v3a1.6 1.6 0 0 1-1.8 1.6C10.8 20.4 3.6 13.2 2.8 5.4A1.6 1.6 0 0 1 4.4 3.6Z" stroke={c} {...S} />
  ),
  mail: (c) => (
    <>
      <Rect x="2.8" y="5.4" width="18.4" height="13.2" rx="2.6" stroke={c} {...S} />
      <Polyline points="3.6,7.4 12,13 20.4,7.4" stroke={c} {...S} />
    </>
  ),
  whatsapp: (c) => (
    <>
      <Path d="M3.6 20.4 5 16.6a8 8 0 1 1 3 3Z" stroke={c} {...S} />
      <Path d="M9.4 9.6c0 3 2 5 5 5 .9 0 1.4-.6 1.2-1.2l-1.6-.8-.9 1a5.4 5.4 0 0 1-2.6-2.6l1-.9-.8-1.6c-.6-.2-1.3.3-1.3 1.1Z" stroke={c} {...S} />
    </>
  ),
  inbox: (c) => (
    <>
      <Rect x="2.8" y="4.6" width="18.4" height="14.8" rx="2.6" stroke={c} {...S} />
      <Path d="M2.8 14h5l1.4 2.4h5.6L16.2 14h5" stroke={c} {...S} />
    </>
  ),
  flag: (c) => (
    <>
      <Path d="M5.6 21V3.6M5.6 4.6h11.8l-2 3.6 2 3.6H5.6" stroke={c} {...S} />
    </>
  ),

  /* ── map layers ─────────────────────────────────────────────────────────── */
  location: (c) => (
    <>
      <Path d="M12 21.2c4-4.2 6-7.4 6-10a6 6 0 1 0-12 0c0 2.6 2 5.8 6 10Z" stroke={c} {...S} />
      <Circle cx="12" cy="11" r="2.4" stroke={c} {...S} />
    </>
  ),
  transit: (c) => (
    <>
      <Rect x="5.4" y="3.4" width="13.2" height="13.6" rx="3" stroke={c} {...S} />
      <Path d="M5.4 11.4h13.2M8.6 20.6l1.8-3.6M15.4 20.6l-1.8-3.6" stroke={c} {...S} />
      <Circle cx="9.2" cy="14.2" r="0.8" fill={c} />
      <Circle cx="14.8" cy="14.2" r="0.8" fill={c} />
    </>
  ),
  charge: (c) => (
    <>
      <Rect x="4.4" y="3.6" width="11.2" height="16.8" rx="2.6" stroke={c} {...S} />
      <Path d="M10.6 8 8.4 12h3.4l-2.2 4M18 9.6h1.8v5a1.8 1.8 0 0 1-1.8 1.8h-2.4" stroke={c} {...S} />
    </>
  ),
  station: (c) => (
    <>
      <Rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.4" stroke={c} {...S} />
      <Path d="M9.6 17V7.6h3.2a2.9 2.9 0 0 1 0 5.8H9.6" stroke={c} {...S} />
    </>
  ),
  parking: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="M9.8 16.6V8h2.9a2.7 2.7 0 0 1 0 5.4H9.8" stroke={c} {...S} />
    </>
  ),
  speed: (c) => (
    <>
      <Path d="M3.8 16.6a8.6 8.6 0 1 1 16.4 0" stroke={c} {...S} />
      <Path d="m14.6 9.6-2.9 4.2" stroke={c} {...S} />
      <Circle cx="12" cy="16.6" r="1.3" stroke={c} {...S} />
    </>
  ),
  nogo: (c) => (
    <>
      <Circle cx="12" cy="12" r="8.6" stroke={c} {...S} />
      <Path d="m6 6 12 12" stroke={c} {...S} />
    </>
  ),

  /* ── the vehicle ────────────────────────────────────────────────────────── */
  scooter: (c) => (
    <>
      <Circle cx="5.6" cy="17.4" r="3" stroke={c} {...S} />
      <Circle cx="18.4" cy="17.4" r="3" stroke={c} {...S} />
      <Path d="M8.6 17.4h6.8l1.4-8.2h-3.2" stroke={c} {...S} />
      <Path d="M13.6 9.2 12 5.2h2.6M5.6 17.4l3.2-6.6h5" stroke={c} {...S} />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  color = '#0d1220',
  strokeWidth = 1.7,
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
