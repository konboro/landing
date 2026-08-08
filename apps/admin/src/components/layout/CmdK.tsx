import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDS } from '@/context/DataContext';
import type { SearchResult } from '@/data/api';

const ICONS: Record<SearchResult['kind'], string> = { customer: '👤', vehicle: '🔋', ride: '🛴' };

export function CmdK({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ds = useDS();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) { setQ(''); setResults([]); setActive(0); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      ds.search(q).then((r) => { if (alive) { setResults(r); setActive(0); } });
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, ds]);

  if (!open) return null;

  const go = (r: SearchResult) => { nav(r.to); onClose(); };

  return (
    <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={{ padding: 'var(--space-md) var(--space-lg)', borderBottom: '1px solid var(--color-border)' }}>
          <input
            ref={inputRef}
            className="input"
            style={{ border: 'none', fontSize: 16, padding: 4 }}
            placeholder="Search customer by phone, vehicle by code, trip by id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter' && results[active]) go(results[active]!);
            }}
          />
        </div>
        <div className="modal-body" style={{ maxHeight: 420, padding: 8 }}>
          {q && results.length === 0 ? (
            <div className="muted" style={{ padding: 16, textAlign: 'center' }}>No matches for “{q}”.</div>
          ) : null}
          {!q ? (
            <div className="muted" style={{ padding: 16, fontSize: 13 }}>Type to search. Results include customers, vehicles and trips.</div>
          ) : null}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              onClick={() => go(r)}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '9px 12px', border: 'none', borderRadius: 8, cursor: 'pointer',
                background: i === active ? 'var(--color-primary-soft)' : 'transparent',
              }}
            >
              <span style={{ fontSize: 18 }}>{ICONS[r.kind]}</span>
              <span style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{r.label}</div>
                <div className="muted" style={{ fontSize: 12 }}>{r.sub}</div>
              </span>
              <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{r.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
