import type {
  BrandConfig,
  DataSource,
  RideDetail,
  SimCommandInput,
  SimDetail,
  SimSyncResult,
  VehicleDetail,
  VehicleHistory,
  CustomerDetail,
  AdminChargeInput,
  AuditInput,
  SearchResult,
} from './api';
import { runQuery, delay, type Page, type QueryParams } from './query';
import { getMockDb } from './mock/db';
import { buildRoute, buildTelemetry, jitterPoint } from './mock/geoutil';
import { toUserRideRow, toVehicleRideRow, computeVehicleStats } from './mock/history';
import { buildSimAlerts, refreshSimDerived } from './mock/sims';
import { SIM_PLANS } from '@/lib/simPlans';
import { Rng, uuid } from '@/lib/rng';
import type { Command, VehicleAlert, Zone } from '@penny/db-types';
import type {
  KpiSnapshot,
  RideRow,
  VehicleRow,
  CustomerRow,
  VerificationItem,
  AuditLogEntry,
  UserProfileFull,
  UserRideHistoryRow,
  VehicleRideHistoryRow,
  SumsubProfileBundle,
  TimelineEvent,
  SimAlert,
  SimCostSummary,
  SimInventoryRow,
} from '@/types/domain';

const LATENCY = 180;

/** Newest-first unless the table asked for something else. */
function withDefaultSort(params: QueryParams): QueryParams {
  return params.sort?.length ? params : { ...params, sort: [{ field: 'started_at', dir: 'desc' }] };
}

type HistoryLike = {
  has_dispute: boolean;
  has_penalty: boolean;
  rating: number | null;
  photo_review: string | null;
  status: string;
};

/** Shared filter predicates for the user + vehicle ride-history tables. */
const RIDE_FILTERS: Record<string, (row: HistoryLike, v: string | number | boolean) => boolean> = {
  has_dispute: (r, v) => r.has_dispute === (v === true || v === 'true'),
  has_penalty: (r, v) => r.has_penalty === (v === true || v === 'true'),
  rated: (r, v) => (v === true || v === 'true' ? r.rating != null : r.rating == null),
  photo_review: (r, v) => (v === 'none' ? r.photo_review == null : r.photo_review === v),
};

export class MockDataSource implements DataSource {
  readonly kind = 'mock' as const;
  private db = getMockDb();

  async getKpis(): Promise<KpiSnapshot> {
    return delay(this.db.kpis, LATENCY);
  }
  async getAlerts(): Promise<VehicleAlert[]> {
    return delay(
      [...this.db.alerts].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      LATENCY,
    );
  }
  async getLiveVehicles(): Promise<VehicleRow[]> {
    return delay(this.db.vehicles, LATENCY);
  }

  async listRides(params: QueryParams): Promise<Page<RideRow>> {
    return delay(
      runQuery(this.db.rides as unknown as Record<string, unknown>[], params, {
        searchFields: ['id', 'user_name', 'user_phone', 'vehicle_code', 'city_name'],
        filterFns: {
          has_dispute: (r, v) => Boolean((r as unknown as RideRow).has_dispute) === (v === true || v === 'true'),
          has_penalty: (r, v) => Boolean((r as unknown as RideRow).has_penalty) === (v === true || v === 'true'),
        },
      }) as unknown as Page<RideRow>,
      LATENCY,
    );
  }

  async getRide(id: string): Promise<RideDetail | null> {
    const ride = this.db.rides.find((r) => r.id === id);
    if (!ride) return delay(null, LATENCY);
    const start = ride.start_pos?.coordinates ?? [23.7275, 37.9838];
    const end = ride.end_pos?.coordinates ?? jitterPoint(start, 1200, new Rng(1));
    const route = buildRoute(start, end, id, 44);
    const telemetry = buildTelemetry(route, ride.started_at ?? new Date().toISOString(), ride.duration_s || 600, 90, id);
    const payments = this.db.payments.filter((p) => p.trip_id === id);
    return delay({ ride, events: this.db.tripEvents[id] ?? [], route, telemetry, payments }, LATENCY);
  }

