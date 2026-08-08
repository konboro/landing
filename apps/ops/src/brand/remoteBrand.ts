// Server-side brand override (`app_config.brand`).
//
// Resolution order: EXPO_PUBLIC_BRAND → this → pennyBrand.
//
// ── SEAM ────────────────────────────────────────────────────────────────────
// `OpsApi` has no app-config surface yet (it's a backend + api-client change
// owned outside this app). This module duck-types the active API for an
// optional config getter; the moment `getAppConfig(key)` lands on OpsApi,
// remote branding starts working with no change here.
//
// Ops is offline-first, so this is strictly best-effort: any failure resolves to
// `null` and the app boots on the local brand from the on-device registry.
import { brandFromConfig, type Brand } from '@penny/ui';
import { getOpsApi } from '../services';

interface ConfigCapableApi {
  getAppConfig?: (key: string) => Promise<unknown>;
  getConfig?: (key: string) => Promise<unknown>;
}

export const BRAND_CONFIG_KEY = 'brand';

export async function loadRemoteBrand(): Promise<Brand | null> {
  try {
    const api = getOpsApi() as unknown as ConfigCapableApi;
    const get = api.getAppConfig ?? api.getConfig;
    if (typeof get !== 'function') return null;
    const value = await get.call(api, BRAND_CONFIG_KEY);
    if (value == null) return null;
    const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return brandFromConfig(parsed);
  } catch {
    return null;
  }
}
