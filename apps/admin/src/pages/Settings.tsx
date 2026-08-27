import { useState } from 'react';
import { Card, CardHeader } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { BrandingEditor } from '@/components/branding/BrandingEditor';
import { useBrand } from '@/context/BrandContext';
import { STATUS_KEYS } from '@/lib/theme';
import { titleCase } from '@/lib/format';
import { Preferences } from '@/components/settings/Preferences';
import { NotificationRules } from '@/components/settings/NotificationRules';
import { Translations } from '@/components/settings/Translations';
import { AppContent } from '@/components/settings/AppContent';
import { FleetModels } from '@/components/settings/FleetModels';
import { CustomerForm } from '@/components/settings/CustomerForm';
import { ReactionTest } from '@/components/settings/ReactionTest';

/**
 * Settings.
 *
 * Every control on this page either writes to the backend and reports what the
 * server actually said, or states that it cannot. There is no third state:
 * a green "saved" toast over a no-op is worse than no button, because the
 * operator stops checking.
 *
 * Where each section lives:
 *   Preferences          → app_config, via the `admin-app-config` edge fn
 *   Notification rules   → notification_rules, via `admin-list`/`admin-write`
 *   Localization         → translations (pk lang+ns+key), same pair
 *   Tutorials & content  → app_content (pk key+lang), same pair
 *   Customer form        → customer_forms, versioned (one active form)
 *   Reaction test        → app_config, via the same edge fn as Preferences
 *   Models & curves      → read-only; no write path exists
 *   Branding             → app_config.brand, via the Branding editor
 *   Map icons            → resolved from the active brand; read-only by design
 */
export function SettingsPage() {
  const [tab, setTab] = useState('prefs');

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title="Settings"
        sub="Operational preferences, notification rules, localization, tutorials and branding"
      />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'prefs', label: 'Preferences' },
          { key: 'notifications', label: 'Alerts & notifications' },
          { key: 'i18n', label: 'Localization' },
          { key: 'tutorials', label: 'Tutorials & content' },
          { key: 'models', label: 'Models & battery curves' },
          { key: 'branding', label: 'Branding' },
          { key: 'personalization', label: 'Map icons' },
          { key: 'form', label: 'Customer form' },
          { key: 'reaction', label: 'Reaction test' },
        ]}
      />

      {tab === 'prefs' ? <Preferences /> : null}
      {tab === 'notifications' ? <NotificationRules /> : null}
      {tab === 'i18n' ? <Translations /> : null}
      {tab === 'tutorials' ? <AppContent /> : null}
      {tab === 'models' ? <FleetModels /> : null}
      {tab === 'branding' ? <BrandingEditor /> : null}
      {tab === 'personalization' ? <Personalization /> : null}
      {tab === 'form' ? <CustomerForm /> : null}
      {tab === 'reaction' ? <ReactionTest /> : null}
    </div>
  );
}


function Personalization() {
  // Vehicle status colours are brand tokens — edit them in Settings → Branding,
  // which writes app_config.brand. This tab only shows what the active brand
  // resolves to, so there is nothing here to save.
  const { brand, mode, statusColor } = useBrand();
  return (
    <Card>
      <CardHeader
        title="Map icons & personalization"
        sub={`Resolved from the “${brand.name}” brand · ${mode} mode · change them in the Branding tab`}
      />
      <div className="card-pad row-wrap">
        {STATUS_KEYS.map((s) => (
          <div key={s} className="card" style={{ padding: 12, minWidth: 160, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: statusColor(s) }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{titleCase(s)}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>{statusColor(s)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

