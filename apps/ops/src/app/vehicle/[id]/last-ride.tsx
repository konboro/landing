// Last ride — replay of the most recent trip on a vehicle.
//
// Why a replay at all: "the scooter is 300 m from where the app says" is the
// single most common field complaint, and watching the last trip play out tells
// a mechanic whether it drifted, was carried, or simply ended in a courtyard.
//
// TRACK SOURCE, in order of preference:
//
//   1. `VehicleRide.track` — the real GPS trace, pulled from `trip_routes.path`
//      (one LineString per trip). This is what gets drawn whenever it exists,
//      and the panel says "GPS track".
//   2. `buildTrack()` — a RECONSTRUCTION from the ride's distance and its known
//      end point, used only when the mirror has no trace for that ride (an old
//      row, or a route that never synced). Derived deterministically from the
//      ride id so it never jumps between renders, and labelled "approx. track"
//      so nobody reads an invented line as evidence.
//
// The distinction is not cosmetic: this screen is used to work out where a
// scooter actually went, and a plausible-looking wrong answer is worse here
// than an obviously absent one.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  PanResponder,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Polyline as SvgPolyline, Circle as SvgCircle } from 'react-native-svg';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haversine } from '@penny/geo';
import { formatDistance, formatDuration, formatDateTime, formatMoney } from '@penny/ui';
import type { LngLat } from '@penny/db-types';
import { useTheme, makeStyles, withAlpha } from '../../../brand';
import { Icon, Body, Muted, Badge, Empty } from '../../../components/ui';
import * as repo from '../../../offline/repo';
import { hasMapboxToken, env } from '../../../lib/env';
import { ATHENS_CENTER } from '../../../services/mockData';
import type { OpsVehicle, VehicleRide } from '../../../lib/types';

// --- Mapbox guard (same degradation contract as components/FleetMap.tsx) -----
type MapboxComponent = React.ComponentType<{ children?: React.ReactNode } & Record<string, unknown>>;
interface MapboxModule {
  MapView?: MapboxComponent;
  Camera?: MapboxComponent;
  ShapeSource?: MapboxComponent;
  LineLayer?: MapboxComponent;
  PointAnnotation?: MapboxComponent;
  setAccessToken?: (token: string) => void;
}

let Mapbox: MapboxModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@rnmapbox/maps') as { default?: MapboxModule } & MapboxModule;
  Mapbox = mod.default ?? mod;
  if (Mapbox?.setAccessToken && env.mapboxToken) Mapbox.setAccessToken(env.mapboxToken);
} catch {
  Mapbox = null;
}

/** A ride row may carry battery endpoints on a newer backend; both are optional
 *  so today's `VehicleRide` still satisfies the type and the tiles just hide. */
type MirrorRide = VehicleRide & { soc_start_pct?: number | null; soc_end_pct?: number | null };

const SPEEDS = [1, 4, 16] as const;
type Speed = (typeof SPEEDS)[number];

/** Real-time seconds one minute of ride takes at 1×. A 30-minute trip replayed
 *  literally would be useless, so 1× is already a 20:1 compression and the
 *  multipliers ride on top of it. */
const BASE_MS_PER_RIDE_MINUTE = 3_000;
const MIN_PLAYBACK_MS = 1_500;

/** Repaint the marker at ~15 Hz. The animation itself runs at frame rate; only
 *  the React state that moves a map annotation is throttled, because a
 *  PointAnnotation re-mount 60×/s stutters far worse than a 66 ms step. */
const PAINT_MS = 66;

const TRACK_POINTS = 64;

// --- Track reconstruction ---------------------------------------------------
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEG_LAT_M = 111_320;

/**
 * A plausible urban track of the right length, ending exactly on the vehicle's
 * last known position. Heading changes are smooth and bounded so the shape reads
 * as streets rather than as noise.
 */
