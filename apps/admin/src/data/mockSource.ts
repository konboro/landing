import type {
  DataSource,
  RideDetail,
  VehicleDetail,
  CustomerDetail,
  AdminChargeInput,
  AuditInput,
  SearchResult,
} from './api';
import { runQuery, delay, type Page, type QueryParams } from './query';
import { getMockDb } from './mock/db';
import { buildRoute, buildTelemetry, jitterPoint } from './mock/geoutil';
import { Rng, uuid } from '@/lib/rng';
import type { Command, VehicleAlert, Zone } from '@penny/db-types';
import type {
  KpiSnapshot,
  RideRow,
  VehicleRow,
  CustomerRow,
  VerificationItem,
  AuditLogEntry,
} from '@/types/domain';

const LATENCY = 180;

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
