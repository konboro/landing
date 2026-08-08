import { colors, palette } from '@penny/ui';
import type { ZoneKind } from '@penny/db-types';

/** Fill + line colors per zone kind for map rendering. */
export function zoneMapStyle(kind: string): { fill: string; line: string } {
  switch (kind as ZoneKind) {
    case 'operating': return { fill: colors.zoneOperating, line: palette.blue500 };
    case 'parking': return { fill: colors.zoneParking, line: palette.green500 };
    case 'paid_parking': return { fill: colors.zonePaidParking, line: palette.amber500 };
    case 'parking_station': return { fill: 'rgba(47,91,224,0.18)', line: palette.blue600 };
    case 'charging_station': return { fill: 'rgba(63,206,122,0.20)', line: palette.green400 };
    case 'no_parking': return { fill: colors.zoneNoParking, line: palette.red500 };
    case 'bonus': return { fill: colors.zoneBonus, line: palette.green400 };
    case 'speed_limit': return { fill: colors.zoneSpeedLimit, line: palette.amber500 };
    case 'no_go': return { fill: colors.zoneNoGo, line: palette.ink900 };
    case 'rebalancing': return { fill: 'rgba(138,92,246,0.18)', line: '#8a5cf6' };
    default: return { fill: 'rgba(90,103,128,0.15)', line: palette.ink500 };
  }
}

export const ZONE_KINDS: ZoneKind[] = ['operating', 'parking', 'paid_parking', 'parking_station', 'charging_station', 'no_parking', 'bonus', 'speed_limit', 'no_go', 'rebalancing'];
