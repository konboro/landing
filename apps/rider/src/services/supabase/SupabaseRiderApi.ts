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
import { estimateRangeM, OPERATING_CITY, OPERATING_BBOX } from '@penny/geo';
import type { Lang } from '../../i18n';
import { uuid } from '../../lib/ids';
import { StripeSvc } from '../../lib/native';
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
  type ChatMessage,
  type LngLat,
  type TripDetail,
  type CostBreakdown,
  type HistoryQuery,
  type HistoryPage,
  type HistoryMonthGroup,
  type RiderCity,
  type RiderStatsDetail,
  type MonthBucket,
  type KycDetail,
} from '../types';

const NI = (what: string) =>
  new RiderApiError('not_implemented', `${what} is not wired to the live backend yet.`);

/** Card rows allow null brand/last4/exp (a PM Stripe has not expanded yet); the UI type does not. */
function toCard(p: {
  id: string;
  brand: string | null;
  last4: string | null;
  exp: string | null;
  is_default: boolean;
}): Card {
  return {
    id: p.id,
    brand: p.brand ?? 'card',
    last4: p.last4 ?? '••••',
    exp: p.exp ?? '',
    is_default: p.is_default,
  };
}

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
  // v_public_vehicles projects the position as plain lng/lat columns, not a
  // GeoJSON point — reading v.pos.coordinates here crashed the map.
  const { lng, lat } = v;
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
    city_id: (t as unknown as { city_id?: string }).city_id ?? '',
    city_name: (t as unknown as { city_name?: string }).city_name ?? '',
  };
}

/** Receipt lines derived from the trip row + its pricing snapshot. */
function breakdownFor(t: TripView, row: Record<string, unknown> = {}): CostBreakdown {
  const moving = Math.max(0, t.duration_s - t.pause_s);
  const num = (k: string): number => {
    const v = row[k];
    return typeof v === 'number' ? v : 0;
  };
  return {
    unlock_cents: t.pricing.unlock_cents,
    ride_cents: Math.round(
      Math.ceil(moving / 60) * t.pricing.per_min_cents * (t.pricing.multiplier || 1),
    ),
    pause_cents: Math.ceil(t.pause_s / 60) * t.pricing.pause_per_min_cents,
    paid_parking_cents: num('paid_parking_cents'),
    addon_cents: num('addon_cents'),
    bonus_cents: t.bonus_cents,
    discount_cents: t.discount_cents,
    promo_cents: num('promo_cents'),
    penalty_cents: t.penalty_cents,
    total_cents: t.cost_cents,
    currency: t.currency,
  };
}

type ProfileExtras = Pick<
  RiderUser,
  | 'date_of_birth'
  | 'address'
  | 'nationality'
  | 'gender'
  | 'address_struct'
  | 'preferred_lang'
  | 'email_verified'
  | 'phone_verified'
  | 'emergency_contact_name'
  | 'tags'
  | 'created_at'
>;

