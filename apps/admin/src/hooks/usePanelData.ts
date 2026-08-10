import { useQuery } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import type { PanelData } from '@/data/panelData';

/** Loads the bulk read-model used by the config-heavy pages
 * (pricing, marketing, fleet, finance, team, settings, analytics). */
export function usePanelData() {
  const ds = useDS();
  return useQuery<PanelData>({ queryKey: ['panel-data'], queryFn: () => ds.getPanelData() });
}
