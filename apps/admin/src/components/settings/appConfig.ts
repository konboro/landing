import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseAuth } from '@/data/authClient';
import { edgeMessage } from './edge';

/* --------------------------------------------------------------------------
   Shared `app_config` plumbing for the Preferences and Reaction test tabs.

   Reads use the anon key — migration 00140 grants SELECT on app_config to
   anon+authenticated because the rider and ops apps fetch these same flags at
   boot. Writes go to `admin-app-config`, the only write path: the table is
   service_role-only for writes, the function enforces `settings.edit`, demands
   a reason, and records before/after in `audit_log` (Hard Rule #8).

   The panel deliberately does not have a generic "write any app_config key"
   data-source method — the edge function's own allowlist is the boundary, and
   a key that is not on it comes back 400 rather than silently doing nothing.
   -------------------------------------------------------------------------- */

export interface AppConfigRow {
  key: string;
  value: unknown;
  updated_at: string | null;
}

export const APP_CONFIG_KEY = ['settings', 'app-config'] as const;

export function useAppConfig() {
  return useQuery({
    queryKey: APP_CONFIG_KEY,
    queryFn: async (): Promise<AppConfigRow[]> => {
      const { data, error } = await getSupabaseAuth().supabase
        .from('app_config').select('key, value, updated_at').order('key');
      if (error) throw error;
      return (data ?? []) as AppConfigRow[];
    },
  });
}

/** Map of key → stored value. A key that is absent is NOT configured, which is
 *  different from being configured to a falsy value — callers must tell those
 *  apart before showing a number as if the fleet were running on it. */
export function configMap(rows: AppConfigRow[] | undefined): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const row of rows ?? []) map.set(row.key, row.value);
  return map;
}

export interface KeyWriteResult {
  ok: string[];
  failed: Array<{ key: string; message: string }>;
}

/**
 * Write one key per call — that is how `admin-app-config` audits them, and it
 * is what makes a single bad flag flip traceable afterwards. A key the server
 * refuses is reported by name with the server's own sentence; it is never
 * folded into a general "could not save".
 */
export async function writeAppConfigKeys(
  entries: Array<{ key: string; value: unknown }>,
  reason: string,
): Promise<KeyWriteResult> {
  const ok: string[] = [];
  const failed: Array<{ key: string; message: string }> = [];
  for (const { key, value } of entries) {
    try {
      const { error } = await getSupabaseAuth().supabase.functions.invoke('admin-app-config', {
        body: { key, value, reason: reason.trim() },
      });
      if (error) throw error;
      ok.push(key);
    } catch (e) {
      failed.push({ key, message: await edgeMessage(e, 'refused by the server') });
    }
  }
  return { ok, failed };
}

/** Both tabs write app_config, and the bulk panel payload carries it too. */
export function useInvalidateAppConfig() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
    void qc.invalidateQueries({ queryKey: ['panel-data'] });
  };
}
