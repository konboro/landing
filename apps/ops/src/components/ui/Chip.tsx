// Chips — the damage part picker (deck, stem, throttle, front brake, …, ~22 of
// them) and every "filter by" row.
//
// A wrapped grid of chips beats a picker/modal here: the whole vocabulary is
// visible at once, selection is one tap, and multi-select needs no confirm step.
// The trade-off is density, so a chip is a full 44 px tall even though the text
// is small — a mechanic tapping "front brake" while holding the scooter upright
// gets one attempt.
import React from 'react';
import { View, Text, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, makeStyles, withAlpha, type OpsTheme } from '../../brand';
import { Icon, type IconName } from './Icon';

export type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export interface ChipOption {
  key: string;
  label: string;
  icon?: IconName;
  tone?: ChipTone;
}

/** Fill + ink for a selected chip. Unselected chips only borrow the fill for their border. */
function toneColors(t: OpsTheme, tone: ChipTone): { fill: string; ink: string } {
  switch (tone) {
    case 'primary':
      return { fill: t.c.primary, ink: t.c.onPrimary };
    case 'success':
      return { fill: t.c.success, ink: t.c.onSuccess };
    case 'warning':
      return { fill: t.c.warning, ink: t.c.onWarning };
    case 'danger':
      return { fill: t.c.danger, ink: t.c.onDanger };
    default:
      return { fill: t.c.primary, ink: t.c.onPrimary };
  }
}

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  tone = 'neutral',
  disabled = false,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  tone?: ChipTone;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { fill, ink } = toneColors(theme, tone);

  const fg = selected ? ink : theme.c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        st.chip,
        selected
          ? { backgroundColor: fill, borderColor: fill }
          : // A tinted border on an unselected semantic chip keeps the meaning
            // readable without competing with the selected state.
            {
              backgroundColor: theme.c.surfaceAlt,
              borderColor: tone === 'neutral' ? theme.c.border : withAlpha(fill, 0.55),
            },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={17} color={fg} strokeWidth={2} /> : null}
      <Text style={[st.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export type ChipGroupProps =
  | {
      options: ChipOption[];
      multiple: true;
      value: string[];
      onChange: (next: string[]) => void;
      style?: StyleProp<ViewStyle>;
    }
  | {
      options: ChipOption[];
      multiple?: false;
      /** `null` = nothing picked. Tapping the selected chip clears it. */
      value: string | null;
      onChange: (next: string | null) => void;
      style?: StyleProp<ViewStyle>;
    };

export function ChipGroup(props: ChipGroupProps) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { options, style } = props;

  const isSelected = (key: string): boolean =>
    props.multiple ? props.value.includes(key) : props.value === key;

  const toggle = (key: string): void => {
    if (props.multiple) {
      const current = props.value;
      props.onChange(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
    } else {
      // Single-select is also de-selectable: a filter you cannot clear is a trap.
      props.onChange(props.value === key ? null : key);
    }
  };

  return (
    <View style={[st.group, style]}>
      {options.map((o) => (
        <Chip
          key={o.key}
          label={o.label}
          icon={o.icon}
          tone={o.tone ?? 'neutral'}
          selected={isSelected(o.key)}
          onPress={() => toggle(o.key)}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  chip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.xs,
    paddingHorizontal: t.space.md,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
  },
  label: { fontSize: t.font.size.sm, fontWeight: '700' },
}));
