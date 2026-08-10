import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, Field, Input, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/feedback';
import { useBrand } from '@/context/BrandContext';
import { configMap, useAppConfig, useInvalidateAppConfig, writeAppConfigKeys } from './appConfig';

/* --------------------------------------------------------------------------
   Reaction test — the night anti-DUI gate (docs/04, docs/06 §10).

   Two `app_config` keys, both new:
     reaction_test_required : bool
     reaction_test          : { rounds, max_ms, valid_min }

   `reaction_tests` is the RESULTS log (user, trip, passed, score) and is not
   touched here — writing settings into it would corrupt the record of who
   passed what.

   Neither key exists in app_config until someone saves. That state is shown as
   "not configured", NOT as the suggested numbers below dressed up as stored
   settings: an operator must be able to tell what the fleet is actually running
   on from what this form happens to have pre-filled.
   -------------------------------------------------------------------------- */

interface TestConfig { rounds: number; max_ms: number; valid_min: number }

/** Starting point for a form that has never been saved. docs/04 quotes the
 *  30-minute validity; the rest are a sane opening bid, not a stored value. */
const SUGGESTED: TestConfig = { rounds: 3, max_ms: 900, valid_min: 30 };

const FIELDS: Array<{ key: keyof TestConfig; label: string; unit: string; min: number; max: number; help: string }> = [
  { key: 'rounds', label: 'Rounds to pass', unit: 'rounds', min: 1, max: 10, help: 'How many taps the rider has to get right in a row.' },
  { key: 'max_ms', label: 'Slowest acceptable reaction', unit: 'ms', min: 100, max: 5000, help: 'A tap slower than this counts as a miss.' },
  { key: 'valid_min', label: 'A pass stays valid for', unit: 'min', min: 1, max: 240, help: 'After this the rider is asked again on the next unlock.' },
];

function readConfig(v: unknown): TestConfig | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  return {
    rounds: num(o.rounds, SUGGESTED.rounds),
    max_ms: num(o.max_ms, SUGGESTED.max_ms),
    valid_min: num(o.valid_min, SUGGESTED.valid_min),
  };
}

function readWindow(v: unknown): { from: string; to: string } | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as { from?: unknown; to?: unknown };
  const from = typeof o.from === 'string' ? o.from : '';
  const to = typeof o.to === 'string' ? o.to : '';
  return from || to ? { from, to } : null;
}