  async listVerification(): Promise<VerificationItem[]> {
    const items = this.db.rides
      .filter((r) => r.photo_review === 'pending' || r.photo_review === 'rejected')
      .map<VerificationItem>((r) => {
        const rng = new Rng(r.id.length * 31 + r.cost_cents);
        const conf = +rng.float(0.55, 0.98).toFixed(2);
        return {
          trip: r,
          ai_confidence: conf,
          ai_verdict: conf >= 0.85 ? 'auto_ok' : 'needs_review',
          photo_url: r.end_photo_url ?? `photo:${r.id}`,
          queued_at: r.ended_at ?? r.started_at ?? new Date().toISOString(),
        };
      })
      .sort((a, b) => a.queued_at.localeCompare(b.queued_at));
    return delay(items, LATENCY);
  }

  async reviewPhoto(tripId: string, verdict: 'approved' | 'rejected', reason?: string): Promise<void> {
    const ride = this.db.rides.find((r) => r.id === tripId);
    if (ride) ride.photo_review = verdict;
    await this.logAudit({ action: 'photo_review', entity: 'trip', entity_id: tripId, reason: reason ?? verdict });
    return delay(undefined, 120);
  }

  async listVehicles(params: QueryParams): Promise<Page<VehicleRow>> {
    return delay(
      runQuery(this.db.vehicles as unknown as Record<string, unknown>[], params, {
        searchFields: ['code', 'model_name', 'city_name', 'imei', 'plate'],
      }) as unknown as Page<VehicleRow>,
      LATENCY,
    );
  }

  async getVehicle(id: string): Promise<VehicleDetail | null> {
    const vehicle = this.db.vehicles.find((v) => v.id === id);
    if (!vehicle) return delay(null, LATENCY);
    const center = jitterPoint([23.7275, 37.9838], 2000, new Rng(id.length));
    const route = buildRoute(center, jitterPoint(center, 800, new Rng(7)), id + ':v', 30);
    const telemetry = buildTelemetry(route, new Date(Date.now() - 30 * 60000).toISOString(), 1800, vehicle.soc_pct ?? 80, id + ':v');
    return delay(
      {
        vehicle,
        telemetry,
        commands: this.db.commands.filter((c) => c.vehicle_id === id),
        alerts: this.db.alerts.filter((a) => a.vehicle_id === id),
        rides: this.db.rides.filter((r) => r.vehicle_id === id).slice(0, 25),
        damage: this.db.damageReports.filter((d) => d.vehicle_id === id),
        device: this.db.devices.find((d) => d.vehicle_id === id) ?? null,
      },
      LATENCY,
    );
  }

  async sendCommand(vehicleId: string, kind: string, payload: Record<string, unknown> = {}): Promise<Command> {
    const dev = this.db.devices.find((d) => d.vehicle_id === vehicleId);
    const now = new Date().toISOString();
    const cmd: Command = {
      id: `cmd-${uuid().slice(0, 8)}`, vehicle_id: vehicleId, device_id: dev?.id ?? 'unknown',
      kind: kind as Command['kind'], payload, status: 'acked', channel: 'gprs', requested_by: 'staff-owner',
      trip_id: null, sent_at: now, acked_at: new Date(Date.now() + 2200).toISOString(), error: null, created_at: now,
    };
    this.db.commands.unshift(cmd);
    await this.logAudit({ action: 'command_send', entity: 'vehicle', entity_id: vehicleId, reason: kind });
    return delay(cmd, 600);
  }

  async setVehicleStatus(vehicleId: string, status: string, reason: string): Promise<void> {
    const v = this.db.vehicles.find((x) => x.id === vehicleId);
    if (v) v.status = status as VehicleRow['status'];
    await this.logAudit({ action: 'vehicle_status', entity: 'vehicle', entity_id: vehicleId, reason });
    return delay(undefined, 160);
  }

  /* ---------- Vehicle: exhaustive history ---------- */

