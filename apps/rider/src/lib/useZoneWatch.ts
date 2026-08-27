// Live zone context for the ride screens.
//
// Both `ride/index.tsx` and `ride/end.tsx` used to do this:
//
//     const pos = trip.route[trip.route.length - 1] ?? trip.start_pos ?? CITY;
//
// In live mode `TripView.route` is always `[]` — the polyline lives in
// `trip_points` and is only read on the ride-detail screen — so `pos` was the
// position where the ride STARTED. Every zone banner ("no-ride zone, leave
// now", "outside the service area", the slow-zone limit) described where the
// rider unlocked, not where they are, and never changed for the whole trip.
// This watches the device instead and re-evaluates as they move.
//
// It also distinguishes "checked, and it's bad" from "could not check". With no
// zones loaded, `evaluateZones` reports `inOperating: false`, and `canEndHere`
// turns that into "You can't end here" — so a rider whose zone fetch failed, or
// who was simply looking at the screen before it resolved, was told they were
// parked illegally. `status` lets the UI say what it actually knows.
//
// Hard Rule #3: this is UX. The server re-validates on `trips-end` and its
// answer is the one that counts; nothing here blocks or permits anything.
import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateZones, type ZoneEvaluation, type ZoneLike } from '@penny/geo';
import { LocationSvc } from './native';
import { getApi } from '../services';
import type { LngLat, MapZone } from '../services/types';

export type ZoneWatchStatus = 'checking' | 'ready' | 'unavailable';

export interface ZoneWatch {
  zones: MapZone[];
  /** Best-known position: device GPS when we have it, else the trip fallback. */
  pos: LngLat | null;
  /** Evaluation at `pos`. Meaningless unless `status === 'ready'`. */
  ev: ZoneEvaluation;
  status: ZoneWatchStatus;
  /** True once the device (not the trip record) supplied the position. */
  liveFix: boolean;
  /** Whether the rider's city requires ending inside a `parking_station`. */
  stationMode: boolean;
}

const EMPTY_EV: ZoneEvaluation = {
  inOperating: false,
  inNoGo: false,
  inNoParking: false,
  inParking: false,
  inParkingStation: false,
  bonusCents: 0,
  paidParkingFeeCents: 0,
  speedLimitKmh: null,
  matched: [],
};

/** How often to re-read the device position while a ride is running. */
const FIX_INTERVAL_MS = 10_000;

/**
 * @param fallbackPos Position to use until (or unless) the device gives one —
 *        normally the trip's start. Never used to claim a `liveFix`.
 * @param watch Keep polling for new fixes. False on the end screen, where the
 *        rider has already stopped and a moving banner would be noise.
 */
export function useZoneWatch(fallbackPos: LngLat | null, watch = true): ZoneWatch {
  const api = useMemo(() => getApi(), []);
  const [zones, setZones] = useState<MapZone[] | null>(null);
  const [zonesFailed, setZonesFailed] = useState(false);
  const [devicePos, setDevicePos] = useState<LngLat | null>(null);
  const [stationMode, setStationMode] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const zs = await api.getZones();
        if (!cancelled) setZones(zs);
      } catch {
        // A failed zone read must not read as "there are no restrictions here".
        if (!cancelled) setZonesFailed(true);
      }
      try {
        const city = await api.getCity();
        if (!cancelled) setStationMode(city.station_mode);
      } catch {
        /* station mode stays off; the server still enforces it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const fix = await LocationSvc.current();
      if (!cancelled && fix) setDevicePos([fix.lng, fix.lat]);
    };
    void read();
    if (!watch) return () => { cancelled = true; };
    const timer = setInterval(read, FIX_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watch]);

  const pos = devicePos ?? fallbackPos;

  const ev = useMemo(
    () => (zones && pos ? evaluateZones(pos, zones as unknown as ZoneLike[]) : EMPTY_EV),
    [zones, pos],
  );

  const status: ZoneWatchStatus =
    zonesFailed || (zones !== null && pos === null)
      ? 'unavailable'
      : zones === null || pos === null
        ? 'checking'
        : 'ready';

  return { zones: zones ?? [], pos, ev, status, liveFix: devicePos !== null, stationMode };
}
