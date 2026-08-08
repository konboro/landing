// Runtime brand switcher — the white-label demo tool.
//
// Not a product surface: it's reachable from the dev menu (Profile → long-press
// the screen title). Picking a brand or a light/dark mode re-themes the running
// app instantly, which is how you show a prospective operator their own colours
// on real screens.
import React from 'react';
import { View, Pressable } from 'react-native';
import { validateBrand, type ThemeMode } from '@penny/ui';
import { useBrand, makeStyles, useTheme } from '../brand';
import { T, Row, Sheet, Badge, Divider, SegmentedControl } from './ui';

export function BrandSwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { brand, brands, setBrandId, mode, setMode } = useBrand();
  const theme = useTheme();
  const styles = useStyles(theme);
  const warnings = validateBrand(brand, mode);

  return (
    <Sheet visible={visible} onClose={onClose} title="Brand switcher (dev)">
      <T variant="caption">
        White-label demo. Everything below comes from `src/brand/brands.ts` — no rebuild needed.
      </T>

      <View style={{ gap: theme.space.sm, marginTop: theme.space.md }}>
        {brands.map((b) => {
          const active = b.id === brand.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => setBrandId(b.id)}
              style={[styles.row, active && { borderColor: theme.color.primary, borderWidth: 1.5 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.monogram, { backgroundColor: b.colors.primary }]}>
                <T variant="subtitle" color={b.colors.onPrimary}>{b.assets.monogram}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T variant="body" style={{ fontWeight: '700' }}>{b.name}</T>
                <T variant="caption">{b.domain} · {b.currency} · {b.scheme}://</T>
              </View>
              <Row gap={4}>
                {(['primary', 'success', 'warning', 'danger'] as const).map((k) => (
                  <View key={k} style={[styles.swatch, { backgroundColor: b.colors[k] }]} />
                ))}
              </Row>
            </Pressable>
          );
        })}
      </View>

      <Divider />

      <T variant="label">Theme mode</T>
      <SegmentedControl<ThemeMode>
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value={mode}
        onChange={setMode}
      />

      <View style={{ marginTop: theme.space.md, gap: 6 }}>
        <T variant="label">Accessibility check</T>
        {warnings.length === 0 ? (
          <Badge tone="success" icon="check" label="All contrast checks pass" />
        ) : (
          warnings.map((w) => (
            <Badge key={w.token} tone="warning" icon="warning" label={`${w.token}: ${w.message}`} />
          ))
        )}
      </View>

      <T variant="caption" style={{ marginTop: theme.space.md }}>
        Disabled features: {disabledList(brand.features) || 'none'}
      </T>
    </Sheet>
  );
}

function disabledList(features: Record<string, boolean>): string {
  return Object.entries(features)
    .filter(([, on]) => !on)
    .map(([k]) => k)
    .join(', ');
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    padding: t.space.md,
    borderRadius: t.radius.lg,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  monogram: {
    width: 40,
    height: 40,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: { width: 12, height: 12, borderRadius: 3 },
}));