  private vehicleRideRows(vehicleId: string): VehicleRideHistoryRow[] {
    return this.db.rides
      .filter((r) => r.vehicle_id === vehicleId)
      .map((r) => {
        const extra = this.db.rideExtras[r.id];
        return extra ? toVehicleRideRow(r, extra) : null;
      })
      .filter((r): r is VehicleRideHistoryRow => r !== null);
  }

  async getVehicleHistory(vehicleId: string, params: QueryParams): Promise<VehicleHistory> {
    const vehicle = this.db.vehicles.find((v) => v.id === vehicleId) ?? null;
    const rows = this.vehicleRideRows(vehicleId);
    const stats = computeVehicleStats(rows, {
      damage_count: this.db.damageReports.filter((d) => d.vehicle_id === vehicleId).length,
      battery_swaps: this.db.batterySwaps.filter((b) => b.vehicle_id === vehicleId).length,
      maintenance_cost_cents: this.db.maintenanceLog.filter((m) => m.vehicle_id === vehicleId).reduce((s, m) => s + m.cost_cents, 0),
      deployed_at: vehicle?.created_at ?? null,
    });
    const rides = await this.getVehicleRides(vehicleId, params);
    return delay({ stats, rides, timeline: this.db.vehicleTimelines[vehicleId] ?? [] }, LATENCY);
  }

  async getVehicleRides(vehicleId: string, params: QueryParams): Promise<Page<VehicleRideHistoryRow>> {
    const rows = this.vehicleRideRows(vehicleId);
    return delay(
      runQuery(rows as unknown as Record<string, unknown>[], withDefaultSort(params), {
        searchFields: ['id', 'user_name', 'user_phone_masked', 'end_zone_name', 'start_zone_name', 'status'],
        filterFns: RIDE_FILTERS as never,
      }) as unknown as Page<VehicleRideHistoryRow>,
      LATENCY,
    );
  }

  async getVehicleTimeline(vehicleId: string, params: QueryParams): Promise<Page<TimelineEvent>> {
    const rows = this.db.vehicleTimelines[vehicleId] ?? [];
    return delay(
      runQuery(rows as unknown as Record<string, unknown>[], { pageSize: 100, ...params }, {
        searchFields: ['title', 'detail', 'ref_id'],
      }) as unknown as Page<TimelineEvent>,
      LATENCY,
    );
  }

  /* ---------- Customer: rich profile, history, KYC ---------- */

  async getUserProfile(userId: string): Promise<UserProfileFull | null> {
    return delay(this.db.userProfiles[userId] ?? null, LATENCY);
  }

  async getUserRides(userId: string, params: QueryParams): Promise<Page<UserRideHistoryRow>> {
    const rows = this.db.rides
      .filter((r) => r.user_id === userId)
      .map((r) => {
        const extra = this.db.rideExtras[r.id];
        return extra ? toUserRideRow(r, extra) : null;
      })
      .filter((r): r is UserRideHistoryRow => r !== null);
    return delay(
      runQuery(rows as unknown as Record<string, unknown>[], withDefaultSort(params), {
        searchFields: ['id', 'vehicle_code', 'vehicle_model', 'end_zone_name', 'start_zone_name', 'status'],
        filterFns: RIDE_FILTERS as never,
      }) as unknown as Page<UserRideHistoryRow>,
      LATENCY,
    );
  }

  async getUserTimeline(userId: string, params: QueryParams): Promise<Page<TimelineEvent>> {
    const rows = this.db.userTimelines[userId] ?? [];
    return delay(
      runQuery(rows as unknown as Record<string, unknown>[], { pageSize: 100, ...params }, {
        searchFields: ['title', 'detail', 'ref_id'],
      }) as unknown as Page<TimelineEvent>,
      LATENCY,
    );
  }

