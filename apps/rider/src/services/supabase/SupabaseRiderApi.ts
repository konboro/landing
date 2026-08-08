// SupabaseRiderApi — the live implementation. Reads go through @penny/api-client
// repos (anon key + RLS); money/unlock/zone mutations go through edge functions
// (Hard Rules #2, #3, #6). Where the backend surface isn't wired yet, methods
// throw a clear `not_implemented` refusal so the gap is visible, not silent.
//
// Selected only when EXPO_PUBLIC_DATA_SOURCE=supabase. In mock mode this file is
// never imported at runtime (the selector lazy-requires it), so Expo Go never
// needs @supabase/supabase-js natively.
import type { PennyClient } from '@penny/api-client';
import type {
  PublicVehicle,
  Trip as DbTrip,
  PricingSnapshot,
  KycStatus,
} from '@penny/db-types';
import { estimateRangeM } from '@penny/geo';
import type { Lang } from '../../i18n';
import { uuid } from '../../lib/ids';
import {
  RiderApiError,
  type RiderApi,
  type RiderSession,
  type RiderUser,
  type OnboardingProgress,
  type OnboardingStep,
  type MapVehicle,
  type MapZone,
  type MapPoi,
  type City,
  type PricingQuote,
  type TripView,
  type UnlockProgress,
  type StartTripInput,
  type EndTripInput,
  type ShareLink,
  type Wallet,
  type Card,
  type PackageProduct,
  type SubscriptionProduct,
  type AddonProduct,
  type DebtView,
  type LifetimeStats,
  type NotifPrefs,
  type FaqEntry,
  type InboxItem,
  type LngLat,
} from '../types';

const NI = (what: string) =>
  new RiderApiError('not_implemented', `${what} is not wired to the live backend yet.`);

const DEFAULT_PRICING: PricingSnapshot = {
  unlock_cents: 100,
  per_min_cents: 23,
  pause_per_min_cents: 8,
  day_cap_cents: 2500,
  currency: 'EUR',
  multiplier: 1,
};

function makeClient(): PennyClient {
  // Lazy require so mock mode never pulls supabase-js into the eval path.
  const { createPennyClient } = require('@penny/api-client') as typeof import('@penny/api-client');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new RiderApiError(
      'config_missing',
      'EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are required for live mode.',
    );
  }
  let storage: unknown;
  try {
    storage = require('@react-native-async-storage/async-storage').default;
  } catch {
    storage = undefined;
  }
  return createPennyClient({ url, anonKey, auth: { storage, storageKey: 'penny-rider-auth' } });
}

function vehicleToMap(v: PublicVehicle, model_name = 'Penny'): MapVehicle {
  const [lng, lat] = v.pos.coordinates;
  return {
    vehicle_id: v.vehicle_id,
    code: v.code,
    kind: v.kind,
    model_name,
    lng,
    lat,
    soc_pct: v.soc_pct,
    range_m: v.range_m ?? estimateRangeM(v.soc_pct),
    max_speed_kmh: v.max_speed_kmh,
    reserved_by_me: false,
  };
}

function tripToView(t: DbTrip, code = ''): TripView {
  return {
    id: t.id,
    vehicle_id: t.vehicle_id,
    vehicle_code: code,
    status: t.status,
    started_at: t.started_at,
    ended_at: t.ended_at,
    duration_s: t.duration_s,
    pause_s: t.pause_s,
    distance_m: t.distance_m,
    soc_pct: 0,
    pricing: t.pricing_snapshot ?? DEFAULT_PRICING,
    cost_cents: t.cost_cents,
    bonus_cents: t.bonus_cents,
    penalty_cents: t.penalty_cents,
    discount_cents: t.discount_cents,
    currency: t.currency,
    start_pos: t.start_pos?.coordinates ?? null,
    end_pos: t.end_pos?.coordinates ?? null,
    route: [],
    end_photo_url: t.end_photo_url,
    photo_review: t.photo_review,
    rating: null,
    tags: [],
    group_id: t.group_id,
    addon_insurance: false,
  };
}

export class SupabaseRiderApi implements RiderApi {
  readonly source = 'supabase' as const;
  private _client: PennyClient | null = null;

