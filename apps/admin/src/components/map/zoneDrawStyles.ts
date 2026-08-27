// Paint for mapbox-gl-draw, plus the polygon mode the editor actually uses.
//
// Two things the stock setup gets wrong for this panel:
//
// 1. Every feature is drawn in the same blue/orange, so a map of ten zones says
//    nothing about what any of them is. Here the polygons take their kind's
//    colour (the same `zoneMapStyle` the rest of the panel uses) via the
//    `user_kind` property draw exposes to style expressions.
// 2. The vertex handles are 5 px dots and the midpoints only appear in
//    `direct_select`, which nothing tells the operator to enter. They are
//    enlarged here so a pin is something you can actually grab, and the
//    midpoints read as hollow "add me" pins.
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { zoneMapStyle } from '@/lib/zoneStyle';
import { ALL_ZONE_KINDS } from './zoneKinds';
import type { LngLat } from '@penny/db-types';

/** Our polygon mode. Registered alongside the stock modes. */
export const ZONE_DRAW_MODE = 'zone_draw_polygon';

const HANDLE_RING = '#ffffff';
const HANDLE_CORE = '#1d4ed8';
const HANDLE_SELECTED = '#e04141';
const MIDPOINT = '#1d4ed8';
const FALLBACK = 'rgba(90,103,128,0.55)';

/** `match` on the zone kind → that kind's outline colour. */
function kindColor(): unknown[] {
  const expr: unknown[] = ['match', ['get', 'user_kind']];
  for (const k of ALL_ZONE_KINDS) expr.push(k, zoneMapStyle(k).line);
  expr.push(FALLBACK);
  return expr;
}

/**
 * Layer set handed to MapboxDraw. Ids keep the `gl-draw-*` convention because
 * draw suffixes each one with `.hot`/`.cold` and expects them unique.
 */
export function zoneDrawStyles(): object[] {
  const color = kindColor();
  return [
    {
      id: 'gl-draw-polygon-fill',
      type: 'fill',
      filter: ['all', ['==', '$type', 'Polygon']],
      paint: {
        'fill-color': color,
        'fill-opacity': ['case', ['==', ['get', 'active'], 'true'], 0.3, 0.16],
      },
    },
    {
      id: 'gl-draw-polygon-stroke',
      type: 'line',
      filter: ['all', ['==', '$type', 'Polygon']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': ['case', ['==', ['get', 'active'], 'true'], 3, 2],
      },
    },
    {
      // The rubber-band line while the first two pins are still being placed.
      id: 'gl-draw-line',
      type: 'line',
      filter: ['all', ['==', '$type', 'LineString']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': HANDLE_CORE, 'line-width': 2.5, 'line-dasharray': [0.4, 2] },
    },
    {
      // Midpoints: hollow pins sitting between two real ones. Dragging or
      // clicking one inserts a vertex there — the whole point of making them
      // this visible.
      id: 'gl-draw-polygon-midpoint',
      type: 'circle',
      filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
      paint: {
        'circle-radius': 6,
        'circle-color': HANDLE_RING,
        'circle-opacity': 0.95,
        'circle-stroke-width': 2,
        'circle-stroke-color': MIDPOINT,
      },
    },
    {
      // Halo doubles as the grab target: a 12 px disc is hittable with a
      // trackpad, a 5 px dot is not.
      id: 'gl-draw-polygon-and-line-vertex-halo-active',
      type: 'circle',
      filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 13, 11],
        'circle-color': HANDLE_RING,
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(16,24,40,0.35)',
      },
    },
    {
      id: 'gl-draw-polygon-and-line-vertex-active',
      type: 'circle',
      filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5.5],
        'circle-color': ['case', ['==', ['get', 'active'], 'true'], HANDLE_SELECTED, HANDLE_CORE],
      },
    },
    {
      // Point features are not used by the zone editor, but draw renders
      // whatever is in its store; without this a stray point would be invisible.
      id: 'gl-draw-point',
      type: 'circle',
      filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
      paint: { 'circle-radius': 5, 'circle-color': HANDLE_CORE },
    },
  ];
}

/* ------------------------------------------------------------------ modes */

/** The bits of draw's internal polygon feature we drive directly. */
interface DrawPolygonFeature {
  id: string;
  coordinates: LngLat[][];
  setCoordinates(rings: LngLat[][]): void;
}
export interface ZoneDrawState {
  polygon: DrawPolygonFeature;
  currentVertexPosition: number;
}

/**
 * Pins committed so far. Draw keeps one extra coordinate that tracks the
 * cursor, so the count on screen is one less than the ring length.
 */
