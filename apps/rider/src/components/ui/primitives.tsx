// Core layout + typography primitives built on the shared design tokens.
import React from 'react';
import {
  View,
  Text as RNText,
  ScrollView,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { theme } from '../../lib/theme';

type TVariant = 'display' | 'title' | 'heading' | 'subtitle' | 'body' | 'caption' | 'label' | 'mono';

const variantStyle: Record<TVariant, TextStyle> = {
  display: { fontSize: theme.font.size.display, fontWeight: '700', color: theme.color.text, letterSpacing: -0.5 },
  title: { fontSize: theme.font.size.xxl, fontWeight: '700', color: theme.color.text, letterSpacing: -0.3 },
  heading: { fontSize: theme.font.size.xl, fontWeight: '700', color: theme.color.text },
  subtitle: { fontSize: theme.font.size.lg, fontWeight: '600', color: theme.color.text },
  body: { fontSize: theme.font.size.md, fontWeight: '400', color: theme.color.text },
  caption: { fontSize: theme.font.size.sm, fontWeight: '400', color: theme.color.textMuted },
  label: { fontSize: theme.font.size.xs, fontWeight: '600', color: theme.color.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  mono: { fontSize: theme.font.size.xxl, fontWeight: '700', color: theme.color.text, fontVariant: ['tabular-nums'] },
};

export function T({
  variant = 'body',
  color,
  center,
  style,
  numberOfLines,
  children,
}: {
  variant?: TVariant;
  color?: string;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: React.ReactNode;
}) {
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[variantStyle[variant], color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
    >
      {children}
    </RNText>
  );
}

export function Screen({
  children,
  edges = ['top'],
  scroll = false,
  bg,
  padded = true,
  contentStyle,
  ...rest
}: {
  children: React.ReactNode;
  edges?: Edge[];
  scroll?: boolean;
  bg?: string;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
} & Pick<ScrollViewProps, 'refreshControl'>) {
  const inner = (
    <View style={[padded && { paddingHorizontal: theme.space.lg }, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: bg ?? theme.color.bg }]}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: theme.space.xxxl }}
          showsVerticalScrollIndicator={false}
          {...rest}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  onPressHint,
  padded = true,
  elevated = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPressHint?: boolean;
  padded?: boolean;
  elevated?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        padded && { padding: theme.space.lg },
        elevated && theme.shadow.card,
        onPressHint && { borderColor: theme.color.primary, borderWidth: 1 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({
  children,
  gap = theme.space.sm,
  align = 'center',
  justify = 'flex-start',
  wrap = false,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: align, justifyContent: justify, gap, flexWrap: wrap ? 'wrap' : 'nowrap' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Spacer({ size = theme.space.lg, horizontal = false }: { size?: number; horizontal?: boolean }) {
  return <View style={horizontal ? { width: size } : { height: size }} />;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border, marginVertical: theme.space.md }, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
});
