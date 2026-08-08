// Typed wrappers around Supabase Edge Functions. Every rider/ops/admin
// mutation that touches money, unlock, or zones goes through here — never
// direct table writes for those (see Hard Rules #2, #3, #6).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID, LngLat } from '@penny/db-types';

export interface EdgeError {
  code: string;
  message: string;
  status: number;
}

export class PennyEdgeError extends Error {
  code: string;
  status: number;
  constructor(e: EdgeError) {
    super(e.message);
    this.name = 'PennyEdgeError';
    this.code = e.code;
    this.status = e.status;
  }
}

async function invoke<T>(
  client: SupabaseClient,
  fn: string,
  body: object,
): Promise<T> {
  const { data, error } = await client.functions.invoke(fn, { body });
  if (error) {
    // supabase-js wraps non-2xx as FunctionsHttpError; `context` is the Response.
    let payload: { code?: string; message?: string } | undefined;
    const ctx = (error as { context?: { status?: number; json?: () => Promise<{ code?: string; message?: string }> } }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        payload = await ctx.json();
      } catch {
        /* body wasn't JSON */
      }
    }
    throw new PennyEdgeError({
      code: payload?.code ?? 'edge_error',
      message: payload?.message ?? error.message,
      status: ctx?.status ?? 500,
    });
  }
  return data as T;
}

export interface StartTripInput {
  vehicle_code: string;
  client_command_id: string; // idempotency (client-generated uuid)
  pos: LngLat;
  addon_insurance?: boolean;
  promo_code?: string;
  group?: boolean;
}
export interface StartTripResult {
  trip_id: UUID;
  status: 'unlocking' | 'active';
  pricing_snapshot: unknown;
}

export interface EndTripInput {
  trip_id: UUID;
  pos: LngLat;
  end_photo_url: string;
  rating?: number;
  tags?: string[];
}
export interface EndTripResult {
  trip_id: UUID;
  status: 'ended' | 'charged';
  cost_cents: number;
  bonus_cents: number;
  penalty_cents: number;
  photo_review: string;
  receipt_url?: string;
}

export function createEdgeApi(client: SupabaseClient) {
  return {
    startTrip: (input: StartTripInput) =>
      invoke<StartTripResult>(client, 'trips-start', input),
    endTrip: (input: EndTripInput) =>
      invoke<EndTripResult>(client, 'trips-end', input),
    pauseTrip: (trip_id: UUID) =>
      invoke<{ trip_id: UUID; status: string }>(client, 'trips-pause', { trip_id, action: 'pause' }),
    resumeTrip: (trip_id: UUID) =>
      invoke<{ trip_id: UUID; status: string }>(client, 'trips-pause', { trip_id, action: 'resume' }),
    reserveVehicle: (vehicle_code: string, pos: LngLat) =>
      invoke<{ trip_id: UUID; expires_at: string }>(client, 'trips-reserve', { vehicle_code, pos }),
    cancelReservation: (trip_id: UUID) =>
      invoke<{ ok: true }>(client, 'trips-reserve', { trip_id, action: 'cancel' }),
    ringVehicle: (vehicle_code: string, pos: LngLat) =>
      invoke<{ ok: true }>(client, 'vehicle-command', { vehicle_code, kind: 'ring', pos }),
    createSetupIntent: () =>
      invoke<{ client_secret: string }>(client, 'payments-setup-intent', {}),
    payDebt: (debt_id: UUID) =>
      invoke<{ status: string }>(client, 'payments-pay-debt', { debt_id }),
    buyPackage: (package_id: UUID) =>
      invoke<{ client_secret: string }>(client, 'payments-buy-package', { package_id }),
    reportDamage: (input: { vehicle_code: string; description: string; photos: string[]; pos?: LngLat }) =>
      invoke<{ id: UUID }>(client, 'damage-report', input),
    // Admin
    adminCharge: (input: {
      user_id: UUID;
      amount_cents: number;
      kind: string;
      reason: string;
      evidence_urls?: string[];
    }) => invoke<{ payment_id: UUID; status: string }>(client, 'admin-charge', input),
    adminRefund: (input: { payment_id: UUID; amount_cents?: number; reason: string }) =>
      invoke<{ status: string }>(client, 'admin-refund', input),
    adminCommand: (input: { vehicle_id: UUID; kind: string; payload?: Record<string, unknown> }) =>
      invoke<{ command_id: UUID }>(client, 'vehicle-command', input),
    saveZoneVersion: (input: { city_id: UUID; zones: unknown[]; reason: string }) =>
      invoke<{ version: number }>(client, 'zones-save', input),

    // Admin — profiles, KYC, history.
    // Response shapes are declared locally (see below) so this package stays
    // decoupled from view-model churn in the panel.
    adminUserProfile: (input: AdminUserProfileInput) =>
      invoke<AdminUserProfileResult>(client, 'admin-user-profile', input),
    adminVehicleHistory: (input: AdminVehicleHistoryInput) =>
      invoke<AdminVehicleHistoryResult>(client, 'admin-vehicle-history', input),
    /**
     * Pull (and cache) the rider's Sumsub applicant + document images.
     * Returns short-lived signed URLs for each document so the panel can render
     * them inline. `live:false` means Sumsub credentials were absent and the
     * cached DB copy was returned instead.
     */
    sumsubApplicant: (input: { user_id: UUID; refresh?: boolean }) =>
      invoke<SumsubApplicantResult>(client, 'sumsub-applicant', input),
  };
}

