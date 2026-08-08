// Ops theme — utilitarian, high-contrast, glove-friendly. Extends the shared
// @penny/ui tokens (single source of truth) with ops-only surfaces + big touch
// sizes tuned for outdoor use.
import {
  palette,
  colors as base,
  space,
  radius,
  font,
  vehicleStatusColor as baseStatusColor,
} from '@penny/ui';
import type { VehicleStatus } from '@penny/db-types';

export { palette, space, radius, font };

// Dark, high-contrast ops chrome. Field techs use this in daylight glare and at
// night, so we lean on strong contrast rather than the rider app's light theme.
export const c = {
  ...base,
  bg: palette.ink900,
  surface: palette.ink800,
  surfaceAlt: palette.ink700,
  border: palette.ink600,
  text: palette.white,
  textMuted: palette.ink300,
  textFaint: palette.ink400,
  primary: palette.blue400,
  primaryDeep: palette.blue600,
  onPrimary: palette.white,
  success: palette.green400,
  warning: palette.amber500,
  danger: palette.red400,
} as const;

// Glove-friendly hit targets.
export const tap = {
  min: 52, // minimum tappable dimension
  row: 64,
  fab: 64,
} as const;

// Extra ops-only status semantics not in the base map.
export const statusColor: Record<string, string> = {
  ...baseStatusColor,
  stolen: palette.red500,
  low_battery: palette.amber500,
  offline: palette.ink400,
  transport: '#8a5cf6',
};

export function colorForStatus(status: VehicleStatus | string): string {
  return statusColor[status] ?? palette.ink400;
}

export interface LegendItem {
  status: string;
  label: string;
  color: string;
}

export const STATUS_LEGEND: LegendItem[] = [
  { status: 'available', label: 'Available', color: statusColor.available! },
  { status: 'in_trip', label: 'In trip', color: statusColor.in_trip! },
  { status: 'reserved', label: 'Reserved', color: statusColor.reserved! },
  { status: 'low_battery', label: 'Low battery', color: statusColor.low_battery! },
  { status: 'maintenance', label: 'Maintenance', color: statusColor.maintenance! },
  { status: 'transport', label: 'Transport', color: statusColor.transport! },
  { status: 'offline', label: 'Offline', color: statusColor.offline! },
  { status: 'stolen', label: 'Stolen-suspect', color: statusColor.stolen! },
  { status: 'decommissioned', label: 'Decommissioned', color: statusColor.decommissioned! },
];
