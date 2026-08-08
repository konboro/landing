// SIM detail drawer: identity, lifecycle, plan/cycle, a 30-day usage chart,
// the linked device/vehicle and the append-only event history — plus the
// lifecycle actions. Suspend and Terminate always require a reason, which is
// what lands in `audit_log` (Hard Rule #8).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { useBrand } from '@/context/BrandContext';
import { Drawer, ConfirmModal, Modal } from '@/components/ui/Modal';
import { Button, Field, Select, Divider } from '@/components/ui/primitives';
import { Badge, SimHealthBadge, SimStatusBadge, VehicleStatusBadge } from '@/components/ui/Badge';
import { Bars } from '@/components/charts/Charts';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { DetailRow, UsageBar } from './SimBits';
import { SIM_PLANS } from '@/lib/simPlans';
import { formatDateTime, formatMoney, relativeTime, titleCase } from '@/lib/format';
import type { SimAction } from '@/data/api';

interface PendingAction {
  action: SimAction;
  title: string;
  message: string;
  requireReason: boolean;
  danger?: boolean;
  confirmLabel: string;
}

const ACTIONS: Record<Exclude<SimAction, 'set_plan'>, PendingAction> = {
  activate: {
    action: 'activate',
    title: 'Activate SIM',
    message: 'Activates the SIM with the provider. Billing for the plan starts on the next cycle.',
    requireReason: false,
    confirmLabel: 'Activate',
  },
  resume: {
    action: 'resume',
    title: 'Resume SIM',
    message: 'Lifts the suspension — the device can attach and receive SMS-fallback commands again.',
    requireReason: false,
    confirmLabel: 'Resume',
  },
  suspend: {
    action: 'suspend',
    title: 'Suspend SIM',
    message: 'The device will lose data and SMS. Any command that needs the SMS fallback (docs/03) will fail until it is resumed.',
    requireReason: true,
    danger: true,
    confirmLabel: 'Suspend',
  },
  terminate: {
    action: 'terminate',
    title: 'Terminate SIM',
    message: 'Irreversible with the provider. The SIM can never be reactivated — recover it from the device first.',
    requireReason: true,
    danger: true,
    confirmLabel: 'Terminate',
  },
};

const DONE_LABEL: Record<SimAction, string> = {
  activate: 'activated',
  resume: 'resumed',
  suspend: 'suspended',
  terminate: 'terminated',
  set_plan: 'plan changed',
};

