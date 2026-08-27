// Per-task-kind checklist templates. Each item may require a before and/or
// after photo. `ops_tasks.checklist` (jsonb) is seeded from these; completion
// enforces required photos before a task can be marked done.
import { OpsTaskKind, type OpsTaskKind as Kind } from '@penny/db-types';

export interface ChecklistTemplateItem {
  key: string;
  label: string;
  /** Requires a photo taken BEFORE the work. */
  requiresBeforePhoto: boolean;
  /** Requires a photo taken AFTER the work. */
  requiresAfterPhoto: boolean;
}

const K = OpsTaskKind;

export const CHECKLISTS: Record<Kind, ChecklistTemplateItem[]> = {
  [K.battery_swap]: [
    { key: 'locate', label: 'Locate & unlock vehicle', requiresBeforePhoto: false, requiresAfterPhoto: false },
    { key: 'voltage_before', label: 'Read battery voltage (before)', requiresBeforePhoto: true, requiresAfterPhoto: false },
    { key: 'swap', label: 'Swap battery pack', requiresBeforePhoto: false, requiresAfterPhoto: false },
    { key: 'voltage_after', label: 'Read battery voltage (after)', requiresBeforePhoto: false, requiresAfterPhoto: true },
    { key: 'secure', label: 'Secure hatch & lock', requiresBeforePhoto: false, requiresAfterPhoto: true },
  ],
  [K.rebalance]: [
    { key: 'pickup', label: 'Pick up at origin', requiresBeforePhoto: true, requiresAfterPhoto: false },
    { key: 'transport', label: 'Transport to target zone', requiresBeforePhoto: false, requiresAfterPhoto: false },
    { key: 'drop', label: 'Drop in target zone (parked legally)', requiresBeforePhoto: false, requiresAfterPhoto: true },
  ],
  [K.pickup]: [
    { key: 'condition', label: 'Photograph condition before pickup', requiresBeforePhoto: true, requiresAfterPhoto: false },
    { key: 'load', label: 'Load onto van', requiresBeforePhoto: false, requiresAfterPhoto: true },
  ],
  [K.repair]: [
    { key: 'diagnose', label: 'Diagnose fault (photo the issue)', requiresBeforePhoto: true, requiresAfterPhoto: false },
    { key: 'fix', label: 'Perform repair', requiresBeforePhoto: false, requiresAfterPhoto: false },
    { key: 'verify', label: 'Verify fixed (photo result)', requiresBeforePhoto: false, requiresAfterPhoto: true },
  ],
  [K.inspect]: [
    { key: 'exterior', label: 'Inspect exterior (photo)', requiresBeforePhoto: true, requiresAfterPhoto: false },
    { key: 'brakes', label: 'Test brakes & throttle', requiresBeforePhoto: false, requiresAfterPhoto: false },
    { key: 'lights', label: 'Test lights & horn', requiresBeforePhoto: false, requiresAfterPhoto: false },
    { key: 'result', label: 'Record inspection result', requiresBeforePhoto: false, requiresAfterPhoto: true },
  ],
  [K.deploy]: [
    { key: 'place', label: 'Place vehicle at deploy point', requiresBeforePhoto: false, requiresAfterPhoto: false },
    { key: 'confirm', label: 'Confirm parked legally (photo)', requiresBeforePhoto: false, requiresAfterPhoto: true },
  ],
};

export interface ChecklistState {
  key: string;
  label: string;
  requiresBeforePhoto: boolean;
  requiresAfterPhoto: boolean;
  done: boolean;
  beforePhoto?: string;
  afterPhoto?: string;
}

export function buildChecklist(kind: Kind): ChecklistState[] {
  return (CHECKLISTS[kind] ?? []).map((t) => ({ ...t, done: false }));
}

/** True when every item is done and all required photos are attached. */
export function checklistComplete(items: ChecklistState[]): boolean {
  return items.every(
    (i) =>
      i.done &&
      (!i.requiresBeforePhoto || !!i.beforePhoto) &&
      (!i.requiresAfterPhoto || !!i.afterPhoto),
  );
}

/** Human summary of what still blocks completion. */
export function checklistBlockers(items: ChecklistState[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (!i.done) out.push(`"${i.label}" not checked`);
    else if (i.requiresBeforePhoto && !i.beforePhoto) out.push(`"${i.label}" needs before-photo`);
    else if (i.requiresAfterPhoto && !i.afterPhoto) out.push(`"${i.label}" needs after-photo`);
  }
  return out;
}

/** battery_swap tasks prompt for voltage before/after. */
export function isBatterySwap(kind: Kind): boolean {
  return kind === K.battery_swap;
}

// --- Damage parts -----------------------------------------------------------
// The component a damage report is filed against (`damage_reports.part`).
// Kept as a plain string list, not an enum or a DB type: migration 00370 made
// the column free text on purpose so an operator can extend the catalogue
// without a migration. Order is the order the chips render in — most-picked
// first, "Other" last as the escape hatch.
export const DAMAGE_PARTS: readonly string[] = [
  'Front bumper',
  'Rear wheel',
  'Front wheel',
  'Motor',
  'Lights',
  'Control panel',
  'Lose/worn parts',
  'Vandalism',
  'Frame',
  'Pedals',
  'Saddle',
  'Gears/transmission',
  'Chain',
  'Suspension',
  'Ignition',
  'Electrical system',
  'Controllers',
  'Firmware',
  'Charger',
  'Mirror',
  'Footrest',
  'Other',
];
