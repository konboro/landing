// Real backend adapter. Uses @penny/api-client (anon key + RLS; ops mutations
// land in audit_log via edge functions on sync — CLAUDE.md Hard Rule #8).
// Selected via EXPO_PUBLIC_DATA_SOURCE=supabase. The mock remains the default
// so the app runs standalone. This adapter is intentionally thin: the offline
// outbox is the source of truth and this only bridges it to edge functions.
import type { OpsApi, PullDelta } from './OpsApi';
import type { Bootstrap, OutboxRow, SyncItemResult, StaffSession } from '../lib/types';
import { env } from '../lib/env';

// Guard the supabase-js import so a mock-only build never pulls native deps it
// doesn't need at runtime.
type PennyClient = import('@penny/api-client').PennyClient;

let clientPromise: Promise<PennyClient> | null = null;
async function getClient(): Promise<PennyClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createPennyClient } = await import('@penny/api-client');
      return createPennyClient({
        url: env.supabaseUrl,
        anonKey: env.supabaseAnonKey,
        auth: { storageKey: 'penny-ops-auth' },
      });
    })();
  }
  return clientPromise;
}

export class SupabaseOpsApi implements OpsApi {
  async login(phone: string, otp: string): Promise<StaffSession> {
    const client = await getClient();
    const { error } = await client.supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' });
    if (error) throw new Error(error.message);
    const me = await client.repos.me();
    if (!me) throw new Error('No user profile');
    // Staff-role check happens server-side via RLS on the ops_staff view.
    const { data: staff, error: sErr } = await client.supabase
      .from('staff')
      .select('id,user_id,role,city_scope,active')
      .eq('user_id', me.id)
      .maybeSingle();
    if (sErr || !staff || !staff.active) throw new Error('Not an active staff account');
    if (!['ops', 'ops_manager', 'admin', 'owner'].includes(staff.role)) {
      throw new Error('Account lacks ops access');
    }
    return {
      staff_id: staff.id,
      user_id: me.id,
      name: me.full_name ?? 'Ops',
      role: (staff.role === 'owner' ? 'admin' : staff.role) as StaffSession['role'],
      city_scope: staff.city_scope,
      phone: me.phone,
    };
  }

  async getBootstrap(session: StaffSession): Promise<Bootstrap> {
    const client = await getClient();
    // A dedicated edge function returns the ops-scoped snapshot in one round
    // trip. Falls back to an empty snapshot if the function isn't deployed yet.
    try {
      const data = await (client.edge as unknown as {
        opsBootstrap?: (input: { staff_id: string }) => Promise<Bootstrap>;
      }).opsBootstrap?.({ staff_id: session.staff_id });
      if (data) return data;
    } catch {
      /* fall through to empty */
    }
    return {
      server_time: new Date().toISOString(),
      vehicles: [], tasks: [], zones: [], damageReports: [],
      statusLog: [], batterySwaps: [], maintenance: [], heat: [],
    };
  }

  async syncPush(items: OutboxRow[]): Promise<SyncItemResult[]> {
    const client = await getClient();
    // The `ops-sync` edge function dedupes by row id and writes audit_log.
    const data = await client.supabase.functions.invoke('ops-sync', {
      body: { items },
    });
    if (data.error) throw new Error(data.error.message);
    return (data.data as { results: SyncItemResult[] }).results;
  }

  async syncPull(since: string): Promise<PullDelta> {
    const client = await getClient();
    const data = await client.supabase.functions.invoke('ops-pull', { body: { since } });
    if (data.error) throw new Error(data.error.message);
    return data.data as PullDelta;
  }
}
