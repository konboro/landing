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
  type LngLat,
} from '../types';
import {
  ATHENS,
  makeVehicles,
  makeZones,
  makePois,
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

function jitterRoute(start: LngLat, points = 24): LngLat[] {
  const route: LngLat[] = [start];
  let [lng, lat] = start;
  for (let i = 0; i < points; i++) {
    lng += (Math.random() - 0.45) * 0.0009;
    lat += (Math.random() - 0.45) * 0.0009;
    route.push([lng, lat]);
  }
  return route;
}

interface MockState {
  user: RiderUser | null;
  onboarding: OnboardingProgress;
  otp: string | null;
  vehicles: MapVehicle[];
  activeTrip: TripView | null;
  history: TripView[];
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

function seedHistory(): TripView[] {
  const mk = (daysAgo: number, code: string, dur: number, dist: number): TripView => {
    const start: LngLat = [23.7275 + Math.random() * 0.01, 37.98 + Math.random() * 0.01];
    const pricing = { ...BASE_PRICING };
    const cost = computeCost(pricing, dur, 0);
    const startedAt = new Date(Date.now() - daysAgo * 86400_000).toISOString();
    return {
      id: `trip-${code}-${daysAgo}`,
      vehicle_id: `veh-${code}`,
      vehicle_code: code,
      status: 'charged',
      started_at: startedAt,
      ended_at: new Date(Date.now() - daysAgo * 86400_000 + dur * 1000).toISOString(),
      duration_s: dur,
      pause_s: 0,
      distance_m: dist,
      soc_pct: 40 + Math.floor(Math.random() * 40),
      pricing,
      cost_cents: cost,
      bonus_cents: 0,
      penalty_cents: 0,
      discount_cents: 0,
      currency: 'EUR',
      start_pos: start,
      end_pos: [start[0] + 0.004, start[1] + 0.003],
      route: jitterRoute(start),
      end_photo_url: 'mock://photo/parked.jpg',
      photo_review: 'auto_ok',
      rating: 5,
      tags: ['smooth', 'clean'],
      group_id: null,
      addon_insurance: false,
    };
  };
  return [mk(2, 'PNY-1130', 640, 2100), mk(6, 'PNY-6620', 420, 1500), mk(11, 'PNY-9004', 1180, 4300)];
}

function freshOnboarding(): OnboardingProgress {
  return { step: 'value', completed: [] };
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
      history: seedHistory(),
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
      this.s.user = {
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
      };
      this.s.onboarding = { step: 'name', completed: ['value', 'phone', 'otp'] };
    }
    return { user: this.s.user, onboarding: this.s.onboarding };
  }

  async updateProfile(patch: Partial<RiderUser>): Promise<RiderUser> {
    await wait(200);
    if (!this.s.user) throw new RiderApiError('no_session', 'Please sign in first.');
    this.s.user = { ...this.s.user, ...patch };
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
    this.s.history = [ended, ...this.s.history];
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

  async getReceiptUrl(trip_id: string): Promise<string> {
    await wait(200);
    return `https://receipts.penny.rent/${trip_id.slice(-8)}.pdf`;
  }

  async disputeTrip(trip_id: string, _reason: string, _photos: string[]): Promise<TripView> {
    await wait(500);
    this.s.history = this.s.history.map((t) =>
      t.id === trip_id ? { ...t, status: 'disputed' } : t,
    );
    const t = this.s.history.find((x) => x.id === trip_id);
    if (!t) throw new RiderApiError('trip_not_found', 'Trip not found.');
    return { ...t };
  }

  /* --------------------------------- profile ------------------------------ */

  async getStats(): Promise<LifetimeStats> {
    await wait(120);
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
      parking_streak: 7,
      year: new Date().getFullYear(),
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

  /* ------------------------------ reaction test --------------------------- */

  async recordReaction(_ms: number, _passed: boolean): Promise<void> {
    await wait(80);
  }
}
