// MockRiderApi — a realistic, fully-clickable Athens backend that runs offline.
// Deterministic where it matters, lively where it helps the demo (vehicle
// jitter, the 20-second unlock wake sequence, live trip cost).
import type { PricingSnapshot } from '@penny/db-types';
import { haversine } from '@penny/geo';
import type { Lang } from '../../i18n';
import { uuid, shortCode } from '../../lib/ids';
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
import {
  ATHENS,
  makeVehicles,
  makeZones,
  makePois,
  makeHistory,
  makeKycDetail,
  RIDE_TAGS,
  PACKAGES,
  SUBSCRIPTIONS,
  ADDONS,
  FAQ,
  INBOX,
} from './fixtures';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const BASE_PRICING: PricingSnapshot = {
  unlock_cents: 100,
  per_min_cents: 23,
  pause_per_min_cents: 8,
  day_cap_cents: 2500,
  currency: 'EUR',
  multiplier: 1,
};

const MIN_START_SOC = 15;

// Vehicles under high demand (deterministic surge for the demo).
const SURGE_CODES = new Set(['PNY-4821', 'PNY-9004', 'PNY-5043']);

function surgeFor(code: string): number {
  return SURGE_CODES.has(code) ? 1.3 : 1;
}

/** Cost of an active/ended trip from its durations + pricing. */
function computeCost(p: PricingSnapshot, duration_s: number, pause_s: number): number {
  const rideMin = Math.ceil(Math.max(0, duration_s - pause_s) / 60);
  const pauseMin = Math.ceil(pause_s / 60);
  const raw = p.unlock_cents + rideMin * p.per_min_cents + pauseMin * p.pause_per_min_cents;
  const withMult = p.unlock_cents + Math.round((raw - p.unlock_cents) * p.multiplier);
  return p.day_cap_cents != null ? Math.min(withMult, p.day_cap_cents) : withMult;
}

function nowISO(): string {
  return new Date().toISOString();
}

interface MockState {
  user: RiderUser | null;
  onboarding: OnboardingProgress;
  otp: string | null;
  vehicles: MapVehicle[];
  activeTrip: TripView | null;
  history: TripDetail[];
  wallet: Wallet;
  cards: Card[];
  packages: PackageProduct[];
  subscriptions: SubscriptionProduct[];
  addons: AddonProduct[];
  debts: DebtView[];
  inbox: InboxItem[];
  notifPrefs: NotifPrefs;
  vehicleTimer: ReturnType<typeof setInterval> | null;
  listeners: Set<(v: MapVehicle[]) => void>;
}

function freshOnboarding(): OnboardingProgress {
  return { step: 'value', completed: [] };
}

/** Month key + human label for grouping/bucketing (stable, locale-light). */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthKey(iso: string | null): string {
  if (!iso) return '0000-00';
  return iso.slice(0, 7);
}
function monthLabel(key: string, short = false): string {
  const [y, m] = key.split('-');
  const idx = Number(m ?? '1') - 1;
  const name = MONTH_NAMES[idx] ?? '—';
  return short ? `${name.slice(0, 3)} ${(y ?? '').slice(2)}` : `${name} ${y}`;
}

/** Reconstruct a receipt breakdown for a trip that doesn't carry one. */
function breakdownFor(t: TripView, extra: Partial<CostBreakdown> = {}): CostBreakdown {
  const moving = Math.max(0, t.duration_s - t.pause_s);
  const ride_cents = Math.round(
    Math.ceil(moving / 60) * t.pricing.per_min_cents * (t.pricing.multiplier || 1),
  );
  const pause_cents = Math.ceil(t.pause_s / 60) * t.pricing.pause_per_min_cents;
  const base: CostBreakdown = {
    unlock_cents: t.pricing.unlock_cents,
    ride_cents,
    pause_cents,
    paid_parking_cents: 0,
    addon_cents: t.addon_insurance ? 99 : 0,
    bonus_cents: t.bonus_cents,
    discount_cents: t.discount_cents,
    promo_cents: 0,
    penalty_cents: t.penalty_cents,
    total_cents: t.cost_cents,
    currency: t.currency,
  };
  return { ...base, ...extra };
}

/** Promote a plain TripView (e.g. a just-ended trip) to a full TripDetail. */
function toDetail(t: TripView): TripDetail {
  const moving = Math.max(1, t.duration_s - t.pause_s);
  return {
    ...t,
    avg_speed_kmh: +((t.distance_m / 1000 / (moving / 3600)) || 0).toFixed(1),
    top_speed_kmh: 20,
    breakdown: breakdownFor(t),
    photo_review_info: {
      outcome: t.photo_review,
      reason: null,
      reviewed_at: t.photo_review && t.photo_review !== 'pending' ? nowISO() : null,
      penalty_cents: t.penalty_cents,
    },
    promo_code: null,
    dispute: null,
    rating_editable: t.rating === null,
    available_tags: RIDE_TAGS,
    start_address: null,
    end_address: null,
  };
}

