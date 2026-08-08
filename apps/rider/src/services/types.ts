// The RiderApi contract. Both MockRiderApi (default, offline) and
// SupabaseRiderApi (live, wired to @penny/api-client) implement this.
// View-models are intentionally app-shaped (not raw DB rows) so screens stay
// simple; where a shared type fits, we reuse @penny/db-types.

import type {
  KycStatus,
  PhotoReview,
  TripStatus,
  ZoneKind,
  GeoPolygon,
  PricingSnapshot,
} from '@penny/db-types';
import type { Lang } from '../i18n';

export type LngLat = [number, number]; // [lng, lat]

/* --------------------------------- Session --------------------------------- */

export interface RiderUser {
  id: string;
  phone: string;
  email: string | null;
  full_name: string | null;
  kyc_status: KycStatus;
  marketing_push: boolean;
  marketing_email: boolean;
  tos_accepted: boolean;
  privacy_accepted: boolean;
  emergency_contact: string | null;
  referral_code: string;
  score: number;
  // customer_form extra fields (panel-configurable in prod)
  date_of_birth: string | null;
  address: string | null;
}

export interface OnboardingProgress {
  step: OnboardingStep;
  completed: OnboardingStep[];
}
export type OnboardingStep =
  | 'value'
  | 'phone'
  | 'otp'
  | 'name'
  | 'consents'
  | 'kyc'
  | 'card'
  | 'tutorial'
  | 'done';

export interface RiderSession {
  user: RiderUser;
  onboarding: OnboardingProgress;
}

/* ---------------------------------- Fleet ---------------------------------- */

export interface MapVehicle {
  vehicle_id: string;
  code: string;
  kind: 'scooter' | 'ebike' | 'moped';
  model_name: string;
  lng: number;
  lat: number;
  soc_pct: number;
  range_m: number;
  max_speed_kmh: number;
  /** reserved by THIS user (only that reservation is visible to them). */
  reserved_by_me: boolean;
}

export interface MapZone {
  id: string;
  kind: ZoneKind;
  name: string | null;
  geom: GeoPolygon;
  rules: Record<string, unknown>;
}

export interface MapPoi {
  id: string;
  name: string;
  kind: string; // 'station' | 'charger' | 'attraction' | 'transit' ...
  lng: number;
  lat: number;
  icon: string | null;
}

export interface City {
  id: string;
  name: string;
  center: LngLat;
  default_zoom: number;
  station_mode: boolean;
}

/* --------------------------------- Pricing --------------------------------- */

export interface PricingQuote {
  snapshot: PricingSnapshot;
  multiplier: number; // dynamic pricing (>1 = surge)
  addon_insurance_cents: number;
  promo?: { code: string; discount_cents: number };
  package_preview?: { name: string; minutes_left: number };
  subscription_preview?: { name: string; perk: string };
  hold_cents: number;
  estimate_15min_cents: number;
  currency: string;
}

/* ---------------------------------- Trips ---------------------------------- */

export interface TripView {
  id: string;
  vehicle_id: string;
  vehicle_code: string;
  status: TripStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number;
  pause_s: number;
  distance_m: number;
  soc_pct: number;
  pricing: PricingSnapshot;
  cost_cents: number;
  bonus_cents: number;
  penalty_cents: number;
  discount_cents: number;
  currency: string;
  start_pos: LngLat | null;
  end_pos: LngLat | null;
  route: LngLat[];
  end_photo_url: string | null;
  photo_review: PhotoReview | null;
  rating: number | null;
  tags: string[];
  group_id: string | null;
  addon_insurance: boolean;
}

export type UnlockPhase =
  | 'sending'
  | 'waking'
  | 'waiting_ack'
  | 'acked'
  | 'failed';

export interface UnlockProgress {
  phase: UnlockPhase;
  elapsed_ms: number;
  message_key: string; // i18n key
}

export interface StartTripInput {
  vehicle_code: string;
  client_command_id: string; // idempotency
  pos: LngLat;
  addon_insurance?: boolean;
  promo_code?: string;
  group?: boolean;
}

export interface EndTripInput {
  trip_id: string;
  pos: LngLat;
  end_photo_url: string;
  rating?: number;
  tags?: string[];
}

export interface ShareLink {
  url: string;
  expires_at: string;
}

/* --------------------------------- Wallet ---------------------------------- */

export interface Wallet {
  balance_cents: number;
  currency: string;
}

export interface Card {
  id: string;
  brand: string;
  last4: string;
  exp: string;
  is_default: boolean;
}

export interface PackageProduct {
  id: string;
  name: string;
  minutes: number;
  price_cents: number;
  validity_days: number;
  owned_minutes_left?: number;
}

export interface SubscriptionProduct {
  id: string;
  name: string;
  price_cents: number;
  perk: string;
  active: boolean;
}