function buildTrack(ride: VehicleRide, endAt: LngLat): LngLat[] {
  const rnd = mulberry32(seedFrom(ride.id));
  const stepM = Math.max(5, ride.distance_m / (TRACK_POINTS - 1));
  const lngM = DEG_LAT_M * Math.cos((endAt[1] * Math.PI) / 180) || DEG_LAT_M;

  // Build in metre offsets from an arbitrary origin, then translate so the last
  // sample lands on the real end point.
  let heading = rnd() * Math.PI * 2;
  let x = 0;
  let y = 0;
  const offsets: [number, number][] = [[0, 0]];
  for (let i = 1; i < TRACK_POINTS; i++) {
    heading += (rnd() - 0.5) * 0.7;
    x += Math.cos(heading) * stepM;
    y += Math.sin(heading) * stepM;
    offsets.push([x, y]);
  }
  const last = offsets[offsets.length - 1] ?? [0, 0];
  return offsets.map(([ox, oy]) => [
    endAt[0] + (ox - last[0]) / lngM,
    endAt[1] + (oy - last[1]) / DEG_LAT_M,
  ]);
}

// --- Geometry ---------------------------------------------------------------
interface Bounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

function boundsOf(points: LngLat[]): Bounds {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng)) {
    return { minLng: ATHENS_CENTER[0], maxLng: ATHENS_CENTER[0], minLat: ATHENS_CENTER[1], maxLat: ATHENS_CENTER[1] };
  }
  return { minLng, minLat, maxLng, maxLat };
}

function makeProjector(b: Bounds, w: number, h: number, pad: number): (p: LngLat) => [number, number] {
  const kx = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180) || 1;
  const lngSpan = Math.max(1e-6, (b.maxLng - b.minLng) * kx);
  const latSpan = Math.max(1e-6, b.maxLat - b.minLat);
  const iw = Math.max(1, w - pad * 2);
  const ih = Math.max(1, h - pad * 2);
  const s = Math.min(iw / lngSpan, ih / latSpan);
  const ox = pad + (iw - lngSpan * s) / 2;
  const oy = pad + (ih - latSpan * s) / 2;
  return ([lng, lat]) => [ox + (lng - b.minLng) * kx * s, oy + (b.maxLat - lat) * s];
}

/** Cumulative metres along the track, so seeking is proportional to DISTANCE
 *  travelled and the marker does not sprint through the dense corners. */
function cumulative(track: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < track.length; i++) {
    cum.push((cum[i - 1] ?? 0) + haversine(track[i - 1]!, track[i]!));
  }
  return cum;
}

