// Global UI state (zustand). Deliberately small: screens read domain data from
// the SQLite mirror and re-query when `rev` bumps. This store holds session +
// sync/connectivity status that the whole shell needs.
import { create } from 'zustand';
import type { StaffSession } from './types';

interface OpsStore {
  session: StaffSession | null;
  bootstrapped: boolean;
  online: boolean;
  overrideOnline: boolean | null; // dev menu forced state
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Bump to tell screens the mirror changed and they should re-read. */
  rev: number;

  setSession: (s: StaffSession | null) => void;
  setBootstrapped: (v: boolean) => void;
  setOnline: (v: boolean) => void;
  setOverrideOnline: (v: boolean | null) => void;
  setPending: (n: number) => void;
  setSyncing: (v: boolean) => void;
  setLastSyncAt: (t: string | null) => void;
  setLastError: (e: string | null) => void;
  bumpRev: () => void;
}

export const useOps = create<OpsStore>((set) => ({
  session: null,
  bootstrapped: false,
  online: true,
  overrideOnline: null,
  pending: 0,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  rev: 0,

  setSession: (session) => set({ session }),
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),
  setOnline: (online) => set({ online }),
  setOverrideOnline: (overrideOnline) => set({ overrideOnline }),
  setPending: (pending) => set({ pending }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  setLastError: (lastError) => set({ lastError }),
  bumpRev: () => set((s) => ({ rev: s.rev + 1 })),
}));
