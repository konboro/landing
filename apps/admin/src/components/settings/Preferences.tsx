import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, Field, Input, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/feedback';
import { edgeMessage } from './edge';
import { configMap, useAppConfig, useInvalidateAppConfig, writeAppConfigKeys } from './appConfig';

/* --------------------------------------------------------------------------
   Operational preferences live in `app_config` (key → jsonb), read and written
   through the shared helpers in ./appConfig.

   The KEYS below mirror `admin-app-config`'s WRITABLE_KEYS allowlist. A key
   that is not on the allowlist is refused with a 400, so rendering an input for
   one would be building a control that cannot save. Any other key found in the
   table is therefore listed read-only instead, with its value, so the operator
   can still see what the fleet is running on.
   -------------------------------------------------------------------------- */

type PrefKind = 'int' | 'ratio' | 'cents' | 'bool' | 'window';

interface PrefSpec {
  key: string;
  label: string;
  help: string;
  kind: PrefKind;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

const GROUPS: Array<{ title: string; sub: string; prefs: PrefSpec[] }> = [
  {
    title: 'Reservations & trip start',
    sub: 'Checked by the trip engine before every unlock (docs/04)',
    prefs: [
      {
        key: 'reservation_ttl_min', label: 'Reservation expires after', kind: 'int', unit: 'min',
        min: 1, max: 120, help: 'A held vehicle is released back to the map after this long.',
      },
      {
        key: 'reserve_free_min', label: 'Free part of a reservation', kind: 'int', unit: 'min',
        min: 0, max: 120, help: 'Minutes of a reservation that are not billed. Must not exceed the TTL above.',
      },
      {
        key: 'min_start_soc', label: 'Minimum battery to start', kind: 'int', unit: '%',
        min: 0, max: 100, help: 'A trip cannot begin on a vehicle below this state of charge.',
      },
      {
        key: 'hold_cents', label: 'Pre-authorisation hold', kind: 'cents',
        min: 0, help: 'Amount held on the card before a trip starts. Released when the ride is charged.',
      },
      {
        key: 'max_telemetry_age_s', label: 'Treat a vehicle as offline after', kind: 'int', unit: 's',
        min: 0, help: 'How stale the last telemetry frame may be before the vehicle stops counting as online for a trip start.',
      },
    ],
  },
  {
    title: 'Parking & zones',
    sub: 'End-of-trip validation',
    prefs: [
      {
        key: 'station_mode', label: 'Station mode', kind: 'bool',
        help: 'When on, a ride may only end inside a parking station zone.',
      },
      {
        key: 'photo_ai_threshold', label: 'Parking photo auto-approval', kind: 'ratio',
        min: 0, max: 1, step: 0.01,
        help: 'Confidence at or above which the parking photo is accepted without a human review. Lower means fewer photos reach the review queue — and more bad parking gets through.',
      },
    ],
  },
  {
    title: 'Night window',
    sub: 'Used by the night rules, including the reaction-test gate',
    prefs: [
      {
        key: 'night_hours', label: 'Night hours', kind: 'window',
        help: 'Local time. Crossing midnight is expected (23:00 → 05:00).',
      },
    ],
  },
];

const SPECS = GROUPS.flatMap((g) => g.prefs);
/** On the same allowlist, but each has its own editor: `brand` is the Branding
 *  tab, the two reaction-test keys are the Reaction test tab. Listing them as
 *  "not editable from the panel" here would be a lie in the other direction. */
const HANDLED_ELSEWHERE = new Set(['brand', 'reaction_test_required', 'reaction_test']);

function readWindow(v: unknown): { from: string; to: string } {
  const o = (v ?? {}) as { from?: unknown; to?: unknown };
  return { from: typeof o.from === 'string' ? o.from : '', to: typeof o.to === 'string' ? o.to : '' };
}

function display(spec: PrefSpec, v: unknown): string {
  if (spec.kind === 'bool') return v ? 'On' : 'Off';
  if (spec.kind === 'window') { const w = readWindow(v); return `${w.from || '—'} → ${w.to || '—'}`; }
  if (spec.kind === 'cents') return `€${(Number(v ?? 0) / 100).toFixed(2)}`;
  return `${String(v ?? '—')}${spec.unit ? ` ${spec.unit}` : ''}`;
}

export function Preferences() {
  const { can } = useAuth();
  const editable = can('settings.edit');
  const toast = useToast();
  const invalidate = useInvalidateAppConfig();

  const { data, isLoading, error } = useAppConfig();
  const server = useMemo(() => configMap(data), [data]);

  // Only the keys the operator actually touched are held here, so a value
  // changed by someone else while this page is open is not silently overwritten
  // by a stale copy of the whole form.
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState('');

  const valueOf = (key: string): unknown => (key in draft ? draft[key] : server.get(key));
  const dirtyKeys = Object.keys(draft).filter(
    (k) => JSON.stringify(draft[k]) !== JSON.stringify(server.get(k)),
  );
  const set = (key: string, v: unknown) => setDraft((d) => ({ ...d, [key]: v }));

  const save = useMutation({
    mutationFn: () => writeAppConfigKeys(dirtyKeys.map((key) => ({ key, value: valueOf(key) })), reason),
    onSuccess: ({ ok, failed }) => {
      // Only what the server confirmed is dropped from the draft; anything it
      // refused stays on screen, still dirty, with the reason it refused.
      setDraft((d) => {
        const next = { ...d };
        for (const k of ok) delete next[k];
        return next;
      });
      if (ok.length) {
        toast.push(`${ok.length} setting${ok.length > 1 ? 's' : ''} saved — recorded in the audit log`, 'success');
        setReason('');
      }
      for (const f of failed) toast.push(`${f.key}: ${f.message}`, 'error');
      invalidate();
    },
    onError: async (e) => toast.push(await edgeMessage(e, 'Could not save the preferences.'), 'error'),
  });

  const unknownKeys = (data ?? [])
    .filter((r) => !SPECS.some((s) => s.key === r.key) && !HANDLED_ELSEWHERE.has(r.key));

  if (error) return <ErrorState message={error instanceof Error ? error.message : 'Could not load app_config.'} />;
  if (isLoading) return <Card pad>Loading preferences…</Card>;

  const reasonTooShort = reason.trim().length < 3;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      {!editable ? (
        <Card pad>
          <span className="muted">Your role can read these settings but not change them (needs <code>settings.edit</code>).</span>
        </Card>
      ) : null}

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader title={group.title} sub={group.sub} />
          <div className="card-pad stack" style={{ gap: 'var(--space-lg)' }}>
            {group.prefs.map((spec) => {
              const missing = !server.has(spec.key);
              const changed = dirtyKeys.includes(spec.key);
              const v = valueOf(spec.key);
              return (
                <div key={spec.key} style={{ maxWidth: 620 }}>
                  <div className="between" style={{ alignItems: 'baseline', marginBottom: 4 }}>
                    <label className="field-label" style={{ marginBottom: 0 }}>{spec.label}</label>
                    <span className="mono muted" style={{ fontSize: 11 }}>{spec.key}</span>
                  </div>

                  {!editable ? (
                    <div style={{ fontWeight: 600 }}>{display(spec, v)}</div>
                  ) : spec.kind === 'bool' ? (
                    <Checkbox
                      label={v ? 'On' : 'Off'}
                      checked={Boolean(v)}
                      onChange={(e) => set(spec.key, e.target.checked)}
                    />
                  ) : spec.kind === 'window' ? (
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <Input
                        type="time" style={{ width: 130 }} value={readWindow(v).from}
                        onChange={(e) => set(spec.key, { ...readWindow(v), from: e.target.value })}
                      />
                      <span className="muted">to</span>
                      <Input
                        type="time" style={{ width: 130 }} value={readWindow(v).to}
                        onChange={(e) => set(spec.key, { ...readWindow(v), to: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <Input
                        type="number" style={{ width: 150 }}
                        min={spec.min} max={spec.max} step={spec.step ?? 1}
                        value={v === undefined || v === null ? '' : String(v)}
                        onChange={(e) => set(spec.key, e.target.value === '' ? null : Number(e.target.value))}
                      />
                      <span className="muted" style={{ fontSize: 13 }}>
                        {spec.kind === 'cents' ? `cents · €${(Number(v ?? 0) / 100).toFixed(2)}` : spec.unit ?? ''}
                      </span>
                      {changed ? <Badge tone="warning">unsaved</Badge> : null}
                    </div>
                  )}

                  {(spec.kind === 'bool' || spec.kind === 'window') && changed
                    ? <div style={{ marginTop: 4 }}><Badge tone="warning">unsaved</Badge></div>
                    : null}

                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{spec.help}</div>
                  {missing ? (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      Not set in <code>app_config</code> yet — saving creates it.
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      {editable ? (
        <Card>
          <CardHeader
            title="Save"
            sub={dirtyKeys.length ? `${dirtyKeys.length} change(s) pending: ${dirtyKeys.join(', ')}` : 'Nothing changed yet'}
          />
          <div className="card-pad stack" style={{ gap: 'var(--space-md)', maxWidth: 620 }}>
            <Field label="Reason" required hint="Stored with the before/after values in the audit log. Required by the server.">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. raising the hold before the summer season"
              />
            </Field>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <Button
                variant="primary"
                disabled={!dirtyKeys.length || reasonTooShort || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? 'Saving…'
                  : dirtyKeys.length
                    ? `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}`
                    : 'Save changes'}
              </Button>
              {dirtyKeys.length ? (
                <Button variant="ghost" disabled={save.isPending} onClick={() => setDraft({})}>Discard</Button>
              ) : null}
              {dirtyKeys.length && reasonTooShort ? <span className="muted" style={{ fontSize: 13 }}>A reason is required.</span> : null}
            </div>
          </div>
        </Card>
      ) : null}

      {unknownKeys.length ? (
        <Card>
          <CardHeader
            title="Other app_config keys"
            sub="Present in the table but not editable from the panel — the admin-app-config allowlist does not include them"
          />
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Key</th><th>Value</th><th>Updated</th></tr></thead>
              <tbody>
                {unknownKeys.map((r) => (
                  <tr key={r.key}>
                    <td className="mono">{r.key}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{JSON.stringify(r.value)}</td>
                    <td className="muted">{r.updated_at?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
