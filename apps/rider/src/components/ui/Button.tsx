import React from 'react';
import {
  Pressable,
  ActivityIndicator,
  StyleSheet,
  View,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { theme, MIN_TOUCH } from '../../lib/theme';
import { Haptics } from '../../lib/native';
import { T } from './primitives';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dark';
type Size = 'sm' | 'md' | 'lg';

const bg: Record<Variant, string> = {
  primary: theme.color.primary,
  secondary: theme.color.surfaceAlt,
  ghost: 'transparent',
  danger: theme.color.danger,
  success: theme.color.success,
  dark: theme.palette.ink900,
};
const fg: Record<Variant, string> = {
  primary: theme.color.onPrimary,
  secondary: theme.color.text,
  ghost: theme.color.primary,
  danger: theme.color.textInverse,
  success: theme.color.textInverse,
  dark: theme.color.textInverse,
};
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
  const isDisabled = disabled || loading;
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
        { backgroundColor: bg[variant] },
        variant === 'ghost' && styles.ghostBorder,
        variant === 'secondary' && styles.secondaryBorder,
        full && { alignSelf: 'stretch' },
        pressed && !isDisabled && { opacity: 0.85, transform: [{ scale: 0.99 }] },
        isDisabled && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={size === 'lg' ? 20 : 17} color={fg[variant]} /> : null}
          <T variant="body" color={fg[variant]} style={[styles.label, size === 'lg' && { fontSize: theme.font.size.lg }]}>
            {title}
          </T>
          {iconRight ? <Icon name={iconRight} size={size === 'lg' ? 20 : 17} color={fg[variant]} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBorder: { borderWidth: 1.5, borderColor: theme.color.primary },
  secondaryBorder: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontWeight: '700' },
});
