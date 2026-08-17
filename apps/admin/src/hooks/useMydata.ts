import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import type { MydataAction, MydataDetail } from '@/data/api';
import type {
  MydataHealth,
  MydataShadowDay,
  MydataState,
  PaymentReceipt,
  UUID,
} from '@/types/domain';

const KEY = ['mydata'] as const;

/**
 * myDATA state for the review desk.
 *
 * Its own query rather than part of getPanelData: the submissions table carries
 * 20 months of receipt history and no other screen needs any of it.
 */
export function useMydata() {
  const ds = useDS();
  return useQuery<MydataState>({
    queryKey: KEY,
    queryFn: () => ds.getMydata(),
    // Receipts move on a worker's schedule, not a person's. Refetching on an
    // interval keeps a reviewer's queue honest while they work through it.
    refetchInterval: 60_000,
  });
}

/**
 * myDATA rollup for the dashboard.
 *
 * `dashboard.read` and `mydata.read` are different permissions — an ops manager
 * has the first and not the second. A 403 here means "this person does not look
 * after tax filings", so the tile hides itself rather than showing an error on
 * a screen they open every morning.
 */
export function useMydataHealth() {
  const ds = useDS();
  return useQuery<MydataHealth | null>({
    queryKey: ['mydata-health'],
    queryFn: () => ds.getMydataHealth(),
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Receipt state for the rides currently on screen.
 *
 * Keyed on the ids so paging refetches, and one request covers the page — a
 * per-row query would be 25 round trips for one column.
 */
export function useReceiptsForTrips(tripIds: UUID[]) {
  const ds = useDS();
  const key = tripIds.slice().sort().join(',');
  return useQuery<PaymentReceipt[]>({
    queryKey: ['mydata-for-trips', key],
    queryFn: () => ds.getReceiptsForTrips(tripIds),
    enabled: tripIds.length > 0,
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * Day-by-day coverage of the shadow run.
 *
 * Fetched only when the Daily tab is open, and empty until a shadow endpoint is
 * actually receiving — so it costs nothing before then and needs no flag.
 */
export function useMydataShadowCompare(enabled: boolean) {
  const ds = useDS();
  return useQuery<MydataShadowDay[]>({
    queryKey: ['mydata-shadow-compare'],
    queryFn: () => ds.getMydataShadowCompare(),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** One receipt with its document, response, linked payment and audit trail. */
export function useMydataDetail(id: UUID | null) {
  const ds = useDS();
  return useQuery<MydataDetail>({
    queryKey: ['mydata-detail', id],
    queryFn: () => ds.getMydataDetail(id as UUID),
    enabled: id != null,
  });
}

/**
 * Retry / cancel / mark_filed / review / set_mode.
 *
 * Every one of these can fail a business rule server-side — already filed, a
 * MARK that belongs to another receipt, a series floor violation. The error is
 * surfaced verbatim rather than swallowed: on a page about tax filings, a button
 * that silently does nothing is worse than one that explains itself.
 */
export function useMydataMutation() {
  const ds = useDS();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: MydataAction; body: Record<string, unknown> }) =>
      ds.mydataMutate(action, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['mydata-detail'] });
    },
  });
}

/** Turn whatever the edge function threw into something a person can act on. */
export function mydataErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; context?: { body?: unknown } };
    if (typeof e.message === 'string' && e.message.length > 0) return e.message;
  }
  return 'The action failed. Check the browser console for the response.';
}
