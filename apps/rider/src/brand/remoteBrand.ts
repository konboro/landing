// Server-side brand override (`app_config.brand`).
//
// Resolution order for the running app is: EXPO_PUBLIC_BRAND → this → pennyBrand.
//
// ── SEAM ────────────────────────────────────────────────────────────────────
// `RiderApi` (src/services/types.ts) has no app-config surface yet — adding one
// is a backend + api-client change owned outside this app. Rather than block on
// it, this module duck-types the active API for an optional config getter. The
// moment `getAppConfig(key)` (or `getConfig(key)`) lands on RiderApi, remote
// branding starts working with no change here.
//
// Anything unexpected (missing method, network error, malformed JSON) resolves
// to `null`, so the app always boots on the local brand.
import { brandFromConfig, type Brand } from '@penny/ui';

/** The optional shape we probe for on the API object. */
interface ConfigCapableApi {
  getAppConfig?: (key: string) => Promise<unknown>;
  getConfig?: (key: string) => Promise<unknown>;
}

export const BRAND_CONFIG_KEY = 'brand';

/**
 * Fetch `app_config.brand` and parse it with `brandFromConfig()`.
 * Returns `null` when the backend has no brand row (or no config surface).
 */
export async function loadRemoteBrand(): Promise<Brand | null> {
  try {
    // Lazy require: keeps the service layer out of the brand module graph, so
    // `useTheme()` never drags the API (and its fixtures) into a render path.
    const { getApi } = require('../services') as typeof import('../services');
    const api = getApi() as unknown as ConfigCapableApi;
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
