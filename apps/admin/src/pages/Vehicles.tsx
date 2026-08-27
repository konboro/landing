import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Column, type SavedView } from '@/components/ui/DataTable';
import { useTableState } from '@/hooks/useTableState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { VehicleStatusBadge } from '@/components/ui/Badge';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { formatSoc, relativeTime, socColor } from '@/lib/format';
import { colors } from '@penny/ui';
import type { VehicleRow } from '@/types/domain';

const SOC_COL = { ok: colors.success, warn: colors.warning, crit: colors.danger };

export function VehiclesPage() {
  const ds = useDS();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can, cities } = useAuth();
  const state = useTableState({ sort: [{ field: 'last_seen', dir: 'desc' }] });
  const { data, isLoading } = useQuery({ queryKey: ['vehicles', state.params], queryFn: () => ds.listVehicles(state.params) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState<null | 'maintenance' | 'locate'>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removeMode, setRemoveMode] = useState<null | 'decommission' | 'purge'>(null);

  const bulk = useMutation({
    mutationFn: async (action: 'maintenance' | 'locate') => {
      for (const id of selected) {
        if (action === 'maintenance') await ds.setVehicleStatus(id, 'maintenance', 'Bulk set to maintenance');
        else await ds.sendCommand(id, 'locate');
      }
    },
    onSuccess: (_r, action) => { toast.push(`Bulk ${action} on ${selected.size} vehicles`, 'success'); setSelected(new Set()); setBulkOpen(null); qc.invalidateQueries({ queryKey: ['vehicles'] }); },
  });

  const remove = useMutation({
    mutationFn: async ({ mode, reason }: { mode: 'decommission' | 'purge'; reason: string }) => {
      // Sequential on purpose: each one is audited server-side, and a partial
      // failure has to name the vehicle it stopped on.
      for (const id of selected) await ds.removeVehicle(id, reason, mode);
    },
    onSuccess: (_r, { mode }) => {
      toast.push(mode === 'purge' ? `Deleted ${selected.size} vehicle(s)` : `Decommissioned ${selected.size} vehicle(s)`, 'success');
      setSelected(new Set());
      setRemoveMode(null);
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Removal failed', 'error'),
  });

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const columns: Column<VehicleRow>[] = [
    { key: 'sel', header: '', hideable: false, render: (v) => <input type="checkbox" checked={selected.has(v.id)} onChange={(e) => { e.stopPropagation(); toggle(v.id); }} onClick={(e) => e.stopPropagation()} />, csv: (v) => (selected.has(v.id) ? '1' : '') },
    { key: 'code', header: 'Code', sortable: true, render: (v) => <span className="mono">{v.code}</span> },
    { key: 'model_name', header: 'Model', sortable: true, render: (v) => v.model_name },
    { key: 'city_name', header: 'City', sortable: true, render: (v) => v.city_name },
    { key: 'status', header: 'Status', sortable: true, render: (v) => <VehicleStatusBadge status={v.status} /> },
    { key: 'soc_pct', header: 'Battery', sortable: true, align: 'right', render: (v) => <span style={{ color: SOC_COL[socColor(v.soc_pct)], fontWeight: 600 }}>{formatSoc(v.soc_pct)}</span>, csv: (v) => v.soc_pct ?? '' },
    { key: 'last_seen', header: 'Last seen', sortable: true, render: (v) => <span style={{ color: v.session_online ? colors.text : colors.danger }}>{relativeTime(v.last_seen)}</span>, csv: (v) => v.last_seen ?? '' },
    { key: 'rides_today', header: 'Rides today', sortable: true, align: 'right', render: (v) => v.rides_today },
    { key: 'idle_hours', header: 'Idle', sortable: true, align: 'right', render: (v) => `${v.idle_hours}h`, csv: (v) => v.idle_hours },
    { key: 'imei', header: 'IMEI', sortable: false, defaultHidden: true, render: (v) => <span className="mono" style={{ fontSize: 12 }}>{v.imei}</span> },
  ];

  const savedViews: SavedView[] = [
    { name: 'Low battery', view: { filters: { status: 'low_battery' }, sort: [{ field: 'soc_pct', dir: 'asc' }] } },
    { name: 'Offline', view: { filters: { status: 'offline' } } },
    { name: 'Idle > 24h', view: { sort: [{ field: 'idle_hours', dir: 'desc' }] } },
    { name: 'Most active', view: { sort: [{ field: 'rides_today', dir: 'desc' }] } },
  ];

  return (
    <div>
      <PageHeader
        title="Vehicles"
        sub="Fleet table with sort, filter, bulk actions and export"
        actions={can('vehicles.manage') ? <Button variant="primary" onClick={() => setAddOpen(true)}>Add vehicle</Button> : null}
      />
      <DataTable
        columns={columns}
        data={data}
        state={state}
        loading={isLoading}
        rowKey={(v) => v.id}
        onRowClick={(v) => nav(`/vehicles/${v.id}`)}
        searchPlaceholder="Search code, model, IMEI, plate…"
        csvName="vehicles"
        savedViews={savedViews}
        toolbarActions={selected.size > 0 && (can('vehicles.command') || can('vehicles.manage')) ? (
          <>
            <span className="muted" style={{ fontSize: 13 }}>{selected.size} selected</span>
            {can('vehicles.command') ? <Button size="sm" onClick={() => setBulkOpen('locate')}>Locate all</Button> : null}
            {can('vehicles.command') ? <Button size="sm" variant="danger" onClick={() => setBulkOpen('maintenance')}>→ Maintenance</Button> : null}
            {can('vehicles.manage') ? <Button size="sm" variant="danger" onClick={() => setRemoveMode('decommission')}>Decommission</Button> : null}
            {can('vehicles.manage') ? <Button size="sm" variant="danger" onClick={() => setRemoveMode('purge')}>Delete…</Button> : null}
          </>
        ) : null}
        filtersSlot={
          <>
            <Select style={{ width: 'auto' }} value={String(state.filters.status ?? 'all')} onChange={(e) => state.setFilter('status', e.target.value)}>
              <option value="all">All statuses</option>
              {['available', 'in_trip', 'reserved', 'low_battery', 'maintenance', 'transport', 'offline'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select style={{ width: 'auto' }} value={String(state.filters.city_name ?? 'all')} onChange={(e) => state.setFilter('city_name', e.target.value)}>
              <option value="all">All cities</option>
              <option value="Athens">Athens</option>
              <option value="Thessaloniki">Thessaloniki</option>
            </Select>
          </>
        }
      />

      <ConfirmModal
        open={bulkOpen !== null}
        onClose={() => setBulkOpen(null)}
        onConfirm={() => bulkOpen && bulk.mutate(bulkOpen)}
        title={bulkOpen === 'maintenance' ? 'Move to maintenance' : 'Locate vehicles'}
        message={`Apply to ${selected.size} selected vehicle(s)?`}
        danger={bulkOpen === 'maintenance'}
        busy={bulk.isPending}
        confirmLabel="Apply"
      />

      <AddVehicleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        cities={cities.length ? cities : cityOptionsFromRows(data?.rows)}
        onCreated={(code) => { toast.push(`Vehicle ${code} added`, 'success'); setAddOpen(false); qc.invalidateQueries({ queryKey: ['vehicles'] }); }}
      />

      {/* Two dialogs rather than one with a switch: "hide it from riders" and
          "erase the record" are different decisions and should read that way. */}
      <ConfirmModal
        open={removeMode === 'decommission'}
        onClose={() => setRemoveMode(null)}
        onConfirm={(reason) => remove.mutate({ mode: 'decommission', reason })}
        title="Decommission vehicle(s)"
        message={`${selected.size} vehicle(s) will be set to decommissioned and hidden from the rider map. Their devices are unfitted; all ride history is kept.`}
        danger
        requireReason
        busy={remove.isPending}
        confirmLabel="Decommission"
      />
      <ConfirmModal
        open={removeMode === 'purge'}
        onClose={() => setRemoveMode(null)}
        onConfirm={(reason) => remove.mutate({ mode: 'purge', reason })}
        title="Delete vehicle(s) permanently"
        message={`Deletes ${selected.size} vehicle record(s) outright. This is only allowed for vehicles with no ride history — anything that has carried a rider must be decommissioned instead, and the server will refuse.`}
        danger
        requireReason
        busy={remove.isPending}
        confirmLabel="Delete permanently"
      />
    </div>
  );
}

/** Cities as known from the loaded rows — the fallback for mock mode, where
 *  `admin-me` (and therefore the real city list) does not exist. */
function cityOptionsFromRows(rows?: VehicleRow[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const r of rows ?? []) if (r.city_id && !seen.has(r.city_id)) seen.set(r.city_id, r.city_name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

const INITIAL_STATUSES = ['offline', 'maintenance', 'transport', 'available'] as const;

function AddVehicleModal({
  open, onClose, cities, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  cities: Array<{ id: string; name: string }>;
  onCreated: (code: string) => void;
}) {
  const ds = useDS();
  const toast = useToast();
  const { data: models } = useQuery({ queryKey: ['vehicle-models'], queryFn: () => ds.listVehicleModels(), enabled: open });
  const [form, setForm] = useState({ code: '', model_id: '', city_id: '', status: 'offline', plate: '', vin: '', imei: '', notes: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!open) setForm({ code: '', model_id: '', city_id: '', status: 'offline', plate: '', vin: '', imei: '', notes: '' });
  }, [open]);
  // Preselect once the lists arrive, so the common case is two fields.
  useEffect(() => {
    setForm((f) => ({
      ...f,
      model_id: f.model_id || models?.[0]?.id || '',
      city_id: f.city_id || cities[0]?.id || '',
    }));
  }, [models, cities]);

  const create = useMutation({
    mutationFn: () => ds.createVehicle({
      code: form.code.trim(),
      model_id: form.model_id,
      city_id: form.city_id || null,
      status: form.status,
      plate: form.plate.trim() || null,
      vin: form.vin.trim() || null,
      imei: form.imei.trim() || null,
      notes: form.notes.trim() || null,
    }),
    onSuccess: (v) => onCreated(v.code),
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Could not add the vehicle', 'error'),
  });

  const ready = form.code.trim().length >= 2 && !!form.model_id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add vehicle"
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Adding…' : 'Add vehicle'}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-md)' }}>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Code" required hint="Printed on the QR label. Must be unique.">
            <Input value={form.code} onChange={set('code')} placeholder="ATH-1042" />
          </Field>
          <Field label="Model" required>
            <Select value={form.model_id} onChange={set('model_id')}>
              {(models ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Field label="City">
            <Select value={form.city_id} onChange={set('city_id')}>
              <option value="">—</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Initial status" hint="Offline until the device reports in.">
            <Select value={form.status} onChange={set('status')}>
              {INITIAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Plate"><Input value={form.plate} onChange={set('plate')} /></Field>
          <Field label="VIN"><Input value={form.vin} onChange={set('vin')} /></Field>
        </div>
        <Field
          label="IMEI (optional)"
          hint="Fits an already-provisioned device to this vehicle. The IMEI stays on the device record — vehicles are never identified by it."
        >
          <Input className="mono" value={form.imei} onChange={set('imei')} placeholder="860000000000000" />
        </Field>
        <Field label="Notes"><Textarea value={form.notes} onChange={set('notes')} rows={2} /></Field>
      </div>
    </Modal>
  );
}