/* ---------- Admin profile / history contracts ---------- */

export interface Paging {
  limit?: number;
  offset?: number;
}

export interface AdminUserProfileInput extends Paging {
  user_id: UUID;
  /** Omit sections you don't need to keep the payload small. */
  include?: Array<'kyc' | 'rides' | 'payments' | 'ledger' | 'debts' | 'timeline' | 'referrals'>;
}

export interface AdminUserProfileResult {
  profile: Record<string, unknown>;
  kyc: SumsubApplicantResult | null;
  stats: Record<string, unknown>;
  rides: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  ledger: Record<string, unknown>[];
  debts: Record<string, unknown>[];
  penalties: Record<string, unknown>[];
  disputes: Record<string, unknown>[];
  devices_used: Record<string, unknown>[];
  referrals: Record<string, unknown>[];
  loyalty: Record<string, unknown> | null;
  timeline: TimelineEventDto[];
  total_rides?: number;
}

export interface AdminVehicleHistoryInput extends Paging {
  vehicle_id: UUID;
  from?: string;
  to?: string;
}

export interface AdminVehicleHistoryResult {
  vehicle: Record<string, unknown>;
  device: Record<string, unknown> | null;
  stats: Record<string, unknown>;
  rides: Record<string, unknown>[];
  timeline: TimelineEventDto[];
  telemetry_summary: Record<string, unknown>[];
  commands: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
  status_log: Record<string, unknown>[];
  damage: Record<string, unknown>[];
  maintenance: Record<string, unknown>[];
  battery_swaps: Record<string, unknown>[];
  total_rides?: number;
}

export interface TimelineEventDto {
  at: string;
  kind: string;
  title: string;
  detail: Record<string, unknown> | null;
  ref_id: string | null;
}

export interface SumsubDocumentDto {
  image_id: string;
  doc_type: string | null;
  doc_sub_type: string | null;
  country: string | null;
  valid_until: string | null;
  review_answer: string | null;
  reject_labels: string[];
  /** Short-lived signed URL into the private `kyc-docs` bucket. */
  url: string | null;
  content_type: string | null;
}

export interface SumsubApplicantResult {
  live: boolean;
  reason?: string;
  applicant: Record<string, unknown> | null;
  documents: SumsubDocumentDto[];
  review_history: Record<string, unknown>[];
  synced_at: string | null;
}

export type EdgeApi = ReturnType<typeof createEdgeApi>;