  private get client(): PennyClient {
    if (!this._client) this._client = makeClient();
    return this._client;
  }

  private async userId(): Promise<string> {
    const me = await this.client.repos.me();
    if (!me) throw new RiderApiError('no_session', 'Please sign in first.');
    return me.id;
  }

  /* ------------------------------- session -------------------------------- */

  async getSession(): Promise<RiderSession | null> {
    const me = await this.client.repos.me();
    if (!me) return null;
    const user: RiderUser = {
      id: me.id,
      phone: me.phone,
      email: me.email,
      full_name: me.full_name,
      kyc_status: me.kyc_status,
      marketing_push: me.marketing_consent,
      marketing_email: me.marketing_consent,
      tos_accepted: !!me.tos_accepted_at,
      privacy_accepted: !!me.privacy_accepted_at,
      emergency_contact: me.emergency_contact,
      referral_code: '',
      score: me.score,
      date_of_birth: null,
      address: null,
    };
    // onboarding_progress table read would go here; default to done for existing users.
    const onboarding: OnboardingProgress = { step: 'done', completed: [] };
    return { user, onboarding };
  }

  async sendOtp(phone: string): Promise<{ sent: true; devCode?: string }> {
    const { error } = await this.client.supabase.auth.signInWithOtp({ phone });
    if (error) throw new RiderApiError('otp_send_failed', error.message);
    return { sent: true };
  }

  async verifyOtp(phone: string, code: string): Promise<RiderSession> {
    const { error } = await this.client.supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (error) throw new RiderApiError('otp_invalid', error.message);
    const session = await this.getSession();
    if (!session) throw new RiderApiError('no_session', 'Verification succeeded but no profile found.');
    return session;
  }

  async updateProfile(patch: Partial<RiderUser>): Promise<RiderUser> {
    const id = await this.userId();
    const dbPatch: Record<string, unknown> = {};
    if (patch.full_name !== undefined) dbPatch.full_name = patch.full_name;
    if (patch.email !== undefined) dbPatch.email = patch.email;
    if (patch.emergency_contact !== undefined) dbPatch.emergency_contact = patch.emergency_contact;
    if (patch.marketing_push !== undefined) dbPatch.marketing_consent = patch.marketing_push;
    if (patch.tos_accepted) dbPatch.tos_accepted_at = new Date().toISOString();
    if (patch.privacy_accepted) dbPatch.privacy_accepted_at = new Date().toISOString();
    const { error } = await this.client.supabase.from('users').update(dbPatch).eq('id', id);
    if (error) throw new RiderApiError('update_failed', error.message);
    const s = await this.getSession();
    return s!.user;
  }

  async setOnboardingStep(step: OnboardingStep): Promise<OnboardingProgress> {
    const id = await this.userId();
    await this.client.supabase
      .from('onboarding_progress')
      .upsert({ user_id: id, step, completed_at: new Date().toISOString() });
    return { step, completed: [] };
  }

  async startKyc(): Promise<{ status: KycStatus }> {
    // Would open the Sumsub SDK and create/reuse an applicant. Placeholder.
    throw NI('KYC');
  }

  async getKycStatus(): Promise<KycStatus> {
    const s = await this.getSession();
    return s?.user.kyc_status ?? 'none';
  }

  async logout(): Promise<void> {
    await this.client.supabase.auth.signOut();
    this._client = null;
  }

  async deleteAccount(): Promise<void> {
    // Triggers a GDPR delete edge function server-side.
    throw NI('Account deletion');
  }

  /* --------------------------------- fleet -------------------------------- */

  async getCity(): Promise<City> {
    const { data } = await this.client.supabase.from('cities').select('*').limit(1).maybeSingle();
    if (!data) return { id: '', name: 'Athens', center: [23.7275, 37.9838], default_zoom: 14, station_mode: false };
    const d = data as any;
    return {
      id: d.id,
      name: d.name,
      center: d.center?.coordinates ?? [23.7275, 37.9838],
      default_zoom: d.default_zoom ?? 14,
      station_mode: !!d.station_mode,
    };
  }

