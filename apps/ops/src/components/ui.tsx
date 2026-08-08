// Utilitarian, high-contrast, glove-friendly primitives built on @penny/ui
// tokens via the ops theme. Big tap targets for outdoor field use.
import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { c, space, radius, font, tap, colorForStatus } from '../lib/theme';

export function Screen({ children, style, scroll = false, pad = true }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; scroll?: boolean; pad?: boolean;
}) {
  const inner = (
    <View style={[pad && { padding: space.lg, gap: space.md }, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={s.h2}>{children}</Text>;
}
export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.body, style]}>{children}</Text>;
}

export function Card({ children, style, onPress }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && s.pressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

export function Row({ children, style, gap = space.sm }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number;
}) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export function Button({ title, onPress, variant = 'primary', disabled, loading, style, icon }: {
  title: string; onPress?: () => void; variant?: BtnVariant; disabled?: boolean;
  loading?: boolean; style?: StyleProp<ViewStyle>; icon?: string;
}) {
  const bg = {
    primary: c.primary, secondary: c.surfaceAlt, danger: c.danger, success: c.success, ghost: 'transparent',
  }[variant];
  const fg = variant === 'secondary' || variant === 'ghost' ? c.text : c.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg },
        variant === 'ghost' && { borderWidth: 1, borderColor: c.border },
        (disabled || loading) && { opacity: 0.5 },
        pressed && s.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.btnText, { color: fg }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function StatusDot({ status, size = 12 }: { status: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colorForStatus(status) }} />;
}

export function Badge({ label, color, textColor }: { label: string; color?: string; textColor?: string }) {
  return (
    <View style={[s.badge, { backgroundColor: color ?? c.surfaceAlt }]}>
      <Text style={[s.badgeText, { color: textColor ?? c.text }]}>{label}</Text>
    </View>
  );
}

export function Pill({ label, color, textColor }: { label: string; color?: string; textColor?: string }) {
  return (
    <View style={[s.pill, { backgroundColor: color ?? c.surfaceAlt }]}>
      <Text style={[s.pillText, { color: textColor ?? c.text }]}>{label}</Text>
    </View>
  );
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, autoFocus }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'number-pad'; multiline?: boolean; autoFocus?: boolean;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textFaint}
        keyboardType={keyboardType}
        multiline={multiline}
        autoFocus={autoFocus}
        style={[s.input, multiline && { height: 96, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: c.border, marginVertical: space.xs }} />;
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ padding: space.xxl, alignItems: 'center' }}>
      <Muted>{text}</Muted>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  h1: { color: c.text, fontSize: font.size.xxl, fontWeight: '700' },
  h2: { color: c.text, fontSize: font.size.lg, fontWeight: '600' },
  body: { color: c.text, fontSize: font.size.md },
  muted: { color: c.textMuted, fontSize: font.size.sm },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: c.border },
  pressed: { opacity: 0.7 },
  btn: { minHeight: tap.min, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnText: { fontSize: font.size.md, fontWeight: '700' },
  badge: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, alignSelf: 'flex-start' },
  badgeText: { fontSize: font.size.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  pill: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: font.size.sm, fontWeight: '600' },
  label: { color: c.textMuted, fontSize: font.size.sm, fontWeight: '600' },
  input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, color: c.text, paddingHorizontal: space.md, minHeight: tap.min, fontSize: font.size.md },
});