function pointAt(track: LngLat[], cum: number[], fraction: number): LngLat {
  const total = cum[cum.length - 1] ?? 0;
  const first = track[0] ?? ATHENS_CENTER;
  if (track.length < 2 || total <= 0) return first;
  const want = Math.min(Math.max(fraction, 0), 1) * total;
  let i = 1;
  while (i < cum.length - 1 && (cum[i] ?? 0) < want) i++;
  const a = track[i - 1] ?? first;
  const b = track[i] ?? first;
  const segStart = cum[i - 1] ?? 0;
  const segLen = (cum[i] ?? 0) - segStart;
  const t = segLen > 0 ? (want - segStart) / segLen : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
export default function LastRideScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const st = useStyles(theme);
  const insets = useSafeAreaInsets();
  const { c } = theme;

  const [vehicle, setVehicle] = useState<OpsVehicle | null>(null);
  const [ride, setRide] = useState<MirrorRide | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [v, rides] = await Promise.all([repo.getVehicle(id), repo.getVehicleRides(id)]);
      if (!alive) return;
      setVehicle(v);
      // `getVehicleRides` already orders started_at DESC — the newest is the one.
      setRide(rides[0] ?? null);
      setLoaded(true);
    })().catch(() => {
      if (alive) setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  // The real GPS trace when the mirror has it (`trip_routes.path`, pulled into
  // `VehicleRide.track`), and only then the reconstruction. Two points is the
  // floor for a line — a single stored fix says where it ended, not where it went.
  const realTrack = ride?.track && ride.track.length >= 2 ? ride.track : null;
  const track = useMemo(
    () => realTrack ?? (ride ? buildTrack(ride, vehicle?.pos ?? ATHENS_CENTER) : []),
    [realTrack, ride, vehicle?.pos],
  );
  const isApprox = !realTrack && track.length > 0;
  const cum = useMemo(() => cumulative(track), [track]);

  // --- playback -------------------------------------------------------------
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [cursor, setCursor] = useState(0);
  const [trackW, setTrackW] = useState(0);

  // Two values driven in lockstep, on purpose: the scrubber is a transform and
  // belongs on the UI thread, while the map marker is a plain JS prop that the
  // native driver cannot touch. One value cannot be both.
  const jsProgress = useRef(new Animated.Value(0)).current;
  const uiProgress = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const progressRef = useRef(0);
  const lastPaint = useRef(0);

  const durationMs = Math.max(
    MIN_PLAYBACK_MS,
    ((ride?.duration_s ?? 0) / 60) * BASE_MS_PER_RIDE_MINUTE,
  );

  const stopAnim = useCallback(() => {
    animRef.current?.stop();
    animRef.current = null;
  }, []);

  const runFrom = useCallback(
    (from: number, mult: Speed) => {
      stopAnim();
      const start = from >= 1 ? 0 : from;
      jsProgress.setValue(start);
      uiProgress.setValue(start);
      progressRef.current = start;
      setCursor(start);
      const remaining = Math.max(200, (1 - start) * (durationMs / mult));
      const anim = Animated.parallel([
        Animated.timing(jsProgress, {
          toValue: 1,
          duration: remaining,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
        Animated.timing(uiProgress, {
          toValue: 1,
          duration: remaining,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]);
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (!finished) return;
        animRef.current = null;
        progressRef.current = 1;
        setCursor(1);
        setPlaying(false);
      });
      setPlaying(true);
    },
    [durationMs, jsProgress, uiProgress, stopAnim],
  );

  const pause = useCallback(() => {
    stopAnim();
    setPlaying(false);
  }, [stopAnim]);

  const seek = useCallback(
    (f: number) => {
      const v = clamp01(f);
      jsProgress.setValue(v);
      uiProgress.setValue(v);
      progressRef.current = v;
      setCursor(v);
    },
    [jsProgress, uiProgress],
  );

  // Sample the JS-driven value into React state, throttled — see PAINT_MS.
  useEffect(() => {
    const sub = jsProgress.addListener(({ value }) => {
      progressRef.current = value;
      const now = Date.now();
      if (value >= 1 || now - lastPaint.current >= PAINT_MS) {
        lastPaint.current = now;
        setCursor(value);
      }
    });
    return () => {
      jsProgress.removeListener(sub);
    };
  }, [jsProgress]);

  // Nothing may outlive the screen: navigating away mid-replay must not leave a
  // timing loop pushing setState into an unmounted tree.
  useEffect(
    () => () => {
      animRef.current?.stop();
      animRef.current = null;
      jsProgress.removeAllListeners();
    },
    [jsProgress],
  );

  const changeSpeed = useCallback(
    (next: Speed) => {
      setSpeed(next);
      // Re-time from where the replay actually is, so switching to 16× does not
      // restart the trip from the beginning.
      if (playing) runFrom(progressRef.current, next);
    },
    [playing, runFrom],
  );

  const togglePlay = useCallback(() => {
    if (playing) pause();
    else runFrom(progressRef.current, speed);
  }, [playing, pause, runFrom, speed]);

  const scrubStart = useRef(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          stopAnim();
          setPlaying(false);
          const f = trackW > 0 ? clamp01(e.nativeEvent.locationX / trackW) : 0;
          scrubStart.current = f;
          seek(f);
        },
        onPanResponderMove: (_e, g) => {
          if (trackW <= 0) return;
          seek(scrubStart.current + g.dx / trackW);
        },
      }),
    [trackW, seek, stopAnim],
  );

  const marker = useMemo(() => pointAt(track, cum, cursor), [track, cum, cursor]);

  // --- facts ----------------------------------------------------------------
  const facts = useMemo(() => {
    if (!ride) return [];
    const out: { label: string; value: string; sub?: string }[] = [
      { label: 'Duration', value: formatDuration(ride.duration_s) },
      { label: 'Distance', value: formatDistance(ride.distance_m) },
    ];
    if (ride.duration_s > 0) {
      const kmh = (ride.distance_m / ride.duration_s) * 3.6;
      out.push({ label: 'Avg speed', value: `${kmh.toFixed(1)} km/h` });
    }
    const from = ride.soc_start_pct;
    const to = ride.soc_end_pct;
    if (typeof from === 'number' && typeof to === 'number') {
      out.push({ label: 'Battery', value: `−${Math.max(0, Math.round(from - to))}%`, sub: `${from}% → ${to}%` });
    }
    out.push({ label: 'Fare', value: formatMoney(ride.cost_cents, ride.currency) });
    if (ride.end_zone_name) out.push({ label: 'Ended in', value: ride.end_zone_name });
    return out;
  }, [ride]);

  const nativeAvailable = !!Mapbox?.MapView && hasMapboxToken;
  const elapsedS = (ride?.duration_s ?? 0) * cursor;

  return (
    <View style={st.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={st.mapWrap}>
        {ride && track.length > 1 ? (
          nativeAvailable ? (
            <NativeTrack track={track} marker={marker} />
          ) : (
            <FallbackTrack track={track} marker={marker} />
          )
        ) : (
          <View style={st.blank} />
        )}
      </View>

      {/* Header floats over the map so the route keeps the full width. */}
      <View style={[st.header, { paddingTop: insets.top + theme.space.sm }]} pointerEvents="box-none">
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Last ride</Text>
          <Text style={st.subtitle} numberOfLines={1}>
            {ride ? formatDateTime(ride.started_at) : (vehicle?.code ?? 'Vehicle')}
          </Text>
        </View>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [st.round, pressed && { opacity: 0.7 }]}
        >
          <Icon name="close" size={24} color={c.text} />
        </Pressable>
      </View>

      <View style={[st.panel, { paddingBottom: insets.bottom + theme.space.md }]}>
        {!loaded ? (
          <Muted>Reading the local mirror…</Muted>
        ) : !ride ? (
          <>
            <Empty text={`${vehicle?.code ?? 'This vehicle'} has no completed rides in the mirror yet.`} />
            <Muted>
              Rides arrive with the next sync. A brand-new or just-deployed scooter simply has none.
            </Muted>
          </>
        ) : (
          <ScrollView contentContainerStyle={st.panelBody} showsVerticalScrollIndicator={false}>
            <View style={st.controls}>
              <Pressable
                onPress={togglePlay}
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Pause replay' : 'Play replay'}
                style={({ pressed }) => [st.play, pressed && { opacity: 0.75 }]}
              >
                <Icon name={playing ? 'pause' : 'play'} size={28} color={c.onPrimary} />
              </Pressable>

              <View style={{ flex: 1, gap: 4 }}>
                <View
                  style={st.scrubTrack}
                  onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}
                  {...panResponder.panHandlers}
                >
                  {/* Clipped full-width bar slid in from the left: a pure
                      translate, so the fill runs on the native driver. */}
                  <View style={st.scrubClip}>
                    <Animated.View
                      style={[
                        st.scrubFill,
                        {
                          width: trackW,
                          transform: [
                            {
                              translateX: uiProgress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [-trackW, 0],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  </View>
                  <Animated.View
                    style={[
                      st.knob,
                      {
                        transform: [
                          {
                            translateX: uiProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, Math.max(0, trackW - 22)],
                            }),
                          },
                        ],
                      },
                    ]}
                    pointerEvents="none"
                  />
                </View>
                <View style={st.timeRow}>
                  <Text style={st.time}>{clock(elapsedS)}</Text>
                  <Text style={st.time}>{clock(ride.duration_s)}</Text>
                </View>
              </View>
            </View>

            <View style={st.speedRow}>
              {SPEEDS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => changeSpeed(s)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: speed === s }}
                  accessibilityLabel={`Speed ${s} times`}
                  style={({ pressed }) => [
                    st.speed,
                    speed === s && { backgroundColor: c.primary, borderColor: c.primary },
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Text style={[st.speedText, speed === s && { color: c.onPrimary }]}>{s}×</Text>
                </Pressable>
              ))}
              <View style={{ flex: 1 }} />
              {/* Only claim precision we have. With a real trace from
                  `trip_routes` the badge would be a lie in the other direction. */}
              <Badge
                label={isApprox ? 'approx. track' : 'GPS track'}
                color={isApprox ? c.surfaceAlt : withAlpha(c.success, 0.18)}
              />
            </View>

            <View style={st.facts}>
              {facts.map((f) => (
                <View key={f.label} style={st.fact}>
                  <Muted>{f.label}</Muted>
                  <Body style={{ fontWeight: '700', fontSize: theme.font.size.lg }}>{f.value}</Body>
                  {f.sub ? <Muted>{f.sub}</Muted> : null}
                </View>
              ))}
            </View>

            <View style={st.legendRow}>
              <Dot color={c.success} />
              <Muted>Start</Muted>
              <Dot color={c.danger} />
              <Muted>End (last known position)</Muted>
            </View>

            <Muted>
              No GPS trace is stored for this ride, so the line is a shape fitted to its distance and its
              end point — use it for direction and scale, not for street-level detail. Rider {ride.rider_masked}.
            </Muted>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function Dot({ color }: { color: string }) {
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />;
}

// --- Native Mapbox track ----------------------------------------------------
function NativeTrack({ track, marker }: { track: LngLat[]; marker: LngLat }) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const mb = Mapbox;
  if (!mb?.MapView || !mb.Camera || !mb.ShapeSource || !mb.LineLayer || !mb.PointAnnotation) return null;
  const { MapView, Camera, ShapeSource, LineLayer, PointAnnotation } = mb;
  const b = boundsOf(track);
  const start = track[0] ?? ATHENS_CENTER;
  const end = track[track.length - 1] ?? ATHENS_CENTER;

  return (
    <MapView
      style={st.fill}
      styleURL={theme.mode === 'dark' ? theme.map.night : theme.map.day}
      scaleBarEnabled={false}
      logoEnabled={false}
      attributionEnabled={false}
    >
      <Camera
        bounds={{
          ne: [b.maxLng, b.maxLat],
          sw: [b.minLng, b.minLat],
          paddingTop: 140,
          paddingBottom: 80,
          paddingLeft: 48,
          paddingRight: 48,
        }}
        animationDuration={0}
      />

      <ShapeSource
        id="ride-track"
        shape={{ type: 'Feature', geometry: { type: 'LineString', coordinates: track }, properties: {} }}
      >
        <LineLayer
          id="ride-track-line"
          style={{ lineColor: c.primary, lineWidth: 5, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.9 }}
        />
      </ShapeSource>

      <PointAnnotation id="ride-start" coordinate={start}>
        <View style={[st.endpoint, { backgroundColor: c.success }]} />
      </PointAnnotation>
      <PointAnnotation id="ride-end" coordinate={end}>
        <View style={[st.endpoint, { backgroundColor: c.danger }]} />
      </PointAnnotation>
      {/* Keyed on nothing but position: PointAnnotation re-renders in place. */}
      <PointAnnotation id="ride-cursor" coordinate={marker}>
        <View style={st.cursorOuter}>
          <View style={st.cursorInner} />
        </View>
      </PointAnnotation>
    </MapView>
  );
}

// --- Fallback track (no token / Expo Go) ------------------------------------
// The route is the whole point of this screen, so the fallback still draws it —
// projected to scale in SVG — rather than degrading to a table of numbers.
function FallbackTrack({ track, marker }: { track: LngLat[]; marker: LngLat }) {
  const theme = useTheme();
  const st = useStyles(theme);
  const { c } = theme;
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }),
    [],
  );

  const project = useMemo(() => {
    if (box.w === 0 || box.h === 0 || track.length === 0) return null;
    return makeProjector(boundsOf(track), box.w, box.h, 36);
  }, [box, track]);

  const start = track[0];
  const end = track[track.length - 1];

  return (
    <View style={st.fill} onLayout={onLayout}>
      <View style={st.fallbackBanner}>
        <Icon name="info" size={16} color={theme.c.textMuted} />
        <Text style={st.fallbackText} numberOfLines={2}>
          Schematic view — no Mapbox token. The route shape and scale are real; streets are not drawn.
        </Text>
      </View>
      {project && start && end ? (
        <Svg width={box.w} height={box.h} style={st.plot}>
          <SvgPolyline
            points={track.map((p) => project(p).join(',')).join(' ')}
            fill="none"
            stroke={c.primary}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <SvgCircle cx={project(start)[0]} cy={project(start)[1]} r={7} fill={c.success} />
          <SvgCircle cx={project(end)[0]} cy={project(end)[1]} r={7} fill={c.danger} />
          <SvgCircle cx={project(marker)[0]} cy={project(marker)[1]} r={11} fill={withAlpha(c.primary, 0.35)} />
          <SvgCircle cx={project(marker)[0]} cy={project(marker)[1]} r={6} fill={c.primary} />
        </Svg>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  mapWrap: { flex: 1 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  plot: { position: 'absolute', top: 0, left: 0 },
  blank: { flex: 1, backgroundColor: t.c.surfaceAlt },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    paddingHorizontal: t.space.lg,
    paddingBottom: t.space.sm,
    backgroundColor: withAlpha(t.c.surface, 0.92),
    borderBottomWidth: 1,
    borderColor: t.c.border,
  },
  title: { color: t.c.text, fontSize: t.font.size.xl, fontWeight: '700' },
  subtitle: { color: t.c.textMuted, fontSize: t.font.size.sm },
  round: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1,
    borderColor: t.c.border,
  },
  panel: {
    maxHeight: '52%',
    backgroundColor: t.c.surface,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    borderTopWidth: 1,
    borderColor: t.c.border,
    paddingHorizontal: t.space.lg,
    paddingTop: t.space.md,
  },
  panelBody: { gap: t.space.md, paddingBottom: t.space.lg },
  controls: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  play: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.primary,
  },
  // 44 px of grabbable height around a 6 px visual bar — gloves, in a van.
  scrubTrack: { height: 44, justifyContent: 'center' },
  scrubClip: {
    height: 6,
    borderRadius: 3,
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1,
    borderColor: t.c.border,
    overflow: 'hidden',
  },
  scrubFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: t.c.primary },
  knob: {
    position: 'absolute',
    left: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.c.primary,
    borderWidth: 2,
    borderColor: t.c.surface,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: t.c.textMuted, fontSize: t.font.size.xs, fontWeight: '700' },
  speedRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  speed: {
    minWidth: 56,
    height: 44,
    paddingHorizontal: t.space.md,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.c.surfaceAlt,
    borderWidth: 1.5,
    borderColor: t.c.border,
  },
  speedText: { color: t.c.text, fontSize: t.font.size.md, fontWeight: '700' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md },
  fact: { flexBasis: '30%', flexGrow: 1, minWidth: 96 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' },
  endpoint: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: t.c.surface },
  cursorOuter: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(t.c.primary, 0.3),
  },
  cursorInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: t.c.primary, borderWidth: 2, borderColor: t.c.surface },
  fallbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    backgroundColor: t.c.surfaceAlt,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
  },
  fallbackText: { flex: 1, color: t.c.textMuted, fontSize: t.font.size.xs },
}));
