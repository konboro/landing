// Shared server-style query primitives: pagination, multi-sort, filtering.
export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export interface QueryParams {
  page?: number; // 1-based
  pageSize?: number;
  sort?: SortSpec[];
  search?: string;
  filters?: Record<string, string | number | boolean | null | undefined>;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

type Primitive = string | number | boolean | null | undefined;

function getField(row: Record<string, unknown>, field: string): Primitive {
  const v = row[field];
  if (v == null) return v as Primitive;
  if (typeof v === 'object') return JSON.stringify(v);
  return v as Primitive;
}

function compare(a: Primitive, b: Primitive): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export interface QueryOptions<T> {
  searchFields?: (keyof T & string)[];
  filterFns?: Record<string, (row: T, value: string | number | boolean) => boolean>;
}

/** Apply search/filter/sort/paginate to an in-memory array (mock server). */
export function runQuery<T extends Record<string, unknown>>(
  data: T[],
  params: QueryParams,
  opts: QueryOptions<T> = {},
): Page<T> {
  let rows = data.slice();

  // search
  const q = params.search?.trim().toLowerCase();
  if (q && opts.searchFields?.length) {
    rows = rows.filter((r) =>
      opts.searchFields!.some((f) => String(r[f] ?? '').toLowerCase().includes(q)),
    );
  }

  // filters
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      if (value === undefined || value === null || value === '' || value === 'all') continue;
      const fn = opts.filterFns?.[key];
      if (fn) {
        rows = rows.filter((r) => fn(r, value as string | number | boolean));
      } else {
        rows = rows.filter((r) => String(getField(r, key)) === String(value));
      }
    }
  }

  // sort (multi)
  if (params.sort?.length) {
    rows.sort((a, b) => {
      for (const s of params.sort!) {
        const c = compare(getField(a, s.field), getField(b, s.field));
        if (c !== 0) return s.dir === 'asc' ? c : -c;
      }
      return 0;
    });
  }

  const total = rows.length;
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? 25;
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, page, pageSize };
}

export function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