  async getSumsubProfile(userId: string, opts?: { refresh?: boolean }): Promise<SumsubProfileBundle> {
    const bundle = this.db.sumsub[userId];
    if (!bundle) {
      return delay({ applicant: null, documents: [], history: [], fetched_at: new Date().toISOString(), source: 'live' as const }, LATENCY);
    }
    // A refresh models a live provider call; otherwise we serve the cache.
    const next: SumsubProfileBundle = {
      ...bundle,
      fetched_at: new Date().toISOString(),
      source: opts?.refresh ? 'live' : 'cache',
      applicant: bundle.applicant ? { ...bundle.applicant, live: Boolean(opts?.refresh) } : null,
    };
    this.db.sumsub[userId] = next;
    if (opts?.refresh) {
      await this.logAudit({ action: 'sumsub_resync', entity: 'user', entity_id: userId, reason: 'Manual re-sync from Sumsub' });
    }
    return delay(next, opts?.refresh ? 700 : LATENCY);
  }

  async listCustomers(params: QueryParams): Promise<Page<CustomerRow>> {
    return delay(
      runQuery(this.db.customers as unknown as Record<string, unknown>[], params, {
        searchFields: ['id', 'full_name', 'phone', 'email', 'legacy_atom_user_id'],
      }) as unknown as Page<CustomerRow>,
      LATENCY,
    );
  }

  async getCustomer(id: string): Promise<CustomerDetail | null> {
    const customer = this.db.customers.find((c) => c.id === id);
    if (!customer) return delay(null, LATENCY);
    const rides = this.db.rides.filter((r) => r.user_id === id);
    const payments = this.db.payments.filter((p) => p.user_id === id);
    const debts = this.db.debts.filter((d) => d.user_id === id);
    const ledger = this.db.ledgerEntries.slice(0, 6);
    const referrals = this.db.referrals.filter((r) => r.referrer_id === id || r.referee_id === id);
    return delay({ customer, rides, payments, debts, ledger, referrals }, LATENCY);
  }

  async adminCharge(input: AdminChargeInput): Promise<void> {
    this.db.payments.unshift({
      id: `pay-${uuid().slice(0, 8)}`, user_id: input.user_id, trip_id: null, stripe_pi_id: `pi_${Date.now()}`,
      amount_cents: input.amount_cents, kind: 'manual', status: 'succeeded', failure_code: null,
      initiated_by: 'admin', admin_reason: input.reason, created_at: new Date().toISOString(),
    });
    await this.logAudit({ action: 'admin_charge', entity: 'user', entity_id: input.user_id, reason: input.reason, after: { amount_cents: input.amount_cents, kind: input.kind } });
    return delay(undefined, 400);
  }

  async refund(paymentId: string, amountCents: number, reason: string): Promise<void> {
    const p = this.db.payments.find((x) => x.id === paymentId);
    if (p) p.status = amountCents >= p.amount_cents ? 'refunded' : 'partially_refunded';
    await this.logAudit({ action: 'refund', entity: 'payment', entity_id: paymentId, reason, after: { amount_cents: amountCents } });
    return delay(undefined, 400);
  }

  async setUserBlocked(userId: string, blocked: boolean, reason: string): Promise<void> {
    const c = this.db.customers.find((x) => x.id === userId);
    if (c) {
      c.status = blocked ? 'blocked' : 'active';
      c.blocked_reason = blocked ? reason : null;
    }
    await this.logAudit({ action: blocked ? 'block_user' : 'unblock_user', entity: 'user', entity_id: userId, reason });
    return delay(undefined, 250);
  }

  async creditWallet(userId: string, amountCents: number, reason: string): Promise<void> {
    await this.logAudit({ action: 'credit_wallet', entity: 'user', entity_id: userId, reason, after: { amount_cents: amountCents } });
    return delay(undefined, 250);
  }

  /* ---------- Connectivity / SIM cards ---------- */

  /** `v_sim_inventory` ordered worst-health-first unless the table sorts. */
  private static readonly HEALTH_RANK: Record<string, number> = {
    over_limit: 0, silent: 1, unassigned: 2, near_limit: 3, no_usage: 4, ok: 5,
  };

