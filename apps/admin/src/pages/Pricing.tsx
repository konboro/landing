// Pricing — the five catalogues an operator actually edits, plus the dynamic
// preview computed from them.
//
// Reads come from the one `panel-data` payload the whole config side of the panel
// already loads, so every tab renders the same rows the rest of the app sees.
// Writes go through `admin-write` (permission `pricing.edit`, column allowlist,
// audit entry per change) and simply invalidate that query on success — no local
// mirror of the catalogue to drift out of step with the server.

import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { useAuth, type Permission } from '@/context/AuthContext';
import { Card } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState, TableSkeleton } from '@/components/ui/feedback';
import { Notice } from '@/components/pricing/EditorModal';
import { PlansTab } from '@/components/pricing/PlansTab';
import { DynamicTab } from '@/components/pricing/DynamicTab';
import { PackagesTab } from '@/components/pricing/PackagesTab';
import { SubscriptionsTab } from '@/components/pricing/SubscriptionsTab';
import { AddonsTab } from '@/components/pricing/AddonsTab';
import { PenaltiesTab } from '@/components/pricing/PenaltiesTab';

// Server-side grant (migration 00160) that the panel's Permission union does not
// list yet; see the note in components/pricing/useCatalogue.ts.
const PRICING_EDIT = 'pricing.edit' as unknown as Permission;

const TABS = [
  { key: 'plans', label: 'Plans' },
  { key: 'dynamic', label: 'Dynamic pricing' },
  { key: 'packages', label: 'Packages' },
  { key: 'subs', label: 'Subscriptions' },
  { key: 'addons', label: 'Add-ons' },
  { key: 'penalties', label: 'Penalties' },
];

export function PricingPage() {
  const { data: db, isLoading, isError, error } = usePanelData();
  const { can } = useAuth();
  const [tab, setTab] = useState('plans');

  const cityName = (id: string) => db?.cities.find((c) => c.id === id)?.name ?? id;
  const modelName = (id: string) => db?.models.find((m) => m.id === id)?.name ?? id;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Pricing" sub="Plans, dynamic pricing, packages, subscriptions, add-ons, penalties" />

      {!can(PRICING_EDIT) ? (
        <Notice tone="muted" title="Read-only">
          You can see every catalogue here but not change one — that needs the <code className="mono">pricing.edit</code> permission.
        </Notice>
      ) : null}

      <Tabs active={tab} onChange={setTab} tabs={TABS} />

      {isError ? (
        <Card><ErrorState message={error instanceof Error ? error.message : 'Could not load the pricing catalogues.'} /></Card>
      ) : isLoading || !db ? (
        <Card><TableSkeleton rows={6} cols={7} /></Card>
      ) : (
        <>
          {tab === 'plans' ? <PlansTab plans={db.pricingPlans} cityName={cityName} modelName={modelName} /> : null}
          {tab === 'dynamic' ? <DynamicTab plans={db.pricingPlans} cityName={cityName} modelName={modelName} /> : null}
          {tab === 'packages' ? <PackagesTab rows={db.packages} /> : null}
          {tab === 'subs' ? <SubscriptionsTab rows={db.subscriptions} /> : null}
          {tab === 'addons' ? <AddonsTab rows={db.addons} /> : null}
          {tab === 'penalties' ? <PenaltiesTab rows={db.penalties} /> : null}
        </>
      )}
    </div>
  );
}
