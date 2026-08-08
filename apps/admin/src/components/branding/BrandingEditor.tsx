// Settings → Branding.
//
// A live white-label editor: every field writes into a draft `Brand`, the
// preview panel re-renders from that draft on each keystroke, and
// `validateBrand()` warnings are shown inline so an operator cannot ship a
// palette that fails WCAG contrast without seeing it first.
//
// "Apply to panel" re-themes the running panel (unsaved). "Save" persists the
// brand to `app_config.brand` through the data source, which writes an
// audit_log entry (who / what / reason) like every other admin mutation.
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  brandFromConfig,
  contrastRatio,
  pennyBrand,
  readableOn,
  resolveColors,
  validateBrand,
  type Brand,
  type BrandColors,
  type ThemeMode,
} from '@penny/ui';
import { useBrand, BUILT_IN_BRANDS } from '@/context/BrandContext';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button, Field, Input, Select, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/Modal';
import { themeVars, STATUS_KEYS } from '@/lib/theme';
import { titleCase } from '@/lib/format';

type ColorKey = keyof BrandColors;

const CORE_COLORS: ColorKey[] = ['primary', 'primaryDark', 'primarySoft', 'onPrimary'];
const SURFACE_COLORS: ColorKey[] = ['bg', 'surface', 'surfaceAlt', 'border', 'text', 'textMuted', 'textInverse'];
const FEEDBACK_COLORS: ColorKey[] = ['success', 'warning', 'danger'];
const STATUS_COLORS: ColorKey[] = [
  'statusAvailable', 'statusReserved', 'statusInTrip', 'statusLowBattery',
  'statusMaintenance', 'statusTransport', 'statusOffline', 'statusStolen',
];
/** Tokens worth overriding for dark mode — the rest inherit from `colors`. */
const DARK_OVERRIDES: ColorKey[] = ['bg', 'surface', 'surfaceAlt', 'border', 'text', 'textMuted', 'primary', 'primarySoft'];

const LOCALES = ['el-GR', 'en-GB', 'en-US', 'pl-PL', 'de-DE', 'fr-FR', 'it-IT'];
const CURRENCIES = ['EUR', 'PLN', 'GBP', 'USD', 'CHF'];
const LANGS = ['el', 'en', 'pl', 'de', 'fr'];