/** The demo rider's profile — rich enough to exercise every profile field. */
function seedUser(phone: string): RiderUser {
  return {
    id: uuid(),
    phone,
    email: null,
    full_name: null,
    kyc_status: 'none',
    marketing_push: false,
    marketing_email: false,
    tos_accepted: false,
    privacy_accepted: false,
    emergency_contact: null,
    referral_code: `PENNY-${shortCode(5)}`,
    score: 720,
    date_of_birth: null,
    address: null,
    nationality: null,
    gender: null,
    address_struct: { line: null, city: null, postcode: null, country: 'GR' },
    preferred_lang: null,
    email_verified: false,
    phone_verified: true,
    emergency_contact_name: null,
    tags: ['new_rider'],
    created_at: nowISO(),
  };
}

export class MockRiderApi implements RiderApi {
  readonly source = 'mock' as const;
  private s: MockState;

  constructor() {
    this.s = {
      user: null,
      onboarding: freshOnboarding(),
      otp: null,
      vehicles: makeVehicles(),
      activeTrip: null,
      history: makeHistory(),
      wallet: { balance_cents: 500, currency: 'EUR' },
      cards: [],
      packages: PACKAGES.map((p) => ({ ...p })),
      subscriptions: SUBSCRIPTIONS.map((p) => ({ ...p })),
      addons: ADDONS.map((p) => ({ ...p })),
      debts: [],
      inbox: INBOX.map((m) => ({ ...m })),
      notifPrefs: {
        push_transactional: true,
        push_marketing: false,
        email_receipts: true,
        email_marketing: false,
        push_ride_updates: true,
        push_parking_reminders: true,
        push_low_battery: true,
        email_monthly_summary: false,
        sms_safety: true,
      },
      vehicleTimer: null,
      listeners: new Set(),
    };
  }

  /* ------------------------------- session -------------------------------- */

  async getSession(): Promise<RiderSession | null> {
    await wait(120);
    if (!this.s.user) return null;
    return { user: this.s.user, onboarding: this.s.onboarding };
  }

  async sendOtp(phone: string): Promise<{ sent: true; devCode?: string }> {
    await wait(400);
    this.s.otp = '000000';
    return { sent: true, devCode: '000000' };
  }

  async verifyOtp(phone: string, code: string): Promise<RiderSession> {
    await wait(400);
    if (code !== (this.s.otp ?? '000000')) {
      throw new RiderApiError('otp_invalid', 'That code is not correct. Try again.');
    }
    if (!this.s.user) {
      this.s.user = seedUser(phone);
      this.s.onboarding = { step: 'name', completed: ['value', 'phone', 'otp'] };
    }
    return { user: this.s.user, onboarding: this.s.onboarding };
  }

  async updateProfile(patch: Partial<RiderUser>): Promise<RiderUser> {
    await wait(200);
    if (!this.s.user) throw new RiderApiError('no_session', 'Please sign in first.');
    const emailChanged = patch.email !== undefined && patch.email !== this.s.user.email;
    this.s.user = {
      ...this.s.user,
      ...patch,
      // A new address is merged field-by-field so a partial patch is safe.
      address_struct: { ...this.s.user.address_struct, ...(patch.address_struct ?? {}) },
      // Changing the email always re-arms verification.
      email_verified: emailChanged ? false : (patch.email_verified ?? this.s.user.email_verified),
      // `tags` are ops/admin-owned — the rider app can never write them.
      tags: this.s.user.tags,
    };
    return this.s.user;
  }

  async setOnboardingStep(step: OnboardingStep): Promise<OnboardingProgress> {
    await wait(60);
    const completed = new Set(this.s.onboarding.completed);
    completed.add(this.s.onboarding.step);
    this.s.onboarding = { step, completed: [...completed] };
    return this.s.onboarding;
  }

  async startKyc(): Promise<{ status: RiderUser['kyc_status'] }> {
    await wait(300);
    if (!this.s.user) throw new RiderApiError('no_session', 'Please sign in first.');
    this.s.user.kyc_status = 'pending';
    // Simulate the Sumsub webhook approving a few seconds later.
    setTimeout(() => {
      if (this.s.user) this.s.user.kyc_status = 'approved';
    }, 4000);
    return { status: 'pending' };
  }

  async getKycStatus() {
    await wait(80);
    return this.s.user?.kyc_status ?? 'none';
  }

  async getKycDetail(): Promise<KycDetail> {
    await wait(160);
    return makeKycDetail(this.s.user?.kyc_status ?? 'none');
  }

