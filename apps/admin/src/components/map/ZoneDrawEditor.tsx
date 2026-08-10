import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { mapToken, MapFallback } from './MapView';
import { Button } from '@/components/ui/primitives';
import { zoneMapStyle } from '@/lib/zoneStyle';
import { titleCase } from '@/lib/format';
import {
  ZONE_DRAW_MODE,
  committedVertices,
  undoLastVertex,
  zoneDrawModes,
  zoneDrawStyles,
  type ZoneDrawState,
} from './zoneDrawStyles';
import { closeRing, distinctVertexCount, formatArea, mainCluster, polygonAreaKm2, vertexCount, zoneRings } from './zoneGeometry';
import { OPERATING_CITY } from '@penny/geo';
import type { LngLat, Zone } from '@penny/db-types';

interface Props {
  /** Zones to render — the page's working draft, including one pending zone while it is being named. */
  zones: Zone[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** A closed polygon. `drawId` is mapbox-gl-draw's own feature id: keep it as
   * the zone id, or later draw.update / draw.delete events match no zone. */
  onCreate: (coordinates: LngLat[][], drawId: string) => void;
  onUpdate: (id: string, coordinates: LngLat[][]) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
  height?: number | string;
  /** Bump to re-frame the map on the current selection (or on everything). */
  frameToken?: number;
  /** Suppresses drawing while a modal owns the interaction. */
  locked?: boolean;
}

type DrawFeature = { id?: string | number; geometry: { type: string; coordinates: unknown } };
type SelectionEvent = { features?: DrawFeature[]; points?: unknown[] };

const HUD_CARD: React.CSSProperties = {
  pointerEvents: 'auto',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-pop)',
  padding: '10px 12px',
  maxWidth: 340,
  fontSize: 'var(--fs-sm)',
};

/**
 * The zone editor: draw a polygon by dropping pins, then reshape it by dragging
 * them.
 *
 * The stock mapbox-gl-draw experience is technically complete and practically
 * undiscoverable — a polygon button, invisible midpoints, and a `direct_select`
 * mode you have to know to enter. Everything below exists to put that on
 * screen: a labelled draw affordance, live guidance and a running pin/area
 * readout while drawing, automatic entry into vertex editing when a zone is
 * selected, and big enough handles to actually grab.
 *
 * Falls back to a schematic view when there is no Mapbox token; the Zones page
 * keeps its GeoJSON import/export so a zone can still be edited without one.
 */
