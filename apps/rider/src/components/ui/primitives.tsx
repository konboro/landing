// Core layout + typography primitives. Brand-aware: every value comes from
// `useTheme()`, so switching brand or light/dark re-renders them immediately.
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
import { useTheme, makeStyles } from '../../brand';
import type { RiderTheme } from '../../brand';
import { Backdrop } from './Backdrop';

type TVariant = 'display' | 'title' | 'heading' | 'subtitle' | 'body' | 'caption' | 'label' | 'mono';

function variantStyles(theme: RiderTheme): Record<TVariant, TextStyle> {
  const { font, color } = theme;
  return {
    display: { fontSize: font.size.display, fontWeight: '700', color: color.text, letterSpacing: -0.5 },
    title: { fontSize: font.size.xxl, fontWeight: '700', color: color.text, letterSpacing: -0.3 },
    heading: { fontSize: font.size.xl, fontWeight: '700', color: color.text },
    subtitle: { fontSize: font.size.lg, fontWeight: '600', color: color.text },
    body: { fontSize: font.size.md, fontWeight: '400', color: color.text },
    caption: { fontSize: font.size.sm, fontWeight: '400', color: color.textMuted },
    label: { fontSize: font.size.xs, fontWeight: '600', color: color.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
    mono: { fontSize: font.size.xxl, fontWeight: '700', color: color.text, fontVariant: ['tabular-nums'] },
  };
}

// Cached per theme object so a re-render doesn't rebuild the map.
const variantCache = new WeakMap<RiderTheme, Record<TVariant, TextStyle>>();
function useVariants(theme: RiderTheme): Record<TVariant, TextStyle> {
  const hit = variantCache.get(theme);
  if (hit) return hit;
  const built = variantStyles(theme);
  variantCache.set(theme, built);
  return built;
}

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
  const variants = useVariants(useTheme());
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[variants[variant], color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
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
  const theme = useTheme();
  const styles = useStyles(theme);
  const paddedStyle = padded ? { paddingHorizontal: theme.space.lg } : null;
  return (
    <SafeAreaView edges={edges} style={[styles.screen, bg ? { backgroundColor: bg } : null]}>
      {/* The sky backdrop is the default ground for every screen. A screen that
          owns its own surface (camera, QR scanner, the full-bleed map) passes an
          explicit `bg` and opts out. */}
      {bg ? null : <Backdrop />}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: theme.space.xxxl }}
          showsVerticalScrollIndicator={false}
          {...rest}
        >
          <View style={[paddedStyle, contentStyle]}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[styles.flex, paddedStyle, contentStyle]}>{children}</View>
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
  const theme = useTheme();
  const styles = useStyles(theme);
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
  gap,
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
  const theme = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap: gap ?? theme.space.sm,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Spacer({ size, horizontal = false }: { size?: number; horizontal?: boolean }) {
  const theme = useTheme();
  const s = size ?? theme.space.lg;
  return <View style={horizontal ? { width: s } : { height: s }} />;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      style={[
        { height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border, marginVertical: theme.space.md },
        style,
      ]}
    />
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1 },
  flex: { flex: 1 },
  card: {
    backgroundColor: t.color.surface,
    // Rounder than the old `radius.lg`, and borderless: over the sky backdrop a
    // hairline border read as a seam, so the shadow alone lifts the card.
    borderRadius: t.radius.xl,
  },
}));