export interface AddonProduct {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  per: 'ride' | 'month';
  active: boolean;
}

export interface DebtView {
  id: string;
  amount_cents: number;
  source: string;
  status: string;
  created_at: string;
}

/* --------------------------------- Profile --------------------------------- */

export interface LifetimeStats {
  rides: number;
  distance_m: number;
  duration_s: number;
  co2_kg: number;
  spent_cents: number;
  loyalty_points: number;
  parking_streak: number;
  year: number;
}

export interface NotifPrefs {
  push_transactional: boolean;
  push_marketing: boolean;
  email_receipts: boolean;
  email_marketing: boolean;
}

/* --------------------------------- Support --------------------------------- */

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  deep_link: string | null;
  read: boolean;
  created_at: string;
}

/* --------------------------------- The API --------------------------------- */

export interface RiderApi {
  readonly source: 'mock' | 'supabase';

  /* session / onboarding */
  getSession(): Promise<RiderSession | null>;
  sendOtp(phone: string): Promise<{ sent: true; devCode?: string }>;
  verifyOtp(phone: string, code: string): Promise<RiderSession>;
  updateProfile(patch: Partial<RiderUser>): Promise<RiderUser>;
  setOnboardingStep(step: OnboardingStep): Promise<OnboardingProgress>;
  startKyc(): Promise<{ status: KycStatus }>;
  getKycStatus(): Promise<KycStatus>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;

  /* map / fleet */
  getCity(pos?: LngLat): Promise<City>;
  getVehicles(): Promise<MapVehicle[]>;
  getVehicle(code: string): Promise<MapVehicle | null>;
  getZones(): Promise<MapZone[]>;
  getPois(): Promise<MapPoi[]>;
  /** live jitter in mock; realtime in supabase. Returns an unsubscribe fn. */
  onVehiclesChange(cb: (vehicles: MapVehicle[]) => void): () => void;

  /* vehicle actions */
  logScan(code: string, method: 'qr' | 'manual'): Promise<void>;
  getQuote(
    code: string,
    pos: LngLat,
    opts?: { addon_insurance?: boolean; promo_code?: string },
  ): Promise<PricingQuote>;
  reserve(code: string, pos: LngLat): Promise<{ trip_id: string; expires_at: string }>;
  cancelReserve(trip_id: string): Promise<void>;
  ring(code: string): Promise<void>;

  /* trip lifecycle */
  getActiveTrip(): Promise<TripView | null>;
  unlock(
    input: StartTripInput,
    onProgress: (p: UnlockProgress) => void,
  ): Promise<TripView>;
  refreshTrip(trip_id: string): Promise<TripView>;
  pause(trip_id: string): Promise<TripView>;
  resume(trip_id: string): Promise<TripView>;
  endTrip(input: EndTripInput): Promise<TripView>;
  shareRide(trip_id: string): Promise<ShareLink>;
  triggerCrashAlert(trip_id: string): Promise<void>;

  /* wallet */
  getWallet(): Promise<Wallet>;
  topUp(cents: number): Promise<Wallet>;
  getCards(): Promise<Card[]>;
  addCard(): Promise<Card>;
  setDefaultCard(id: string): Promise<Card[]>;
  removeCard(id: string): Promise<Card[]>;
  getPackages(): Promise<PackageProduct[]>;
  buyPackage(id: string): Promise<PackageProduct[]>;
  getSubscriptions(): Promise<SubscriptionProduct[]>;
  subscribe(id: string): Promise<SubscriptionProduct[]>;
  getAddons(): Promise<AddonProduct[]>;
  toggleAddon(id: string): Promise<AddonProduct[]>;
  applyPromo(code: string): Promise<{ ok: boolean; discount_cents: number; message: string }>;
  getDebts(): Promise<DebtView[]>;
  payDebt(id: string): Promise<DebtView[]>;

  /* history */
  getHistory(): Promise<TripView[]>;
  getReceiptUrl(trip_id: string): Promise<string>;
  disputeTrip(trip_id: string, reason: string, photos: string[]): Promise<TripView>;

  /* profile */
  getStats(): Promise<LifetimeStats>;
  getNotifPrefs(): Promise<NotifPrefs>;
  setNotifPrefs(patch: Partial<NotifPrefs>): Promise<NotifPrefs>;

  /* support */
  getFaq(lang: Lang): Promise<FaqEntry[]>;
  reportVehicleProblem(
    code: string,
    description: string,
    photos: string[],
    pos?: LngLat,
  ): Promise<{ id: string }>;
  getInbox(): Promise<InboxItem[]>;
  markInboxRead(id: string): Promise<void>;

  /* reaction test */
  recordReaction(ms: number, passed: boolean): Promise<void>;
}

/** Raised for user-visible refusals — the message is shown verbatim. */
export class RiderApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RiderApiError';
    this.code = code;
  }
}
