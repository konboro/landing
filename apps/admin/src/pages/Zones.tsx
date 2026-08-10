import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { usePanelData } from '@/hooks/usePanelData';
import { Card, CardHeader, Button, Field, Input, Select, Textarea, Checkbox } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { ZoneDrawEditor } from '@/components/map/ZoneDrawEditor';
import { ZONE_KIND_GROUPS, ZONE_KIND_HELP } from '@/components/map/zoneKinds';
import {
  formatArea,
  hasBlockingIssue,
  polygonAreaKm2,
  vertexCount,
  zoneIssues,
  zoneRings,
  type ZoneIssue,
} from '@/components/map/zoneGeometry';
import { zoneMapStyle } from '@/lib/zoneStyle';
import { titleCase, formatDateTime } from '@/lib/format';
import { evaluateZones, type ZoneLike } from '@penny/geo';
import type { LngLat, Zone, ZoneKind } from '@penny/db-types';

/** Ids are regenerated server-side by `apply_zone_version`; this only has to be
 * unique within the draft so draw events find the right zone. */
function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `new-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ZonesPage() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can, cities } = useAuth();
  const { data: zones, isLoading } = useQuery({ queryKey: ['zones'], queryFn: () => ds.listZones() });
  const { data: db } = usePanelData();

  const [draft, setDraft] = useState<Zone[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** A freshly drawn polygon waiting for a name + kind. It is on the map but
   * not in the list: a zone never joins the list under an invented name. */
  const [pending, setPending] = useState<Zone | null>(null);
  const [frameToken, setFrameToken] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Zone | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState('');

  const working = draft ?? zones ?? [];
  const dirty = draft !== null;
  const editable = can('zones.edit');

  // A new polygon must inherit a real city: `apply_zone_version` keys the whole
  // version off one city id, so a placeholder here fails the save server-side.
  const newZoneCityId = working.find((z) => z.city_id)?.city_id ?? cities[0]?.id ?? '';

  const issues = useMemo(() => {
    const m = new Map<string, ZoneIssue[]>();
    for (const z of working) m.set(z.id, zoneIssues(z, working));
    return m;
  }, [working]);

  const activeZones = working.filter((z) => z.active);
  const blocking = working.filter((z) => hasBlockingIssue(issues.get(z.id) ?? []));
  const warnings = working.reduce((n, z) => n + (issues.get(z.id) ?? []).filter((i) => i.level === 'warning').length, 0);

  // `apply_zone_version` re-inserts every zone in the payload as active and
  // deactivates whatever is left out — so "switched off" IS "left out". Saying
  // it out loud beats a checkbox that silently comes back on.
  const saveBlocked = !editable
    ? 'You do not have the zones.edit permission.'
    : !dirty
      ? null
      : activeZones.length === 0
        ? 'A city must keep at least one active zone — the save would be rejected. Draw one, or switch one back on.'
        : blocking.length > 0
          ? `${blocking.length} zone${blocking.length === 1 ? '' : 's'} cannot be stored yet — see the errors in the list.`
          : !newZoneCityId
            ? 'No city id available. Reload the page so the city list loads.'
            : null;

  const save = useMutation({
    mutationFn: (reason: string) => ds.saveZoneVersion(activeZones, reason),
    onSuccess: (version) => {
      toast.push(`Saved zones v${version}`, 'success');
      setDraft(null);
      setSelectedId(null);
      setSaveOpen(false);
      qc.invalidateQueries({ queryKey: ['zones'] });
      qc.invalidateQueries({ queryKey: ['panel-data'] });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : 'Save failed', 'error'),
  });

  const updateZone = (id: string, patch: Partial<Zone>) => {
    if (pending && pending.id === id) {
      setPending({ ...pending, ...patch });
      return;
    }
    setDraft(working.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  };
  const updateRule = (id: string, key: string, value: number) =>
    setDraft(working.map((z) => (z.id === id ? { ...z, rules: { ...z.rules, [key]: value } } : z)));
  const removeZone = (id: string) => {
    setDraft(working.filter((z) => z.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  /* ------------------------------------------------------------ geojson io */
  const exportGeoJSON = () => {
    const fc = {
      type: 'FeatureCollection',
      features: working.map((z) => ({ type: 'Feature', properties: { id: z.id, kind: z.kind, name: z.name, rules: z.rules, active: z.active }, geometry: z.geom })),
    };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zones.geojson';
    a.click();
  };

  const importGeoJSON = (text: string): { added: number; skipped: number } => {
    const parsed = JSON.parse(text) as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown };
    const features: Array<{ geometry?: unknown; properties?: Record<string, unknown> }> =
      parsed.type === 'FeatureCollection' ? ((parsed.features ?? []) as never[]) : [parsed as never];
    const known = new Set(ZONE_KIND_GROUPS.flatMap((g) => g.kinds) as string[]);
    let skipped = 0;
    const added: Zone[] = [];
    for (const f of features) {
      const rings = zoneRings(f.geometry);
      if (!rings) {
        skipped++;
        continue;
      }
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const kind = typeof props.kind === 'string' && known.has(props.kind) ? (props.kind as ZoneKind) : 'parking';
      added.push({
        id: newId(),
        city_id: newZoneCityId,
        kind,
        geom: { type: 'Polygon', coordinates: rings },
        rules: (props.rules && typeof props.rules === 'object' ? props.rules : {}) as Zone['rules'],
        active: props.active !== false,
        valid_from: null,
        valid_to: null,
        version: 0,
        created_by: null,
        name: typeof props.name === 'string' && props.name.trim() ? props.name : 'Imported zone',
      });
    }
    if (added.length) {
      setDraft([...working, ...added]);
      setFrameToken((t) => t + 1);
    }
    return { added: added.length, skipped };
  };

  /* ------------------------------------------------------------------ view */
  const mapZones = pending ? [...working, pending] : working;
  const selected = working.find((z) => z.id === selectedId) ?? null;
  const filtered = query.trim()
    ? working.filter((z) => `${z.name ?? ''} ${z.kind}`.toLowerCase().includes(query.trim().toLowerCase()))
    : working;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title="Zones"
        sub="Draw a zone by dropping pins, then drag them to reshape it · every save writes a new version"
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>Import GeoJSON</Button>
            <Button onClick={exportGeoJSON} disabled={working.length === 0}>Export GeoJSON</Button>
            {dirty ? <Button onClick={() => { setDraft(null); setSelectedId(null); setPending(null); }}>Discard changes</Button> : null}
            <Button variant="primary" disabled={!dirty || saveBlocked !== null} onClick={() => setSaveOpen(true)}>
              Save new version
            </Button>
          </>
        }
      />

      {dirty ? (
        <Badge tone={saveBlocked ? 'danger' : 'warning'}>
          {saveBlocked ?? `Unsaved: ${activeZones.length} zone${activeZones.length === 1 ? '' : 's'} will be written as a new version${warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`}
        </Badge>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.85fr) minmax(320px, 1fr)', alignItems: 'start' }}>
        <Card>
          <CardHeader
            title="Map editor"
            sub={editable ? 'Click “+ Draw a zone”, then click the map to drop pins' : 'Read-only — zones.edit required'}
          />
          <div className="card-pad" style={{ paddingTop: 0 }}>
            <ZoneDrawEditor
              zones={mapZones}
              selectedId={pending ? pending.id : selectedId}
              onSelect={(id) => { if (!pending) setSelectedId(id); }}
              onCreate={(coords) => {
                setPending({
                  id: newId(),
                  city_id: newZoneCityId,
                  kind: 'parking',
                  geom: { type: 'Polygon', coordinates: coords },
                  rules: {},
                  active: true,
                  valid_from: null,
                  valid_to: null,
                  version: 0,
                  created_by: null,
                  name: '',
                });
              }}
              onUpdate={(id, coords) => updateZone(id, { geom: { type: 'Polygon', coordinates: coords as LngLat[][] } })}
              onDelete={(id) => removeZone(id)}
              canEdit={editable}
              height="calc(100vh - 300px)"
              frameToken={frameToken}
              locked={pending !== null}
            />
            <div className="row-wrap" style={{ marginTop: 10, gap: 10 }}>
              {ZONE_KIND_GROUPS.flatMap((g) => g.kinds).map((k) => {
                const s = zoneMapStyle(k);
                const n = working.filter((z) => z.kind === k).length;
                return (
                  <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, opacity: n ? 1 : 0.45 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: s.fill, border: `1px solid ${s.line}` }} />
                    {titleCase(k)}
                    {n ? <b>&nbsp;{n}</b> : null}
                  </span>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="stack" style={{ gap: 'var(--space-lg)' }}>
          <Card>
            <CardHeader
              title={`Zones (${working.length})`}
              sub="Click a row to frame it and edit its pins"
              actions={working.length > 4 ? <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" style={{ width: 130 }} /> : undefined}
            />
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {isLoading && !working.length ? (
                <div className="card-pad muted">Loading zones…</div>
              ) : working.length === 0 ? (
                <div className="empty-state">
                  <div style={{ fontSize: 26 }}>🗺️</div>
                  <b>No zones in this city yet</b>
                  <div style={{ maxWidth: 280 }}>
                    Hit <b>+ Draw a zone</b> on the map and click to drop pins. A city needs at least one zone before a
                    version can be saved, and an <b>operating</b> zone is what makes trips possible at all.
                  </div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="card-pad muted">Nothing matches “{query}”.</div>
              ) : (
                filtered.map((z) => (
                  <ZoneRow
                    key={z.id}
                    zone={z}
                    issues={issues.get(z.id) ?? []}
                    selected={z.id === selectedId}
                    editable={editable}
                    onSelect={() => { setSelectedId(z.id); setFrameToken((t) => t + 1); }}
                    onToggleActive={() => updateZone(z.id, { active: !z.active })}
                  />
                ))
              )}
            </div>
          </Card>

          {selected ? (
            <ZoneDetail
              zone={selected}
              issues={issues.get(selected.id) ?? []}
              editable={editable}
              onChange={(patch) => updateZone(selected.id, patch)}
              onRule={(k, v) => updateRule(selected.id, k, v)}
              onZoom={() => setFrameToken((t) => t + 1)}
              onDelete={() => setDeleteTarget(selected)}
            />
          ) : null}
        </div>
      </div>

      <div className="grid grid-2">
        <PointCheck zones={activeZones} />
        <Versions versions={db?.zoneVersions ?? []} onRollback={(v) => toast.push(`Rolled back to v${v} (would create new version)`, 'info')} />
      </div>

      {/* Name-before-it-exists: the drawn polygon is on the map, but it does not
          become a zone until it has a name and a kind. */}
      <NameZoneModal
        zone={pending}
        onChange={(patch) => setPending((p) => (p ? { ...p, ...patch } : p))}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          setDraft([...working, pending]);
          setSelectedId(pending.id);
          setPending(null);
        }}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={(text) => {
          try {
            const { added, skipped } = importGeoJSON(text);
            if (!added) {
              toast.push('No polygons found in that GeoJSON', 'error');
              return false;
            }
            toast.push(`Imported ${added} zone${added === 1 ? '' : 's'}${skipped ? ` · skipped ${skipped} non-polygon` : ''}`, 'success');
            setImportOpen(false);
            return true;
          } catch (err) {
            toast.push(err instanceof Error ? `Invalid GeoJSON: ${err.message}` : 'Invalid GeoJSON', 'error');
            return false;
          }
        }}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) removeZone(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title={`Delete “${deleteTarget?.name || 'Unnamed zone'}”?`}
        message="Removes it from the draft. Nothing changes in the database until you save a new version — and past versions keep the old geometry either way."
        danger
        confirmLabel="Delete zone"
      />

      <ConfirmModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onConfirm={(reason) => save.mutate(reason)}
        title="Save new zone version"
        message={
          <>
            Writes <b>{activeZones.length}</b> zone{activeZones.length === 1 ? '' : 's'} as a new immutable version and activates it.
            {working.length > activeZones.length ? (
              <> {working.length - activeZones.length} switched-off zone{working.length - activeZones.length === 1 ? ' is' : 's are'} left out — that is how the server deactivates a zone.</>
            ) : null}
            {warnings ? <> {warnings} warning{warnings === 1 ? '' : 's'} will be saved as drawn.</> : null}
          </>
        }
        requireReason
        busy={save.isPending}
        confirmLabel="Save & activate"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function ZoneRow({
  zone,
  issues,
  selected,
  editable,
  onSelect,
  onToggleActive,
}: {
  zone: Zone;
  issues: ZoneIssue[];
  selected: boolean;
  editable: boolean;
  onSelect: () => void;
  onToggleActive: () => void;
}) {
  const rings = zoneRings(zone.geom);
  const style = zoneMapStyle(zone.kind);
  const worst = issues.find((i) => i.level === 'error') ?? issues[0];
  return (
    <div
      onClick={onSelect}
      data-testid="zone-row"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px var(--space-md)',
        borderBottom: '1px solid var(--color-border)',
        borderLeft: `3px solid ${selected ? style.line : 'transparent'}`,
        background: selected ? 'var(--color-primary-soft)' : undefined,
        cursor: 'pointer',
        opacity: zone.active ? 1 : 0.55,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {zone.name || <span className="muted">Unnamed zone</span>}
          </span>
          <Badge color={style.line}>{titleCase(zone.kind)}</Badge>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {vertexCount(rings)} pins · {formatArea(polygonAreaKm2(rings))}
          {zone.active ? '' : ' · switched off'}
        </div>
        {worst ? (
          <div style={{ fontSize: 12, marginTop: 3, color: worst.level === 'error' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
            {worst.level === 'error' ? '✖' : '⚠'} {worst.text}
          </div>
        ) : null}
      </div>
      <input
        type="checkbox"
        checked={zone.active}
        disabled={!editable}
        title={zone.active ? 'Active — included in the next version' : 'Switched off — left out of the next version'}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggleActive}
        style={{ marginTop: 3 }}
      />
    </div>
  );
}

function ZoneDetail({
  zone,
  issues,
  editable,
  onChange,
  onRule,
  onZoom,
  onDelete,
}: {
  zone: Zone;
  issues: ZoneIssue[];
  editable: boolean;
  onChange: (patch: Partial<Zone>) => void;
  onRule: (key: string, val: number) => void;
  onZoom: () => void;
  onDelete: () => void;
}) {
  const rings = zoneRings(zone.geom);
  return (
    <Card>
      <CardHeader title="Selected zone" sub={`${vertexCount(rings)} pins · ${formatArea(polygonAreaKm2(rings))}`} />
      <div className="card-pad">
        <Field label="Name" required>
          <Input value={zone.name ?? ''} disabled={!editable} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. City centre" />
        </Field>
        <Field label="Kind" hint={ZONE_KIND_HELP[zone.kind]}>
          <KindSelect value={zone.kind} disabled={!editable} onChange={(k) => onChange({ kind: k })} />
        </Field>
        <RuleFields zone={zone} disabled={!editable} onChange={onRule} />
        <Checkbox
          label="Active — include in the next version"
          checked={zone.active}
          disabled={!editable}
          onChange={(e) => onChange({ active: e.target.checked })}
        />
        {issues.length ? (
          <div className="stack" style={{ gap: 4, marginTop: 10 }}>
            {issues.map((i, n) => (
              <div key={n} style={{ fontSize: 12, color: i.level === 'error' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                {i.level === 'error' ? '✖' : '⚠'} {i.text}
              </div>
            ))}
          </div>
        ) : null}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <Button size="sm" onClick={onZoom}>Zoom to zone</Button>
          <Button size="sm" variant="danger" disabled={!editable} onClick={onDelete}>Delete zone</Button>
        </div>
      </div>
    </Card>
  );
}

/** All ten `zone_kind` values, grouped so the list is scannable. */
function KindSelect({ value, disabled, onChange }: { value: ZoneKind; disabled?: boolean; onChange: (k: ZoneKind) => void }) {
  return (
    <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as ZoneKind)}>
      {ZONE_KIND_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.kinds.map((k) => (
            <option key={k} value={k}>{titleCase(k)}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function NameZoneModal({
  zone,
  onChange,
  onCancel,
  onConfirm,
}: {
  zone: Zone | null;
  onChange: (patch: Partial<Zone>) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const rings = zone ? zoneRings(zone.geom) : null;
  const issues = zone ? zoneIssues(zone, [zone]) : [];
  const nameOk = (zone?.name ?? '').trim().length > 0;
  const blocked = hasBlockingIssue(issues);
  return (
    <Modal
      open={zone !== null}
      onClose={onCancel}
      title="Name this zone"
      footer={
        <>
          <Button onClick={onCancel}>Discard shape</Button>
          <Button variant="primary" disabled={!nameOk || blocked} onClick={onConfirm} data-testid="zone-name-confirm">
            Add zone
          </Button>
        </>
      }
    >
      {zone ? (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            {vertexCount(rings)} pins · {formatArea(polygonAreaKm2(rings))}. Nothing is written to the database until you
            save a new version.
          </p>
          <Field label="Name" required>
            <Input
              autoFocus
              value={zone.name ?? ''}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="e.g. Aristotelous parking"
              data-testid="zone-name-input"
            />
          </Field>
          <Field label="Kind" hint={ZONE_KIND_HELP[zone.kind]}>
            <KindSelect value={zone.kind} onChange={(k) => onChange({ kind: k })} />
          </Field>
          <RuleFields zone={zone} onChange={(k, v) => onChange({ rules: { ...zone.rules, [k]: v } })} />
          {issues.map((i, n) => (
            <div key={n} style={{ fontSize: 12, color: i.level === 'error' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
              {i.level === 'error' ? '✖' : '⚠'} {i.text}
            </div>
          ))}
        </>
      ) : null}
    </Modal>
  );
}

function ImportModal({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (text: string) => boolean }) {
  const [text, setText] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import GeoJSON"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => { if (onImport(text)) setText(''); }}>
            Import
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Paste a Feature or FeatureCollection of Polygons. `properties.kind` and `properties.name` are used when present.
        Imported zones join the draft — review them on the map before saving a version.
      </p>
      <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"type":"FeatureCollection","features":[…]}' />
    </Modal>
  );
}

function RuleFields({ zone, disabled, onChange }: { zone: Zone; disabled?: boolean; onChange: (key: string, val: number) => void }) {
  const fields: Array<{ key: string; label: string }> = [];
  if (zone.kind === 'bonus') fields.push({ key: 'bonus_cents', label: 'Bonus ¢' });
  if (zone.kind === 'paid_parking') fields.push({ key: 'fee_cents', label: 'Fee ¢' });
  if (zone.kind === 'speed_limit') fields.push({ key: 'limit_kmh', label: 'Limit km/h' });
  if (zone.kind === 'parking_station') fields.push({ key: 'station_capacity', label: 'Capacity' });
  if (fields.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <Input
            type="number"
            disabled={disabled}
            value={Number(zone.rules?.[f.key] ?? 0)}
            onChange={(e) => onChange(f.key, Number(e.target.value))}
            style={{ width: 110 }}
          />
        </Field>
      ))}
    </div>
  );
}

function PointCheck({ zones }: { zones: Zone[] }) {
  const [lng, setLng] = useState('22.9444');
  const [lat, setLat] = useState('40.6401');
  const result = useMemo(() => {
    const pt: [number, number] = [parseFloat(lng), parseFloat(lat)];
    if (Number.isNaN(pt[0]) || Number.isNaN(pt[1])) return null;
    const zl: ZoneLike[] = zones.map((z) => ({ kind: z.kind, geom: z.geom, rules: z.rules }));
    return evaluateZones(pt, zl);
  }, [lng, lat, zones]);
  return (
    <Card>
      <CardHeader title="Point-check simulator" sub="@penny/geo · UX mirror of the server engine (the server decides)" />
      <div className="card-pad">
        <div className="row" style={{ gap: 8 }}>
          <Field label="Longitude"><Input value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
          <Field label="Latitude"><Input value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
        </div>
        {result ? (
          <div className="stack" style={{ gap: 6, fontSize: 13 }}>
            <Row label="Inside operating" ok={result.inOperating} />
            <Row label="No-go" ok={!result.inNoGo} okText="clear" badText="INSIDE no-go" />
            <Row label="No-parking" ok={!result.inNoParking} okText="clear" badText="INSIDE no-parking" />
            <Row label="Parking allowed" ok={result.inParking} />
            <div className="between"><span>Bonus</span><b>{result.bonusCents}¢</b></div>
            <div className="between"><span>Paid parking fee</span><b>{result.paidParkingFeeCents}¢</b></div>
            <div className="between"><span>Speed limit</span><b>{result.speedLimitKmh ?? '—'}</b></div>
            <div className="between"><span>Matched zones</span><b>{result.matched.length}</b></div>
          </div>
        ) : <span className="muted">Enter a valid coordinate.</span>}
      </div>
    </Card>
  );
}

function Row({ label, ok, okText = 'yes', badText = 'no' }: { label: string; ok: boolean; okText?: string; badText?: string }) {
  return <div className="between"><span>{label}</span><Badge tone={ok ? 'success' : 'danger'}>{ok ? okText : badText}</Badge></div>;
}

function Versions({ versions, onRollback }: { versions: Array<{ version: number; created_at: string; created_by: string; note: string; count: number }>; onRollback: (v: number) => void }) {
  return (
    <Card>
      <CardHeader title="Version history" sub="Diff & rollback" />
      <div className="card-pad stack">
        {versions.length === 0 ? <span className="muted">No versions saved yet.</span> : null}
        {versions.map((v, i) => (
          <div key={v.version} className="between" style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>v{v.version} {i === 0 ? <Badge tone="success">active</Badge> : null}</div>
              <div className="muted" style={{ fontSize: 12 }}>{v.note} · {v.count} zones · {v.created_by} · {formatDateTime(v.created_at)}</div>
              {i < versions.length ? <div className="muted" style={{ fontSize: 12 }}>Δ vs v{v.version - 1}: {v.count - (versions[i + 1]?.count ?? v.count) >= 0 ? '+' : ''}{v.count - (versions[i + 1]?.count ?? v.count)} zones</div> : null}
            </div>
            {i !== 0 ? <Button size="sm" onClick={() => onRollback(v.version)}>Rollback</Button> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
