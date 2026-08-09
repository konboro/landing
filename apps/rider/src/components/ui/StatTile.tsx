// Stat primitives: the icon/number/label tile and the pill switcher.
//
// Both existed inline in three or four screens with slightly different sizes
// and weights, which is the main reason numbers never lined up across the app.
// Centralised here so a row of stats is typographically identical everywhere.
import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../brand';
import { Icon, type IconName } from './Icon';
import { T } from './primitives';

/**
 * One stat: optional icon, a big value, a quiet label under it.
 *
 * `value` stays a string so the caller owns formatting (currency, units,
 * tabular figures) — the tile never guesses how to render a number.
 */
export function StatTile({
  icon,
  value,
  label,
  tone = 'onSky',
  style,
}: {
  icon?: IconName;
  value: string;
  label: string;
  /** `onSky` sits directly on the backdrop, `onCard` inside a white card. */
  tone?: 'onSky' | 'onCard';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const strong = tone === 'onSky' ? theme.color.textInverse : theme.color.text;
  const quiet = tone === 'onSky' ? 'rgba(255,255,255,0.92)' : theme.color.textMuted;

  return (
    <View style={[{ alignItems: 'center', gap: theme.space.xs, flex: 1 }, style]}>
      {icon ? <Icon name={icon} size={26} color={strong} strokeWidth={1.6} /> : null}
      <T
        variant="heading"
        style={{ color: strong, fontVariant: ['tabular-nums'], letterSpacing: -0.4 }}
        numberOfLines={1}
      >
        {value}
      </T>
      <T variant="caption" center style={{ color: quiet }} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

/** A row of tiles that always splits evenly, so columns line up across rows. */
export function StatRow({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.md, alignItems: 'flex-start' }}>
      {children}
    </View>
  );
}

/** Pill switcher — the Daily / Monthly / Overall control. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (v: V) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.sm, justifyContent: 'center' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              paddingVertical: theme.space.sm,
              paddingHorizontal: theme.space.lg,
              borderRadius: theme.radius.pill,
              backgroundColor: on ? theme.color.primarySoft : theme.color.surface,
              borderWidth: 1,
              borderColor: on ? theme.color.primary : theme.color.border,
            }}
          >
            <T
              variant="body"
              style={{
                fontWeight: '600',
                color: on ? theme.color.primaryDark : theme.color.textMuted,
              }}
            >
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
