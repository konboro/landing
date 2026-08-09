// A single Supabase client for the panel's auth session, shared by
// AuthContext and SupabaseDataSource so both see the same tokens.
//
// Kept separate from the data source because AuthContext must exist before any
// data source is constructed (the login screen renders first).

import { createPennyClient, type PennyClient } from '@penny/api-client';

export interface AdminMe {
  staff: {
    id: string;
    user_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
    role: string;
    city_scope: string[];
  };
  /** Flattened role_permissions; `*` means everything (owner). */
  permissions: string[];
  cities: Array<{ id: string; name: string }>;
}

export interface AdminAuth {
  client: PennyClient;
  supabase: PennyClient['supabase'];
  me(): Promise<AdminMe>;
}

let cached: AdminAuth | null = null;

/** True when the panel is pointed at a real Supabase project. */
export function isLiveMode(): boolean {
  return (import.meta.env.VITE_DATA_SOURCE ?? 'mock') === 'supabase';
}

export function getSupabaseAuth(): AdminAuth {
  if (cached) return cached;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required in live mode.');
  }

  const client = createPennyClient({
    url,
    anonKey: anon,
    auth: { storage: window.localStorage, storageKey: 'penny-admin-auth', detectSessionInUrl: true },
  });

  cached = {
    client,
    supabase: client.supabase,
    async me(): Promise<AdminMe> {
      const { data, error } = await client.supabase.functions.invoke('admin-me', { body: {} });
      if (error) {
        // Surface the structured reason (e.g. "not an active staff member").
        let message = error.message;
        const ctx = (error as { context?: { json?: () => Promise<{ message?: string }> } }).context;
        if (ctx?.json) {
          try {
            const body = await ctx.json();
            if (body?.message) message = body.message;
          } catch {
            /* not JSON */
          }
        }
        throw new Error(message);
      }
      return data as AdminMe;
    },
  };
  return cached;
}