export function BrandingEditor() {
  const { brand, setBrand, mode, setMode, source } = useBrand();
  const ds = useDS();
  const toast = useToast();
  const { can } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Brand>(brand);
  const [previewMode, setPreviewMode] = useState<ThemeMode>(mode);
  const [saveOpen, setSaveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const warnings = useMemo(() => validateBrand(draft, previewMode), [draft, previewMode]);
  const previewColors = useMemo(() => resolveColors(draft, previewMode), [draft, previewMode]);
  const previewStyle = useMemo(
    () => themeVars(draft, previewMode) as unknown as CSSProperties,
    [draft, previewMode],
  );

  const patch = (p: Partial<Brand>) => setDraft((d) => ({ ...d, ...p }));
  const setColor = (key: ColorKey, value: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
  const setDarkColor = (key: ColorKey, value: string) =>
    setDraft((d) => ({ ...d, darkColors: { ...d.darkColors, [key]: value } }));
  const clearDarkColor = (key: ColorKey) =>
    setDraft((d) => {
      const next = { ...d.darkColors };
      delete next[key];
      return { ...d, darkColors: next };
    });
  const setFeature = (key: string, value: boolean) =>
    setDraft((d) => ({ ...d, features: { ...d.features, [key]: value } }));

  /** Suggested `onPrimary` for the current primary — pure contrast maths. */
  const suggestedOnPrimary = readableOn(draft.colors.primary);
  const onPrimaryMismatch = suggestedOnPrimary.toLowerCase() !== draft.colors.onPrimary.toLowerCase();

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brand-${draft.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.push(`Exported brand-${draft.id}.json`, 'success');
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        // brandFromConfig deep-merges over the default, so a partial file works.
        setDraft(brandFromConfig(parsed));
        setImportError(null);
        toast.push('Brand JSON imported into the editor', 'success');
      } catch (e) {
        setImportError(e instanceof Error ? e.message : 'Invalid JSON');
      }
    };
    reader.onerror = () => setImportError('Could not read the file');
    reader.readAsText(file);
  };

  const save = async (reason: string) => {
    setSaving(true);
    try {
      // The stored shape is exactly what brandFromConfig() accepts.
      await ds.saveBrandConfig(draft as unknown as Record<string, unknown>, reason);
      setBrand(draft);
      setSaveOpen(false);
      toast.push(`Brand “${draft.name}” saved and applied (audited)`, 'success');
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !can('settings.edit');

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.45fr) minmax(320px, 1fr)', alignItems: 'start' }}>
      {/* ─────────────── editor ─────────────── */}
      <div className="stack" style={{ gap: 'var(--space-lg)' }}>
        <Card>
          <CardHeader
            title="Brand identity"
            sub={`Active brand: ${brand.name} · resolved from ${SOURCE_LABEL[source]}`}
            actions={
              <>
                <Select
                  style={{ width: 'auto' }}
                  value={BUILT_IN_BRANDS.some((b) => b.id === draft.id) ? draft.id : '__custom'}
                  onChange={(e) => {
                    const preset = BUILT_IN_BRANDS.find((b) => b.id === e.target.value);
                    if (preset) setDraft(preset);
                  }}
                  title="Start from a built-in brand"
                >
                  {BUILT_IN_BRANDS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  {BUILT_IN_BRANDS.some((b) => b.id === draft.id) ? null : <option value="__custom">{draft.name} (custom)</option>}
                </Select>
                <Button size="sm" onClick={() => setBrand(draft)}>Apply to panel</Button>
              </>
            }
          />
          <div className="card-pad brand-grid">
            <Field label="Brand id" hint="Slug used as the app_config key and in analytics.">
              <Input className="mono" value={draft.id} onChange={(e) => patch({ id: e.target.value.trim() })} disabled={readOnly} />
            </Field>
            <Field label="Product name">
              <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} disabled={readOnly} />
            </Field>
            <Field label="Deep-link scheme" hint={`${draft.scheme}://vehicle/ATH-1001`}>
              <Input className="mono" value={draft.scheme} onChange={(e) => patch({ scheme: e.target.value.replace(/[^a-z0-9]/gi, '').toLowerCase() })} disabled={readOnly} />
            </Field>
            <Field label="Primary domain">
              <Input className="mono" value={draft.domain} onChange={(e) => patch({ domain: e.target.value.trim() })} disabled={readOnly} />
            </Field>
            <Field label="Default language">
              <Select value={draft.defaultLang} onChange={(e) => patch({ defaultLang: e.target.value })} disabled={readOnly}>
                {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Locale" hint="Number and date formatting.">
              <Select value={draft.locale} onChange={(e) => patch({ locale: e.target.value })} disabled={readOnly}>
                {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Currency">
              <Select value={draft.currency} onChange={(e) => patch({ currency: e.target.value })} disabled={readOnly}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Monogram" hint="1–2 characters, drawn when no logo is supplied.">
              <Input value={draft.assets.monogram} maxLength={2} onChange={(e) => setDraft((d) => ({ ...d, assets: { ...d.assets, monogram: e.target.value } }))} disabled={readOnly} />
            </Field>
            <Field label="Emoji" hint="Favicon / native fallback.">
              <Input value={draft.assets.emoji ?? ''} onChange={(e) => setDraft((d) => ({ ...d, assets: { ...d.assets, emoji: e.target.value || null } }))} disabled={readOnly} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Colour tokens"
            sub="Feeds every CSS variable in the panel — and the rider/ops apps."
            actions={
              <div className="toolbar">
                <Button size="sm" variant={previewMode === 'light' ? 'primary' : 'default'} onClick={() => setPreviewMode('light')}>☀️ Light</Button>
                <Button size="sm" variant={previewMode === 'dark' ? 'primary' : 'default'} onClick={() => setPreviewMode('dark')}>🌙 Dark</Button>
              </div>
            }
          />
          <div className="card-pad stack" style={{ gap: 'var(--space-lg)' }}>
            <ColorGroup title="Core" keys={CORE_COLORS} colors={draft.colors} onChange={setColor} disabled={readOnly} />
            {onPrimaryMismatch ? (
              <div className="warn-row">
                <span aria-hidden>💡</span>
                <span>
                  <b>onPrimary</b> reads better as <span className="mono">{suggestedOnPrimary}</span>{' '}
                  ({contrastRatio(suggestedOnPrimary, draft.colors.primary)}:1 vs{' '}
                  {contrastRatio(draft.colors.onPrimary, draft.colors.primary)}:1).
                </span>
                <Button size="sm" style={{ marginLeft: 'auto' }} disabled={readOnly} onClick={() => setColor('onPrimary', suggestedOnPrimary)}>
                  Use it
                </Button>
              </div>
            ) : null}
            <ColorGroup title="Surfaces & text" keys={SURFACE_COLORS} colors={draft.colors} onChange={setColor} disabled={readOnly} />
            <ColorGroup title="Feedback" keys={FEEDBACK_COLORS} colors={draft.colors} onChange={setColor} disabled={readOnly} />
            <ColorGroup title="Vehicle status" keys={STATUS_COLORS} colors={draft.colors} onChange={setColor} disabled={readOnly} />

            <div>
              <div className="section-label">Dark mode overrides</div>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Only the tokens listed here change in dark mode; everything else inherits the light value.
              </p>
              <div className="brand-grid">
                {DARK_OVERRIDES.map((key) => {
                  const overridden = draft.darkColors[key] !== undefined;
                  const value = draft.darkColors[key] ?? draft.colors[key];
                  return (
                    <Field key={key} label={key}>
                      <div className="swatch-row">
                        <input type="color" value={toHex(value)} disabled={readOnly} onChange={(e) => setDarkColor(key, e.target.value)} aria-label={`${key} dark`} />
                        <Input className="mono" value={value} disabled={readOnly} onChange={(e) => setDarkColor(key, e.target.value)} />
                        {overridden ? (
                          <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => clearDarkColor(key)} title="Inherit the light value">↺</Button>
                        ) : null}
                      </div>
                    </Field>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Typography & shape" />
          <div className="card-pad brand-grid">
            <Field label="Sans font stack">
              <Input className="mono" style={{ fontSize: 12 }} value={draft.typography.sans} disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, typography: { ...d.typography, sans: e.target.value } }))} />
            </Field>
            <Field label="Mono font stack">
              <Input className="mono" style={{ fontSize: 12 }} value={draft.typography.mono} disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, typography: { ...d.typography, mono: e.target.value } }))} />
            </Field>
            <ScaleSlider
              label="Type scale" value={draft.typography.scale} disabled={readOnly}
              onChange={(v) => setDraft((d) => ({ ...d, typography: { ...d.typography, scale: v } }))}
            />
            <ScaleSlider
              label="Radius scale" value={draft.shape.radiusScale} max={2.5} disabled={readOnly}
              onChange={(v) => setDraft((d) => ({ ...d, shape: { ...d.shape, radiusScale: v } }))}
            />
            <ScaleSlider
              label="Spacing scale" value={draft.shape.spaceScale} disabled={readOnly}
              onChange={(v) => setDraft((d) => ({ ...d, shape: { ...d.shape, spaceScale: v } }))}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Support & legal" sub="Rendered on receipts, emails and in-app help." />
          <div className="card-pad brand-grid">
            <Field label="Support email">
              <Input value={draft.support.email} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, support: { ...d.support, email: e.target.value } }))} />
            </Field>
            <Field label="Support phone">
              <Input value={draft.support.phone ?? ''} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, support: { ...d.support, phone: e.target.value || null } }))} />
            </Field>
            <Field label="Support URL">
              <Input value={draft.support.url ?? ''} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, support: { ...d.support, url: e.target.value || null } }))} />
            </Field>
            <Field label="WhatsApp">
              <Input value={draft.support.whatsapp ?? ''} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, support: { ...d.support, whatsapp: e.target.value || null } }))} />
            </Field>
            <Field label="Legal entity">
              <Input value={draft.legal.legalName} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, legal: { ...d.legal, legalName: e.target.value } }))} />
            </Field>
            <Field label="Registered address">
              <Input value={draft.legal.address} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, legal: { ...d.legal, address: e.target.value } }))} />
            </Field>
            <Field label="VAT id">
              <Input className="mono" value={draft.legal.vatId ?? ''} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, legal: { ...d.legal, vatId: e.target.value || null } }))} />
            </Field>
            <Field label="Terms URL">
              <Input value={draft.legal.termsUrl} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, legal: { ...d.legal, termsUrl: e.target.value } }))} />
            </Field>
            <Field label="Privacy URL">
              <Input value={draft.legal.privacyUrl} disabled={readOnly} onChange={(e) => setDraft((d) => ({ ...d, legal: { ...d.legal, privacyUrl: e.target.value } }))} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Feature flags" sub="Per-operator switches read by all three clients." />
          <div className="card-pad brand-grid">
            {Object.entries(draft.features).map(([key, on]) => (
              <Checkbox key={key} label={titleCase(key)} checked={on} disabled={readOnly} onChange={(e) => setFeature(key, e.target.checked)} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Import / export" sub="The exact JSON shape brandFromConfig() accepts — partials are merged over the default." />
          <div className="card-pad toolbar">
            <Button onClick={exportJson}>⬇ Export JSON</Button>
            <Button disabled={readOnly} onClick={() => fileRef.current?.click()}>⬆ Import JSON</Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = '';
              }}
            />
            <Button variant="ghost" disabled={readOnly} onClick={() => setResetOpen(true)}>↺ Reset to Penny</Button>
            <div className="topbar-spacer" style={{ flex: 1 }} />
            <Button variant="primary" disabled={readOnly} onClick={() => setSaveOpen(true)}>Save brand</Button>
          </div>
          {importError ? (
            <div className="card-pad" style={{ paddingTop: 0, color: 'var(--color-danger)', fontSize: 13 }}>
              Import failed: {importError}
            </div>
          ) : null}
          {readOnly ? (
            <div className="card-pad muted" style={{ paddingTop: 0, fontSize: 12 }}>
              Your role cannot edit settings — the editor is read-only.
            </div>
          ) : null}
        </Card>
      </div>

      {/* ─────────────── live preview ─────────────── */}
      <div className="stack" style={{ gap: 'var(--space-lg)', position: 'sticky', top: 74 }}>
        <Card>
          <CardHeader
            title="Live preview"
            sub={`${draft.name} · ${previewMode} mode`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => { setPreviewMode(previewMode === 'dark' ? 'light' : 'dark'); setMode(previewMode === 'dark' ? 'light' : 'dark'); }}>
                {previewMode === 'dark' ? '☀️' : '🌙'}
              </Button>
            }
          />
          <div className="card-pad">
            {/* The preview scopes the very same variables the panel uses, so
                what renders here is exactly what "Apply to panel" produces. */}
            <div className="brand-preview" style={previewStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 30, height: 30, borderRadius: 'var(--radius-sm)', flex: '0 0 30px',
                    background: previewColors.primary, color: previewColors.onPrimary,
                    display: 'grid', placeItems: 'center', fontWeight: 700,
                  }}
                >
                  {draft.assets.monogram}
                </span>
                <b style={{ fontFamily: 'var(--font-sans)' }}>{draft.name}</b>
                <span style={{ color: previewColors.textMuted, fontSize: 12 }}>{draft.domain}</span>
              </div>

              <div className="pv-card">
                <div style={{ fontSize: 12, color: previewColors.textMuted, fontWeight: 500 }}>Today revenue</div>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>€842.10</div>
                <div style={{ fontSize: 12, color: previewColors.success, fontWeight: 600 }}>▲ 8% vs yesterday</div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: previewColors.textMuted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                  Map pins
                </div>
                <div className="pin-row">
                  {STATUS_KEYS.slice(0, 6).map((s) => (
                    <span key={s} className="map-pin" title={titleCase(s)} style={{ background: statusOf(draft, s, previewMode) }}>
                      {s === 'in_trip' ? '🛴' : ''}
                    </span>
                  ))}
                </div>
              </div>

              <div className="toolbar">
                <span className="pv-btn primary">Unlock</span>
                <span className="pv-btn">Locate</span>
                <span className="pv-btn danger">Terminate</span>
              </div>

              <div className="toolbar">
                <PreviewBadge color={previewColors.success}>Active</PreviewBadge>
                <PreviewBadge color={previewColors.warning}>Near limit</PreviewBadge>
                <PreviewBadge color={previewColors.danger}>Over limit</PreviewBadge>
                <PreviewBadge color={previewColors.textMuted}>Inventory</PreviewBadge>
              </div>

              <div style={{ fontSize: 11, color: previewColors.textMuted, fontFamily: 'var(--font-mono)' }}>
                {draft.scheme}://vehicle/ATH-1001 · {draft.support.email}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Accessibility"
            sub={`WCAG contrast · ${previewMode} mode`}
            actions={warnings.length === 0 ? <Badge tone="success">Passes</Badge> : <Badge tone="danger">{warnings.length} issue{warnings.length === 1 ? '' : 's'}</Badge>}
          />
          <div className="card-pad">
            {warnings.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                Every checked pair meets its minimum ratio in {previewMode} mode.
              </div>
            ) : (
              warnings.map((w) => (
                <div key={w.token} className="warn-row">
                  <span aria-hidden>⚠️</span>
                  <span><b className="mono">{w.token}</b> — {w.message}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onConfirm={save}
        busy={saving}
        title={`Save brand “${draft.name}”`}
        message={
          warnings.length
            ? `This palette has ${warnings.length} contrast warning${warnings.length === 1 ? '' : 's'} in ${previewMode} mode. Saving applies it to every operator screen.`
            : 'Persists to app_config.brand and applies to the panel immediately.'
        }
        requireReason
        reasonLabel="Why is the brand changing?"
        confirmLabel="Save brand"
      />
      <ConfirmModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => { setDraft(pennyBrand); setResetOpen(false); toast.push('Editor reset to the Penny default (not saved yet)', 'info'); }}
        title="Reset to Penny"
        message="Discards the draft and loads the platform default brand. Nothing is saved until you press Save brand."
        confirmLabel="Reset"
      />
    </div>
  );
}