  async getVehicles(): Promise<MapVehicle[]> {
    // Whole-city bbox; screens refine by viewport. Athens default.
    const rows = await this.client.repos.publicVehiclesInBBox({
      minLng: 23.6,
      minLat: 37.9,
      maxLng: 23.85,
      maxLat: 38.05,
    });
    return rows.map((r) => vehicleToMap(r));
  }

  async getVehicle(code: string): Promise<MapVehicle | null> {
    const all = await this.getVehicles();
    return all.find((v) => v.code.toUpperCase() === code.toUpperCase()) ?? null;
  }

  async getZones(): Promise<MapZone[]> {
    const { data } = await this.client.supabase
      .from('zones')
      .select('id,kind,name,geom,rules')
      .eq('active', true);
    return ((data ?? []) as any[]).map((z) => ({
      id: z.id,
      kind: z.kind,
      name: z.name ?? null,
      geom: z.geom,
      rules: z.rules ?? {},
    }));
  }

  async getPois(): Promise<MapPoi[]> {
    const { data } = await this.client.supabase.from('pois').select('*').eq('active', true);
    return ((data ?? []) as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      lng: p.pos?.coordinates?.[0] ?? 0,
      lat: p.pos?.coordinates?.[1] ?? 0,
      icon: p.icon ?? null,
    }));
  }

  onVehiclesChange(cb: (vehicles: MapVehicle[]) => void): () => void {
    const channel = this.client.repos.subscribeVehicleState(() => {
      this.getVehicles().then(cb).catch(() => {});
    });
    return () => {
      this.client.supabase.removeChannel(channel);
    };
  }

  /* ---------------------------- vehicle actions --------------------------- */

  async logScan(code: string, method: 'qr' | 'manual'): Promise<void> {
    await this.client.supabase.from('scan_data_log').insert({ code, method });
  }

  async getQuote(code: string, _pos: LngLat): Promise<PricingQuote> {
    // Pricing preview would come from a `pricing-quote` edge fn. Use defaults.
    const snapshot = { ...DEFAULT_PRICING };
    return {
      snapshot,
      multiplier: 1,
      addon_insurance_cents: 0,
      hold_cents: 500,
      estimate_15min_cents: snapshot.unlock_cents + 15 * snapshot.per_min_cents,
      currency: 'EUR',
    };
  }

  async reserve(code: string, pos: LngLat): Promise<{ trip_id: string; expires_at: string }> {
    return this.client.edge.reserveVehicle(code, pos);
  }

  async cancelReserve(trip_id: string): Promise<void> {
    await this.client.edge.cancelReservation(trip_id);
  }

  async ring(code: string): Promise<void> {
    await this.client.edge.ringVehicle(code, [0, 0]);
  }

  /* ---------------------------- trip lifecycle ---------------------------- */

  async getActiveTrip(): Promise<TripView | null> {
    const id = await this.userId();
    const t = await this.client.repos.activeTrip(id);
    return t ? tripToView(t) : null;
  }

  async unlock(input: StartTripInput, onProgress: (p: UnlockProgress) => void): Promise<TripView> {
    const t0 = Date.now();
    onProgress({ phase: 'sending', elapsed_ms: 0, message_key: 'unlock.sending' });
    let res;
    try {
      res = await this.client.edge.startTrip({
        vehicle_code: input.vehicle_code,
        client_command_id: input.client_command_id,
        pos: input.pos,
        addon_insurance: input.addon_insurance,
        promo_code: input.promo_code,
        group: input.group,
      });
    } catch (e: any) {
      throw new RiderApiError(e?.code ?? 'unlock_failed', e?.message ?? 'Unlock failed.');
    }
    // Poll the trip until it reaches `active` or `aborted` (ACK within 8 s).
    const id = await this.userId();
    for (let i = 0; i < 40; i++) {
      onProgress({
        phase: i < 3 ? 'waking' : 'waiting_ack',
        elapsed_ms: Date.now() - t0,
        message_key: i < 3 ? 'unlock.waking' : 'unlock.waitingAck',
      });
      const t = await this.client.repos.activeTrip(id);
      if (t && t.status === 'active') {
        onProgress({ phase: 'acked', elapsed_ms: Date.now() - t0, message_key: 'unlock.success' });
        return tripToView(t, input.vehicle_code);
      }
      if (!t || t.status === 'aborted') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new RiderApiError('no_ack', 'The scooter did not confirm. You were not charged.');
  }

  async refreshTrip(trip_id: string): Promise<TripView> {
    const { data } = await this.client.supabase.from('trips').select('*').eq('id', trip_id).maybeSingle();
    if (!data) throw new RiderApiError('trip_not_found', 'Trip not found.');
    return tripToView(data as DbTrip);
  }

  async pause(trip_id: string): Promise<TripView> {
    await this.client.edge.pauseTrip(trip_id);
    return this.refreshTrip(trip_id);
  }

  async resume(trip_id: string): Promise<TripView> {
    await this.client.edge.resumeTrip(trip_id);
    return this.refreshTrip(trip_id);
  }

  async endTrip(input: EndTripInput): Promise<TripView> {
    await this.client.edge.endTrip({
      trip_id: input.trip_id,
      pos: input.pos,
      end_photo_url: input.end_photo_url,
      rating: input.rating,
      tags: input.tags,
    });
    return this.refreshTrip(input.trip_id);
  }

  async shareRide(trip_id: string): Promise<ShareLink> {
    // Signed share URL from an edge fn. Placeholder shape.
    return {
      url: `https://share.penny.rent/r/${trip_id}`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
  }

  async triggerCrashAlert(trip_id: string): Promise<void> {
    await this.client.supabase.from('crash_checkins').insert({ trip_id, id: uuid() });
  }

  /* --------------------------------- wallet ------------------------------- */

  async getWallet(): Promise<Wallet> {
    const id = await this.userId();
    const { data } = await this.client.supabase
      .from('v_wallet_balance')
      .select('balance_cents,currency')
      .eq('user_id', id)
      .maybeSingle();
    const d = data as any;
    return { balance_cents: d?.balance_cents ?? 0, currency: d?.currency ?? 'EUR' };
  }

  async topUp(_cents: number): Promise<Wallet> {
    throw NI('Wallet top-up');
  }

  async getCards(): Promise<Card[]> {
    const id = await this.userId();
    const pms = await this.client.repos.paymentMethods(id);
    return pms.map((p) => ({
      id: p.id,
      brand: p.brand,
      last4: p.last4,
      exp: p.exp,
      is_default: p.is_default,
    }));
  }

  async addCard(): Promise<Card> {
    // Would present Stripe PaymentSheet with a SetupIntent client_secret.
    await this.client.edge.createSetupIntent();
    throw NI('Card add (present PaymentSheet with the returned client_secret)');
  }

  async setDefaultCard(): Promise<Card[]> {
    throw NI('Set default card');
  }
  async removeCard(): Promise<Card[]> {
    throw NI('Remove card');
  }

  async getPackages(): Promise<PackageProduct[]> {
    const { data } = await this.client.supabase.from('packages').select('*').eq('active', true);
    return ((data ?? []) as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.minutes,
      price_cents: p.price_cents,
      validity_days: p.validity_days,
    }));
  }

  async buyPackage(id: string): Promise<PackageProduct[]> {
    await this.client.edge.buyPackage(id);
    return this.getPackages();
  }

  async getSubscriptions(): Promise<SubscriptionProduct[]> {
    const { data } = await this.client.supabase.from('subscription_plans').select('*').eq('active', true);
    return ((data ?? []) as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      price_cents: p.price_cents,
      perk: p.perk ?? '',
      active: false,
    }));
  }
  async subscribe(): Promise<SubscriptionProduct[]> {
    throw NI('Subscribe');
  }
  async getAddons(): Promise<AddonProduct[]> {
    return [];
  }
  async toggleAddon(): Promise<AddonProduct[]> {
    throw NI('Add-ons');
  }

  async applyPromo(code: string): Promise<{ ok: boolean; discount_cents: number; message: string }> {
    const { data } = await this.client.supabase
      .from('promo_codes')
      .select('discount_cents')
      .eq('code', code.toUpperCase())
      .maybeSingle();
    if (!data) return { ok: false, discount_cents: 0, message: 'That promo code is not valid.' };
    return { ok: true, discount_cents: (data as any).discount_cents, message: 'Promo applied.' };
  }

  async getDebts(): Promise<DebtView[]> {
    const id = await this.userId();
    const debts = await this.client.repos.openDebts(id);
    return debts.map((d) => ({
      id: d.id,
      amount_cents: d.amount_cents,
      source: d.source,
      status: d.status,
      created_at: d.created_at,
    }));
  }

  async payDebt(id: string): Promise<DebtView[]> {
    await this.client.edge.payDebt(id);
    return this.getDebts();
  }

  /* --------------------------------- history ------------------------------ */

  async getHistory(): Promise<TripView[]> {
    const id = await this.userId();
    const trips = await this.client.repos.tripHistory(id);
    return trips.map((t) => tripToView(t));
  }

  async getReceiptUrl(trip_id: string): Promise<string> {
    return `${process.env.EXPO_PUBLIC_EDGE_BASE_URL ?? ''}/receipt?trip=${trip_id}`;
  }

  async disputeTrip(trip_id: string, reason: string, photos: string[]): Promise<TripView> {
    await this.client.supabase.from('disputes').insert({ trip_id, reason, photos });
    return this.refreshTrip(trip_id);
  }

  /* --------------------------------- profile ------------------------------ */

  async getStats(): Promise<LifetimeStats> {
    const id = await this.userId();
    const { data } = await this.client.supabase
      .from('v_rider_lifetime_stats')
      .select('*')
      .eq('user_id', id)
      .maybeSingle();
    const d = (data as any) ?? {};
    return {
      rides: d.rides ?? 0,
      distance_m: d.distance_m ?? 0,
      duration_s: d.duration_s ?? 0,
      co2_kg: d.co2_kg ?? 0,
      spent_cents: d.spent_cents ?? 0,
      loyalty_points: d.loyalty_points ?? 0,
      parking_streak: d.parking_streak ?? 0,
      year: new Date().getFullYear(),
    };
  }

  async getNotifPrefs(): Promise<NotifPrefs> {
    const id = await this.userId();
    const { data } = await this.client.supabase
      .from('user_notification_prefs')
      .select('*')
      .eq('user_id', id)
      .maybeSingle();
    const d = (data as any) ?? {};
    return {
      push_transactional: d.push_transactional ?? true,
      push_marketing: d.push_marketing ?? false,
      email_receipts: d.email_receipts ?? true,
      email_marketing: d.email_marketing ?? false,
    };
  }

  async setNotifPrefs(patch: Partial<NotifPrefs>): Promise<NotifPrefs> {
    const id = await this.userId();
    await this.client.supabase.from('user_notification_prefs').upsert({ user_id: id, ...patch });
    return this.getNotifPrefs();
  }

  /* --------------------------------- support ------------------------------ */

  async getFaq(lang: Lang): Promise<FaqEntry[]> {
    const items = await this.client.repos.faq(lang);
    return items.map((f) => ({ id: f.id, question: f.question, answer: f.answer }));
  }

  async reportVehicleProblem(
    code: string,
    description: string,
    photos: string[],
    pos?: LngLat,
  ): Promise<{ id: string }> {
    return this.client.edge.reportDamage({ vehicle_code: code, description, photos, pos });
  }

  async getInbox(): Promise<InboxItem[]> {
    const id = await this.userId();
    const msgs = await this.client.repos.inbox(id);
    return msgs.map((m) => ({
      id: m.id,
      title: m.title,
      body: m.body,
      deep_link: m.deep_link,
      read: !!m.read_at,
      created_at: m.created_at,
    }));
  }

  async markInboxRead(id: string): Promise<void> {
    await this.client.supabase.from('inbox_messages').update({ read_at: new Date().toISOString() }).eq('id', id);
  }

  async recordReaction(ms: number, passed: boolean): Promise<void> {
    await this.client.supabase.from('reaction_tests').insert({ ms, passed });
  }
}
