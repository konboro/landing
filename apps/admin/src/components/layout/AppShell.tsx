import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CmdK } from './CmdK';
import { NAV } from './nav';
import { useAuth } from '@/context/AuthContext';
import { BUILT_IN_BRANDS, useBrand } from '@/context/BrandContext';

export function AppShell() {
  const loc = useLocation();
  const { staff } = useAuth();
  const { brand, setBrand, mode, setMode } = useBrand();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdkOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { setSidebarOpen(false); }, [loc.pathname]);

  const title = pageTitle(loc.pathname);

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} />
      {/* Rendered only while the drawer is open, so it never covers the desktop
          layout. Tapping it closes the menu — otherwise the only way out is
          picking a link. */}
      {sidebarOpen ? (
        <button
          className="sidebar-scrim"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <div className="app-main">
        <header className="topbar">
          <button
            className="btn btn-ghost btn-icon menu-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={sidebarOpen}
          >
            ☰
          </button>
          <h1>{title}</h1>
          <div className="topbar-spacer" />
          <button className="cmdk-trigger" onClick={() => setCmdkOpen(true)}>
            <span>🔍</span>
            <span>Search…</span>
            <kbd>⌘K</kbd>
          </button>
          {/* White-label switcher: re-themes the whole panel instantly. A brand
              edited in Settings → Branding is kept as an extra option. */}
          <select
            className="select hide-sm"
            style={{ width: 'auto' }}
            value={BUILT_IN_BRANDS.some((b) => b.id === brand.id) ? brand.id : '__custom'}
            onChange={(e) => {
              const next = BUILT_IN_BRANDS.find((b) => b.id === e.target.value);
              if (next) setBrand(next);
            }}
            title="Demo: switch operator brand"
          >
            {BUILT_IN_BRANDS.map((b) => <option key={b.id} value={b.id}>{b.assets.emoji ?? '🎨'} {b.name}</option>)}
            {BUILT_IN_BRANDS.some((b) => b.id === brand.id) ? null : <option value="__custom">🎨 {brand.name} (custom)</option>}
          </select>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle theme"
          >
            {mode === 'dark' ? '☀️' : '🌙'}
          </button>
          {/* The role is whatever the server says it is. The dropdown that used
              to sit here let anyone pick their own role to "see permission
              gating" — harmless against the mock, misleading against live data. */}
          <span className="badge hide-sm" title="Your role, assigned server-side">{staff.role}</span>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--color-primary)', color: 'var(--color-on-primary)', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
            {staff.name[0]}
          </div>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
      <CmdK open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </div>
  );
}

function pageTitle(path: string): string {
  if (path === '/') return 'Dashboard';
  const seg = path.split('/')[1] ?? '';
  const match = NAV.find((n) => n.to === `/${seg}`);
  if (match) return match.label;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}
