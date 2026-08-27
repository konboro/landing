// React Query wiring for a config catalogue: one list query plus create /
// update / remove mutations that report the truth in a toast and refresh the
// screens showing the same rows.
//
// Transport is the DataSource's `config*` verbs (`admin-list` for reads,
// `admin-write` for writes). Nothing here talks to a table directly — Hard
// Rule #6 — and every write is permission-checked and audited server-side.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/Toast';
import { useDS } from '@/context/DataContext';
import type { ConfigKey, ConfigTable } from '@/data/api';
import type { QueryParams, SortSpec } from '@/data/query';

/**
 * `admin-list` sorts by `created_at` when the caller sends none, and two of
 * these tables genuinely do not have that column — the request then fails with
 * a 500 that reads like an outage. Sending an explicit sort for those is the
 * difference between a working screen and a mystery.
 */
const DEFAULT_SORT: Partial<Record<ConfigTable, SortSpec[]>> = {
  faq_items: [{ field: 'sort', dir: 'asc' }],
  app_content: [{ field: 'key', dir: 'asc' }],
};

/**
 * supabase-js reports every failed function call as "Edge Function returned a
 * non-2xx status code" and hides the real reason on `context`. Showing the raw
 * message in a toast tells an operator nothing, so unwrap the server's own
 * message ("key.key is required for app_content", "forbidden: settings.edit").
 */
async function edgeMessage(e: unknown, fallback: string): Promise<string> {
  const ctx = (e as { context?: { json?: () => Promise<{ message?: string }> } })?.context;
  if (ctx?.json) {
    try {
      const body = await ctx.json();
      if (body?.message) return body.message;
    } catch {
      /* not JSON — fall through */
    }
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Runs a write and rethrows a plain Error carrying the server's message. */
async function withEdgeError<T>(fallback: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw new Error(await edgeMessage(e, fallback));
  }
}

export interface ConfigResourceOptions {
  /** Singular, lower case — used verbatim in toasts ("FAQ entry created"). */
  label: string;
  list?: QueryParams;
  /** Skip the list query when the section is permission-gated off. */
  enabled?: boolean;
}

/** Rows come straight from Postgres. Composite-key tables have no `id`. */
export interface ConfigRow {
  id?: string;
  [key: string]: unknown;
}

export function useConfigResource<T extends ConfigRow>(
  table: ConfigTable,
  opts: ConfigResourceOptions,
) {
  const { label, list, enabled = true } = opts;
  const ds = useDS();
  const toast = useToast();
  const qc = useQueryClient();

  const params: QueryParams = {
    pageSize: 200,
    ...list,
    sort: list?.sort ?? DEFAULT_SORT[table],
  };

  const query = useQuery({
    queryKey: ['config', table, params],
    queryFn: () => ds.configList<T>(table, params),
    enabled,
  });

  // `admin-panel-data` carries copies of several of these tables, so a write has
  // to invalidate it too or half the panel keeps showing the old row.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['config', table] });
    void qc.invalidateQueries({ queryKey: ['panel-data'] });
  };
  const fail = (e: unknown) =>
    toast.push(e instanceof Error ? e.message : `Could not save the ${label}`, 'error');

  const create = useMutation({
    mutationFn: (v: { values: Record<string, unknown> }) =>
      withEdgeError(`Could not create the ${label}`, () => ds.configCreate<T>(table, v.values)),
    onSuccess: () => { toast.push(`${cap(label)} created`, 'success'); refresh(); },
    onError: fail,
  });

  const update = useMutation({
    // `key` is a uuid string for almost everything, and an object of the key
    // columns for composite tables like app_content (key, lang).
    mutationFn: (v: { key: ConfigKey; values: Record<string, unknown> }) =>
      withEdgeError(`Could not save the ${label}`, () => ds.configUpdate<T>(table, v.key, v.values)),
    onSuccess: () => { toast.push(`${cap(label)} saved`, 'success'); refresh(); },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (v: { key: ConfigKey; reason?: string }) =>
      withEdgeError(`Could not remove the ${label}`, () => ds.configRemove(table, v.key, v.reason)),
    onSuccess: (res) => {
      // The server decides which of the two happened; say what it actually did.
      // A row still referenced by receipts or history is kept and switched off.
      toast.push(
        res.deactivated
          ? `${cap(label)} deactivated — kept because history still refers to it`
          : `${cap(label)} deleted`,
        'success',
      );
      refresh();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : `Could not remove the ${label}`, 'error'),
  });

  return {
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    create,
    update,
    remove,
    busy: create.isPending || update.isPending || remove.isPending,
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
