import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StaffRole } from '@penny/db-types';
import { getSupabaseAuth, isLiveMode } from '@/data/authClient';

export type Permission =
  | 'payments.charge'
  | 'payments.refund'
  | 'users.block'
  | 'users.credit'
  | 'zones.edit'
  | 'vehicles.command'
  | 'vehicles.status'
  | 'debts.writeoff'
  | 'tasks.manage'
  | 'settings.edit'
  | 'team.manage'
  | 'verification.review'
  // Message centre. Reading a conversation and answering it are separate:
  // a reply goes out under the operator's name, so it is a narrower grant.
  | 'messages.read'
  | 'messages.reply';

const ALL: Permission[] = [
  'payments.charge', 'payments.refund', 'users.block', 'users.credit', 'zones.edit',
  'vehicles.command', 'vehicles.status', 'debts.writeoff', 'tasks.manage', 'settings.edit',
  'team.manage', 'verification.review', 'messages.read', 'messages.reply',
];

// Mirrors migration 00290 — keep the two in step, since the server check is
// what actually enforces this and the client copy only shapes the UI.
const ROLE_PERMS: Record<StaffRole, Permission[]> = {
  owner: ALL,
  admin: ALL,
  support: ['users.block', 'users.credit', 'payments.refund', 'verification.review', 'debts.writeoff', 'messages.read', 'messages.reply'],
  ops_manager: ['vehicles.command', 'vehicles.status', 'tasks.manage', 'zones.edit', 'messages.read', 'messages.reply'],
  ops: ['vehicles.command', 'vehicles.status', 'tasks.manage'],
  accountant: ['payments.charge', 'payments.refund', 'debts.writeoff', 'messages.read'],
  readonly: ['messages.read'],
};

export interface CurrentStaff {
  id: string;
  name: string;
  role: StaffRole;
  cityScope: string[];
}

interface AuthCtx {
  staff: CurrentStaff;
  setRole: (role: StaffRole) => void;
  can: (p: Permission) => boolean;
  /** Cities this deployment operates in (from `admin-me`). Empty in mock mode. */
  cities: Array<{ id: string; name: string }>;
  /** Live mode only: true while the session is being resolved. */
  loading: boolean;
  /** Live mode only: null when signed out, a message when sign-in failed. */
  authError: string | null;
  /** Live mode only. In mock mode these are no-ops. */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** False in live mode until a staff session is established. */
  isAuthenticated: boolean;
  live: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  return isLiveMode() ? <LiveAuthProvider>{children}</LiveAuthProvider> : <MockAuthProvider>{children}</MockAuthProvider>;
}

/** Demo/offline mode: always signed in as owner, with a role switcher for gating. */
function MockAuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<StaffRole>('owner');
  const value = useMemo<AuthCtx>(() => ({
    staff: { id: 'staff-owner', name: 'Konstantinos', role, cityScope: [] },
    setRole,
    can: (p: Permission) => ROLE_PERMS[role].includes(p),
    cities: [],
    loading: false,
    authError: null,
    signIn: async () => {},
    signOut: async () => {},
    isAuthenticated: true,
    live: false,
  }), [role]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Live mode: a real Supabase session. The role and permission list come from
 * `admin-me`, because `staff` and `role_permissions` are not readable with the
 * anon key — that edge function is also what rejects a rider account (403).
 */
function LiveAuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<CurrentStaff | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const resolve = useMemo(() => async () => {
    let auth;
    try {
      auth = getSupabaseAuth();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'client misconfigured');
      setLoading(false);
      return;
    }
    const { data } = await auth.supabase.auth.getSession();
    if (!data.session) { setStaff(null); setLoading(false); return; }
    try {
      const me = await auth.me();
      setStaff({
        id: me.staff.id,
        name: me.staff.name,
        role: me.staff.role as StaffRole,
        cityScope: me.staff.city_scope ?? [],
      });
      setPermissions(me.permissions ?? []);
      setCities(me.cities ?? []);
      setAuthError(null);
    } catch (e) {
      // A valid Supabase user who is not staff must not get in.
      setStaff(null);
      setAuthError(e instanceof Error ? e.message : 'not authorised for the admin panel');
      await auth.supabase.auth.signOut();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void resolve(); }, [resolve]);

  const value = useMemo<AuthCtx>(() => ({
    staff: staff ?? { id: '', name: '', role: 'readonly', cityScope: [] },
    setRole: () => {},           // role is server-assigned in live mode
    can: (p: Permission) => permissions.includes('*') || permissions.includes(p),
    cities,
    loading,
    authError,
    isAuthenticated: staff !== null,
    live: true,
    signIn: async (email: string, password: string) => {
      setAuthError(null);
      setLoading(true);
      try {
        const auth = getSupabaseAuth();
        const { error } = await auth.supabase.auth.signInWithPassword({ email, password });
        if (error) { setAuthError(error.message); setLoading(false); return; }
        await resolve();
      } catch (e) {
        // A network failure must not leave the panel stuck on the spinner.
        setAuthError(e instanceof Error ? e.message : 'could not reach the server');
        setLoading(false);
      }
    },
    signOut: async () => {
      await getSupabaseAuth().supabase.auth.signOut();
      setStaff(null);
      setPermissions([]);
    },
  }), [staff, permissions, cities, loading, authError, resolve]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
