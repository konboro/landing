// Form controls — TextField, Toggle, SegmentedControl, Chip, Stepper, ListRow.
import React from 'react';
import {
  View,
  TextInput,
  Pressable,
  Switch,
  StyleSheet,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { theme, MIN_TOUCH } from '../../lib/theme';
import { Haptics } from '../../lib/native';
import { T } from './primitives';
import { Icon, type IconName } from './Icon';

export function TextField({
  label,
  hint,
  error,
  style,
  ...rest
}: {
  label?: string;
  hint?: string;
  error?: string;
} & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <T variant="label">{label}</T> : null}
      <TextInput
        placeholderTextColor={theme.color.textMuted}
        style={[
          styles.input,
          error ? { borderColor: theme.color.danger } : null,
          style,
        ]}
        {...rest}
      />
      {error ? (
        <T variant="caption" color={theme.color.danger}>{error}</T>
      ) : hint ? (
        <T variant="caption">{hint}</T>
      ) : null}
    </View>
  );
}

export function Toggle({
  value,
  onChange,
  label,
  description,
  icon,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  description?: string;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.select();
        onChange(!value);
      }}
      style={styles.toggleRow}
    >
      {icon ? <Icon name={icon} size={20} /> : null}
      <View style={{ flex: 1 }}>
        {label ? <T variant="body" style={{ fontWeight: '600' }}>{label}</T> : null}
        {description ? <T variant="caption">{description}</T> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => onChange(v)}
        trackColor={{ true: theme.color.primary, false: theme.color.border }}
        thumbColor={theme.color.surface}
      />
    </Pressable>
  );
}

export function SegmentedControl<Opt extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: Opt; label: string }[];
  value: Opt;
  onChange: (v: Opt) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              Haptics.select();
              onChange(o.value);
            }}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
          >
            <T variant="body" color={active ? theme.color.onPrimary : theme.color.text} style={{ fontWeight: '600' }}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  active = false,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={() => {
        if (onPress) Haptics.select();
        onPress?.();
      }}
      style={[styles.chip, active && styles.chipActive]}
    >
      {icon ? <Icon name={icon} size={14} color={active ? theme.color.onPrimary : theme.color.text} /> : null}
      <T variant="caption" color={active ? theme.color.onPrimary : theme.color.text} style={{ fontWeight: '600' }}>
        {label}
      </T>
    </Pressable>
  );
}

export function ListRow({
  title,
  subtitle,
  icon,
  right,
  value,
  onPress,
  danger,
  style,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: React.ReactNode;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <View style={[styles.row, style]}>
      {icon ? (
        <View style={styles.rowIcon}>
          <Icon name={icon} size={18} color={danger ? theme.color.danger : theme.color.text} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T variant="body" color={danger ? theme.color.danger : theme.color.text} style={{ fontWeight: '600' }}>
          {title}
        </T>
        {subtitle ? <T variant="caption">{subtitle}</T> : null}
      </View>
      {value ? <T variant="body" color={theme.color.textMuted}>{value}</T> : null}
      {right ?? (onPress ? <Icon name="chevron" size={22} color={theme.color.textMuted} /> : null)}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={() => {
        Haptics.light();
        onPress();
      }}
      style={({ pressed }) => [pressed && { opacity: 0.6 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 12,
    fontSize: theme.font.size.md,
    color: theme.color.text,
    minHeight: MIN_TOUCH,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    minHeight: MIN_TOUCH,
    paddingVertical: 6,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
  },
  segmentItemActive: {
    backgroundColor: theme.color.primary,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  chipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    minHeight: MIN_TOUCH,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