const SOURCE_LABEL: Record<'env' | 'config' | 'default', string> = {
  env: 'VITE_BRAND (pinned at build time)',
  config: 'app_config.brand',
  default: 'the platform default',
};

function statusOf(brand: Brand, status: string, mode: ThemeMode): string {
  const c = resolveColors(brand, mode);
  const map: Record<string, string> = {
    available: c.statusAvailable, reserved: c.statusReserved, in_trip: c.statusInTrip,
    low_battery: c.statusLowBattery, maintenance: c.statusMaintenance, transport: c.statusTransport,
    offline: c.statusOffline, stolen: c.statusStolen, decommissioned: c.textMuted,
  };
  return map[status] ?? c.textMuted;
}

function PreviewBadge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="badge" style={{ color, background: `${color}1a` }}>
      <span className="dot" />
      {children}
    </span>
  );
}

function ColorGroup({
  title, keys, colors, onChange, disabled,
}: {
  title: string;
  keys: ColorKey[];
  colors: BrandColors;
  onChange: (key: ColorKey, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="section-label">{title}</div>
      <div className="brand-grid">
        {keys.map((key) => (
          <Field key={key} label={key}>
            <div className="swatch-row">
              <input type="color" value={toHex(colors[key])} disabled={disabled} onChange={(e) => onChange(key, e.target.value)} aria-label={key} />
              <Input className="mono" value={colors[key]} disabled={disabled} onChange={(e) => onChange(key, e.target.value)} />
            </div>
          </Field>
        ))}
      </div>
    </div>
  );
}

function ScaleSlider({
  label, value, onChange, min = 0, max = 2, disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <Field label={`${label} — ${value.toFixed(2)}×`}>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        disabled={disabled}
        style={{ width: '100%' }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

/** `<input type="color">` only accepts #rrggbb — rgba()/named values fall back. */
function toHex(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#000000';
}
