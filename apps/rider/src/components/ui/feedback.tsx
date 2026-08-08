// Feedback + status components — Badge, ProgressBar, SocPill, Banner, Sheet.
import React from 'react';
import {
  View,
  Modal,
  Pressable,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { theme } from '../../lib/theme';
import { socColor } from '@penny/ui';
import { T, Row } from './primitives';
import { Icon, type IconName } from './Icon';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

const toneBg: Record<Tone, string> = {
  neutral: theme.color.surfaceAlt,
  primary: theme.color.primarySoft,
  success: theme.color.successSoft,
  warning: theme.color.warningSoft,
  danger: theme.color.dangerSoft,
};
const toneFg: Record<Tone, string> = {
  neutral: theme.color.textMuted,
  primary: theme.color.primary,
  success: theme.color.success,
  warning: theme.color.warning,
  danger: theme.color.danger,
};

export function Badge({
  label,
  tone = 'neutral',
  icon,
  style,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: toneBg[tone] }, style]}>
      {icon ? <Icon name={icon} size={12} color={toneFg[tone]} /> : null}
      <T variant="caption" color={toneFg[tone]} style={{ fontWeight: '700' }}>
        {label}
      </T>
    </View>
  );
}

export function ProgressBar({
  value,
  tone = 'primary',
  height = 8,
}: {
  value: number; // 0..1
  tone?: Tone;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: toneFg[tone],
        }}
      />
    </View>
  );
}

/** Battery/state-of-charge pill with the shared soc color logic. */
export function SocPill({ soc, size = 'md' }: { soc: number; size?: 'sm' | 'md' }) {
  const level = socColor(soc);
  const tone: Tone = level === 'ok' ? 'success' : level === 'warn' ? 'warning' : 'danger';
  return (
    <View style={[styles.badge, { backgroundColor: toneBg[tone] }, size === 'sm' && { paddingVertical: 2 }]}>
      <Icon name="battery" size={12} color={toneFg[tone]} />
      <T variant="caption" color={toneFg[tone]} style={{ fontWeight: '700' }}>
        {Math.round(soc)}%
      </T>
    </View>
  );
}

export function Banner({
  tone = 'primary',
  icon,
  title,
  body,
  action,
  style,
}: {
  tone?: Tone;
  icon?: IconName;
  title: string;
  body?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.banner, { backgroundColor: toneBg[tone], borderColor: toneFg[tone] }, style]}>
      <Row gap={theme.space.md} align="flex-start">
        {icon ? <Icon name={icon} size={20} color={toneFg[tone]} /> : null}
        <View style={{ flex: 1 }}>
          <T variant="body" color={toneFg[tone]} style={{ fontWeight: '700' }}>
            {title}
          </T>
          {body ? (
            <T variant="caption" color={toneFg[tone]} style={{ marginTop: 2 }}>
              {body}
            </T>
          ) : null}
        </View>
        {action}
      </Row>
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  children,
  title,
  dismissable = true,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  dismissable?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={dismissable ? onClose : undefined}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          {title ? (
            <Row justify="space-between" style={{ marginBottom: theme.space.md }}>
              <T variant="subtitle">{title}</T>
              {dismissable ? (
                <Pressable onPress={onClose} hitSlop={12}>
                  <Icon name="close" size={20} color={theme.color.textMuted} />
                </Pressable>
              ) : null}
            </Row>
          ) : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    alignSelf: 'flex-start',
  },
  track: {
    width: '100%',
    backgroundColor: theme.color.surfaceAlt,
    overflow: 'hidden',
  },
  banner: {
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: theme.space.lg,
  },
  scrim: {
    flex: 1,
    backgroundColor: theme.color.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    padding: theme.space.xl,
    paddingBottom: theme.space.xxl,
    gap: theme.space.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.color.border,
    marginBottom: theme.space.md,
  },
});
