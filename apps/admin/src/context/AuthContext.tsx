import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StaffRole } from '@penny/db-types';
import { getSupabaseAuth } from '@/data/authClient';

export type Permission =
  | 'payments.charge'
  | 'payments.refund'
  | 'users.block'
  | 'users.credit'
  | 'zones.edit'
  | 'vehicles.command'
  | 'vehicles.status'
  // Adding a vehicle or retiring one changes what the fleet *is*, so it is a
  // separate grant from `vehicles.status` (migration 00300).
  | 'vehicles.manage'
  | 'debts.writeoff'
  | 'tasks.manage'
  | 'settings.edit'
  | 'team.manage'
  | 'verification.review'
  // Message centre. Reading a conversation and answering it are separate:
  // a reply goes out under the operator's name, so it is a narrower grant.
  | 'messages.read'
  | 'messages.reply'
  // Broadcasting to the whole user base is its own blast radius — not implied
  // by answering one rider (migration 00310).
  | 'notifications.send';

// The role → permission table that used to live here was only ever read by the
// mock provider. The real list arrives per session from `admin-me`, sourced from
// `role_permissions`, so a second copy in the client could only ever drift from
// the check that actually enforces anything.

export interface CurrentStaff {
  id: string;
  name: string;
  role: StaffRole;
  cityScope: string[];
}

interface AuthCtx {
  staff: CurrentStaff;
  can: (p: Permission) => boolean;
  /** Cities this deployment operates in (from `admin-me`). */
  cities: Array<{ id: string; name: string }>;
  /** True while the session is being resolved. */
  loading: boolean;
  /** Null when signed out, a message when sign-in failed. */
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** False until a staff session is established. */
  isAuthenticated: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

// There is one auth mode: a real Supabase staff session. The former mock
// provider signed everyone in as an owner called "Konstantinos" with no
// credentials, and it was selected by an ENV VAR — so an unset variable in a
// deploy meant the panel let anyone straight in and showed them a role switcher.
export function AuthProvider({ children }: { children: ReactNode }) {
  return <LiveAuthProvider>{children}</LiveAuthProvider>;
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
    can: (p: Permission) => permissions.includes('*') || permissions.includes(p),
    cities,
    loading,
    authError,
    isAuthenticated: staff !== null,
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
