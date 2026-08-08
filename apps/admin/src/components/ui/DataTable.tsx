import { useMemo, useState, type ReactNode } from 'react';
import type { Page } from '@/data/query';
import type { TableState } from '@/hooks/useTableState';
import { Button, Input } from './primitives';
import { TableSkeleton, EmptyState } from './feedback';
import { downloadCsv, type CsvColumn } from '@/lib/csv';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  sortField?: string;
  hideable?: boolean;
  defaultHidden?: boolean;
  csv?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
}

export interface SavedView {
  name: string;
  view: Parameters<TableState['applyView']>[0];
}

interface Props<T> {
  columns: Column<T>[];
  data?: Page<T>;
  state: TableState;
  loading?: boolean;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchPlaceholder?: string;
  filtersSlot?: ReactNode;
  savedViews?: SavedView[];
  csvName?: string;
  toolbarActions?: ReactNode;
  emptyTitle?: string;
}

export function DataTable<T>({
  columns,
  data,
  state,
  loading,
  rowKey,
  onRowClick,
  searchPlaceholder = 'Search…',
  filtersSlot,
  savedViews,
  csvName = 'export',
  toolbarActions,
  emptyTitle = 'No results',
}: Props<T>) {
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const visibleColumns = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function exportCsv() {
    if (!data) return;
    const csvCols: CsvColumn<T>[] = visibleColumns.map((c) => ({
      header: c.header,
      value: (row) => (c.csv ? c.csv(row) : String(c.render(row) ?? '')),
    }));
    downloadCsv(csvName, data.rows, csvCols);
  }

  const sortDir = (field: string) => state.sort.find((s) => s.field === field)?.dir;

  return (
    <div className="card">
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="toolbar">
          <Input
            style={{ maxWidth: 260 }}
            placeholder={searchPlaceholder}
            value={state.search}
            onChange={(e) => state.setSearch(e.target.value)}
          />
          {filtersSlot}
          <div className="topbar-spacer" style={{ flex: 1 }} />
          {toolbarActions}
          <div style={{ position: 'relative' }}>
            <Button size="sm" variant="ghost" onClick={() => setPickerOpen((o) => !o)}>⚙ Columns</Button>
            {pickerOpen ? (
              <div className="card" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 30, padding: 10, minWidth: 180, boxShadow: 'var(--shadow-pop)' }}>
                {columns.filter((c) => c.hideable !== false).map((c) => (
                  <label key={c.key} className="checkbox-row" style={{ padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.key)}
                      onChange={() => setHidden((prev) => {
                        const n = new Set(prev);
                        if (n.has(c.key)) n.delete(c.key); else n.add(c.key);
                        return n;
                      })}
                    />
                    <span>{c.header}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <Button size="sm" variant="ghost" onClick={exportCsv}>⬇ CSV</Button>
        </div>
        {savedViews?.length ? (
          <div className="toolbar" style={{ marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>Views:</span>
            {savedViews.map((v) => (
              <button key={v.name} className="chip" onClick={() => state.applyView(v.view)}>{v.name}</button>
            ))}
            <button className="chip" onClick={state.resetFilters}>Reset</button>
          </div>
        ) : null}
      </div>

      <div className="table-wrap">
        {loading ? (
          <TableSkeleton cols={visibleColumns.length} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState title={emptyTitle} hint="Try adjusting filters or search." />
        ) : (
          <table className="data">
            <thead>
              <tr>
                {visibleColumns.map((c) => {
                  const field = c.sortField ?? c.key;
                  const dir = sortDir(field);
                  return (
                    <th
                      key={c.key}
                      className={c.sortable ? 'sortable' : ''}
                      style={{ textAlign: c.align ?? 'left', width: c.width }}
                      onClick={c.sortable ? (e) => state.toggleSort(field, e.shiftKey) : undefined}
                    >
                      {c.header}
                      {c.sortable ? <span className="sort-caret">{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}</span> : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={rowKey(row)} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {visibleColumns.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total > 0 ? (
        <div className="pagination">
          <span className="muted" style={{ fontSize: 13 }}>
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <div className="topbar-spacer" style={{ flex: 1 }} />
          <select className="select" style={{ width: 'auto' }} value={data.pageSize} onChange={(e) => state.setPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <Button size="sm" variant="ghost" disabled={data.page <= 1} onClick={() => state.setPage(data.page - 1)}>‹ Prev</Button>
          <span style={{ fontSize: 13 }}>Page {data.page} / {totalPages}</span>
          <Button size="sm" variant="ghost" disabled={data.page >= totalPages} onClick={() => state.setPage(data.page + 1)}>Next ›</Button>
        </div>
      ) : null}
    </div>
  );
}
