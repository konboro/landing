// Vehicle status transition matrix (docs/07 "Status management").
// Enforced client-side for UX; the edge function re-validates on sync
// (server wins on vehicle status — conflict rule). Every applied change writes
// a vehicle_status_log row with optional/required photos per this table.
import { VehicleStatus, type VehicleStatus as VStatus } from '@penny/db-types';

export type OpsRole = 'ops' | 'ops_manager' | 'admin';

export interface Transition {
  to: VStatus;
  label: string;
  requiresPhoto: boolean;
  requiresChecklist: boolean;
  requiresReason: boolean;
  /** Goes to admin review instead of applying directly (stolen flag). */
  adminReview: boolean;
  /** admin/ops_manager only. */
  adminOnly: boolean;
  /** Side effects applied on sync (documented for the reviewer). */
  sideEffects?: string[];
}

const S = VehicleStatus;

// Base transitions available to the `ops` field role.
const OPS_TRANSITIONS: Record<string, Transition[]> = {
  [S.available]: [
    { to: S.maintenance, label: 'Send to maintenance', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: false },
    { to: S.transport, label: 'Load for transport', requiresPhoto: false, requiresChecklist: false, requiresReason: false, adminReview: false, adminOnly: false },
    { to: S.offline, label: 'Flag offline / investigate', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: false },
    { to: S.stolen, label: 'Flag stolen-suspect', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: true, adminOnly: false, sideEffects: ['sent to admin review', 'no direct status change until admin confirms'] },
  ],
  [S.maintenance]: [
    { to: S.available, label: 'Return to service', requiresPhoto: true, requiresChecklist: true, requiresReason: false, adminReview: false, adminOnly: false, sideEffects: ['checklist must be complete', 'after-photo required'] },
    { to: S.transport, label: 'Load for transport', requiresPhoto: false, requiresChecklist: false, requiresReason: false, adminReview: false, adminOnly: false },
    { to: S.offline, label: 'Flag offline / investigate', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: false },
  ],
  [S.transport]: [
    { to: S.available, label: 'Deploy (available)', requiresPhoto: true, requiresChecklist: false, requiresReason: false, adminReview: false, adminOnly: false },
    { to: S.offline, label: 'Flag offline / investigate', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: false },
  ],
  [S.low_battery]: [
    { to: S.maintenance, label: 'Send to maintenance', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: false },
    { to: S.transport, label: 'Load for transport', requiresPhoto: false, requiresChecklist: false, requiresReason: false, adminReview: false, adminOnly: false },
    { to: S.available, label: 'Return to service', requiresPhoto: true, requiresChecklist: false, requiresReason: false, adminReview: false, adminOnly: false },
  ],
  [S.offline]: [
    { to: S.maintenance, label: 'Send to maintenance', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: false },
    { to: S.available, label: 'Return to service', requiresPhoto: true, requiresChecklist: false, requiresReason: false, adminReview: false, adminOnly: false },
    { to: S.stolen, label: 'Flag stolen-suspect', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: true, adminOnly: false, sideEffects: ['sent to admin review'] },
  ],
  [S.stolen]: [
    { to: S.available, label: 'Recover to service', requiresPhoto: true, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: true },
    { to: S.maintenance, label: 'Recover to maintenance', requiresPhoto: false, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: true },
  ],
};

// Admin can also decommission from any non-decommissioned status.
const ADMIN_EXTRA: Transition[] = [
  { to: S.decommissioned, label: 'Decommission', requiresPhoto: true, requiresChecklist: false, requiresReason: true, adminReview: false, adminOnly: true, sideEffects: ['device unlinked', 'removed from fleet'] },
];

export function allowedTransitions(from: VStatus, role: OpsRole): Transition[] {
  const isAdmin = role === 'admin' || role === 'ops_manager';
  const base = OPS_TRANSITIONS[from] ?? [];
  const list = base.filter((t) => (t.adminOnly ? isAdmin : true));
  if (isAdmin && from !== S.decommissioned) {
    for (const extra of ADMIN_EXTRA) {
      if (!list.some((t) => t.to === extra.to)) list.push(extra);
    }
  }
  return list;
}

export function findTransition(from: VStatus, to: VStatus, role: OpsRole): Transition | undefined {
  return allowedTransitions(from, role).find((t) => t.to === to);
}

// Stolen confirmation side effects (applied by admin on sync) — surfaced in UI.
export const STOLEN_CONFIRM_EFFECTS = [
  'alarm rule armed',
  'visible = false (removed from rider map)',
  'police-report note enabled',
];