  async getSims(params: QueryParams): Promise<Page<SimInventoryRow>> {
    const rows = this.db.sims.slice().sort(
      (a, b) => (MockDataSource.HEALTH_RANK[a.health] ?? 9) - (MockDataSource.HEALTH_RANK[b.health] ?? 9),
    );
    return delay(
      runQuery(rows as unknown as Record<string, unknown>[], params, {
        // ICCID/IMSI/MSISDN/IMEI are searched as stored — no normalization.
        searchFields: ['iccid', 'imsi', 'msisdn', 'provider_sim_id', 'device_imei', 'vehicle_code', 'label', 'plan_name'],
        filterFns: {
          linked: (r, v) => {
            const row = r as unknown as SimInventoryRow;
            return (v === true || v === 'true' || v === 'yes') ? row.device_id !== null : row.device_id === null;
          },
          over_limit: (r) => (r as unknown as SimInventoryRow).data_pct_used >= 100,
        },
      }) as unknown as Page<SimInventoryRow>,
      LATENCY,
    );
  }

  async getSimDetail(simId: string): Promise<SimDetail | null> {
    const sim = this.db.sims.find((s) => s.id === simId);
    if (!sim) return delay(null, LATENCY);
    return delay(
      {
        sim,
        usage: this.db.simUsage[simId] ?? [],
        events: this.db.simEvents[simId] ?? [],
        source: this.db.simLastSyncAt ? ('live' as const) : ('cache' as const),
        fetched_at: this.db.simLastSyncAt ?? new Date().toISOString(),
      },
      LATENCY,
    );
  }

  async getSimAlerts(): Promise<SimAlert[]> {
    return delay(this.db.simAlerts, LATENCY);
  }

  async getSimCostSummary(): Promise<SimCostSummary[]> {
    return delay(this.db.simCostSummary, LATENCY);
  }

  /** Models a `sim-sync` run: re-pull the provider snapshot and re-derive. */
  async syncSims(): Promise<SimSyncResult> {
    const now = Date.now();
    let updated = 0;
    for (const sim of this.db.sims) {
      const days = this.db.simUsage[sim.id] ?? [];
      const cycleFirst = new Date(`${sim.cycle_start}T00:00:00Z`).getTime();
      const inCycle = days.filter((u) => new Date(`${u.day}T00:00:00Z`).getTime() >= cycleFirst);
      const used = +inCycle.reduce((s, u) => s + u.data_mb, 0).toFixed(2);
      if (used !== sim.data_used_mb_cycle) updated += 1;
      sim.data_used_mb_cycle = used;
      refreshSimDerived(sim, now);
    }
    this.db.simAlerts = buildSimAlerts(this.db.sims);
    this.db.simLastSyncAt = new Date().toISOString();
    await this.logAudit({ action: 'sim_sync', entity: 'sim', entity_id: 'all', reason: 'Manual sync from provider' });
    return delay(
      {
        fetched: this.db.sims.length,
        updated,
        discovered: 0,
        synced_at: this.db.simLastSyncAt,
        provider: this.db.sims[0]?.provider ?? 'Truphone / 1GLOBAL',
      },
      750,
    );
  }

  async simCommand(input: SimCommandInput): Promise<SimInventoryRow> {
    const sim = this.db.sims.find((s) => s.id === input.sim_id);
    if (!sim) throw new Error(`Unknown SIM ${input.sim_id}`);
    // Mirrors the server-side guard: destructive lifecycle changes are audited
    // and cannot be issued without an explanation.
    if ((input.action === 'suspend' || input.action === 'terminate') && input.reason.trim().length < 3) {
      throw new Error(`A reason is mandatory to ${input.action} a SIM.`);
    }
    const before = { status: sim.status, plan_name: sim.plan_name };

    if (input.action === 'activate' || input.action === 'resume') sim.status = 'active';
    if (input.action === 'suspend') sim.status = 'suspended';
    if (input.action === 'terminate') sim.status = 'terminated';
    if (input.action === 'set_plan') {
      const plan = SIM_PLANS.find((p) => p.name === input.plan);
      if (!plan) throw new Error(`Unknown plan ${input.plan ?? '—'}`);
      sim.plan_name = plan.name;
      sim.plan_data_mb = plan.data_mb;
      sim.monthly_cost_cents = plan.cost_cents;
    }

    const detail =
      input.action === 'set_plan'
        ? `Plan changed ${before.plan_name} → ${sim.plan_name}`
        : `Status ${before.status} → ${sim.status}`;
    const log = this.db.simEvents[sim.id] ?? (this.db.simEvents[sim.id] = []);
    log.unshift({
      at: new Date().toISOString(),
      kind: input.action,
      detail,
      staff_id: 'staff-owner',
      reason: input.reason.trim() || null,
    });

    refreshSimDerived(sim);
    this.db.simAlerts = buildSimAlerts(this.db.sims);
    await this.logAudit({
      action: `sim_${input.action}`,
      entity: 'sim',
      entity_id: sim.id,
      reason: input.reason.trim() || null,
      before,
      after: { status: sim.status, plan_name: sim.plan_name },
    });
    return delay(sim, 420);
  }

