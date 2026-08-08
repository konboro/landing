import React from 'react';
import {
  Pressable,
  ActivityIndicator,
  StyleSheet,
  View,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { MIN_TOUCH } from '../../lib/theme';
import { useTheme, makeStyles } from '../../brand';
import type { RiderTheme } from '../../brand';
import { Haptics } from '../../lib/native';
import { T } from './primitives';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dark';
type Size = 'sm' | 'md' | 'lg';

function bgFor(theme: RiderTheme, variant: Variant): string {
  switch (variant) {
    case 'primary': return theme.color.primary;
    case 'secondary': return theme.color.surfaceAlt;
    case 'ghost': return 'transparent';
    case 'danger': return theme.color.danger;
    case 'success': return theme.color.success;
    // "dark" is deliberate chrome (photo/scan overlays), not a brand colour.
    case 'dark': return theme.palette.ink900;
  }
}
function fgFor(theme: RiderTheme, variant: Variant): string {
  switch (variant) {
    case 'primary': return theme.color.onPrimary;
    case 'secondary': return theme.color.text;
    case 'ghost': return theme.color.primary;
    default: return theme.color.textInverse;
  }
}

const pad: Record<Size, ViewStyle> = {
  sm: { paddingVertical: 8, paddingHorizontal: 14, minHeight: 36 },
  md: { paddingVertical: 12, paddingHorizontal: 18, minHeight: MIN_TOUCH },
  lg: { paddingVertical: 16, paddingHorizontal: 22, minHeight: 56 },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  full = true,
  haptic = true,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const styles = useStyles(theme);
  const isDisabled = disabled || loading;
  const fg = fgFor(theme, variant);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={() => {
        if (haptic) Haptics.light();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        pad[size],
        { backgroundColor: bgFor(theme, variant) },
        variant === 'ghost' && styles.ghostBorder,
        variant === 'secondary' && styles.secondaryBorder,
        full && { alignSelf: 'stretch' },
        pressed && !isDisabled && { opacity: 0.85, transform: [{ scale: 0.99 }] },
        isDisabled && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={size === 'lg' ? 20 : 17} color={fg} /> : null}
          <T variant="body" color={fg} style={[styles.label, size === 'lg' && { fontSize: theme.font.size.lg }]}>
            {title}
          </T>
          {iconRight ? <Icon name={iconRight} size={size === 'lg' ? 20 : 17} color={fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  base: {
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBorder: { borderWidth: 1.5, borderColor: t.color.primary },
  secondaryBorder: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.color.border },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontWeight: '700' },
}));
