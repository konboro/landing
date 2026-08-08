import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createEdgeApi, type EdgeApi } from './edge.js';
import { createRepos, type Repos } from './repos.js';

export interface PennyClientConfig {
  url: string;
  anonKey: string;
  /** Optional custom storage (AsyncStorage on RN, localStorage on web). */
  auth?: {
    storage?: unknown;
    storageKey?: string;
    detectSessionInUrl?: boolean;
  };
}

export interface PennyClient {
  supabase: SupabaseClient;
  edge: EdgeApi;
  repos: Repos;
}

/**
 * Single entry point used by rider, ops, and admin apps.
 * Apps ALWAYS use the anon key + RLS; service_role never ships in a bundle.
 */
export function createPennyClient(config: PennyClientConfig): PennyClient {
  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: config.auth?.detectSessionInUrl ?? false,
      // @ts-expect-error storage typing differs per platform
      storage: config.auth?.storage,
      storageKey: config.auth?.storageKey ?? 'penny-auth',
    },
    global: { headers: { 'x-penny-client': 'app' } },
  });
  return {
    supabase,
    edge: createEdgeApi(supabase),
    repos: createRepos(supabase),
  };
}
