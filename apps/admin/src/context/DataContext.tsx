import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getDataSource, type DataSource } from '@/data/api';
import { Spinner } from '@/components/ui/primitives';

const Ctx = createContext<DataSource | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [ds, setDs] = useState<DataSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getDataSource()
      .then((d) => { if (alive) setDs(d); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 24, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <h2>Data source failed to initialize</h2>
          <p className="muted">{error}</p>
          <p className="muted">
            Check <code className="mono">VITE_SUPABASE_URL</code> and{' '}
            <code className="mono">VITE_SUPABASE_ANON_KEY</code>. There is no offline
            mode — the panel only ever shows live data.
          </p>
        </div>
      </div>
    );
  }
  if (!ds) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Spinner size={28} /></div>;
  }
  return <Ctx.Provider value={ds}>{children}</Ctx.Provider>;
}

export function useDS(): DataSource {
  const ds = useContext(Ctx);
  if (!ds) throw new Error('useDS must be used within DataProvider');
  return ds;
}
