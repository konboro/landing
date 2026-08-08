import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatDistance, co2SavedKg, socColor } from './format.ts';

test('formatDuration', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1h 02m');
});

test('formatDistance', () => {
  assert.equal(formatDistance(500), '500 m');
  assert.equal(formatDistance(1500), '1.50 km');
  assert.equal(formatDistance(15000), '15.0 km');
});

test('co2 + socColor', () => {
  assert.equal(co2SavedKg(5000), 0.6);
  assert.equal(socColor(80), 'ok');
  assert.equal(socColor(20), 'warn');
  assert.equal(socColor(5), 'crit');
});
