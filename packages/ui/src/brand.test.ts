import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pennyBrand,
  createBrand,
  brandFromConfig,
  resolveColors,
  brandCssVars,
  brandCssBlock,
  statusColor,
  deepLink,
  contrastRatio,
  readableOn,
  validateBrand,
  scaledRadius,
} from './brand.ts';

test('createBrand deep-merges over the default', () => {
  const acme = createBrand({
    id: 'acme',
    name: 'Acme Go',
    scheme: 'acmego',
    colors: { primary: '#ff5a1f' },
    assets: { monogram: 'A' },
  });
  assert.equal(acme.id, 'acme');
  assert.equal(acme.colors.primary, '#ff5a1f');
  // untouched siblings survive the merge
  assert.equal(acme.colors.success, pennyBrand.colors.success);
  assert.equal(acme.assets.emoji, pennyBrand.assets.emoji);
  assert.equal(acme.features.groupRides, true);
  // the default brand is not mutated
  assert.equal(pennyBrand.colors.primary, '#2f5be0');
  assert.equal(pennyBrand.id, 'penny');
});

test('feature flags can be turned off per client', () => {
  const lean = createBrand({ features: { groupRides: false, loyalty: false } });
  assert.equal(lean.features.groupRides, false);
  assert.equal(lean.features.reservations, true);
});

test('dark mode overlays only the overridden tokens', () => {
  const light = resolveColors(pennyBrand, 'light');
  const dark = resolveColors(pennyBrand, 'dark');
  assert.notEqual(light.bg, dark.bg);
  assert.equal(light.success, dark.success);
});

test('css vars are kebab-cased and prefixed', () => {
  const vars = brandCssVars(pennyBrand);
  assert.equal(vars['--brand-primary'], pennyBrand.colors.primary);
  assert.ok('--brand-status-low-battery' in vars);
  assert.ok(brandCssBlock(pennyBrand).startsWith(':root {'));
});

test('brandFromConfig tolerates junk', () => {
  assert.equal(brandFromConfig(null).id, 'penny');
  assert.equal(brandFromConfig('nope').id, 'penny');
  assert.equal(brandFromConfig({ name: 'X' }).name, 'X');
});

test('status colours and deep links follow the brand', () => {
  const b = createBrand({ scheme: 'acmego', colors: { statusAvailable: '#00ff00' } });
  assert.equal(statusColor(b, 'available'), '#00ff00');
  assert.equal(statusColor(b, 'nonsense'), b.colors.textMuted);
  assert.equal(deepLink(b, '/vehicle/ATH-1'), 'acmego://vehicle/ATH-1');
});

test('contrast helpers', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(readableOn('#ffffff'), '#000000');
  assert.equal(readableOn('#000000'), '#ffffff');
});

test('validateBrand flags an unreadable palette', () => {
  assert.equal(validateBrand(pennyBrand).length, 0);
  const bad = createBrand({ colors: { primary: '#ffff00', onPrimary: '#ffffff' } });
  const warnings = validateBrand(bad);
  assert.ok(warnings.some((w) => w.token === 'onPrimary/primary'));
});

test('shape scaling', () => {
  const round = createBrand({ shape: { radiusScale: 2, spaceScale: 1 } });
  assert.equal(scaledRadius(round, 12), 24);
});