  async logout(): Promise<void> {
    await wait(100);
    this.stopVehicleTimer();
    this.s.user = null;
    this.s.onboarding = freshOnboarding();
    this.s.activeTrip = null;
  }

  async deleteAccount(): Promise<void> {
    await wait(400);
    await this.logout();
  }

  /* --------------------------------- fleet -------------------------------- */

  async getCity(): Promise<City> {
    await wait(80);
    return ATHENS;
  }

  async getVehicles(): Promise<MapVehicle[]> {
    await wait(150);
    return this.s.vehicles.map((v) => ({ ...v }));
  }

  async getVehicle(code: string): Promise<MapVehicle | null> {
    await wait(120);
    const v = this.s.vehicles.find((x) => x.code.toUpperCase() === code.toUpperCase());
    return v ? { ...v } : null;
  }

  async getZones(): Promise<MapZone[]> {
    await wait(100);
    return makeZones();
  }

  async getPois(): Promise<MapPoi[]> {
    await wait(100);
    return makePois();
  }

  onVehiclesChange(cb: (vehicles: MapVehicle[]) => void): () => void {
    this.s.listeners.add(cb);
    this.startVehicleTimer();
    return () => {
      this.s.listeners.delete(cb);
      if (this.s.listeners.size === 0) this.stopVehicleTimer();
    };
  }

  private startVehicleTimer() {
    if (this.s.vehicleTimer) return;
    this.s.vehicleTimer = setInterval(() => {
      // Gentle SoC drift + occasional micro-move to feel alive.
      this.s.vehicles = this.s.vehicles.map((v) => ({
        ...v,
        soc_pct: Math.max(5, v.soc_pct - (Math.random() < 0.3 ? 1 : 0)),
        lng: v.lng + (Math.random() - 0.5) * 0.00006,
        lat: v.lat + (Math.random() - 0.5) * 0.00006,
      }));
      const snapshot = this.s.vehicles.map((v) => ({ ...v }));
      this.s.listeners.forEach((l) => l(snapshot));
    }, 5000);
  }

  private stopVehicleTimer() {
    if (this.s.vehicleTimer) {
      clearInterval(this.s.vehicleTimer);
      this.s.vehicleTimer = null;
    }
  }

  /* ---------------------------- vehicle actions --------------------------- */

  async logScan(code: string, method: 'qr' | 'manual'): Promise<void> {
    // Would insert into scan_data_log. Mock: no-op (kept for funnel parity).
    await wait(40);
  }

  async getQuote(
    code: string,
    _pos: LngLat,
    opts?: { addon_insurance?: boolean; promo_code?: string },
  ): Promise<PricingQuote> {
    await wait(180);
    const v = await this.getVehicle(code);
    if (!v) throw new RiderApiError('vehicle_not_found', `Vehicle ${code} not found.`);
    const multiplier = surgeFor(code);
    const snapshot: PricingSnapshot = { ...BASE_PRICING, multiplier };
    const addon = opts?.addon_insurance ? 99 : 0;
    let promo: PricingQuote['promo'];
    if (opts?.promo_code) {
      const res = this.evalPromo(opts.promo_code);
      if (res.ok) promo = { code: opts.promo_code.toUpperCase(), discount_cents: res.discount_cents };
    }
    const pkg = this.s.packages.find((p) => (p.owned_minutes_left ?? 0) > 0);
    const sub = this.s.subscriptions.find((x) => x.active);
    const estimate = computeCost(snapshot, 15 * 60, 0) + addon - (promo?.discount_cents ?? 0);
    return {
      snapshot,
      multiplier,
      addon_insurance_cents: addon,
      promo,
      package_preview: pkg ? { name: pkg.name, minutes_left: pkg.owned_minutes_left ?? 0 } : undefined,
      subscription_preview: sub ? { name: sub.name, perk: sub.perk } : undefined,
      hold_cents: 500,
      estimate_15min_cents: Math.max(0, estimate),
      currency: 'EUR',
    };
  }