export function ZoneDrawEditor({
  zones,
  selectedId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  canEdit,
  height = 560,
  frameToken = 0,
  locked = false,
}: Props) {
  const token = mapToken();
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const sink = useRef<ZoneDrawState | null>(null);
  const lastUpdate = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<string>('simple_select');
  const [live, setLive] = useState<{ pins: number; km2: number }>({ pins: 0, km2: 0 });
  const [pinsSelected, setPinsSelected] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** Auto-framing happens once; after that the view belongs to the operator. */
  const framed = useRef(false);

  // Draw events fire long after mount, so handlers must not close over first-render
  // props: every edit after the first would be computed from a stale zone list.
  const cbs = useRef({ onCreate, onUpdate, onDelete, onSelect });
  cbs.current = { onCreate, onUpdate, onDelete, onSelect };

  const drawing = mode === ZONE_DRAW_MODE;
  const editingPins = mode === 'direct_select';

  const selectedZone = useMemo(() => zones.find((z) => z.id === selectedId) ?? null, [zones, selectedId]);
  const selectedRings = useMemo(() => zoneRings(selectedZone?.geom), [selectedZone]);

  const refreshLive = useCallback(() => {
    const pts = committedVertices(sink.current);
    setLive({ pins: pts.length, km2: pts.length >= 3 ? polygonAreaKm2([closeRing(pts)]) : 0 });
  }, []);

  const syncMode = useCallback(() => {
    const draw = drawRef.current;
    if (draw) setMode(draw.getMode() as string);
  }, []);

  const fitTo = useCallback((polygons: LngLat[][][]) => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new mapboxgl.LngLatBounds();
    let any = false;
    for (const rings of polygons) {
      for (const ring of rings) {
        for (const p of ring) {
          if (Array.isArray(p) && p.length >= 2) {
            bounds.extend([p[0], p[1]]);
            any = true;
          }
        }
      }
    }
    if (any) map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 500 });
  }, []);

  // Notices are transient guidance, not a log.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ------------------------------------------------------------- map setup */
  useEffect(() => {
    if (!token || !ref.current) return;
    mapboxgl.accessToken = token;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: ref.current,
        style: 'mapbox://styles/mapbox/light-v11',
        // Only what you see before the zones load and reframe the camera.
        center: OPERATING_CITY.center,
        zoom: 12,
        attributionControl: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      boxSelect: false,
      // Without this the `kind` we attach to each feature never reaches the
      // paint expressions, and every zone renders the same colour.
      userProperties: true,
      // 2 px is the stock hit radius for a handle. 6 makes a pin grabbable.
      clickBuffer: 6,
      styles: zoneDrawStyles(),
      modes: zoneDrawModes(sink, {
        onDrawChange: refreshLive,
        onDeleteRefused: () => setNotice('A zone needs at least 3 pins — move this one instead of removing it.'),
      }) as never,
    });
    drawRef.current = draw;
    map.addControl(draw as unknown as mapboxgl.IControl);
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

    // mapbox-gl-draw fires custom string events not in the typed Map event map.
    const on = map.on.bind(map) as unknown as (type: string, listener: (e: never) => void) => void;
    map.on('load', () => setReady(true));
    map.on('error', (e) => {
      // A rejected token yields a blank grey box otherwise; tile errors stay non-fatal.
      const status = (e as unknown as { error?: { status?: number } }).error?.status;
      if (status === 401 || status === 403) setFailed(true);
    });

    on('draw.create', ((e: { features: DrawFeature[] }) => {
      const f = e.features[0];
      if (!f || f.geometry.type !== 'Polygon' || f.id == null) return;
      const coords = f.geometry.coordinates as LngLat[][];
      // Guard rail: a geofence needs an area. Three pins on two spots is not one.
      if (distinctVertexCount(coords) < 3) {
        draw.delete([String(f.id)]);
        setNotice('That shape had fewer than 3 distinct pins, so it was discarded.');
        syncMode();
        return;
      }
      setNotice(null);
      cbs.current.onCreate(coords, String(f.id));
      syncMode();
    }) as never);

    on('draw.update', ((e: { features: DrawFeature[] }) => {
      lastUpdate.current = Date.now();
      for (const f of e.features) {
        if (f.geometry.type === 'Polygon' && f.id != null) {
          cbs.current.onUpdate(String(f.id), f.geometry.coordinates as LngLat[][]);
        }
      }
    }) as never);

    on('draw.delete', ((e: { features: DrawFeature[] }) => {
      for (const f of e.features) if (f.id != null) cbs.current.onDelete(String(f.id));
    }) as never);

    on('draw.selectionchange', ((e: SelectionEvent) => {
      setPinsSelected((e.points ?? []).length);
      const first = (e.features ?? [])[0];
      cbs.current.onSelect(first?.id != null ? String(first.id) : null);
      syncMode();
    }) as never);

    on('draw.modechange', (() => syncMode()) as never);

    // Clicking a zone while another one is in vertex-edit mode otherwise just
    // deselects (stock draw sends you back to simple_select with nothing
    // selected), so the operator has to click twice. Pick the hit zone here.
    map.on('click', (e) => {
      const d = drawRef.current;
      if (!d || d.getMode() === ZONE_DRAW_MODE) return;
      // A vertex drag ends with a DOM click too. Releasing a pin over a
      // neighbouring zone must not yank the operator into editing that one.
      if (Date.now() - lastUpdate.current < 250) return;
      const hit = d.getFeatureIdsAt(e.point).find((id) => typeof id === 'string' && id.length > 0);
      if (hit) cbs.current.onSelect(String(hit));
    });

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
      sink.current = null;
      // The next map is a blank camera, so it has to earn its framing again.
      framed.current = false;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* ------------------------------------------- push the zone list into draw */
  // Its own effect: `zones` arrives asynchronously, so folding this into the
  // setup effect meant existing zones never appeared and you could only draw.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !ready) return;

    const desired = new Map<string, { coords: LngLat[][]; kind: string }>();
    for (const z of zones) {
      const rings = zoneRings(z.geom);
      if (rings?.length) desired.set(z.id, { coords: rings, kind: z.kind });
    }
    const current = draw.getAll().features;

    // Only a membership/geometry change may reset the collection: draw.set()
    // drops the selection, which mid-drag would cancel the edit in progress.
    let structural = current.length !== desired.size;
    if (!structural) {
      for (const f of current) {
        const want = desired.get(String(f.id));
        if (!want || JSON.stringify(want.coords) !== JSON.stringify((f.geometry as { coordinates: unknown }).coordinates)) {
          structural = true;
          break;
        }
      }
    }
    if (structural) {
      draw.set({
        type: 'FeatureCollection',
        features: [...desired].map(([id, d]) => ({
          id,
          type: 'Feature' as const,
          properties: { kind: d.kind },
          geometry: { type: 'Polygon' as const, coordinates: d.coords },
        })),
      } as GeoJSON.FeatureCollection);
    } else {
      // Kind-only change (the picker in the naming modal, or the list) — repaint
      // in the new colour without disturbing the selection.
      for (const f of current) {
        const want = desired.get(String(f.id));
        if (want && (f.properties as { kind?: string } | null)?.kind !== want.kind) {
          draw.setFeatureProperty(String(f.id), 'kind', want.kind);
        }
      }
    }

    // Frame what actually loaded rather than a hardcoded city — a fleet
    // elsewhere used to get a map with its zones somewhere off-screen.
    //
    // Only the cluster the city actually lives in, though: this project has a
    // leftover test polygon 1400 km away, and framing the union of everything
    // opened the editor zoomed out to half of Europe. The outlier is still
    // drawn, still listed, still flagged in its warnings, and "Fit" frames
    // every zone — this is the opening camera, not a correction.
    if (framed.current || desired.size === 0) return;
    framed.current = true;
    fitTo(mainCluster(zones).flatMap((z) => {
      const r = zoneRings(z.geom);
      return r ? [r] : [];
    }));
  }, [zones, ready]);

  /* --------------------------------------------------- selection → editing */
  // Selecting a zone drops you straight into vertex editing. This is the whole
  // point: `direct_select` is where pins and midpoints live, and nothing in the
  // stock UI ever tells an operator it exists.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !ready || drawing || locked) return;
    if (!selectedId) {
      if (draw.getMode() === 'direct_select') {
        draw.changeMode('simple_select');
        syncMode();
      }
      return;
    }
    if (!draw.get(selectedId)) return;
    if (!canEdit) return;
    if (draw.getMode() === 'direct_select' && draw.getSelectedIds()[0] === selectedId) return;
    draw.changeMode('direct_select', { featureId: selectedId });
    setPinsSelected(0);
    syncMode();
  }, [selectedId, ready, drawing, locked, canEdit, zones, syncMode]);

  /* -------------------------------------------------------------- framing */
  useEffect(() => {
    if (!ready || frameToken === 0) return;
    const target = selectedRings
      ? [selectedRings]
      : zones.flatMap((z) => {
          const r = zoneRings(z.geom);
          return r ? [r] : [];
        });
    fitTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameToken, ready]);

  /* -------------------------------------------------------------- actions */
  const startDraw = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    setNotice(null);
    cbs.current.onSelect(null);
    draw.changeMode(ZONE_DRAW_MODE as never);
    refreshLive();
    syncMode();
  }, [refreshLive, syncMode]);

  const undoPin = useCallback(() => {
    const draw = drawRef.current;
    if (!draw || !undoLastVertex(sink.current)) return;
    // The undo happens outside draw's event loop, so nothing has asked the
    // store to repaint. Deleting nothing is the cheapest public way to do it.
    draw.delete([]);
    refreshLive();
  }, [refreshLive]);

  const finishDraw = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    // Leaving the mode is what commits the polygon: draw fires `draw.create`
    // from the mode's own teardown.
    draw.changeMode('simple_select');
    syncMode();
  }, [syncMode]);

  const cancelDraw = useCallback(() => {
    const draw = drawRef.current;
    const state = sink.current;
    if (!draw) return;
    if (state) draw.delete([state.polygon.id]);
    draw.changeMode('simple_select');
    sink.current = null;
    refreshLive();
    syncMode();
    setNotice(null);
  }, [refreshLive, syncMode]);

  const removeSelectedPin = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    setNotice(null);
    draw.trash();
    syncMode();
  }, [syncMode]);

  const toggleWholeZoneMove = useCallback(() => {
    const draw = drawRef.current;
    if (!draw || !selectedId) return;
    if (draw.getMode() === 'direct_select') draw.changeMode('simple_select', { featureIds: [selectedId] });
    else draw.changeMode('direct_select', { featureId: selectedId });
    syncMode();
  }, [selectedId, syncMode]);

  /* ------------------------------------------------------------- keyboard */
  // Owned here rather than left to mapbox-gl-draw: draw's own Backspace
  // handling is gated on the trash *control* being displayed (which it is not —
  // the HUD replaces it) and on the canvas holding focus. Neither is something
  // the operator should have to know about, and the on-map guidance promises
  // these keys work.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Never steal keys from a field — Backspace has a day job in the name input.
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const del = e.key === 'Backspace' || e.key === 'Delete';
      if (drawing) {
        if (e.key === 'Escape' || del || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') cancelDraw();
          else undoPin();
        }
        return;
      }
      if (del && editingPins && pinsSelected > 0) {
        e.preventDefault();
        e.stopPropagation();
        removeSelectedPin();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canEdit, drawing, editingPins, pinsSelected, cancelDraw, undoPin, removeSelectedPin]);

  /* ----------------------------------------------------------------- view */
  if (!token || failed) {
    return (
      <MapFallback
        height={height}
        zones={zones.flatMap((z) => {
          const r = zoneRings(z.geom);
          return r ? [{ id: z.id, coordinates: r, ...zoneMapStyle(z.kind), label: z.name ?? z.kind }] : [];
        })}
      />
    );
  }

  const selectedPins = vertexCount(selectedRings);
  const selectedArea = polygonAreaKm2(selectedRings);

  return (
    <div className="map-box" style={{ height, minHeight: 420 }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 12, gap: 10 }}>
        {/* top row: status on the left, the create affordance on the right */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            {drawing ? (
              <div style={HUD_CARD} data-testid="zone-draw-hud">
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Drawing a new zone</div>
                <div className="muted" style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.45 }}>
                  Click the map to drop a pin. Click the first pin again — or press Enter — to close the shape.
                </div>
                <div style={{ margin: '8px 0 8px', fontVariantNumeric: 'tabular-nums' }} data-testid="zone-live-readout">
                  <b>{live.pins}</b> {live.pins === 1 ? 'pin' : 'pins'}
                  {live.pins >= 3 ? <> · {formatArea(live.km2)}</> : <span className="muted"> · need at least 3</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={undoPin} disabled={live.pins === 0} data-testid="zone-draw-undo">
                    Undo pin
                  </Button>
                  <Button size="sm" variant="primary" onClick={finishDraw} disabled={live.pins < 3} data-testid="zone-draw-finish">
                    Close shape
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelDraw} data-testid="zone-draw-cancel">
                    Cancel
                  </Button>
                </div>
                <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>
                  Backspace removes the last pin · Esc discards the shape
                </div>
              </div>
            ) : selectedZone ? (
              <div style={HUD_CARD} data-testid="zone-edit-hud">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: zoneMapStyle(selectedZone.kind).line }} />
                  {selectedZone.name || 'Unnamed zone'}
                  <span className="muted" style={{ fontWeight: 400 }}>· {titleCase(selectedZone.kind)}</span>
                </div>
                <div style={{ margin: '6px 0', fontVariantNumeric: 'tabular-nums' }} data-testid="zone-edit-readout">
                  <b>{selectedPins}</b> {selectedPins === 1 ? 'pin' : 'pins'} · {formatArea(selectedArea)}
                </div>
                {canEdit ? (
                  <>
                    <div className="muted" style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.45 }}>
                      {editingPins
                        ? 'Drag a solid pin to move it. Drag or click a hollow pin between two of them to add one. Click a pin, then Delete, to remove it.'
                        : 'Whole-zone mode: drag anywhere inside the zone to move all of its pins together.'}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      <Button size="sm" onClick={removeSelectedPin} disabled={!editingPins || pinsSelected === 0} data-testid="zone-pin-remove">
                        Remove pin{pinsSelected > 1 ? `s (${pinsSelected})` : ''}
                      </Button>
                      <Button size="sm" onClick={toggleWholeZoneMove} data-testid="zone-edit-toggle">
                        {editingPins ? 'Move whole zone' : 'Edit pins'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => cbs.current.onSelect(null)} data-testid="zone-edit-done">
                        Done
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Read-only — you do not have the zones.edit permission.</div>
                )}
              </div>
            ) : null}
            {notice ? (
              <div style={{ ...HUD_CARD, borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }} data-testid="zone-notice">
                {notice}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto', flexShrink: 0 }}>
            {!drawing && canEdit ? (
              <Button variant="primary" onClick={startDraw} disabled={locked} data-testid="zone-draw-start">
                + Draw a zone
              </Button>
            ) : null}
            <Button
              title={selectedRings ? 'Frame the selected zone' : 'Frame every zone, including any that sit far from the city'}
              onClick={() => fitTo(selectedRings ? [selectedRings] : zones.flatMap((z) => { const r = zoneRings(z.geom); return r ? [r] : []; }))}
              data-testid="zone-fit"
            >
              Fit
            </Button>
          </div>
        </div>

        {/* bottom row: what the handles mean, so midpoints stop being a secret */}
        {drawing || editingPins ? (
          <div style={{ ...HUD_CARD, maxWidth: 'none', width: 'fit-content', padding: '7px 11px', display: 'flex', gap: 14, alignItems: 'center', fontSize: 'var(--fs-xs)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#1d4ed8', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(16,24,40,.3)' }} />
              pin — drag to move
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#fff', border: '2px solid #1d4ed8' }} />
              midpoint — drag to add a pin
            </span>
          </div>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
