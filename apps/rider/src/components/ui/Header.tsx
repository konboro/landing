import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { MIN_TOUCH } from '../../lib/theme';
import { useTheme, makeStyles } from '../../brand';
import { T, Row } from './primitives';
import { Icon } from './Icon';

export function Header({
  title,
  subtitle,
  onBack,
  right,
  transparent = false,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  transparent?: boolean;
}) {
  const router = useRouter();
  const theme = useTheme();
  const styles = useStyles(theme);
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/map')));
  return (
    <Row
      justify="space-between"
      style={[styles.header, transparent && { backgroundColor: 'transparent', borderBottomWidth: 0 }]}
    >
      <Pressable onPress={back} hitSlop={12} style={styles.iconBtn} accessibilityLabel="Back">
        <Icon name="back" size={28} color={theme.color.text} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        {title ? <T variant="subtitle" numberOfLines={1}>{title}</T> : null}
        {subtitle ? <T variant="caption" numberOfLines={1}>{subtitle}</T> : null}
      </View>
      <View style={styles.iconBtn}>{right}</View>
    </Row>
  );
}

const useStyles = makeStyles((t) => ({
  header: {
    height: 52,
    paddingHorizontal: t.space.md,
    backgroundColor: t.color.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.color.border,
  },
  iconBtn: {
    minWidth: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
