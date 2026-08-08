// Data-plan catalogue offered by the connectivity provider.
//
// Lives in lib/ (not data/mock/) so the SIM UI can offer plans without pulling
// the mock generator into the production bundle. When the provider adapter
// exposes a live tariff list this becomes a fetch — the shape stays.
export interface SimPlan {
  name: string;
  data_mb: number;
  cost_cents: number;
}

export const SIM_PLANS: SimPlan[] = [
  { name: 'IoT 50MB Test', data_mb: 50, cost_cents: 40 },
  { name: 'IoT 250MB', data_mb: 250, cost_cents: 85 },
  { name: 'IoT 500MB', data_mb: 500, cost_cents: 120 },
  { name: 'IoT 1GB', data_mb: 1024, cost_cents: 190 },
];

/** Overage above the plan allowance, billed per started MB. */
export const OVERAGE_CENTS_PER_MB = 4;