  /* ---------- White-label branding ---------- */

  async getBrandConfig(): Promise<BrandConfig | null> {
    return delay(this.db.brandConfig, 80);
  }

  async saveBrandConfig(config: BrandConfig, reason: string): Promise<void> {
    const before = this.db.brandConfig;
    this.db.brandConfig = config;
    await this.logAudit({
      action: 'brand_config_save',
      entity: 'app_config',
      entity_id: 'brand',
      reason,
      before: before ?? null,
      after: config,
    });
    return delay(undefined, 260);
  }

  async listZones(): Promise<Zone[]> {
    return delay(this.db.zones, LATENCY);
  }

  async saveZoneVersion(zones: Zone[], reason: string): Promise<number> {
    const version = (this.db.zoneVersions[0]?.version ?? 0) + 1;
    this.db.zones = zones;
    this.db.zoneVersions.unshift({ version, created_at: new Date().toISOString(), created_by: 'Owner', note: reason, count: zones.length });
    await this.logAudit({ action: 'zone_edit', entity: 'zone', entity_id: `v${version}`, reason });
    return delay(version, 400);
  }

  async getPanelData() {
    return delay(this.db, LATENCY);
  }

  async search(q: string): Promise<SearchResult[]> {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const out: SearchResult[] = [];
    for (const c of this.db.customers) {
      if (c.phone.toLowerCase().includes(query) || (c.full_name ?? '').toLowerCase().includes(query) || (c.email ?? '').toLowerCase().includes(query)) {
        out.push({ kind: 'customer', id: c.id, label: c.full_name ?? c.phone, sub: c.phone, to: `/customers/${c.id}` });
      }
    }
    for (const v of this.db.vehicles) {
      if (v.code.toLowerCase().includes(query) || (v.imei ?? '').includes(query)) {
        out.push({ kind: 'vehicle', id: v.id, label: v.code, sub: v.model_name, to: `/vehicles/${v.id}` });
      }
    }
    for (const r of this.db.rides) {
      if (r.id.toLowerCase().includes(query)) {
        out.push({ kind: 'ride', id: r.id, label: r.id, sub: `${r.user_name} · ${r.vehicle_code}`, to: `/rides/${r.id}` });
      }
    }
    return delay(out.slice(0, 12), 120);
  }

  async logAudit(input: AuditInput): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: `audit-${uuid().slice(0, 8)}`, staff_id: 'staff-owner', action: input.action, entity: input.entity,
      entity_id: input.entity_id, before: input.before ?? null, after: input.after ?? null, reason: input.reason,
      ip: '10.0.0.1', at: new Date().toISOString(),
    };
    this.db.auditLog.unshift(entry);
    return entry;
  }

  async listAudit(params: QueryParams): Promise<Page<AuditLogEntry>> {
    return delay(
      runQuery(this.db.auditLog as unknown as Record<string, unknown>[], params, {
        searchFields: ['action', 'entity', 'entity_id', 'reason'],
      }) as unknown as Page<AuditLogEntry>,
      LATENCY,
    );
  }
}
