// Search field for vehicle / task / zone lists.
//
// The trailing slot exists because in the field the QR scanner is the *primary*
// way to find a vehicle and typing a plate is the fallback — so the scan button
// has to live inside the search affordance rather than somewhere else on screen.
import React from 'react';
import {
  View,
  TextInput,
  Pressable,
  type StyleProp,
  type ViewStyle,
  type ReturnKeyTypeOptions,
} from 'react-native';
import { useTheme, makeStyles } from '../../brand';
import { Icon } from './Icon';

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
  onClear,
  trailing,
  autoFocus,
  onSubmitEditing,
  returnKeyType = 'search',
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Called after the field is emptied. Omit and the clear button still works. */
  onClear?: () => void;
  /** QR / filter buttons, rendered outside the field's rounded box. */
  trailing?: React.ReactNode;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: ReturnKeyTypeOptions;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const st = useStyles(theme);

  const clear = () => {
    onChangeText('');
    onClear?.();
  };

  return (
    <View style={[st.row, style]}>
      <View style={st.field}>
        <Icon name="search" size={20} color={theme.c.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.c.textFaint}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          // Field IDs are short and often scanned-then-corrected; a clear button
          // is faster than holding backspace with a glove on.
          clearButtonMode="never"
          style={st.input}
        />
        {value.length > 0 ? (
          <Pressable
            onPress={clear}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={({ pressed }) => [st.clear, pressed && { opacity: 0.6 }]}
          >
            <Icon name="close" size={18} color={theme.c.textMuted} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    minHeight: t.tap.min,
    paddingHorizontal: t.space.md,
    borderRadius: t.radius.pill,
    backgroundColor: t.c.surface,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  input: {
    flex: 1,
    color: t.c.text,
    fontSize: t.font.size.md,
    // Height is owned by the row so the caret does not shift when the clear
    // button appears; padding here would fight it.
    paddingVertical: 0,
  },
  clear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
}));
