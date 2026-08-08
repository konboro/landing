// Lightweight icon set. Emoji-based so we ship zero icon-font native deps and
// render identically in Expo Go. Names are semantic; swap for an SVG set later.
import React from 'react';
import { Text, type TextStyle, type StyleProp } from 'react-native';

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

const GLYPH: Record<IconName, string> = {
  map: '🗺️', wallet: '👛', history: '🧾', profile: '👤', help: '💬',
  scan: '📷', qr: '⬛', flash: '🔦', battery: '🔋', range: '📍', walk: '🚶',
  reserve: '⏱️', bell: '🔔', ring: '📣', pause: '⏸️', play: '▶️', locate: '🎯',
  share: '🔗', camera: '📸', check: '✓', close: '✕', chevron: '›', back: '‹',
  star: '★', card: '💳', applepay: '📲', package: '🎟️', crown: '👑', shield: '🛡️',
  promo: '🏷️', warning: '⚠️', danger: '🚨', info: 'ℹ️', lock: '🔒', unlock: '🔓',
  leaf: '🌿', fire: '🔥', points: '⭐', referral: '🎁', lang: '🌐', trash: '🗑️',
  phone: '📞', mail: '✉️', whatsapp: '💚', inbox: '📥', flag: '🚩', transit: '🚇',
  charge: '⚡', station: '🅿️', parking: '🅿️', speed: '🐢', nogo: '⛔', bonus: '✨',
  scooter: '🛴', crash: '🆘', moon: '🌙', location: '📍',
};

export function Icon({
  name,
  size = 18,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      allowFontScaling={false}
      style={[{ fontSize: size, lineHeight: size * 1.15, color }, style]}
    >
      {GLYPH[name]}
    </Text>
  );
}
