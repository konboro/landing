// Rich per-customer profiles + the unified activity timelines (customer and
// vehicle). Everything is derived deterministically from the already-generated
// base entities so the panel tells one consistent story.
import { Rng } from '@/lib/rng';
import { avatarDataUri } from './media';
import { toUserRideRow, toVehicleRideRow, computeUserStats, type RideExtra } from './history';
import type { Lang, VehicleAlert, Command, DamageReport } from '@penny/db-types';
import type {
  CustomerRow,
  RideRow,
  VehicleRow,
  Payment,
  Debt,
  Referral,
  CorporateAccount,
  CustomerGroup,
  TimelineEvent,
  UserProfileFull,
  UserNote,
  UserDevice,
  UserPaymentMethod,
  UserLoyaltyEvent,
  BatterySwapRow,
  MaintenanceLogRow,
  NotificationLogEntry,
  ScanLogRow,
} from '@/types/domain';

const STREETS = [
  'Ermou', 'Stadiou', 'Patission', 'Kifisias', 'Syngrou', 'Alexandras',
  'Vouliagmenis', 'Panepistimiou', 'Athinas', 'Mesogeion', 'Solonos', 'Skoufa',
];
const AREAS = ['Kolonaki', 'Exarcheia', 'Pagkrati', 'Koukaki', 'Kypseli', 'Ampelokipoi', 'Petralona', 'Nea Smyrni'];
const NATIONALITIES = ['GR', 'GR', 'GR', 'GR', 'GR', 'PL', 'DE', 'UK'] as const;
const TAG_POOL = [
  'vip', 'frequent-rider', 'commuter', 'weekend-only', 'tourist', 'student',
  'chargeback-risk', 'late-parker', 'photo-issues', 'support-heavy', 'corporate', 'beta-tester',
];
const PHONE_MODELS = ['iPhone 15', 'iPhone 13', 'Pixel 8', 'Galaxy S24', 'Galaxy A54', 'Xiaomi 13T', 'iPhone SE'];
const FORM_QUESTIONS: Array<[string, string[]]> = [
  ['How did you hear about Penny?', ['Friend', 'Instagram ad', 'Saw a scooter', 'Google', 'University stand']],
  ['Main use case', ['Commute to work', 'Leisure / weekend', 'Last mile to metro', 'Tourism']],
  ['Do you own a helmet?', ['Yes', 'No', 'Sometimes']],
  ['Preferred parking area', AREAS.slice(0, 5)],
];
const NOTE_BODIES = [
  'Called support about a failed unlock at Syntagma — device rebooted, unlock OK afterwards.',
  'Requested invoice with company VAT number. Forwarded to finance.',
  'Repeated bad-parking photos. Warned by email, next one gets a penalty.',
  'Chargeback opened and later withdrawn by the bank. Watch this account.',
  'Asked for GDPR export on 12/06 — delivered same day.',
  'Very polite rider, reported a broken brake before riding. Gave 5€ goodwill credit.',
];
const RISK_REASONS = [
  'Multiple failed payments in 30 days',
  'Chargeback history',
  'Signup device shared with another account',
  'Repeated end-photo rejections',
  'Rides frequently end outside parking zones',
  'Phone number reused after account deletion',
];

export interface ProfileCtx {
  customers: CustomerRow[];
  vehicles: VehicleRow[];
  rides: RideRow[];
  rideExtras: Record<string, RideExtra>;
  payments: Payment[];
  debts: Debt[];
  referrals: Referral[];
  corporate: CorporateAccount[];
  groups: CustomerGroup[];
  alerts: VehicleAlert[];
  commands: Command[];
  damage: DamageReport[];
  batterySwaps: BatterySwapRow[];
  maintenance: MaintenanceLogRow[];
  notifications: NotificationLogEntry[];
  scans: ScanLogRow[];
  /** Pre-migration Atom ride counts folded into CustomerRow.rides. */
  legacyRides: Record<string, number>;
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickMany<T>(arr: readonly T[], n: number, rng: Rng): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]!);
  return out;
}

