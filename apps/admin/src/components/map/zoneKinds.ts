// The ten `zone_kind` enum values, grouped and explained for the picker.
//
// The panel used to offer a subset, so an operator could not create the kinds
// the trip engine actually reads (docs/04). All ten are here; the grouping and
// the one-liners come from what each kind does at trip start/end, so the
// picker is self-documenting rather than a bare enum dump.
import type { ZoneKind } from '@penny/db-types';

export interface ZoneKindGroup {
  label: string;
  kinds: ZoneKind[];
}

export const ZONE_KIND_GROUPS: ZoneKindGroup[] = [
  { label: 'Coverage', kinds: ['operating'] },
  { label: 'Parking', kinds: ['parking', 'paid_parking', 'parking_station', 'no_parking'] },
  { label: 'Restrictions', kinds: ['no_go', 'speed_limit'] },
  { label: 'Incentives', kinds: ['bonus'] },
  { label: 'Operations', kinds: ['charging_station', 'rebalancing'] },
];

/** Flat list in group order — legend, colour keys, bulk iteration. */
export const ALL_ZONE_KINDS: ZoneKind[] = ZONE_KIND_GROUPS.flatMap((g) => g.kinds);

export const ZONE_KIND_HELP: Record<ZoneKind, string> = {
  operating: 'The service area. A trip can only end inside one.',
  parking: 'Parking is allowed here.',
  paid_parking: 'Parking allowed, with a fee added at trip end.',
  parking_station: 'A fixed station. In station-mode cities a trip must end inside one.',
  no_parking: 'A trip cannot end here.',
  no_go: 'Riding here alerts the rider and flags the trip.',
  speed_limit: 'Advisory speed cap shown to the rider (the device cannot enforce it).',
  bonus: 'Ending here credits the rider.',
  charging_station: 'Where crews swap or charge batteries.',
  rebalancing: 'Target area for rebalancing tasks.',
};
