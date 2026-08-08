// UX flags — one-time first-use tooltips, permission pre-prompt state, and the
// night reaction-test gate. In-memory for the mock; would persist to
// user_flags server-side in live mode.
import { create } from 'zustand';

export type FirstUseKey =
  | 'firstPause'
  | 'firstBonusZone'
  | 'firstLowBattery'
  | 'firstPaidParking'
  | 'mapTooltip'
  | 'scanTooltip';

interface FlagsState {
  seen: Record<string, boolean>;
  markSeen: (k: FirstUseKey) => void;
  hasSeen: (k: FirstUseKey) => boolean;

  // Permission pre-prompt tracking (progressive permissions, docs/12 D.6).
  askedLocation: boolean;
  askedCamera: boolean;
  askedNotifications: boolean;
  setAsked: (k: 'askedLocation' | 'askedCamera' | 'askedNotifications') => void;

  // Night reaction-test gate.
  reactionPassedAt: number | null;
  reactionBlockedUntil: number | null;
  passReaction: () => void;
  failReaction: () => void;
}

// Config mirror (docs/04): night hours + how long a pass stays valid.
export const NIGHT_START_H = 23;
export const NIGHT_END_H = 5;
const REACTION_VALID_MS = 30 * 60_000;

export function isNightNow(d = new Date()): boolean {
  const h = d.getHours();
  return h >= NIGHT_START_H || h < NIGHT_END_H;
}

export const useFlags = create<FlagsState>((set, get) => ({
  seen: {},
  markSeen(k) {
    set((s) => ({ seen: { ...s.seen, [k]: true } }));
  },
  hasSeen(k) {
    return !!get().seen[k];
  },
  askedLocation: false,
  askedCamera: false,
  askedNotifications: false,
  setAsked(k) {
    set({ [k]: true } as Pick<FlagsState, typeof k>);
  },
  reactionPassedAt: null,
  reactionBlockedUntil: null,
  passReaction() {
    set({ reactionPassedAt: Date.now(), reactionBlockedUntil: null });
  },
  failReaction() {
    // Soft block until 05:00 tomorrow-ish (next morning).
    const d = new Date();
    d.setHours(NIGHT_END_H, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    set({ reactionBlockedUntil: d.getTime() });
  },
}));

/** Whether the night reaction test must be taken before unlocking. */
export function reactionRequired(state: FlagsState, now = Date.now()): boolean {
  if (!isNightNow()) return false;
  if (state.reactionBlockedUntil && now < state.reactionBlockedUntil) return true;
  if (!state.reactionPassedAt) return true;
  return now - state.reactionPassedAt > REACTION_VALID_MS;
}
