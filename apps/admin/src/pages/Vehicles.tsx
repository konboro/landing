import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type Column, type SavedView } from '@/components/ui/DataTable';
import { useTableState } from '@/hooks/useTableState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, Button } from '@/components/ui/primitives';
import { VehicleStatusBadge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/Modal';
import { formatSoc, relativeTime, socColor } from '@/lib/format';
import { colors } from '@penny/ui';
import type { VehicleRow } from '@/types/domain';

const SOC_COL = { ok: colors.success, warn: colors.warning, crit: colors.danger };

export function VehiclesPage() {
  const ds = useDS();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const state = useTableState({ sort: [{ field: 'last_seen', dir: 'desc' }] });
  const { data, isLoading } = useQuery({ queryKey: ['vehicles', state.params], queryFn: () => ds.listVehicles(state.params) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState<null | 'maintenance' | 'locate'>(null);

  const bulk = useMutation({
    mutationFn: async (action: 'maintenance' | 'locate') => {
      for (const id of selected) {
        if (action === 'maintenance') await ds.setVehicleStatus(id, 'maintenance', 'Bulk set to maintenance');
        else await ds.sendCommand(id, 'locate');
      }
    },
    onSuccess: (_r, action) => { toast.push(`Bulk ${action} on ${selected.size} vehicles`, 'success'); setSelected(new Set()); setBulkOpen(null); qc.invalidateQueries({ queryKey: ['vehicles'] }); },
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
      <PageHeader title="Vehicles" sub="Fleet table with sort, filter, bulk actions and export" />
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
        toolbarActions={selected.size > 0 && can('vehicles.command') ? (
          <>
            <span className="muted" style={{ fontSize: 13 }}>{selected.size} selected</span>
            <Button size="sm" onClick={() => setBulkOpen('locate')}>Locate all</Button>
            <Button size="sm" variant="danger" onClick={() => setBulkOpen('maintenance')}>→ Maintenance</Button>
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
    </div>
  );
}