export function committedVertices(state: ZoneDrawState | null): LngLat[] {
  if (!state) return [];
  const ring = state.polygon.coordinates[0] ?? [];
  return ring.slice(0, Math.max(0, state.currentVertexPosition));
}

/**
 * Remove the last placed pin, keeping the cursor-tracking coordinate intact.
 *
 * Deliberately not `polygon.removeCoordinate()`: that drops the whole ring once
 * it is under three long, which throws the mode's position counter out of sync
 * with the feature and corrupts the next click.
 */
export function undoLastVertex(state: ZoneDrawState | null): boolean {
  if (!state || state.currentVertexPosition <= 0) return false;
  const ring = state.polygon.coordinates[0];
  if (!ring || ring.length === 0) return false;
  const next = ring.slice();
  next.splice(state.currentVertexPosition - 1, 1);
  state.currentVertexPosition -= 1;
  state.polygon.setCoordinates([next]);
  return true;
}

type ModeMap = Record<string, unknown>;
type Ctx = Record<string, unknown>;
type AnyMode = Record<string, unknown>;

/** Call a stock mode's method with our `this`, without TS fighting the untyped shape. */
function proxy(base: AnyMode, fn: string, self: unknown, ...args: unknown[]): unknown {
  const impl = base[fn] as ((this: unknown, ...a: unknown[]) => unknown) | undefined;
  return impl ? impl.call(self, ...args) : undefined;
}

/** Internal shape of `direct_select`'s state that the delete guard reads. */
interface DirectSelectState {
  featureId: string;
  selectedCoordPaths: string[];
  feature?: { coordinates?: LngLat[][] };
}

export interface ZoneModeHooks {
  /** Fired whenever the in-progress polygon changes, for the live HUD. */
  onDrawChange: () => void;
  /** Fired when a pin deletion was refused because a polygon needs three. */
  onDeleteRefused: () => void;
}

/**
 * The mode map handed to MapboxDraw: the stock modes, plus our polygon mode,
 * minus two stock behaviours that lose an operator's work.
 *
 * `zone_draw_polygon` — stock `draw_polygon` with:
 *  - its live state published to `sink`, so the HUD can show the pin count and
 *    area *while* drawing, and so "undo last pin" can exist at all (draw has no
 *    such API);
 *  - Backspace/Delete undoing one pin instead of throwing the whole shape away.
 *    Escape still cancels the lot — that is stock, and the on-map guidance says
 *    so rather than leaving it to be discovered.
 *
 * `direct_select` — stock, except that removing a pin is refused when it would
 * leave fewer than three. Stock draw silently DELETES THE WHOLE ZONE in that
 * case, which is a wildly disproportionate outcome for pressing Delete on a
 * triangle's corner.
 */
export function zoneDrawModes(sink: { current: ZoneDrawState | null }, hooks: ZoneModeHooks): ModeMap {
  const stock = MapboxDraw.modes as unknown as Record<string, AnyMode>;
  const basePolygon = stock.draw_polygon as AnyMode;
  const baseDirect = stock.direct_select as AnyMode;

  const drawPolygon = {
    ...basePolygon,
    onSetup(this: Ctx, opts: unknown) {
      const state = proxy(basePolygon, 'onSetup', this, opts) as ZoneDrawState;
      sink.current = state;
      hooks.onDrawChange();
      return state;
    },
    onClick(this: Ctx, state: ZoneDrawState, e: unknown) {
      const r = proxy(basePolygon, 'onClick', this, state, e);
      hooks.onDrawChange();
      return r;
    },
    onTap(this: Ctx, state: ZoneDrawState, e: unknown) {
      const r = proxy(basePolygon, 'onTap', this, state, e);
      hooks.onDrawChange();
      return r;
    },
    onTrash(this: Ctx, state: ZoneDrawState) {
      if (undoLastVertex(state)) {
        hooks.onDrawChange();
        return undefined;
      }
      return proxy(basePolygon, 'onTrash', this, state);
    },
    onStop(this: Ctx, state: ZoneDrawState) {
      const r = proxy(basePolygon, 'onStop', this, state);
      sink.current = null;
      hooks.onDrawChange();
      return r;
    },
  };

  const directSelect = {
    ...baseDirect,
    onTrash(this: Ctx, state: DirectSelectState) {
      const ring = state.feature?.coordinates?.[0] ?? [];
      if (state.selectedCoordPaths.length && ring.length - state.selectedCoordPaths.length < 3) {
        hooks.onDeleteRefused();
        return undefined;
      }
      return proxy(baseDirect, 'onTrash', this, state);
    },
  };

  return { ...(stock as unknown as ModeMap), direct_select: directSelect, [ZONE_DRAW_MODE]: drawPolygon };
}
