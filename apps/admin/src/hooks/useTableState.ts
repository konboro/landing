import { useCallback, useMemo, useState } from 'react';
import type { QueryParams, SortSpec } from '@/data/query';

export interface TableState {
  params: QueryParams;
  page: number;
  pageSize: number;
  sort: SortSpec[];
  search: string;
  filters: Record<string, string | number | boolean | null | undefined>;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  setSearch: (s: string) => void;
  toggleSort: (field: string, additive?: boolean) => void;
  setFilter: (key: string, value: string | number | boolean | null | undefined) => void;
  resetFilters: () => void;
  applyView: (v: { sort?: SortSpec[]; filters?: Record<string, string | number | boolean | null | undefined>; search?: string }) => void;
}

export function useTableState(opts?: { pageSize?: number; sort?: SortSpec[] }): TableState {
  const [page, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(opts?.pageSize ?? 25);
  const [sort, setSort] = useState<SortSpec[]>(opts?.sort ?? []);
  const [search, setSearchRaw] = useState('');
  const [filters, setFilters] = useState<Record<string, string | number | boolean | null | undefined>>({});

  const setPage = useCallback((p: number) => setPageRaw(Math.max(1, p)), []);
  const setPageSize = useCallback((n: number) => { setPageSizeRaw(n); setPageRaw(1); }, []);
  const setSearch = useCallback((s: string) => { setSearchRaw(s); setPageRaw(1); }, []);
  const setFilter = useCallback((key: string, value: string | number | boolean | null | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPageRaw(1);
  }, []);
  const resetFilters = useCallback(() => { setFilters({}); setSearchRaw(''); setPageRaw(1); }, []);
  const toggleSort = useCallback((field: string, additive = false) => {
    setSort((prev) => {
      const existing = prev.find((s) => s.field === field);
      const nextDir: 'asc' | 'desc' | null = !existing ? 'asc' : existing.dir === 'asc' ? 'desc' : null;
      let base = additive ? prev.filter((s) => s.field !== field) : [];
      if (nextDir) base = [...base, { field, dir: nextDir }];
      return base;
    });
    setPageRaw(1);
  }, []);
  const applyView = useCallback((v: { sort?: SortSpec[]; filters?: Record<string, string | number | boolean | null | undefined>; search?: string }) => {
    if (v.sort) setSort(v.sort);
    if (v.filters) setFilters(v.filters);
    if (v.search !== undefined) setSearchRaw(v.search);
    setPageRaw(1);
  }, []);

  const params = useMemo<QueryParams>(() => ({ page, pageSize, sort, search, filters }), [page, pageSize, sort, search, filters]);

  return { params, page, pageSize, sort, search, filters, setPage, setPageSize, setSearch, toggleSort, setFilter, resetFilters, applyView };
}
