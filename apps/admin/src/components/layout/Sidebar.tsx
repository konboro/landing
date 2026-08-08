import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NAV, NAV_GROUPS } from './nav';
import { useDS } from '@/context/DataContext';

export function Sidebar({ open }: { open: boolean }) {
  const ds = useDS();
  const { data: queue } = useQuery({ queryKey: ['verification'], queryFn: () => ds.listVerification() });
  const pending = queue?.filter((q) => q.trip.photo_review === 'pending').length ?? 0;

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand">
        <span className="logo">P</span>
        <span>Penny <span style={{ color: 'var(--pal-ink400)', fontWeight: 500 }}>Admin</span></span>
      </div>
      {NAV_GROUPS.map((group) => (
        <div className="sidebar-section" key={group}>
          <div className="sidebar-section-title">{group}</div>
          {NAV.filter((n) => n.group === group).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="icon">{n.icon}</span>
              <span>{n.label}</span>
              {n.badgeKey === 'verification' && pending > 0 ? <span className="nav-badge">{pending}</span> : null}
            </NavLink>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 'auto', padding: 'var(--space-md)', fontSize: 11, color: 'var(--pal-ink500)' }}>
        v0.1.0 · Athens
      </div>
    </aside>
  );
}