  async reserve(code: string, _pos: LngLat): Promise<{ trip_id: string; expires_at: string }> {
    await wait(300);
    const v = this.s.vehicles.find((x) => x.code === code);
    if (!v) throw new RiderApiError('vehicle_not_found', `Vehicle ${code} not found.`);
    v.reserved_by_me = true;
    return { trip_id: `resv-${uuid()}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };
  }

  async cancelReserve(_trip_id: string): Promise<void> {
    await wait(150);
    this.s.vehicles.forEach((v) => (v.reserved_by_me = false));
  }

  async ring(code: string): Promise<void> {
    await wait(600); // DOUT2 siren pulse
  }

  async reportZoneIncident(_trip_id: string, _kind: 'no_go' | 'no_parking', _pos: [number, number]): Promise<void> {
    await wait(50); // no backend in the mock
  }

  /* ---------------------------- trip lifecycle ---------------------------- */

  async getActiveTrip(): Promise<TripView | null> {
    await wait(80);
    return this.s.activeTrip ? this.recalc(this.s.activeTrip) : null;
  }

  async unlock(
    input: StartTripInput,
    onProgress: (p: UnlockProgress) => void,
  ): Promise<TripView> {
    // Preconditions (surface every refusal reason — drives conversion).
    if (!this.s.user) throw new RiderApiError('no_session', 'Please sign in first.');
    if (this.s.user.kyc_status !== 'approved')
      throw new RiderApiError('kyc_required', 'Verify your identity before your first ride.');
    if (this.s.cards.length === 0 && this.s.wallet.balance_cents <= 0)
      throw new RiderApiError('payment_required', 'Add a payment method or top up your wallet to ride.');
    if (this.s.debts.length > 0)
      throw new RiderApiError('debt_open', 'Clear your outstanding balance to ride.');
    const v = this.s.vehicles.find((x) => x.code.toUpperCase() === input.vehicle_code.toUpperCase());
    if (!v) throw new RiderApiError('vehicle_not_found', `Vehicle ${input.vehicle_code} not found.`);
    if (v.soc_pct < MIN_START_SOC)
      throw new RiderApiError('low_battery', 'This scooter’s battery is too low to start. Try another nearby.');

    // The "waking vehicle… up to 20 s" sequence. Idempotent by client_command_id.
    const t0 = Date.now();
    const emit = (phase: UnlockProgress['phase'], key: string) =>
      onProgress({ phase, elapsed_ms: Date.now() - t0, message_key: key });

    emit('sending', 'unlock.sending');
    await wait(700);
    emit('waking', 'unlock.waking');
    await wait(1600);
    emit('waiting_ack', 'unlock.waitingAck');
    // Simulate a 2G-latency ACK (well under the 8 s hard limit).
    await wait(2400);
    emit('acked', 'unlock.success');

    const pricing: PricingSnapshot = { ...BASE_PRICING, multiplier: surgeFor(v.code) };
    const trip: TripView = {
      id: `trip-${uuid()}`,
      vehicle_id: v.vehicle_id,
      vehicle_code: v.code,
      status: 'active',
      started_at: nowISO(),
      ended_at: null,
      duration_s: 0,
      pause_s: 0,
      distance_m: 0,
      soc_pct: v.soc_pct,
      pricing,
      cost_cents: pricing.unlock_cents,
      bonus_cents: 0,
      penalty_cents: 0,
      discount_cents: 0,
      currency: 'EUR',
      start_pos: input.pos,
      end_pos: null,
      route: [input.pos],
      end_photo_url: null,
      photo_review: null,
      rating: null,
      tags: [],
      group_id: input.group ? `grp-${uuid()}` : null,
      addon_insurance: !!input.addon_insurance,
      city_id: ATHENS.id,
      city_name: ATHENS.name,
    };
    v.reserved_by_me = false;
    this.s.activeTrip = trip;
    return this.recalc(trip);
  }

  /** Recompute live duration/cost/route for an in-flight trip. */
  private recalc(trip: TripView): TripView {
    if (trip.status !== 'active' && trip.status !== 'paused') return { ...trip };
    const started = trip.started_at ? new Date(trip.started_at).getTime() : Date.now();
    const total = Math.floor((Date.now() - started) / 1000);
    const duration_s = total;
    // Grow route + distance a little as time passes.
    const route = trip.route.slice();
    if (route.length > 0 && trip.status === 'active') {
      const last = route[route.length - 1]!;
      const next: LngLat = [last[0] + 0.00012, last[1] + 0.00009];
      route.push(next);
    }
    let distance_m = 0;
    for (let i = 1; i < route.length; i++) distance_m += haversine(route[i - 1]!, route[i]!);
    const cost_cents = computeCost(trip.pricing, duration_s, trip.pause_s);
    return { ...trip, duration_s, distance_m: Math.round(distance_m), cost_cents, route };
  }

  async refreshTrip(trip_id: string): Promise<TripView> {
    await wait(40);
    if (this.s.activeTrip?.id === trip_id) {
      this.s.activeTrip = this.recalc(this.s.activeTrip);
      return { ...this.s.activeTrip };
    }
    const h = this.s.history.find((t) => t.id === trip_id);
    if (h) return { ...h };
    throw new RiderApiError('trip_not_found', 'Trip not found.');
  }

  async pause(trip_id: string): Promise<TripView> {
    await wait(400);
    const t = this.s.activeTrip;
    if (!t || t.id !== trip_id) throw new RiderApiError('trip_not_found', 'No active trip.');
    const recalced = this.recalc(t);
    this.s.activeTrip = { ...recalced, status: 'paused' };
    return { ...this.s.activeTrip };
  }

  async resume(trip_id: string): Promise<TripView> {
    await wait(400);
    const t = this.s.activeTrip;
    if (!t || t.id !== trip_id) throw new RiderApiError('trip_not_found', 'No active trip.');
    // Add a pause minute for realism.
    this.s.activeTrip = { ...t, status: 'active', pause_s: t.pause_s + 60 };
    return this.recalc(this.s.activeTrip);
  }

  async endTrip(input: EndTripInput): Promise<TripView> {
    await wait(900); // lock command + ACK
    const t = this.s.activeTrip;
    if (!t || t.id !== input.trip_id) throw new RiderApiError('trip_not_found', 'No active trip.');
    const recalced = this.recalc(t);
    const endMin = Math.ceil(recalced.duration_s / 60);
    const addonCents = t.addon_insurance ? 99 : 0;

    // Consume package minutes first (before card), per docs/05.
    let packageMinutesUsed = 0;
    const pkg = this.s.packages.find((p) => (p.owned_minutes_left ?? 0) > 0);
    if (pkg && pkg.owned_minutes_left) {
      packageMinutesUsed = Math.min(pkg.owned_minutes_left, endMin);
      pkg.owned_minutes_left -= packageMinutesUsed;
    }
    const discount_cents = packageMinutesUsed * t.pricing.per_min_cents;

    const baseCost = computeCost(t.pricing, recalced.duration_s, t.pause_s);
    const cost_cents = Math.max(0, baseCost + addonCents - discount_cents);

    const ended: TripView = {
      ...recalced,
      status: 'charged',
      ended_at: nowISO(),
      end_pos: input.pos,
      end_photo_url: input.end_photo_url,
      photo_review: 'pending',
      rating: input.rating ?? null,
      tags: input.tags ?? [],
      cost_cents,
      discount_cents,
      bonus_cents: 0,
    };

    // Pay from wallet first, remainder to card. If neither, create a debt.
    let remaining = cost_cents;
    if (this.s.wallet.balance_cents > 0) {
      const used = Math.min(this.s.wallet.balance_cents, remaining);
      this.s.wallet.balance_cents -= used;
      remaining -= used;
    }
    if (remaining > 0 && this.s.cards.length === 0) {
      ended.status = 'ended';
      this.s.debts.push({
        id: `debt-${uuid()}`,
        amount_cents: remaining,
        source: 'failed_trip_payment',
        status: 'open',
        created_at: nowISO(),
      });
    }

    this.s.activeTrip = null;
    this.s.history = [toDetail(ended), ...this.s.history];
    return { ...ended };
  }

  async shareRide(trip_id: string): Promise<ShareLink> {
    await wait(200);
    return {
      url: `https://share.penny.rent/r/${trip_id.slice(-8)}?sig=${shortCode(12)}`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
  }

  async triggerCrashAlert(_trip_id: string): Promise<void> {
    await wait(200); // would send SMS to emergency contact + support alert
  }

  /* --------------------------------- wallet ------------------------------- */

  async getWallet(): Promise<Wallet> {
    await wait(80);
    return { ...this.s.wallet };
  }

  async topUp(cents: number): Promise<Wallet> {
    await wait(500);
    this.s.wallet.balance_cents += cents;
    return { ...this.s.wallet };
  }

  async getCards(): Promise<Card[]> {
    await wait(80);
    return this.s.cards.map((c) => ({ ...c }));
  }

  async addCard(): Promise<Card> {
    await wait(700); // Stripe PaymentSheet / SetupIntent
    const brands = ['visa', 'mastercard'];
    const card: Card = {
      id: `pm-${uuid()}`,
      brand: brands[this.s.cards.length % brands.length]!,
      last4: String(1000 + Math.floor(Math.random() * 8999)).slice(-4),
      exp: '12/29',
      is_default: this.s.cards.length === 0,
    };
    this.s.cards.push(card);
    return { ...card };
  }

  async setDefaultCard(id: string): Promise<Card[]> {
    await wait(120);
    this.s.cards = this.s.cards.map((c) => ({ ...c, is_default: c.id === id }));
    return this.s.cards.map((c) => ({ ...c }));
  }

  async removeCard(id: string): Promise<Card[]> {
    await wait(200);
    this.s.cards = this.s.cards.filter((c) => c.id !== id);
    if (this.s.cards.length && !this.s.cards.some((c) => c.is_default)) {
      this.s.cards[0]!.is_default = true;
    }
    return this.s.cards.map((c) => ({ ...c }));
  }

  async getPackages(): Promise<PackageProduct[]> {
    await wait(80);
    return this.s.packages.map((p) => ({ ...p }));
  }

  async buyPackage(id: string): Promise<PackageProduct[]> {
    await wait(700);
    const pkg = this.s.packages.find((p) => p.id === id);
    if (pkg) pkg.owned_minutes_left = (pkg.owned_minutes_left ?? 0) + pkg.minutes;
    return this.s.packages.map((p) => ({ ...p }));
  }

  async getSubscriptions(): Promise<SubscriptionProduct[]> {
    await wait(80);
    return this.s.subscriptions.map((p) => ({ ...p }));
  }

  async subscribe(id: string): Promise<SubscriptionProduct[]> {
    await wait(700);
    this.s.subscriptions = this.s.subscriptions.map((p) => ({ ...p, active: p.id === id }));
    return this.s.subscriptions.map((p) => ({ ...p }));
  }

  async getAddons(): Promise<AddonProduct[]> {
    await wait(80);
    return this.s.addons.map((p) => ({ ...p }));
  }

  async toggleAddon(id: string): Promise<AddonProduct[]> {
    await wait(200);
    this.s.addons = this.s.addons.map((p) => (p.id === id ? { ...p, active: !p.active } : p));
    return this.s.addons.map((p) => ({ ...p }));
  }

  private evalPromo(code: string): { ok: boolean; discount_cents: number; message: string } {
    const c = code.trim().toUpperCase();
    if (c === 'PENNY1') return { ok: true, discount_cents: 100, message: 'First unlock free — €1.00 off.' };
    if (c === 'ATHENS20') return { ok: true, discount_cents: 60, message: '20% off this ride applied.' };
    return { ok: false, discount_cents: 0, message: 'That promo code is not valid.' };
  }

  async applyPromo(code: string) {
    await wait(300);
    return this.evalPromo(code);
  }

  async getDebts(): Promise<DebtView[]> {
    await wait(80);
    return this.s.debts.map((d) => ({ ...d }));
  }

  async payDebt(id: string): Promise<DebtView[]> {
    await wait(700);
    this.s.debts = this.s.debts.filter((d) => d.id !== id);
    return this.s.debts.map((d) => ({ ...d }));
  }

  /* --------------------------------- history ------------------------------ */

  async getHistory(): Promise<TripView[]> {
    await wait(150);
    return this.s.history.map((t) => ({ ...t }));
  }

  /** Apply the history filter to the in-memory trip list. */
  private filtered(q: HistoryQuery): TripDetail[] {
    const needle = (q.search ?? '').trim().toLowerCase();
    const fromMs = q.from ? Date.parse(q.from) : null;
    // `to` is inclusive: extend to the end of that day.
    const toMs = q.to ? Date.parse(q.to) + 86400_000 - 1 : null;
    return this.s.history.filter((t) => {
      const started = t.started_at ? Date.parse(t.started_at) : 0;
      if (fromMs !== null && started < fromMs) return false;
      if (toMs !== null && started > toMs) return false;
      if (q.city_id && t.city_id !== q.city_id) return false;
      if (q.has_dispute && !t.dispute && t.status !== 'disputed') return false;
      if (q.has_penalty && t.penalty_cents <= 0) return false;
      if (needle) {
        const hay = `${t.vehicle_code} ${t.city_name} ${t.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }

  async getHistoryPage(q: HistoryQuery): Promise<HistoryPage> {
    await wait(220);
    const all = this.filtered(q);
    const slice = all.slice(q.offset, q.offset + q.limit);
    const groups: HistoryMonthGroup[] = [];
    for (const t of slice) {
      const key = monthKey(t.started_at);
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, label: monthLabel(key), rides: 0, distance_m: 0, spent_cents: 0, trips: [] };
        groups.push(g);
      }
      g.rides += 1;
      g.distance_m += t.distance_m;
      g.spent_cents += t.cost_cents;
      g.trips.push({ ...t });
    }
    const next_offset = q.offset + slice.length;
    return {
      groups,
      total: all.length,
      has_more: next_offset < all.length,
      next_offset,
      currency: 'EUR',
    };
  }

  async getRiderCities(): Promise<RiderCity[]> {
    await wait(90);
    const counts = new Map<string, RiderCity>();
    for (const t of this.s.history) {
      const cur = counts.get(t.city_id);
      if (cur) cur.rides += 1;
      else counts.set(t.city_id, { id: t.city_id, name: t.city_name, rides: 1 });
    }
    return [...counts.values()].sort((a, b) => b.rides - a.rides);
  }

  async getTripDetail(trip_id: string): Promise<TripDetail> {
    await wait(180);
    const t = this.s.history.find((x) => x.id === trip_id);
    if (t) return { ...t, route: [...t.route] };
    if (this.s.activeTrip?.id === trip_id) return toDetail(this.recalc(this.s.activeTrip));
    throw new RiderApiError('trip_not_found', 'Trip not found.');
  }

  async rateTrip(trip_id: string, rating: number, tags: string[]): Promise<TripDetail> {
    await wait(300);
    const t = this.s.history.find((x) => x.id === trip_id);
    if (!t) throw new RiderApiError('trip_not_found', 'Trip not found.');
    if (!t.rating_editable) {
      throw new RiderApiError('rating_locked', 'This ride has already been rated.');
    }
    const next: TripDetail = { ...t, rating, tags, rating_editable: false };
    this.s.history = this.s.history.map((x) => (x.id === trip_id ? next : x));
    return { ...next };
  }

  async getReceiptUrl(trip_id: string): Promise<string> {
    await wait(200);
    return `https://receipts.penny.rent/${trip_id.slice(-8)}.pdf`;
  }

  async disputeTrip(trip_id: string, reason: string, _photos: string[]): Promise<TripView> {
    await wait(500);
    this.s.history = this.s.history.map((t) =>
      t.id === trip_id
        ? {
            ...t,
            status: 'disputed' as const,
            dispute: {
              status: 'open' as const,
              reason,
              created_at: nowISO(),
              resolution: null,
              refund_cents: 0,
            },
          }
        : t,
    );
    const t = this.s.history.find((x) => x.id === trip_id);
    if (!t) throw new RiderApiError('trip_not_found', 'Trip not found.');
    return { ...t };
  }

  /* --------------------------------- profile ------------------------------ */

  private lifetime(): LifetimeStats {
    const all = this.s.history;
    const distance_m = all.reduce((a, t) => a + t.distance_m, 0);
    const duration_s = all.reduce((a, t) => a + t.duration_s, 0);
    const spent_cents = all.reduce((a, t) => a + t.cost_cents, 0);
    return {
      rides: all.length,
      distance_m,
      duration_s,
      co2_kg: +((distance_m / 1000) * 0.12).toFixed(1),
      spent_cents,
      loyalty_points: 340 + all.length * 20,
      parking_streak: this.parkingStreak(),
      year: new Date().getFullYear(),
    };
  }

  /** Consecutive most-recent rides whose parking photo was accepted. */
  private parkingStreak(): number {
    let n = 0;
    for (const t of this.s.history) {
      if (t.photo_review === 'rejected') break;
      if (t.photo_review === 'pending') continue;
      n += 1;
    }
    return n;
  }

  private longestParkingStreak(): number {
    let best = 0;
    let cur = 0;
    for (const t of this.s.history) {
      if (t.photo_review === 'rejected') {
        cur = 0;
        continue;
      }
      cur += 1;
      if (cur > best) best = cur;
    }
    return best;
  }

  async getStats(): Promise<LifetimeStats> {
    await wait(120);
    return this.lifetime();
  }

  async getStatsDetail(): Promise<RiderStatsDetail> {
    await wait(220);
    const base = this.lifetime();
    const all = this.s.history;

    // Month buckets, oldest -> newest, with empty months filled in so the
    // chart shows real gaps instead of silently compressing them.
    const byKey = new Map<string, MonthBucket>();
    for (const t of all) {
      const key = monthKey(t.started_at);
      const b = byKey.get(key) ?? {
        key,
        label: monthLabel(key, true),
        rides: 0,
        distance_m: 0,
        spent_cents: 0,
      };
      b.rides += 1;
      b.distance_m += t.distance_m;
      b.spent_cents += t.cost_cents;
      byKey.set(key, b);
    }
    const keys = [...byKey.keys()].sort();
    const months: MonthBucket[] = [];
    if (keys.length > 0) {
      const first = keys[0]!;
      const last = keys[keys.length - 1]!;
      const cursor = new Date(`${first}-01T00:00:00Z`);
      const end = new Date(`${last}-01T00:00:00Z`);
      while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 7);
        months.push(
          byKey.get(key) ?? { key, label: monthLabel(key, true), rides: 0, distance_m: 0, spent_cents: 0 },
        );
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }
    const best_month = months.reduce<MonthBucket | null>(
      (acc, m) => (acc === null || m.rides > acc.rides ? m : acc),
      null,
    );

    // Favourite model is derived from the vehicle the trip ran on.
    const modelCount = new Map<string, number>();
    for (const t of all) {
      const v = this.s.vehicles.find((x) => x.code === t.vehicle_code);
      const name = v?.model_name ?? 'Penny One';
      modelCount.set(name, (modelCount.get(name) ?? 0) + 1);
    }
    const favourite_model =
      [...modelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const cities = await this.getRiderCities();
    const points = base.loyalty_points;
    const TIERS: { name: string; at: number }[] = [
      { name: 'Bronze', at: 0 },
      { name: 'Silver', at: 750 },
      { name: 'Gold', at: 1500 },
      { name: 'Platinum', at: 3000 },
    ];
    let tierIdx = 0;
    for (let i = 0; i < TIERS.length; i++) if (points >= TIERS[i]!.at) tierIdx = i;
    const cur = TIERS[tierIdx]!;
    const next = TIERS[tierIdx + 1] ?? null;
    const progress = next ? Math.min(1, (points - cur.at) / (next.at - cur.at)) : 1;

    const oldest = all[all.length - 1] ?? null;
    const newest = all[0] ?? null;

    return {
      ...base,
      months,
      best_month,
      longest_parking_streak: this.longestParkingStreak(),
      favourite_model,
      favourite_city: cities[0]?.name ?? null,
      first_ride_at: oldest?.started_at ?? null,
      last_ride_at: newest?.started_at ?? null,
      avg_distance_m: all.length ? Math.round(base.distance_m / all.length) : 0,
      avg_duration_s: all.length ? Math.round(base.duration_s / all.length) : 0,
      tier: {
        name: cur.name,
        points,
        next_name: next?.name ?? null,
        next_at_points: next?.at ?? null,
        progress,
      },
      referral: {
        code: this.s.user?.referral_code ?? 'PENNY-DEMO',
        invited: 6,
        converted: 3,
        earned_cents: 900,
      },
      cities,
    };
  }

  async getNotifPrefs(): Promise<NotifPrefs> {
    await wait(60);
    return { ...this.s.notifPrefs };
  }

  async setNotifPrefs(patch: Partial<NotifPrefs>): Promise<NotifPrefs> {
    await wait(120);
    this.s.notifPrefs = { ...this.s.notifPrefs, ...patch };
    return { ...this.s.notifPrefs };
  }

  /* --------------------------------- support ------------------------------ */

  async getFaq(_lang: Lang): Promise<FaqEntry[]> {
    await wait(120);
    return FAQ.map((f) => ({ ...f }));
  }

  async reportVehicleProblem(
    _code: string,
    _description: string,
    _photos: string[],
    _pos?: LngLat,
  ): Promise<{ id: string }> {
    await wait(500);
    return { id: `dmg-${uuid()}` };
  }

  async getInbox(): Promise<InboxItem[]> {
    await wait(120);
    return this.s.inbox.map((m) => ({ ...m }));
  }

  async markInboxRead(id: string): Promise<void> {
    await wait(60);
    this.s.inbox = this.s.inbox.map((m) => (m.id === id ? { ...m, read: true } : m));
  }

  /* -------------------------- pop-ups + push (docs/12) --------------------- */

  /** Mock mode has no server to broadcast from, so the pop-up queue is
   *  whatever this session pushed into it (see `__queuePopup`). */
  private popups: InboxItem[] = [];

  async getLivePopup(): Promise<InboxItem | null> {
    await wait(60);
    return this.popups.find((p) => !p.read) ?? null;
  }

  async dismissPopup(id: string): Promise<void> {
    await wait(60);
    this.popups = this.popups.map((p) => (p.id === id ? { ...p, read: true } : p));
  }

  async registerPushToken(_token: string, _platform: string): Promise<void> {
    await wait(40);
  }

  /** Test hook: drop a pop-up into the queue without a backend. */
  __queuePopup(title: string, body: string): void {
    this.popups.unshift({
      id: `popup-${this.popups.length + 1}`,
      title, body, deep_link: null, read: false, created_at: new Date().toISOString(),
    });
  }

  /* -------------------------------- live chat ----------------------------- */

  private chat: ChatMessage[] = [];
  private chatListeners = new Set<(m: ChatMessage) => void>();

  async getChat(): Promise<ChatMessage[]> {
    await wait(120);
    return this.chat.map((m) => ({ ...m }));
  }

  async sendChatMessage(body: string): Promise<ChatMessage> {
    await wait(150);
    const mine: ChatMessage = {
      id: `chat-${this.chat.length + 1}`,
      sender: 'rider',
      body,
      created_at: new Date().toISOString(),
    };
    this.chat.push(mine);

    // Demo mode answers itself after a beat so the screen can be shown without
    // a backend and still look alive. Never runs in supabase mode.
    setTimeout(() => {
      const reply: ChatMessage = {
        id: `chat-${this.chat.length + 1}`,
        sender: 'staff',
        agent_name: 'Penny Support',
        body: 'Thanks for the message — an agent will be with you shortly.',
        created_at: new Date().toISOString(),
      };
      this.chat.push(reply);
      this.chatListeners.forEach((fn) => fn(reply));
    }, 1400);

    return mine;
  }

  subscribeChat(onMessage: (m: ChatMessage) => void): () => void {
    this.chatListeners.add(onMessage);
    return () => {
      this.chatListeners.delete(onMessage);
    };
  }

  /* ------------------------------ reaction test --------------------------- */

  async recordReaction(_ms: number, _passed: boolean): Promise<void> {
    await wait(80);
  }
}
