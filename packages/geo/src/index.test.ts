import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversine,
  pointInPolygon,
  evaluateZones,
  canEndHere,
  snapToGrid,
  estimateRangeM,
  type Polygon,
} from './index.ts';

const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

test('haversine ~111km per degree lat', () => {
  const d = haversine([0, 0], [0, 1]);
  assert.ok(Math.abs(d - 111_195) < 500, `got ${d}`);
});

test('pointInPolygon inside/outside', () => {
  assert.equal(pointInPolygon([0.5, 0.5], square), true);
  assert.equal(pointInPolygon([2, 2], square), false);
});

test('evaluateZones matches operating + bonus', () => {
  const ev = evaluateZones([0.5, 0.5], [
    { kind: 'operating', geom: square },
    { kind: 'bonus', geom: square, rules: { bonus_cents: 100 } },
  ]);
  assert.equal(ev.inOperating, true);
  assert.equal(ev.bonusCents, 100);
  assert.equal(canEndHere(ev).ok, true);
});

test('canEndHere blocks no_parking', () => {
  const ev = evaluateZones([0.5, 0.5], [
    { kind: 'operating', geom: square },
    { kind: 'no_parking', geom: square },
  ]);
  assert.equal(canEndHere(ev).ok, false);
});

test('snapToGrid idempotent + range estimate', () => {
  const a = snapToGrid([23.7, 37.98], 100);
  const b = snapToGrid(a, 100);
  // cos(lat) drift across the tiny snap keeps this within a metre, not bit-exact.
  assert.ok(Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3);
  assert.equal(estimateRangeM(50, 30000), 15000);
});