export function SimDetailDrawer({ simId, onClose }: { simId: string | null; onClose: () => void }) {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { colors } = useBrand();

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState<string>('');

  const detail = useQuery({
    queryKey: ['sim-detail', simId],
    queryFn: () => ds.getSimDetail(simId!),
    enabled: Boolean(simId),
  });

  const command = useMutation({
    mutationFn: (input: { action: SimAction; reason: string; plan?: string }) =>
      ds.simCommand({ sim_id: simId!, action: input.action, reason: input.reason, plan: input.plan }),
    onSuccess: (_r, v) => {
      toast.push(`SIM ${DONE_LABEL[v.action]} (audited)`, 'success');
      qc.invalidateQueries({ queryKey: ['sim-detail', simId] });
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['sim-alerts'] });
      qc.invalidateQueries({ queryKey: ['sim-cost'] });
      setPending(null);
      setPlanOpen(false);
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : 'Command failed', 'error'),
  });

  const sim = detail.data?.sim;
  const usage = detail.data?.usage ?? [];

  const chartData = useMemo(
    () =>
      usage.map((u) => ({
        day: u.day.slice(5), // MM-DD
        data_mb: +u.data_mb.toFixed(2),
        sms: u.sms_out + u.sms_in,
      })),
    [usage],
  );

  const totals = useMemo(
    () => ({
      mb: usage.reduce((s, u) => s + u.data_mb, 0),
      sms: usage.reduce((s, u) => s + u.sms_out + u.sms_in, 0),
      cost: usage.reduce((s, u) => s + u.cost_cents, 0),
    }),
    [usage],
  );

  const canManage = can('settings.edit') || can('vehicles.status');

  return (
    <>
      <Drawer
        open={Boolean(simId)}
        onClose={onClose}
        title={sim ? <span className="mono" style={{ fontSize: 15 }}>{sim.iccid}</span> : 'SIM'}
        footer={
          sim ? (
            <div className="toolbar" style={{ width: '100%' }}>
              {sim.status !== 'active' && sim.status !== 'terminated' ? (
                <Button
                  disabled={!canManage || command.isPending}
                  onClick={() => setPending(ACTIONS[sim.status === 'suspended' ? 'resume' : 'activate'])}
                >
                  {sim.status === 'suspended' ? 'Resume' : 'Activate'}
                </Button>
              ) : null}
              {sim.status === 'active' || sim.status === 'test' ? (
                <Button disabled={!canManage || command.isPending} onClick={() => setPending(ACTIONS.suspend)}>Suspend</Button>
              ) : null}
              <Button
                disabled={!canManage || command.isPending || sim.status === 'terminated'}
                onClick={() => { setPlan(sim.plan_name); setPlanOpen(true); }}
              >
                Change plan
              </Button>
              <div className="topbar-spacer" style={{ flex: 1 }} />
              <Button
                variant="danger"
                disabled={!canManage || command.isPending || sim.status === 'terminated'}
                onClick={() => setPending(ACTIONS.terminate)}
              >
                Terminate
              </Button>
            </div>
          ) : null
        }
      >
        {detail.isLoading ? (
          <div className="stack" style={{ gap: 10 }}>
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={14} />)}
          </div>
        ) : detail.error ? (
          <ErrorState message={detail.error instanceof Error ? detail.error.message : String(detail.error)} />
        ) : !sim ? (
          <EmptyState emoji="🔍" title="SIM not found" hint="It may have been removed by a provider sync." />
        ) : (
          <div className="stack" style={{ gap: 'var(--space-md)' }}>
            <div className="toolbar">
              <SimStatusBadge status={sim.status} />
              <SimHealthBadge health={sim.health} />
              <Badge tone="neutral" dot={false}>{sim.provider}</Badge>
            </div>

            <section>
              <div className="section-label">Identity</div>
              {/* Stored exactly as the provider issued them — never reformatted. */}
              <DetailRow label="ICCID"><span className="mono">{sim.iccid}</span></DetailRow>
              <DetailRow label="IMSI"><span className="mono">{sim.imsi}</span></DetailRow>
              <DetailRow label="MSISDN"><span className="mono">{sim.msisdn}</span></DetailRow>
              <DetailRow label="Provider SIM id"><span className="mono">{sim.provider_sim_id}</span></DetailRow>
              <DetailRow label="Label">{sim.label}</DetailRow>
            </section>

            <Divider />

            <section>
              <div className="section-label">Plan &amp; billing cycle</div>
              <DetailRow label="Plan">{sim.plan_name} · {sim.plan_data_mb} MB</DetailRow>
              <DetailRow label="Cycle"><span className="mono">{sim.cycle_start} → {sim.cycle_end}</span></DetailRow>
              <DetailRow label="Data used">
                <UsageBar usedMb={sim.data_used_mb_cycle} limitMb={sim.plan_data_mb} pct={sim.data_pct_used} />
              </DetailRow>
              <DetailRow label="Plan price">{formatMoney(sim.monthly_cost_cents)} / month</DetailRow>
              <DetailRow label="Cost MTD"><b>{formatMoney(sim.cost_mtd_cents)}</b></DetailRow>
            </section>

            <Divider />

            <section>
              <div className="section-label">Network</div>
              <DetailRow label="Last attach">
                {sim.last_seen_at ? (
                  <>
                    {relativeTime(sim.last_seen_at)}
                    <div className="muted" style={{ fontSize: 11 }}>{formatDateTime(sim.last_seen_at)}</div>
                  </>
                ) : '—'}
              </DetailRow>
              <DetailRow label="Network">{sim.network ?? '—'}{sim.country ? ` · ${sim.country}` : ''}</DetailRow>
              <DetailRow label="Days since seen">{sim.days_since_seen ?? '—'}</DetailRow>
            </section>

            <Divider />

            <section>
              <div className="section-label">Linked device &amp; vehicle</div>
              <DetailRow label="Device IMEI"><span className="mono">{sim.device_imei ?? '— not linked'}</span></DetailRow>
              <DetailRow label="Vehicle">
                {sim.vehicle_id ? (
                  <Link to={`/vehicles/${sim.vehicle_id}`} className="mono" style={{ color: colors.primary }}>
                    {sim.vehicle_code}
                  </Link>
                ) : '—'}
              </DetailRow>
              {sim.vehicle_status ? (
                <DetailRow label="Vehicle status"><VehicleStatusBadge status={sim.vehicle_status} /></DetailRow>
              ) : null}
            </section>

            <Divider />

            <section>
              <div className="section-label">Last 30 days</div>
              {chartData.length === 0 ? (
                <EmptyState emoji="📉" title="No usage recorded" hint="This SIM has never attached to a network." />
              ) : (
                <>
                  <Bars
                    data={chartData}
                    xKey="day"
                    height={200}
                    series={[{ key: 'data_mb', name: 'MB/day', color: colors.primary }]}
                  />
                  <div className="row-wrap" style={{ fontSize: 12, marginTop: 6 }}>
                    <span className="muted">30-day data <b>{totals.mb.toFixed(1)} MB</b></span>
                    <span className="muted">SMS <b>{totals.sms}</b></span>
                    <span className="muted">Cost <b>{formatMoney(totals.cost)}</b></span>
                  </div>
                </>
              )}
            </section>

            <Divider />

            <section>
              <div className="section-label">Event history</div>
              {detail.data && detail.data.events.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>No lifecycle events yet.</div>
              ) : (
                <div className="timeline">
                  {detail.data?.events.map((e, i) => (
                    <div key={`${e.at}-${i}`} className="timeline-item">
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{titleCase(e.kind)}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{e.detail}</div>
                      {e.reason ? <div className="quote" style={{ fontSize: 12 }}>{e.reason}</div> : null}
                      <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
                        {formatDateTime(e.at)}{e.staff_id ? ` · ${e.staff_id}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {!canManage ? (
              <div className="muted" style={{ fontSize: 12 }}>Your role cannot change SIM lifecycle state.</div>
            ) : null}
          </div>
        )}
      </Drawer>

      <ConfirmModal
        open={pending !== null}
        onClose={() => setPending(null)}
        busy={command.isPending}
        onConfirm={(reason) => { if (pending) command.mutate({ action: pending.action, reason }); }}
        title={pending?.title ?? ''}
        message={pending?.message}
        requireReason={pending?.requireReason}
        danger={pending?.danger}
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
      />

      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Change data plan"
        footer={
          <>
            <Button onClick={() => setPlanOpen(false)} disabled={command.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={command.isPending || !plan || plan === sim?.plan_name}
              onClick={() => command.mutate({ action: 'set_plan', reason: `Plan change to ${plan}`, plan })}
            >
              {command.isPending ? 'Working…' : 'Change plan'}
            </Button>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Takes effect with the provider on the next billing cycle. Recorded in the audit log.
        </p>
        <Field label="Plan" required>
          <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
            {SIM_PLANS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} — {p.data_mb} MB · {formatMoney(p.cost_cents)}/mo
              </option>
            ))}
          </Select>
        </Field>
      </Modal>
    </>
  );
}