export function ReactionTest() {
  const { can } = useAuth();
  const editable = can('settings.edit');
  const toast = useToast();
  const { colors } = useBrand();
  const invalidate = useInvalidateAppConfig();

  const { data, isLoading, error } = useAppConfig();
  const server = useMemo(() => configMap(data), [data]);

  const storedRequired = server.has('reaction_test_required') ? server.get('reaction_test_required') === true : null;
  const storedConfig = server.has('reaction_test') ? readConfig(server.get('reaction_test')) : null;
  const configured = storedRequired !== null || storedConfig !== null;
  const night = readWindow(server.get('night_hours'));

  const [draftRequired, setDraftRequired] = useState<boolean | null>(null);
  const [draftConfig, setDraftConfig] = useState<TestConfig | null>(null);
  const [reason, setReason] = useState('');

  const required = draftRequired ?? storedRequired ?? false;
  const config = draftConfig ?? storedConfig ?? SUGGESTED;

  // A key is dirty when the operator has touched it AND it differs from what is
  // stored — with "nothing stored" counting as a difference, so the first save
  // of an unconfigured key is never skipped as a no-op.
  const dirty: Array<{ key: string; value: unknown }> = [];
  if (draftRequired !== null && draftRequired !== storedRequired) {
    dirty.push({ key: 'reaction_test_required', value: draftRequired });
  }
  if (draftConfig !== null && JSON.stringify(draftConfig) !== JSON.stringify(storedConfig)) {
    dirty.push({ key: 'reaction_test', value: draftConfig });
  }

  const setField = (key: keyof TestConfig, value: number) =>
    setDraftConfig({ ...config, [key]: value });

  const save = useMutation({
    mutationFn: () => writeAppConfigKeys(dirty, reason),
    onSuccess: ({ ok, failed }) => {
      if (ok.includes('reaction_test_required')) setDraftRequired(null);
      if (ok.includes('reaction_test')) setDraftConfig(null);
      if (ok.length) {
        toast.push(`Reaction test saved — recorded in the audit log`, 'success');
        setReason('');
      }
      for (const f of failed) toast.push(`${f.key}: ${f.message}`, 'error');
      invalidate();
    },
    onError: () => toast.push('Could not save the reaction test settings.', 'error'),
  });

  if (error) return <ErrorState message={error instanceof Error ? error.message : 'Could not load app_config.'} />;
  if (isLoading) return <Card pad>Loading…</Card>;

  const reasonTooShort = reason.trim().length < 3;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader
          title="Reaction test (night anti-DUI gate)"
          sub="A tap test before a night unlock. Results are logged to reaction_tests; this is the configuration behind it."
          actions={configured ? <Badge tone="success">Configured</Badge> : <Badge tone="warning">Not configured</Badge>}
        />
        <div className="card-pad stack" style={{ gap: 'var(--space-lg)' }}>
          {!configured ? (
            <div className="banner" style={{ borderColor: `${colors.warning}55`, background: `${colors.warning}12` }}>
              <div className="banner-bar" style={{ background: colors.warning }} />
              <div>
                <div style={{ fontWeight: 600 }}>Nothing is stored yet</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Neither <code>reaction_test_required</code> nor <code>reaction_test</code> exists in <code>app_config</code>.
                  The values below are a suggested starting point, not what the fleet is running on — nothing takes effect
                  until you save.
                </div>
              </div>
            </div>
          ) : null}

          {!editable ? (
            <span className="muted">Your role can read these settings but not change them (needs <code>settings.edit</code>).</span>
          ) : null}

          <div>
            <Checkbox
              label="Require the reaction test during night hours"
              checked={required}
              disabled={!editable}
              onChange={(e) => setDraftRequired(e.target.checked)}
            />
            <div className="muted" style={{ fontSize: 12, marginLeft: 26 }}>
              Stored as <code>reaction_test_required</code>. The trip-start check reads it together with the night window.
              {storedRequired === null ? <> Not stored yet.</> : null}
            </div>
          </div>

          <div>
            <div className="section-label">Night window</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {night
                ? <>The gate applies between <b>{night.from || '—'}</b> and <b>{night.to || '—'}</b>. Change it under Preferences → Night window — it is the same <code>night_hours</code> key the other night rules use.</>
                : <><code>night_hours</code> is not set, so there is no window for this gate to apply in. Set it under Preferences first.</>}
            </div>
          </div>

          <div className="row-wrap" style={{ gap: 'var(--space-lg)' }}>
            {FIELDS.map((f) => (
              <div key={f.key} style={{ minWidth: 230 }}>
                <div className="between" style={{ alignItems: 'baseline', marginBottom: 4 }}>
                  <label className="field-label" style={{ marginBottom: 0 }}>{f.label}</label>
                  <span className="mono muted" style={{ fontSize: 11 }}>{f.key}</span>
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <Input
                    type="number" style={{ width: 130 }} min={f.min} max={f.max}
                    value={String(config[f.key])}
                    disabled={!editable}
                    onChange={(e) => setField(f.key, Number(e.target.value))}
                  />
                  <span className="muted" style={{ fontSize: 13 }}>{f.unit}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{f.help}</div>
              </div>
            ))}
          </div>
          {!storedConfig ? (
            <div className="muted" style={{ fontSize: 12 }}>
              The three numbers above are saved together as one <code>reaction_test</code> object.
            </div>
          ) : null}
        </div>
      </Card>

      {editable ? (
        <Card>
          <CardHeader
            title="Save"
            sub={dirty.length ? `${dirty.length} change(s) pending: ${dirty.map((d) => d.key).join(', ')}` : 'Nothing changed yet'}
          />
          <div className="card-pad stack" style={{ gap: 'var(--space-md)', maxWidth: 620 }}>
            <Field label="Reason" required hint="Stored with the before/after values in the audit log. Required by the server.">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. turning the night gate on for the summer season"
              />
            </Field>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <Button
                variant="primary"
                disabled={!dirty.length || reasonTooShort || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save reaction test'}
              </Button>
              {dirty.length ? (
                <Button
                  variant="ghost" disabled={save.isPending}
                  onClick={() => { setDraftRequired(null); setDraftConfig(null); }}
                >
                  Discard
                </Button>
              ) : null}
              {dirty.length && reasonTooShort ? <span className="muted" style={{ fontSize: 13 }}>A reason is required.</span> : null}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
