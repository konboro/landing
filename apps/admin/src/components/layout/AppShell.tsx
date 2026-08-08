import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CmdK } from './CmdK';
import { NAV } from './nav';
import { useAuth } from '@/context/AuthContext';
import type { StaffRole } from '@penny/db-types';

const ROLES: StaffRole[] = ['owner', 'admin', 'support', 'ops_manager', 'ops', 'accountant', 'readonly'];

export function AppShell() {
  const loc = useLocation();
  const { staff, setRole } = useAuth();
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
      <div className="app-main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon" style={{ display: 'none' }} onClick={() => setSidebarOpen((o) => !o)} aria-label="Menu">☰</button>
          <h1>{title}</h1>
          <div className="topbar-spacer" />
          <button className="cmdk-trigger" onClick={() => setCmdkOpen(true)}>
            <span>🔍</span>
            <span>Search…</span>
            <kbd>⌘K</kbd>
          </button>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={staff.role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            title="Demo: switch role to see permission gating"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
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
