// Central env access. Reads from Expo `extra` (app.config.ts) with sane
// defaults so the app boots standalone in mock mode with zero configuration.
import Constants from 'expo-constants';

type Extra = {
  dataSource?: string;
  mapboxToken?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const legacyManifest = (Constants as unknown as { manifest?: { extra?: Extra } }).manifest;
const extra: Extra =
  (Constants.expoConfig?.extra as Extra | undefined) ?? legacyManifest?.extra ?? {};

export type DataSource = 'mock' | 'supabase';

export const env = {
  dataSource: (extra.dataSource === 'supabase' ? 'supabase' : 'mock') as DataSource,
  mapboxToken: extra.mapboxToken ?? '',
  supabaseUrl: extra.supabaseUrl ?? '',
  supabaseAnonKey: extra.supabaseAnonKey ?? '',
};

/** Mapbox native maps are only usable with a public token + dev client. */
export const hasMapboxToken = !!env.mapboxToken && env.mapboxToken.startsWith('pk.');
