// Runtime brand switcher — the white-label demo tool (dev menu only).
//
// Picking a brand or a light/dark mode re-themes the running app instantly,
// which is how you show a prospective operator their own colours on real
// screens. The choice persists in the SQLite `meta` table.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { validateBrand } from '@penny/ui';
import { useBrand, useTheme, makeStyles, opsNameFor } from '../brand';
import { Card, H2, Muted, Row, Badge, Divider } from './ui';

export function BrandSwitcher() {
  const { brand, brands, setBrandId, mode, setMode } = useBrand();
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const warnings = validateBrand(brand, mode);

  return (
    <Card>
      <H2>Brand (white-label demo)</H2>
      <Muted>
        Switch operator or light/dark and the whole app re-themes — no rebuild. Brands live in
        src/brand/brands.ts.
      </Muted>

      <View style={{ gap: theme.space.sm }}>
        {brands.map((b) => {
          const active = b.id === brand.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => setBrandId(b.id)}
              style={[st.row, active && { borderColor: c.primary }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View style={[st.monogram, { backgroundColor: b.colors.primary }]}>
                <Text style={[st.monogramText, { color: b.colors.onPrimary }]}>{b.assets.monogram}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{opsNameFor(b.id)}</Text>
                <Muted>{b.domain} · {b.currency} · {b.scheme}://</Muted>
              </View>
              <Row gap={4}>
                {(['primary', 'success', 'warning', 'danger'] as const).map((k) => (
                  <View key={k} style={[st.swatch, { backgroundColor: b.colors[k] }]} />
                ))}
              </Row>
            </Pressable>
          );
        })}
      </View>

      <Divider />

      <Row>
        <Pressable
          onPress={() => setMode('light')}
          style={[st.modeBtn, mode === 'light' && { backgroundColor: c.primary, borderColor: c.primary }]}
        >
          <Text style={[st.modeText, mode === 'light' && { color: c.onPrimary }]}>☀ Light (glare)</Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('dark')}
          style={[st.modeBtn, mode === 'dark' && { backgroundColor: c.primary, borderColor: c.primary }]}
        >
          <Text style={[st.modeText, mode === 'dark' && { color: c.onPrimary }]}>🌙 Dark (default)</Text>
        </Pressable>
      </Row>

      <Divider />

      <Muted>Accessibility check ({mode})</Muted>
      {warnings.length === 0 ? (
        <Badge label="all contrast checks pass" color={c.success} textColor={c.onSuccess} />
      ) : (
        warnings.map((w) => (
          <Badge key={w.token} label={`${w.token}: ${w.message}`} color={c.warning} textColor={c.onWarning} />
        ))
      )}

      <Muted>Disabled features: {disabledList(brand.features) || 'none'}</Muted>
    </Card>
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
    borderRadius: t.radius.md,
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: t.tap.row,
  },
  monogram: {
    width: 40,
    height: 40,
    borderRadius: t.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: { fontWeight: '800', fontSize: t.font.size.lg },
  name: { color: t.c.text, fontWeight: '700', fontSize: t.font.size.md },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  modeBtn: {
    flex: 1,
    minHeight: t.tap.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.c.border,
    backgroundColor: t.c.surfaceAlt,
  },
  modeText: { color: t.c.text, fontWeight: '700', fontSize: t.font.size.sm },
}));