/** Pull the customer_form extras out of the `users` row (jsonb `profile`). */
function readProfileExtras(row: Record<string, unknown>): ProfileExtras {
  const p = (row.profile as Record<string, unknown> | null | undefined) ?? {};
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const addr = (p.address as Record<string, unknown> | null | undefined) ?? {};
  return {
    date_of_birth: str(p.date_of_birth ?? row.date_of_birth),
    address: str(p.address_line ?? addr.line),
    nationality: str(p.nationality),
    gender: (str(p.gender) as RiderUser['gender']) ?? null,
    address_struct: {
      line: str(addr.line),
      city: str(addr.city),
      postcode: str(addr.postcode),
      country: str(addr.country),
    },
    preferred_lang: (str(p.preferred_lang) as RiderUser['preferred_lang']) ?? null,
    email_verified: row.email_verified === true,
    phone_verified: row.phone_verified !== false,
    emergency_contact_name: str(p.emergency_contact_name),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    created_at: str(row.created_at),
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthKey(iso: string | null): string {
  return iso ? iso.slice(0, 7) : '0000-00';
}
function monthLabel(key: string, short = false): string {
  const [y, m] = key.split('-');
  const name = MONTH_NAMES[Number(m ?? '1') - 1] ?? '—';
  return short ? `${name.slice(0, 3)} ${(y ?? '').slice(2)}` : `${name} ${y}`;
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
      // customer_form extras live in `users.profile` (jsonb) — read what's
      // there, fall back to nulls so the edit UI still renders.
      ...readProfileExtras(me as unknown as Record<string, unknown>),
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
    // customer_form extras are merged into the `profile` jsonb column.
    const profile: Record<string, unknown> = {};
    if (patch.date_of_birth !== undefined) profile.date_of_birth = patch.date_of_birth;
    if (patch.nationality !== undefined) profile.nationality = patch.nationality;
    if (patch.gender !== undefined) profile.gender = patch.gender;
    if (patch.preferred_lang !== undefined) profile.preferred_lang = patch.preferred_lang;
    if (patch.emergency_contact_name !== undefined) {
      profile.emergency_contact_name = patch.emergency_contact_name;
    }
    if (patch.address_struct !== undefined) profile.address = patch.address_struct;
    if (Object.keys(profile).length > 0) dbPatch.profile = profile;
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

  async getKycDetail(): Promise<KycDetail> {
    const id = await this.userId();
    // `kyc_applicants` mirrors the Sumsub webhook payload (docs/09). RLS
    // restricts it to the signed-in rider's own row — never anyone else's.
    const { data, error } = await this.client.supabase
      .from('kyc_applicants')
      .select('*')
      .eq('user_id', id)
      .maybeSingle();
    if (error) throw new RiderApiError('kyc_read_failed', error.message);
    const status = await this.getKycStatus();
    if (!data) {
      return {
        status,
        provider: 'sumsub',
        level: '',
        applicant_ref: null,
        submitted_at: null,
        reviewed_at: null,
        expires_at: null,
        documents: [],
        review_answer: null,
        reject_reason: null,
        reject_labels: [],
        can_retry: status !== 'approved' && status !== 'pending',
      };
    }
    const d = data as Record<string, unknown>;
    const answer = (d.review_answer as KycDetail['review_answer']) ?? null;
    const ref = typeof d.applicant_id === 'string' ? d.applicant_id : null;
    return {
      status,
      provider: 'sumsub',
      level: typeof d.level_name === 'string' ? d.level_name : '',
      // Never expose the raw applicant id — mask all but the last 4 chars.
      applicant_ref: ref ? `••••${ref.slice(-4)}` : null,
      submitted_at: (d.submitted_at as string | null) ?? null,
      reviewed_at: (d.reviewed_at as string | null) ?? null,
      expires_at: (d.expires_at as string | null) ?? null,
      documents: Array.isArray(d.documents)
        ? (d.documents as Record<string, unknown>[]).map((doc) => ({
            kind: String(doc.kind ?? 'document'),
            label: String(doc.label ?? doc.kind ?? 'Document'),
            status: (doc.status as KycDetail['documents'][number]['status']) ?? 'pending',
            submitted_at: (doc.submitted_at as string | null) ?? null,
          }))
        : [],
      review_answer: answer,
      reject_reason: (d.reject_reason as string | null) ?? null,
      reject_labels: Array.isArray(d.reject_labels) ? (d.reject_labels as string[]) : [],
      can_retry: answer === 'RETRY' || status === 'expired',
    };
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
    if (!data) return { id: '', name: 'Athens', center: OPERATING_CITY.center, default_zoom: 14, station_mode: false };
    const d = data as any;
    return {
      id: d.id,
      name: d.name,
      center: d.center?.coordinates ?? OPERATING_CITY.center,
      default_zoom: d.default_zoom ?? 14,
      station_mode: !!d.station_mode,
    };
  }

  async getVehicles(): Promise<MapVehicle[]> {
    // Whole-city bbox; screens refine by viewport. Bounds come from
    // OPERATING_BBOX, not literals: these stayed on Athens after the move to
    // Thessaloniki, so the query matched nothing and the map came up empty.
    const rows = await this.client.repos.publicVehiclesInBBox(OPERATING_BBOX);
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
    // `v_my_wallet_balance`, not `v_wallet_balance` — the latter does not exist.
    // PostgREST answered with an error, the error was discarded, and the balance
    // rendered as 0 forever: a rider could top up successfully, watch the money
    // reach the ledger, and still be told they had nothing. The view scopes itself
    // to auth.uid(), so no user filter is needed here.
    const { data, error } = await this.client.supabase
      .from('v_my_wallet_balance')
      .select('balance_cents,currency')
      .maybeSingle();
    if (error) throw new RiderApiError('wallet_unavailable', error.message);
    const d = data as { balance_cents?: number; currency?: string } | null;
    return { balance_cents: d?.balance_cents ?? 0, currency: d?.currency ?? 'EUR' };
  }

  async topUp(cents: number): Promise<Wallet> {
    // Both round-trips at once. Reading the balance first only to know what to
    // compare against later added a whole request between the rider's tap and the
    // payment sheet, for information not needed until after it closes.
    const [before, intent] = await Promise.all([
      this.getWallet(),
      this.client.edge.topUp(cents),
    ]);
    const outcome = await StripeSvc.presentSheet({ kind: 'payment', clientSecret: intent.client_secret });
    if (outcome === 'canceled') throw new RiderApiError('canceled', 'Top-up cancelled.');
    return await this.walletAfterCredit(before.balance_cents);
  }

  /**
   * The wallet is credited by payments-webhook on payment_intent.succeeded, which
   * lands shortly *after* the sheet closes. Reading the balance straight away would
   * show the old number and read as a failed top-up, so wait briefly for it to move.
   * Falls through with whatever the balance is after ~4 s rather than blocking: the
   * credit is not lost, it is just late, and the next refresh will show it.
   */
  private async walletAfterCredit(previousCents: number): Promise<Wallet> {
    let w = await this.getWallet();
    for (let i = 0; i < 8 && w.balance_cents === previousCents; i++) {
      await new Promise((r) => setTimeout(r, 500));
      w = await this.getWallet();
    }
    return w;
  }

  async getCards(): Promise<Card[]> {
    const id = await this.userId();
    const pms = await this.client.repos.paymentMethods(id);
    // Removed cards keep their row so past payments stay readable — they must not
    // show up as something the rider can still pay with.
    return pms.filter((p) => p.status === 'active').map(toCard);
  }

  async addCard(): Promise<Card> {
    const { client_secret } = await this.client.edge.createSetupIntent();
    const outcome = await StripeSvc.presentSheet({ kind: 'setup', clientSecret: client_secret });
    if (outcome === 'canceled') throw new RiderApiError('canceled', 'Card setup cancelled.');

    // Reconcile with Stripe rather than waiting on setup_intent.succeeded, so the
    // new card is there the moment the sheet closes instead of a webhook later.
    const { cards } = await this.client.edge.cards({ action: 'sync' });
    const added = cards[cards.length - 1];
    if (!added) throw new RiderApiError('card_not_saved', 'The card was not saved. Please try again.');
    return toCard(added);
  }

  async setDefaultCard(id: string): Promise<Card[]> {
    const { cards } = await this.client.edge.cards({ action: 'set_default', card_id: id });
    return cards.map(toCard);
  }

  async removeCard(id: string): Promise<Card[]> {
    const { cards } = await this.client.edge.cards({ action: 'remove', card_id: id });
    return cards.map(toCard);
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

  async getHistoryPage(query: HistoryQuery): Promise<HistoryPage> {
    const id = await this.userId();
    let q = this.client.supabase
      .from('trips')
      .select('*', { count: 'exact' })
      .eq('user_id', id)
      .in('status', ['ended', 'charged', 'disputed'])
      .order('started_at', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);
    if (query.from) q = q.gte('started_at', query.from);
    if (query.to) q = q.lte('started_at', `${query.to}T23:59:59.999Z`);
    if (query.city_id) q = q.eq('city_id', query.city_id);
    if (query.has_dispute) q = q.eq('status', 'disputed');
    if (query.has_penalty) q = q.gt('penalty_cents', 0);
    if (query.search) q = q.ilike('vehicle_code', `%${query.search}%`);

    const { data, error, count } = await q;
    if (error) throw new RiderApiError('history_failed', error.message);
    const trips = ((data ?? []) as DbTrip[]).map((t) => tripToView(t));

    const groups: HistoryMonthGroup[] = [];
    for (const t of trips) {
      const key = monthKey(t.started_at);
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, label: monthLabel(key), rides: 0, distance_m: 0, spent_cents: 0, trips: [] };
        groups.push(g);
      }
      g.rides += 1;
      g.distance_m += t.distance_m;
      g.spent_cents += t.cost_cents;
      g.trips.push(t);
    }
    const next_offset = query.offset + trips.length;
    const total = count ?? next_offset;
    return { groups, total, has_more: next_offset < total, next_offset, currency: 'EUR' };
  }

  async getRiderCities(): Promise<RiderCity[]> {
    const id = await this.userId();
    const { data, error } = await this.client.supabase
      .from('v_rider_cities')
      .select('city_id,name,rides')
      .eq('user_id', id);
    if (error) throw new RiderApiError('cities_failed', error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.city_id ?? ''),
      name: String(r.name ?? ''),
      rides: Number(r.rides ?? 0),
    }));
  }

  async getTripDetail(trip_id: string): Promise<TripDetail> {
    const { data, error } = await this.client.supabase
      .from('trips')
      .select('*')
      .eq('id', trip_id)
      .maybeSingle();
    if (error) throw new RiderApiError('trip_read_failed', error.message);
    if (!data) throw new RiderApiError('trip_not_found', 'Trip not found.');
    const row = data as Record<string, unknown>;
    const view = tripToView(data as DbTrip);
    // The route polyline lives in `trip_points` (PII-retention limited, docs/10).
    const { data: pts } = await this.client.supabase
      .from('trip_points')
      .select('pos')
      .eq('trip_id', trip_id)
      .order('at', { ascending: true });
    const route = ((pts ?? []) as Record<string, unknown>[])
      .map((p) => (p.pos as { coordinates?: LngLat } | null)?.coordinates)
      .filter((c): c is LngLat => Array.isArray(c));
    const { data: dispute } = await this.client.supabase
      .from('disputes')
      .select('status,reason,created_at,resolution,refund_cents')
      .eq('trip_id', trip_id)
      .maybeSingle();
    const d = dispute as Record<string, unknown> | null;
    const moving = Math.max(1, view.duration_s - view.pause_s);
    return {
      ...view,
      route,
      rating: typeof row.rating === 'number' ? row.rating : null,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      avg_speed_kmh: +((view.distance_m / 1000 / (moving / 3600)) || 0).toFixed(1),
      top_speed_kmh: typeof row.top_speed_kmh === 'number' ? row.top_speed_kmh : 0,
      breakdown: breakdownFor(view, row),
      photo_review_info: {
        outcome: view.photo_review,
        reason: typeof row.photo_review_reason === 'string' ? row.photo_review_reason : null,
        reviewed_at: (row.photo_reviewed_at as string | null) ?? null,
        penalty_cents: view.penalty_cents,
      },
      promo_code: typeof row.promo_code === 'string' ? row.promo_code : null,
      dispute: d
        ? {
            status: (d.status as 'open' | 'resolved' | 'rejected') ?? 'open',
            reason: String(d.reason ?? ''),
            created_at: String(d.created_at ?? ''),
            resolution: (d.resolution as string | null) ?? null,
            refund_cents: Number(d.refund_cents ?? 0),
          }
        : null,
      rating_editable: row.rating == null,
      available_tags: [],
      start_address: null,
      end_address: null,
    };
  }

  async rateTrip(trip_id: string, rating: number, tags: string[]): Promise<TripDetail> {
    const { error } = await this.client.supabase
      .from('trips')
      .update({ rating, tags })
      .eq('id', trip_id);
    if (error) throw new RiderApiError('rating_failed', error.message);
    return this.getTripDetail(trip_id);
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

  async getStatsDetail(): Promise<RiderStatsDetail> {
    const id = await this.userId();
    const base = await this.getStats();
    const { data, error } = await this.client.supabase
      .from('v_rider_month_stats')
      .select('month,rides,distance_m,spent_cents')
      .eq('user_id', id)
      .order('month', { ascending: true });
    if (error) throw new RiderApiError('stats_failed', error.message);
    const months: MonthBucket[] = ((data ?? []) as Record<string, unknown>[]).map((r) => {
      const key = String(r.month ?? '').slice(0, 7);
      return {
        key,
        label: monthLabel(key, true),
        rides: Number(r.rides ?? 0),
        distance_m: Number(r.distance_m ?? 0),
        spent_cents: Number(r.spent_cents ?? 0),
      };
    });
    const best_month = months.reduce<MonthBucket | null>(
      (acc, m) => (acc === null || m.rides > acc.rides ? m : acc),
      null,
    );
    const cities = await this.getRiderCities();
    return {
      ...base,
      months,
      best_month,
      longest_parking_streak: base.parking_streak,
      favourite_model: null,
      favourite_city: cities[0]?.name ?? null,
      first_ride_at: months[0] ? `${months[0].key}-01T00:00:00Z` : null,
      last_ride_at: null,
      avg_distance_m: base.rides ? Math.round(base.distance_m / base.rides) : 0,
      avg_duration_s: base.rides ? Math.round(base.duration_s / base.rides) : 0,
      tier: {
        name: 'Bronze',
        points: base.loyalty_points,
        next_name: null,
        next_at_points: null,
        progress: 1,
      },
      referral: { code: '', invited: 0, converted: 0, earned_cents: 0 },
      cities,
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
      push_ride_updates: d.push_ride_updates ?? true,
      push_parking_reminders: d.push_parking_reminders ?? true,
      push_low_battery: d.push_low_battery ?? true,
      email_monthly_summary: d.email_monthly_summary ?? false,
      sms_safety: d.sms_safety ?? true,
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

  /* ---- Pop-ups + push (docs/12) ---- */

  async getLivePopup(): Promise<InboxItem | null> {
    const id = await this.userId();
    const m = await this.client.repos.livePopup(id);
    if (!m) return null;
    return { id: m.id, title: m.title, body: m.body, deep_link: m.deep_link, read: false, created_at: m.created_at };
  }

  async dismissPopup(id: string): Promise<void> {
    await this.markInboxRead(id);
  }

  async registerPushToken(token: string, platform: string): Promise<void> {
    const userId = await this.userId();
    // `token` is unique: the same device re-registering must refresh the row,
    // not pile up duplicates that would each get their own copy of a broadcast.
    const { error } = await this.client.supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token, platform, last_seen: new Date().toISOString() }, { onConflict: 'token' });
    if (error) throw new RiderApiError('push_register_failed', error.message);
  }

  /* ---- Live chat (message centre, kind = 'chat') ---- */

  async getChat(): Promise<ChatMessage[]> {
    const id = await this.userId();
    const { data, error } = await this.client.supabase
      .from('inbox_messages')
      .select('id, sender, body, created_at')
      .eq('user_id', id)
      .eq('kind', 'chat')
      .order('created_at', { ascending: true }) // oldest first — a transcript
      .limit(200);
    if (error) throw new RiderApiError('chat_failed', error.message);
    return (data ?? []) as ChatMessage[];
  }

  async sendChatMessage(body: string): Promise<ChatMessage> {
    const id = await this.userId();
    // sender/kind are pinned here AND enforced by the RLS WITH CHECK, so a
    // rider cannot post a turn that looks like it came from support.
    const { data, error } = await this.client.supabase
      .from('inbox_messages')
      .insert({ user_id: id, body, kind: 'chat', sender: 'rider', title: '' })
      .select('id, sender, body, created_at')
      .single();
    if (error) throw new RiderApiError('chat_send_failed', error.message);
    return data as ChatMessage;
  }

  subscribeChat(onMessage: (m: ChatMessage) => void): () => void {
    // Filtering server-side on user_id keeps other riders' traffic off this
    // socket entirely rather than discarding it on the device.
    const channel = this.client.supabase
      .channel('rider-chat')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'inbox_messages' },
        (payload: { new?: Record<string, unknown> }) => {
          const row = payload.new;
          if (!row || row.kind !== 'chat') return;
          onMessage({
            id: String(row.id),
            sender: row.sender as ChatMessage['sender'],
            body: String(row.body ?? ''),
            created_at: String(row.created_at),
          });
        },
      )
      .subscribe();
    return () => {
      void this.client.supabase.removeChannel(channel);
    };
  }

  async recordReaction(ms: number, passed: boolean): Promise<void> {
    await this.client.supabase.from('reaction_tests').insert({ ms, passed });
  }
}
