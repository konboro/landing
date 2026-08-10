// One hook behind all five pricing catalogues.
//
// Every one of them is the same shape — create a row, update a row, remove a row
// through `admin-write` — and the only things that differ are the table name, the
// noun in the sentences an operator reads, and whether the server can really
// delete or has to deactivate. Those are parameters, not five copies of the same
// mutation pair.

import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth, type Permission } from '@/context/AuthContext';
import type { ConfigTable } from '@/data/api';

const PRICING_EDIT: Permission = 'pricing.edit';

/**
 * The sentence the edge function wrote for the operator.
 *
 * supabase-js flattens every non-2xx into `FunctionsHttpError`, whose `.message`
 * is always the same useless "Edge Function returned a non-2xx status code". The
 * real reason — "tier must ascend", "penalty not found", "not an active staff
 * member" — is in the response body, so read that first and only fall back when
 * there is nothing there.
 */
export async function edgeMessage(e: unknown, fallback: string): Promise<string> {
  const ctx = (e as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx?.json) {
    try {
      const body = (await ctx.json()) as { message?: string; error?: string } | null;
      const msg = body?.message ?? body?.error;
      if (msg) return msg;
    } catch {
      /* the body was not JSON — fall through */
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export interface CatalogueMeta {
  table: ConfigTable;
  /** Lower-case singular, dropped verbatim into toasts and confirms. */
  noun: string;
  /**
   * Whether `admin-write` may really DELETE this table. False means rows are
   * referenced by receipts, disputes or ride history and get deactivated
   * instead. The server is still the authority — this only decides what the
   * confirm dialog promises before the call goes out.
   */
  hardDelete: boolean;
}

export interface CatalogueApi {
  /** False → the whole tab renders read-only, buttons and row clicks included. */
  canEdit: boolean;
  submit: (id: string | null, values: Record<string, unknown>) => void;
  remove: (id: string, reason: string) => void;
  saving: boolean;
  removing: boolean;
  /** Server's own words, shown inside the form so the typed values survive. */
  formError: string | null;
  clearFormError: () => void;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function useCatalogue(
  { table, noun, hardDelete }: CatalogueMeta,
  onSaved?: () => void,
): CatalogueApi {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  // Everything on this page is read out of the one `panel-data` payload, so one
  // invalidation refreshes every tab — including the tables that show a row's
  // derived columns (units sold, active subscribers) which a write can move.
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['panel-data'] });
  }, [qc]);

  const save = useMutation({
    mutationFn: (input: { id: string | null; values: Record<string, unknown> }) =>
      input.id
        ? ds.configUpdate<unknown>(table, input.id, input.values)
        : ds.configCreate<unknown>(table, input.values),
    onSuccess: (_row, input) => {
      setFormError(null);
      toast.push(`${capitalise(noun)} ${input.id ? 'updated' : 'created'}`, 'success');
      refresh();
      onSaved?.();
    },
    onError: async (e: unknown) => {
      setFormError(await edgeMessage(e, `Could not save the ${noun}.`));
    },
  });

  const del = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      ds.configRemove(table, input.id, input.reason),
    onSuccess: (res) => {
      // What actually happened is the server's call, not ours: a catalogue the
      // history still points at comes back `deactivated`, and telling an
      // operator "deleted" when the row is still there is a lie they will act on.
      const deactivated = res?.deactivated ?? !hardDelete;
      toast.push(
        deactivated
          ? `${capitalise(noun)} deactivated — existing rides and receipts still resolve it`
          : `${capitalise(noun)} deleted`,
        'success',
      );
      refresh();
    },
    onError: async (e: unknown) => {
      toast.push(await edgeMessage(e, `Could not remove the ${noun}.`), 'error');
    },
  });

  return {
    canEdit: can(PRICING_EDIT),
    submit: (id, values) => save.mutate({ id, values }),
    remove: (id, reason) => del.mutate({ id, reason }),
    saving: save.isPending,
    removing: del.isPending,
    formError,
    clearFormError: () => setFormError(null),
  };
}
