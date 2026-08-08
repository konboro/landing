// Utilitarian, high-contrast, glove-friendly primitives. Brand-aware: every
// colour, radius and type size comes from `useTheme()`, so switching brand or
// light/dark re-themes the whole app. Big tap targets for outdoor field use.
import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, makeStyles } from '../brand';

export function Screen({ children, style, scroll = false, pad = true }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; scroll?: boolean; pad?: boolean;
}) {
  const theme = useTheme();
  const s = useStyles(theme);
  const { space } = theme;
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
  return <Text style={useStyles(useTheme()).h1}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={useStyles(useTheme()).h2}>{children}</Text>;
}
export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[useStyles(useTheme()).muted, style]}>{children}</Text>;
}
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[useStyles(useTheme()).body, style]}>{children}</Text>;
}

export function Card({ children, style, onPress }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void;
}) {
  const s = useStyles(useTheme());
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && s.pressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

export function Row({ children, style, gap }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number;
}) {
  const { space } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: gap ?? space.sm }, style]}>{children}</View>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export function Button({ title, onPress, variant = 'primary', disabled, loading, style, icon }: {
  title: string; onPress?: () => void; variant?: BtnVariant; disabled?: boolean;
  loading?: boolean; style?: StyleProp<ViewStyle>; icon?: string;
}) {
  const theme = useTheme();
  const s = useStyles(theme);
  const { c } = theme;
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
  const { colorForStatus } = useTheme();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colorForStatus(status) }} />;
}

export function Badge({ label, color, textColor }: { label: string; color?: string; textColor?: string }) {
  const theme = useTheme();
  const s = useStyles(theme);
  return (
    <View style={[s.badge, { backgroundColor: color ?? theme.c.surfaceAlt }]}>
      <Text style={[s.badgeText, { color: textColor ?? theme.c.text }]}>{label}</Text>
    </View>
  );
}

export function Pill({ label, color, textColor }: { label: string; color?: string; textColor?: string }) {
  const theme = useTheme();
  const s = useStyles(theme);
  return (
    <View style={[s.pill, { backgroundColor: color ?? theme.c.surfaceAlt }]}>
      <Text style={[s.pillText, { color: textColor ?? theme.c.text }]}>{label}</Text>
    </View>
  );
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, autoFocus }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'number-pad'; multiline?: boolean; autoFocus?: boolean;
}) {
  const theme = useTheme();
  const s = useStyles(theme);
  return (
    <View style={{ gap: theme.space.xs }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.c.textFaint}
        keyboardType={keyboardType}
        multiline={multiline}
        autoFocus={autoFocus}
        style={[s.input, multiline && { height: 96, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function Divider() {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.c.border, marginVertical: theme.space.xs }} />;
}

export function Empty({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.space.xxl, alignItems: 'center' }}>
      <Muted>{text}</Muted>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.c.bg },
  h1: { color: t.c.text, fontSize: t.font.size.xxl, fontWeight: '700' },
  h2: { color: t.c.text, fontSize: t.font.size.lg, fontWeight: '600' },
  body: { color: t.c.text, fontSize: t.font.size.md },
  muted: { color: t.c.textMuted, fontSize: t.font.size.sm },
  card: { backgroundColor: t.c.surface, borderRadius: t.radius.lg, padding: t.space.lg, gap: t.space.sm, borderWidth: 1, borderColor: t.c.border },
  pressed: { opacity: 0.7 },
  btn: { minHeight: t.tap.min, borderRadius: t.radius.md, paddingHorizontal: t.space.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnText: { fontSize: t.font.size.md, fontWeight: '700' },
  badge: { paddingHorizontal: t.space.sm, paddingVertical: 3, borderRadius: t.radius.sm, alignSelf: 'flex-start' },
  badgeText: { fontSize: t.font.size.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  pill: { paddingHorizontal: t.space.md, paddingVertical: 6, borderRadius: t.radius.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: t.font.size.sm, fontWeight: '600' },
  label: { color: t.c.textMuted, fontSize: t.font.size.sm, fontWeight: '600' },
  input: { backgroundColor: t.c.surface, borderWidth: 1, borderColor: t.c.border, borderRadius: t.radius.md, color: t.c.text, paddingHorizontal: t.space.md, minHeight: t.tap.min, fontSize: t.font.size.md },
}));

// Kept as a named export for parity with the previous module surface; screens
// should build their own themed styles with `makeStyles` instead.
export { useStyles as useUiStyles };
