// Backend selector. Default 'mock' so the app runs standalone for testing.
import type { OpsApi } from './OpsApi';
import { MockOpsApi } from './MockOpsApi';
import { env } from '../lib/env';

let instance: OpsApi | null = null;

export function getOpsApi(): OpsApi {
  if (instance) return instance;
  let created: OpsApi;
  if (env.dataSource === 'supabase') {
    // Lazy require keeps supabase-js out of the mock bundle path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SupabaseOpsApi } = require('./SupabaseOpsApi');
    created = new SupabaseOpsApi();
  } else {
    created = new MockOpsApi();
  }
  instance = created;
  return created;
}

export type { OpsApi, PullDelta } from './OpsApi';