function isoDaysAgo(days: number, rng: Rng): string {
  return new Date(Date.now() - days * 86400000 - rng.int(0, 86400000)).toISOString();
}

/* ------------------------------------------------------------------ */
/* Customer profile                                                    */
/* ------------------------------------------------------------------ */

export function buildUserProfile(customer: CustomerRow, ctx: ProfileCtx): UserProfileFull {
  const rng = new Rng(seedOf(`${customer.id}:profile`));
  const nationality = customer.full_name && /^[A-Za-z]+ [A-Za-z]+$/.test(customer.full_name) && rng.bool(0.25)
    ? rng.pick(['PL', 'DE', 'UK'] as const)
    : rng.pick(NATIONALITIES);
  const gender = rng.pick(['M', 'F', 'F', 'M', 'X'] as const);
  const dobYear = 2026 - rng.int(19, 58);
  const dob = `${dobYear}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;

  const myRides = ctx.rides.filter((r) => r.user_id === customer.id);
  const historyRows = myRides
    .map((r) => {
      const extra = ctx.rideExtras[r.id];
      return extra ? toUserRideRow(r, extra) : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const myPayments = ctx.payments.filter((p) => p.user_id === customer.id);
  const refunds = myPayments
    .filter((p) => p.status === 'refunded' || p.status === 'partially_refunded')
    .reduce((s, p) => s + p.amount_cents, 0);

  const stats = computeUserStats(historyRows, { debt_cents: customer.debt_cents, refunds_cents: refunds });

  const riskBase = Math.max(
    0,
    Math.min(100, 100 - customer.score + (customer.debt_cents > 0 ? 18 : 0) + stats.disputes_count * 6 + Math.round(stats.photo_reject_rate_pct / 4)),
  );
  const riskReasons = riskBase > 45 ? pickMany(RISK_REASONS, rng.int(1, 3), rng) : riskBase > 25 ? pickMany(RISK_REASONS, 1, rng) : [];

  const group = ctx.groups.find((g) => g.id === customer.customer_group_id) ?? null;
  const corporate = customer.customer_group_id === 'grp-corporate' || rng.bool(0.12) ? rng.pick(ctx.corporate) : null;

  const loyaltyPoints = Math.round(customer.rides * rng.float(4, 12));
  const loyaltyTier = loyaltyPoints >= 2000 ? 'Gold' : loyaltyPoints >= 500 ? 'Silver' : 'Bronze';
  const loyaltyEvents: UserLoyaltyEvent[] = Array.from({ length: rng.int(2, 6) }, (_, i) => ({
    id: `ly-${customer.id}-${i}`,
    at: isoDaysAgo(rng.int(1, 90), rng),
    points: rng.pick([10, 20, 25, 50, -100, 100]),
    reason: rng.pick(['Ride completed', 'Weekend 2× bonus', 'Referral rewarded', 'Redeemed free unlock', 'Parking in bonus zone']),
  })).sort((a, b) => b.at.localeCompare(a.at));

  const notes: UserNote[] = Array.from({ length: rng.int(0, 3) }, (_, i) => ({
    id: `note-${customer.id}-${i}`,
    at: isoDaysAgo(rng.int(1, 120), rng),
    author: rng.pick(['Eleni Admin', 'Giorgos Support', 'Konstantinos (Owner)']),
    body: rng.pick(NOTE_BODIES),
  })).sort((a, b) => b.at.localeCompare(a.at));

  const devices: UserDevice[] = Array.from({ length: rng.int(1, 3) }, (_, i) => {
    const platform = rng.pick(['ios', 'android', 'web'] as const);
    return {
      id: `dev-${customer.id}-${i}`,
      platform,
      model: platform === 'web' ? 'Chrome / macOS' : rng.pick(PHONE_MODELS),
      app_version: rng.pick(['3.4.1', '3.4.0', '3.3.8', '3.2.11']),
      os_version: platform === 'ios' ? `iOS ${rng.int(16, 19)}.${rng.int(0, 4)}` : platform === 'android' ? `Android ${rng.int(12, 16)}` : '—',
      last_seen: isoDaysAgo(rng.int(0, 40), rng),
      push_token_masked: `••••${rng.int(1000, 9999)}`,
    };
  });

  const paymentMethods: UserPaymentMethod[] = Array.from({ length: rng.int(0, 2) + (customer.rides > 0 ? 1 : 0) }, (_, i) => ({
    id: `pm-${customer.id}-${i}`,
    brand: rng.pick(['Visa', 'Mastercard', 'Visa', 'Amex', 'Apple Pay']),
    last4: String(rng.int(1000, 9999)),
    exp: `${String(rng.int(1, 12)).padStart(2, '0')}/${rng.int(26, 31)}`,
    is_default: i === 0,
    status: rng.bool(0.88) ? 'valid' : rng.bool(0.5) ? 'expired' : 'requires_action',
    added_at: isoDaysAgo(rng.int(5, 380), rng),
  }));

  const signupSource = rng.pick(['ios', 'ios', 'android', 'android', 'web', 'referral'] as const);
  const marketingAt = customer.marketing_consent ? customer.tos_accepted_at : null;

  return {
    customer,
    avatar_url: avatarDataUri(customer.full_name, customer.id),
    date_of_birth: dob,
    nationality,
    gender,
    address: {
      line1: `${rng.pick(STREETS)} ${rng.int(1, 180)}`,
      line2: rng.bool(0.4) ? `Apt ${rng.int(1, 40)}` : null,
      city: customer.city_name,
      postcode: `1${rng.int(0, 9)}${rng.int(0, 9)} ${rng.int(10, 99)}`,
      country: 'Greece',
    },
    preferred_lang: (rng.bool(0.6) ? 'el' : rng.bool(0.7) ? 'en' : 'pl') as Lang,
    email_verified: customer.email ? rng.bool(0.86) : false,
    phone_verified: true,
    signup_source: signupSource,
    signup_at: customer.created_at,
    last_active_at: isoDaysAgo(rng.int(0, 30), rng),
    risk_score: riskBase,
    risk_reasons: riskReasons,
    tags: pickMany(TAG_POOL, rng.int(0, 3), rng),
    notes,
    customer_group_name: group?.name ?? null,
    corporate_id: corporate?.id ?? null,
    corporate_name: corporate?.name ?? null,
    loyalty_tier: loyaltyTier,
    loyalty_points: loyaltyPoints,
    loyalty_events: loyaltyEvents,
    referrals_sent: ctx.referrals.filter((r) => r.referrer_id === customer.id).length,
    referrals_qualified: ctx.referrals.filter((r) => r.referrer_id === customer.id && r.status !== 'pending').length,
    referral_code: `PENNY-${customer.id.slice(-3).toUpperCase()}${rng.int(10, 99)}`,
    wallet_balance_cents: rng.bool(0.45) ? rng.int(100, 3500) : 0,
    legacy_rides: ctx.legacyRides[customer.id] ?? 0,
    legacy_spend_cents: Math.max(0, customer.spend_cents - stats.total_spend_cents),
    emergency_contact_name: customer.emergency_contact ? rng.pick(['Maria (mother)', 'Nikos (brother)', 'Eleni (partner)', 'Kostas (friend)']) : null,
    consents: {
      tos_accepted_at: customer.tos_accepted_at,
      tos_version: rng.pick(['2025-11-01', '2026-03-15']),
      privacy_accepted_at: customer.privacy_accepted_at,
      privacy_version: rng.pick(['2025-11-01', '2026-03-15']),
      marketing_consent: customer.marketing_consent,
      marketing_consent_at: marketingAt,
      data_processing_at: customer.tos_accepted_at,
      age_confirmed: true,
    },
    notification_prefs: {
      push_trip_receipts: rng.bool(0.9),
      push_promotions: customer.marketing_consent && rng.bool(0.8),
      email_receipts: rng.bool(0.75),
      email_newsletter: customer.marketing_consent && rng.bool(0.6),
      sms_critical: rng.bool(0.5),
    },
    payment_methods: paymentMethods,
    devices,
    form_answers: FORM_QUESTIONS.map(([question, answers]) => ({ question, answer: rng.pick(answers) })),
    stats,
  };
}

/* ------------------------------------------------------------------ */
/* Timelines                                                           */
/* ------------------------------------------------------------------ */

function sortDesc(events: TimelineEvent[]): TimelineEvent[] {
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function buildUserTimeline(profile: UserProfileFull, ctx: ProfileCtx): TimelineEvent[] {
  const c = profile.customer;
  const rng = new Rng(seedOf(`${c.id}:timeline`));
  const out: TimelineEvent[] = [];

  out.push({
    id: `tl-${c.id}-signup`, at: c.created_at, kind: 'account',
    title: 'Account created',
    detail: `Signed up via ${profile.signup_source} · ${c.phone}`,
    ref_id: c.id, tone: 'info',
  });

  for (const r of ctx.rides.filter((x) => x.user_id === c.id)) {
    const extra = ctx.rideExtras[r.id];
    out.push({
      id: `tl-ride-${r.id}`, at: r.started_at ?? r.created_at, kind: 'ride',
      title: `Ride on ${r.vehicle_code}`,
      detail: `${(r.distance_m / 1000).toFixed(2)} km · ${Math.round(r.duration_s / 60)} min · ${(r.cost_cents / 100).toFixed(2)} € · ends ${extra?.end_zone_name ?? 'unknown zone'}`,
      ref_id: r.id, link: `/rides/${r.id}`,
      tone: r.status === 'disputed' ? 'warning' : r.status === 'aborted' ? 'danger' : 'neutral',
    });
    if (r.has_dispute) {
      out.push({
        id: `tl-dispute-${r.id}`, at: r.ended_at ?? r.started_at ?? r.created_at, kind: 'support',
        title: 'Dispute opened', detail: `Rider disputed the charge for ${r.id}`,
        ref_id: r.id, link: `/rides/${r.id}`, tone: 'warning',
      });
    }
  }

  for (const p of ctx.payments.filter((x) => x.user_id === c.id)) {
    const kind = p.kind === 'penalty' ? 'penalty' : p.status === 'refunded' || p.status === 'partially_refunded' ? 'refund' : 'payment';
    out.push({
      id: `tl-pay-${p.id}`, at: p.created_at, kind,
      title: `${p.kind === 'penalty' ? 'Penalty' : p.status === 'refunded' ? 'Refund' : 'Payment'} · ${(p.amount_cents / 100).toFixed(2)} €`,
      detail: `${p.kind} · ${p.status}${p.admin_reason ? ` · ${p.admin_reason}` : ''}${p.failure_code ? ` · ${p.failure_code}` : ''}`,
      ref_id: p.id,
      tone: p.status === 'failed' ? 'danger' : p.kind === 'penalty' ? 'warning' : 'success',
    });
  }

  for (const d of ctx.debts.filter((x) => x.user_id === c.id)) {
    out.push({
      id: `tl-debt-${d.id}`, at: d.created_at, kind: 'debt',
      title: `Debt opened · ${(d.amount_cents / 100).toFixed(2)} €`,
      detail: `Source ${d.source} · ${d.attempts} retry attempt(s) · status ${d.status}`,
      ref_id: d.id, tone: 'danger',
    });
  }

  if (c.sumsub_applicant_id) {
    out.push({
      id: `tl-kyc-${c.id}`, at: c.tos_accepted_at ?? c.created_at, kind: 'kyc',
      title: 'KYC submitted to Sumsub',
      detail: `Applicant ${c.sumsub_applicant_id}`,
      ref_id: c.sumsub_applicant_id, tone: 'info',
    });
    out.push({
      id: `tl-kyc-res-${c.id}`, at: c.updated_at, kind: 'kyc',
      title: `KYC ${c.kyc_status}`,
      detail: c.kyc_status === 'approved' ? 'Sumsub returned GREEN' : c.kyc_status === 'rejected' ? 'Sumsub returned RED' : 'Awaiting Sumsub decision',
      ref_id: c.sumsub_applicant_id,
      tone: c.kyc_status === 'approved' ? 'success' : c.kyc_status === 'rejected' ? 'danger' : 'warning',
    });
  }

  if (c.status === 'blocked') {
    out.push({
      id: `tl-block-${c.id}`, at: c.updated_at, kind: 'account',
      title: 'Account blocked', detail: c.blocked_reason ?? 'Blocked by staff', ref_id: c.id, tone: 'danger',
    });
  }

  for (const n of profile.notes) {
    out.push({ id: `tl-note-${n.id}`, at: n.at, kind: 'support', title: `Internal note by ${n.author}`, detail: n.body, ref_id: n.id, tone: 'neutral' });
  }
  for (const l of profile.loyalty_events) {
    out.push({ id: `tl-ly-${l.id}`, at: l.at, kind: 'loyalty', title: `${l.points > 0 ? '+' : ''}${l.points} loyalty points`, detail: l.reason, ref_id: l.id, tone: l.points > 0 ? 'success' : 'neutral' });
  }
  for (const r of ctx.referrals.filter((x) => x.referrer_id === c.id || x.referee_id === c.id)) {
    out.push({
      id: `tl-ref-${r.id}`, at: r.created_at, kind: 'referral',
      title: r.referrer_id === c.id ? `Referred ${r.referee_name}` : `Referred by ${r.referrer_name}`,
      detail: `${r.status} · reward ${(r.reward_cents / 100).toFixed(2)} €`, ref_id: r.id,
      tone: r.status === 'rewarded' ? 'success' : 'info',
    });
  }
  for (const n of ctx.notifications.filter((x) => x.target === c.phone).slice(0, 6)) {
    out.push({
      id: `tl-notif-${n.id}`, at: n.sent_at, kind: 'notification',
      title: `Notification · ${n.template_key}`, detail: `${n.channel} → ${n.status}`, ref_id: n.id,
      tone: n.status === 'failed' ? 'danger' : 'neutral',
    });
  }
  for (const s of ctx.scans.filter((x) => x.user_id === c.id && x.result !== 'ok').slice(0, 4)) {
    out.push({
      id: `tl-scan-${s.id}`, at: s.created_at, kind: 'support',
      title: 'Failed QR scan', detail: `Scanned ${s.vehicle_code_scanned} → ${s.result}`, ref_id: s.id, tone: 'warning',
    });
  }
  if (rng.bool(0.5)) {
    out.push({
      id: `tl-support-${c.id}`, at: isoDaysAgo(rng.int(2, 60), rng), kind: 'support',
      title: 'Support ticket', detail: rng.pick(['Unlock failed at Monastiraki — resolved', 'Asked for receipt copy', 'Reported damaged brake', 'Wrong charge — refunded']),
      ref_id: null, tone: 'info',
    });
  }

  return sortDesc(out);
}

export function buildVehicleTimeline(vehicle: VehicleRow, ctx: ProfileCtx): TimelineEvent[] {
  const rng = new Rng(seedOf(`${vehicle.id}:timeline`));
  const out: TimelineEvent[] = [];

  out.push({
    id: `tl-${vehicle.id}-deployed`, at: vehicle.created_at, kind: 'status',
    title: 'Vehicle deployed', detail: `${vehicle.model_name} · ${vehicle.city_name} · code ${vehicle.code}`,
    ref_id: vehicle.id, tone: 'info',
  });

  for (const r of ctx.rides.filter((x) => x.vehicle_id === vehicle.id)) {
    const extra = ctx.rideExtras[r.id];
    const row = extra ? toVehicleRideRow(r, extra) : null;
    out.push({
      id: `tl-vride-${r.id}`, at: r.started_at ?? r.created_at, kind: 'ride',
      title: `Ride by ${r.user_name}`,
      detail: `${(r.distance_m / 1000).toFixed(2)} km · ${Math.round(r.duration_s / 60)} min · ${(r.cost_cents / 100).toFixed(2)} €${row?.end_zone_name ? ` · ends ${row.end_zone_name}` : ''}`,
      ref_id: r.id, link: `/rides/${r.id}`,
      tone: r.status === 'disputed' ? 'warning' : 'neutral',
    });
  }

  for (const c of ctx.commands.filter((x) => x.vehicle_id === vehicle.id)) {
    out.push({
      id: `tl-cmd-${c.id}`, at: c.sent_at ?? c.created_at, kind: 'command',
      title: `Command ${c.kind}`,
      detail: `${c.channel.toUpperCase()} · ${c.status}${c.acked_at && c.sent_at ? ` · ACK in ${new Date(c.acked_at).getTime() - new Date(c.sent_at).getTime()} ms` : ''}${c.error ? ` · ${c.error}` : ''}`,
      ref_id: c.id,
      tone: c.status === 'acked' ? 'success' : c.status === 'failed' || c.status === 'expired' ? 'danger' : 'info',
    });
  }

  for (const a of ctx.alerts.filter((x) => x.vehicle_id === vehicle.id)) {
    out.push({
      id: `tl-alert-${a.id}`, at: a.created_at, kind: 'alert',
      title: `Alert · ${a.kind.replace(/_/g, ' ')}`,
      detail: `${Object.keys(a.payload).length ? JSON.stringify(a.payload) : 'no payload'}${a.ack_at ? ' · acknowledged' : ' · unacknowledged'}`,
      ref_id: a.id, tone: a.ack_at ? 'neutral' : 'danger',
    });
  }

  for (const d of ctx.damage.filter((x) => x.vehicle_id === vehicle.id)) {
    out.push({
      id: `tl-dmg-${d.id}`, at: d.created_at, kind: 'damage',
      title: `Damage report · ${d.severity}`,
      detail: `${d.description} · reported by ${d.reporter} · ${d.status}`,
      ref_id: d.id, tone: d.severity === 'critical' || d.severity === 'high' ? 'danger' : 'warning',
    });
  }

  for (const b of ctx.batterySwaps.filter((x) => x.vehicle_id === vehicle.id)) {
    out.push({
      id: `tl-bs-${b.id}`, at: b.at, kind: 'battery_swap',
      title: 'Battery swap',
      detail: `${(b.voltage_before / 1000).toFixed(1)} V → ${(b.voltage_after / 1000).toFixed(1)} V · by ${b.by_name}`,
      ref_id: b.id, tone: 'success',
    });
  }

  for (const m of ctx.maintenance.filter((x) => x.vehicle_id === vehicle.id)) {
    out.push({
      id: `tl-ml-${m.id}`, at: m.created_at, kind: 'maintenance',
      title: `Maintenance · ${m.parts}`,
      detail: `${(m.cost_cents / 100).toFixed(2)} € · ${m.notes}`,
      ref_id: m.id, tone: 'info',
    });
  }

  // A couple of status transitions so the filter chips always have content.
  const statusEvents = rng.int(1, 3);
  for (let i = 0; i < statusEvents; i++) {
    const to = rng.pick(['maintenance', 'available', 'transport', 'low_battery'] as const);
    out.push({
      id: `tl-st-${vehicle.id}-${i}`, at: isoDaysAgo(rng.int(1, 80), rng), kind: 'status',
      title: `Status → ${to.replace(/_/g, ' ')}`,
      detail: rng.pick(['Set by ops app', 'Automatic rule (SoC threshold)', 'Set from admin panel', 'Returned from workshop']),
      ref_id: vehicle.id, tone: to === 'available' ? 'success' : 'warning',
    });
  }

  return sortDesc(out);
}
