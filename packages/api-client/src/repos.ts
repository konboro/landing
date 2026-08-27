// Read repositories over RLS-protected tables/views. Writes for money/unlock
// go through edge.ts. These are safe reads + realtime subscriptions.

import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type {
  PublicVehicle,
  Trip,
  Payment,
  Debt,
  PaymentMethod,
  InboxMessage,
  FaqItem,
  User,
  UUID,
} from '@penny/db-types';
import type { BBox } from '@penny/geo';

export function createRepos(sb: SupabaseClient) {
  return {
    async me(): Promise<User | null> {
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await sb.from('users').select('*').eq('id', auth.user.id).single();
      if (error) return null;
      return data as User;
    },

    async publicVehiclesInBBox(bbox: BBox): Promise<PublicVehicle[]> {
      const { data, error } = await sb
        .from('v_public_vehicles')
        .select('*')
        .gte('lng', bbox.minLng)
        .lte('lng', bbox.maxLng)
        .gte('lat', bbox.minLat)
        .lte('lat', bbox.maxLat);
      if (error) throw error;
      return (data ?? []) as PublicVehicle[];
    },

    /** Subscribe to vehicle_state changes (the ONLY realtime table for apps). */
    subscribeVehicleState(onChange: (row: Record<string, unknown>) => void): RealtimeChannel {
      return sb
        .channel('vehicle_state')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'vehicle_state' },
          (payload) => onChange(payload.new as Record<string, unknown>),
        )
        .subscribe();
    },

    subscribeMyTrip(userId: UUID, onChange: (trip: Trip) => void): RealtimeChannel {
      return sb
        .channel(`trips:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'trips', filter: `user_id=eq.${userId}` },
          (payload) => onChange(payload.new as Trip),
        )
        .subscribe();
    },

    async activeTrip(userId: UUID): Promise<Trip | null> {
      const { data } = await sb
        .from('trips')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['reserved', 'unlocking', 'active', 'paused', 'ending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as Trip) ?? null;
    },

    async tripHistory(userId: UUID, limit = 50): Promise<Trip[]> {
      const { data, error } = await sb
        .from('trips')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['ended', 'charged', 'disputed'])
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Trip[];
    },

    async paymentMethods(userId: UUID): Promise<PaymentMethod[]> {
      const { data } = await sb.from('payment_methods').select('*').eq('user_id', userId);
      return (data ?? []) as PaymentMethod[];
    },

    async payments(userId: UUID, limit = 50): Promise<Payment[]> {
      const { data } = await sb
        .from('payments')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      return (data ?? []) as Payment[];
    },

    async openDebts(userId: UUID): Promise<Debt[]> {
      const { data } = await sb
        .from('debts')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['open', 'retrying']);
      return (data ?? []) as Debt[];
    },

    /** The message-centre list: notifications and chat turns, newest first.
     *  Pop-ups are excluded — they are the same content delivered as a modal,
     *  so including them would show every broadcast twice. */
    async inbox(userId: UUID): Promise<InboxMessage[]> {
      const { data } = await sb
        .from('inbox_messages')
        .select('*')
        .eq('user_id', userId)
        .neq('kind', 'popup')
        .order('created_at', { ascending: false })
        .limit(100);
      return (data ?? []) as InboxMessage[];
    },

    /** The oldest pop-up this rider has not dismissed and that has not expired,
     *  or null. Oldest first so a queue is worked through in order. */
    async livePopup(userId: UUID): Promise<InboxMessage | null> {
      const { data } = await sb
        .from('inbox_messages')
        .select('*')
        .eq('user_id', userId)
        .eq('kind', 'popup')
        .is('read_at', null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: true })
        .limit(1);
      return (data?.[0] as InboxMessage | undefined) ?? null;
    },

    async faq(lang: string): Promise<FaqItem[]> {
      const { data } = await sb
        .from('faq_items')
        .select('*')
        .eq('lang', lang)
        .order('sort', { ascending: true });
      return (data ?? []) as FaqItem[];
    },

    async appConfig(): Promise<Record<string, unknown>> {
      const { data } = await sb.from('app_config').select('key,value');
      const out: Record<string, unknown> = {};
      for (const row of data ?? []) out[(row as any).key] = (row as any).value;
      return out;
    },
  };
}

export type Repos = ReturnType<typeof createRepos>;
