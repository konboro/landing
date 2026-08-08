// Trip store — the single active trip + a 1 Hz ticker that keeps the live
// timer/cost/distance fresh while riding. All mutations are idempotent
// (client_command_id generated on unlock).
import { create } from 'zustand';
import { getApi } from '../services';
import type { TripView } from '../services/types';

interface TripState {
  trip: TripView | null;
  ticking: boolean;
  setTrip: (t: TripView | null) => void;
  hydrate: () => Promise<void>;
  startTicker: () => void;
  stopTicker: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
}

let ticker: ReturnType<typeof setInterval> | null = null;

export const useTrip = create<TripState>((set, get) => ({
  trip: null,
  ticking: false,
  setTrip(trip) {
    set({ trip });
    if (trip && (trip.status === 'active' || trip.status === 'paused')) {
      get().startTicker();
    } else {
      get().stopTicker();
    }
  },
  async hydrate() {
    const t = await getApi().getActiveTrip();
    get().setTrip(t);
  },
  startTicker() {
    if (ticker) return;
    set({ ticking: true });
    ticker = setInterval(async () => {
      const cur = get().trip;
      if (!cur || cur.status === 'ended' || cur.status === 'charged') {
        get().stopTicker();
        return;
      }
      try {
        const fresh = await getApi().refreshTrip(cur.id);
        set({ trip: fresh });
      } catch {
        /* keep last known */
      }
    }, 1000);
  },
  stopTicker() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    set({ ticking: false });
  },
  async pause() {
    const cur = get().trip;
    if (!cur) return;
    const t = await getApi().pause(cur.id);
    set({ trip: t });
  },
  async resume() {
    const cur = get().trip;
    if (!cur) return;
    const t = await getApi().resume(cur.id);
    set({ trip: t });
  },
}));
