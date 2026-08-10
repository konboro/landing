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
import { Unavailable } from '@/components/settings/Unavailable';

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
 *   Models & curves      → read-only; no write path exists
 *   Branding             → app_config.brand, via the Branding editor
 *   Map icons            → resolved from the active brand; read-only by design
 *   Customer form        → nothing to write to (see below)
 *   Reaction test        → nothing to write to (see below)
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

/* --------------------------------------------------------------------------
   The two sections with nowhere to save to.

   Both used to render a full form with a Save button that pushed "saved" and
   wrote nothing at all. They are disabled rather than deleted so the gap stays
   visible — an operator who is looking for the setting learns why it is not
   there instead of assuming the panel lost it.
   -------------------------------------------------------------------------- */

function CustomerForm() {
  return (
    <Unavailable
      title="Customer form builder"
      sub="Extra questions asked during signup"
      summary={
        <>
          The panel cannot save a signup form yet. The <code>customer_forms</code> table exists (migration 00100:
          <code> id, fields jsonb, active</code>) and is empty, but no edge function is allowed to write it — so any
          form built here would have nowhere to go.
        </>
      }
      covers={[
        'Which extra fields appear after name and e-mail during onboarding (docs/12 §D step 4)',
        'Field type and whether each one is required',
        'The answers shown back on the rider’s profile (docs/06 §7)',
      ]}
      needs={
        <>
          <code>customer_forms</code> added to the <code>admin-write</code> table allowlist (permission
          <code> settings.edit</code>, columns <code>fields</code> + <code>active</code>, soft-delete on <code>active</code>
          because answers reference the form version), plus <code>customer_forms</code> in <code>admin-list</code>’s view
          allowlist so the panel can read it back. No migration needed — only the edge-function whitelists.
        </>
      }
    />
  );
}

function ReactionTest() {
  return (
    <Unavailable
      title="Reaction test (night anti-DUI gate)"
      sub="The tap test riders take before a night unlock"
      summary={
        <>
          There is no config store for this test. <code>reaction_tests</code> is the <em>results</em> log
          (<code>user_id, trip_id, started_at, passed, score</code>) — writing settings into it would corrupt the record of
          who passed what. docs/04 refers to a <code>reaction_test_required</code> flag that does not exist in
          <code> app_config</code> either.
        </>
      }
      covers={[
        'Whether the test is required during the night window at all',
        'Rounds to pass and the maximum acceptable reaction time',
        'How long a pass stays valid before a rider is asked again',
      ]}
      needs={
        <>
          Keys added to <code>admin-app-config</code>’s <code>WRITABLE_KEYS</code> — e.g.
          <code> reaction_test_required</code> (bool), <code>reaction_test</code> (object:
          <code> rounds</code>, <code>max_ms</code>, <code>valid_min</code>) — and the trip-start check reading them.
          The night window itself already exists as <code>night_hours</code> and is editable under Preferences.
        </>
      }
    />
  );
}
