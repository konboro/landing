// Data-source selection. Default is the offline MockRiderApi so the app is
// fully clickable in Expo Go. Set EXPO_PUBLIC_DATA_SOURCE=supabase to use the
// live backend (SupabaseRiderApi via @penny/api-client).
import type { RiderApi } from './types';
import { MockRiderApi } from './mock/MockRiderApi';

export * from './types';

let instance: RiderApi | null = null;

export function getApi(): RiderApi {
  if (instance) return instance;
  const source = process.env.EXPO_PUBLIC_DATA_SOURCE ?? 'mock';
  if (source === 'supabase') {
    // Lazy require: keeps supabase-js out of the mock eval path entirely.
    const { SupabaseRiderApi } = require('./supabase/SupabaseRiderApi') as typeof import('./supabase/SupabaseRiderApi');
    instance = new SupabaseRiderApi();
  } else {
    instance = new MockRiderApi();
  }
  return instance;
}

export function dataSource(): 'mock' | 'supabase' {
  return (process.env.EXPO_PUBLIC_DATA_SOURCE as 'mock' | 'supabase') ?? 'mock';
}
