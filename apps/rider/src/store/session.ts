// Session store — the signed-in user + onboarding progress. Backed by RiderApi.
import { create } from 'zustand';
import { getApi } from '../services';
import type { RiderUser, OnboardingProgress, OnboardingStep } from '../services/types';

interface SessionState {
  loading: boolean;
  user: RiderUser | null;
  onboarding: OnboardingProgress | null;
  /** true once we've attempted the initial session load. */
  ready: boolean;
  load: () => Promise<void>;
  setUser: (u: RiderUser) => void;
  setOnboarding: (o: OnboardingProgress) => void;
  advance: (step: OnboardingStep) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  loading: true,
  user: null,
  onboarding: null,
  ready: false,
  async load() {
    set({ loading: true });
    try {
      const s = await getApi().getSession();
      set({ user: s?.user ?? null, onboarding: s?.onboarding ?? null });
    } finally {
      set({ loading: false, ready: true });
    }
  },
  setUser(user) {
    set({ user });
  },
  setOnboarding(onboarding) {
    set({ onboarding });
  },
  async advance(step) {
    const o = await getApi().setOnboardingStep(step);
    set({ onboarding: o });
  },
  async logout() {
    await getApi().logout();
    set({ user: null, onboarding: null });
  },
}));

/** Whether onboarding still needs to run (drives the root route gate). */
export function needsOnboarding(o: OnboardingProgress | null): boolean {
  if (!o) return true;
  return o.step !== 'done';
}
