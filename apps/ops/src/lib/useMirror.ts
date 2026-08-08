// Re-query the SQLite mirror whenever it changes (store `rev` bump) or the
// screen re-focuses. Keeps every screen a pure function of local state.
import { useCallback, useEffect, useState } from 'react';
import { useOps } from './store';

export function useMirror<T>(loader: () => Promise<T>, initial: T): {
  data: T;
  loading: boolean;
  reload: () => void;
} {
  const rev = useOps((s) => s.rev);
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, tick]);

  return { data, loading, reload };
}
