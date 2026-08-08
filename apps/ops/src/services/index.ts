// Backend selector. Default 'mock' so the app runs standalone for testing.
import type { OpsApi } from './OpsApi';
import { MockOpsApi } from './MockOpsApi';
import { env } from '../lib/env';

let instance: OpsApi | null = null;

export function getOpsApi(): OpsApi {
  if (instance) return instance;
  if (env.dataSource === 'supabase') {
    // Lazy require keeps supabase-js out of the mock bundle path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SupabaseOpsApi } = require('./SupabaseOpsApi');
    instance = new SupabaseOpsApi();
  } else {
    instance = new MockOpsApi();
  }
  return instance;
}

export type { OpsApi, PullDelta } from './OpsApi';
