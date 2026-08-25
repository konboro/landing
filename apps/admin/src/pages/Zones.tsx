import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { usePanelData } from '@/hooks/usePanelData';
import { Card, CardHeader, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmModal } from '@/components/ui/Modal';
import { ZoneDrawEditor } from '@/components/map/ZoneDrawEditor';
import { ZONE_KINDS, zoneMapStyle } from '@/lib/zoneStyle';
import { titleCase, formatDateTime } from '@/lib/format';
import { evaluateZones, type ZoneLike } from '@penny/geo';
import type { Zone } from '@penny/db-types';

export function ZonesPage() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can, cities } = useAuth();
  const { data: zones } = useQuery({ queryKey: ['zones'], queryFn: () => ds.listZones() });
  const { data: db } = usePanelData();
  const [draft, setDraft] = useState<Zone[] | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  // Lock model: saved zones are read-only on the map until explicitly unlocked.
  // `editingId` is the one zone currently editable in the draw layer; `selectedId`
  // is a highlighted-but-still-locked zone (picked from the map or the table).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const working = draft ?? zones ?? [];
  const dirty = draft !== null;
  const editingZone = working.find((z) => z.id === editingId) ?? null;

  const clearEdit = () => { setEditingId(null); setSelectedId(null); };

  // A new polygon must inherit a real city: `apply_zone_version` keys the whole
  // version off one city id, so a placeholder here fails the save server-side.
  const newZoneCityId = working.find((z) => z.city_id)?.city_id ?? cities[0]?.id ?? '';

  const save = useMutation({
    mutationFn: (reason: string) => ds.saveZoneVersion(working, reason),
    onSuccess: (version) => { toast.push(`Saved zones v${version}`, 'success'); setDraft(null); clearEdit(); setSaveOpen(false); qc.invalidateQueries({ queryKey: ['zones'] }); qc.invalidateQueries({ queryKey: ['panel-data'] }); },
  });

  const updateZone = (id: string, patch: Partial<Zone>) => setDraft(working.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  const updateRule = (id: string, key: string, value: number) => setDraft(working.map((z) => (z.id === id ? { ...z, rules: { ...z.rules, [key]: value } } : z)));

  const exportGeoJSON = () => {
    const fc = { type: 'FeatureCollection', features: working.map((z) => ({ type: 'Feature', properties: { id: z.id, kind: z.kind, name: z.name, rules: z.rules }, geometry: z.geom })) };
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zones.geojson'; a.click();
  };

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title="Zones"
        sub="Draw/edit polygons per kind · versioned · point-check simulator"
        actions={
          <>
            <Button onClick={exportGeoJSON}>Export GeoJSON</Button>
            {dirty ? <Button onClick={() => { setDraft(null); clearEdit(); }}>Discard</Button> : null}
            <Button variant="primary" disabled={!dirty || !can('zones.edit')} onClick={() => setSaveOpen(true)}>Save new version</Button>
          </>
        }
      />
      {dirty ? <Badge tone="warning">Unsaved changes — a new version will be written on save (never mutates existing versions)</Badge> : null}

      <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <Card>
          <CardHeader title="Map editor" sub="Saved zones are locked — pick one and Edit, or draw a new polygon" />
          <div className="card-pad">
            {editingZone ? (
              <div className="between" style={{ gap: 8, alignItems: 'center' }}>
                <Badge tone="warning">Editing “{editingZone.name || titleCase(editingZone.kind)}” — drag to move, double-click an edge to add a point, trash to delete</Badge>
                <Button size="sm" variant="primary" onClick={clearEdit}>Done editing</Button>
              </div>
            ) : (
              <Badge tone="info">Zones are locked. Click a zone (or a table row) then “Edit”, or use the polygon tool ▱ to add a new one.</Badge>
            )}
            <div style={{ height: 8 }} />
            <ZoneDrawEditor
              zones={working}
              editingId={editingId}
              selectedId={selectedId}
              // Clicking a locked zone only selects it — the Edit button unlocks it.
              onSelect={(id) => setSelectedId(id)}
              // The id must be mapbox-gl-draw's own feature id, otherwise the
              // draw.update / draw.delete events for this polygon match nothing.
              // A freshly drawn polygon is immediately the editable one.
              onCreate={(coords, drawId) => { setDraft([...working, { id: drawId, city_id: newZoneCityId, kind: 'parking', geom: { type: 'Polygon', coordinates: coords }, rules: {}, active: true, valid_from: null, valid_to: null, version: 0, created_by: null, name: 'New zone' }]); setEditingId(drawId); setSelectedId(drawId); }}
              onUpdate={(id, coords) => updateZone(id, { geom: { type: 'Polygon', coordinates: coords } })}
              onDelete={(id) => { setDraft(working.filter((z) => z.id !== id)); if (id === editingId) clearEdit(); }}
            />
            <div className="row-wrap" style={{ marginTop: 10, gap: 6 }}>
              {ZONE_KINDS.map((k) => { const s = zoneMapStyle(k); return <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: s.fill, border: `1px solid ${s.line}` }} />{titleCase(k)}</span>; })}
            </div>
          </div>
        </Card>

        <div className="stack" style={{ gap: 'var(--space-lg)' }}>
          <PointCheck zones={working} />
          <Versions versions={db?.zoneVersions ?? []} onRollback={(v) => toast.push(`Rolled back to v${v} (would create new version)`, 'info')} />
        </div>
      </div>

      <Card>
        <CardHeader title="Zone rules" sub="Per-kind fields; edits become a new version" />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th></th><th>Name</th><th>Kind</th><th>Rules</th><th>Active</th></tr></thead>
            <tbody>
              {working.map((z) => (
                <tr key={z.id} onClick={() => setSelectedId(z.id)} style={{ background: z.id === editingId ? 'var(--color-warning-bg, rgba(245,158,11,0.12))' : z.id === selectedId ? 'var(--color-hover, rgba(120,120,120,0.08))' : undefined, cursor: 'pointer' }}>
                  <td>
                    <Button
                      size="sm"
                      variant={z.id === editingId ? 'primary' : 'ghost'}
                      disabled={!can('zones.edit')}
                      onClick={(e) => { e.stopPropagation(); if (z.id === editingId) clearEdit(); else { setEditingId(z.id); setSelectedId(z.id); } }}
                    >{z.id === editingId ? 'Done' : 'Edit'}</Button>
                  </td>
                  <td><Input value={z.name ?? ''} onChange={(e) => updateZone(z.id, { name: e.target.value })} style={{ minWidth: 160 }} /></td>
                  <td>
                    <Select value={z.kind} onChange={(e) => updateZone(z.id, { kind: e.target.value as Zone['kind'] })} style={{ width: 'auto' }}>
                      {ZONE_KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
                    </Select>
                  </td>
                  <td><RuleFields zone={z} onChange={(key, val) => updateRule(z.id, key, val)} /></td>
                  <td><input type="checkbox" checked={z.active} onChange={(e) => updateZone(z.id, { active: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmModal open={saveOpen} onClose={() => setSaveOpen(false)} onConfirm={(reason) => save.mutate(reason)} title="Save new zone version" message="Writes a new immutable version and activates it. Requires a reason (audited)." requireReason busy={save.isPending} confirmLabel="Save & activate" />
    </div>
  );
}

function RuleFields({ zone, onChange }: { zone: Zone; onChange: (key: string, val: number) => void }) {
  const fields: Array<{ key: string; label: string }> = [];
  if (zone.kind === 'bonus') fields.push({ key: 'bonus_cents', label: 'Bonus ¢' });
  if (zone.kind === 'paid_parking') fields.push({ key: 'fee_cents', label: 'Fee ¢' });
  if (zone.kind === 'speed_limit') fields.push({ key: 'limit_kmh', label: 'Limit km/h' });
  if (zone.kind === 'parking_station') fields.push({ key: 'station_capacity', label: 'Capacity' });
  if (fields.length === 0) return <span className="muted">—</span>;
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {fields.map((f) => (
        <label key={f.key} style={{ fontSize: 12 }}>{f.label}<br /><Input type="number" value={Number(zone.rules?.[f.key] ?? 0)} onChange={(e) => onChange(f.key, Number(e.target.value))} style={{ width: 90 }} /></label>
      ))}
    </div>
  );
}

function PointCheck({ zones }: { zones: Zone[] }) {
  const [lng, setLng] = useState('23.7275');
  const [lat, setLat] = useState('37.9838');
  const result = useMemo(() => {
    const pt: [number, number] = [parseFloat(lng), parseFloat(lat)];
    if (Number.isNaN(pt[0]) || Number.isNaN(pt[1])) return null;
    const zl: ZoneLike[] = zones.map((z) => ({ kind: z.kind, geom: z.geom, rules: z.rules }));
    return evaluateZones(pt, zl);
  }, [lng, lat, zones]);
  return (
    <Card>
      <CardHeader title="Point-check simulator" sub="@penny/geo · UX mirror of the server engine" />
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
