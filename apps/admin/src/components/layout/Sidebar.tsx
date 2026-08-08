import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NAV, NAV_GROUPS } from './nav';
import { useDS } from '@/context/DataContext';
import { useBrand } from '@/context/BrandContext';

const APP_VERSION = '0.1.0';

export function Sidebar({ open }: { open: boolean }) {
  const ds = useDS();
  const { brand } = useBrand();
  const { data: queue } = useQuery({ queryKey: ['verification'], queryFn: () => ds.listVerification() });
  const pending = queue?.filter((q) => q.trip.photo_review === 'pending').length ?? 0;

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand">
        {/* Inline SVG wordmark when the brand ships one, monogram chip otherwise.
            Inline keeps the panel self-contained — no external asset host. */}
        {brand.assets.wordmark ? (
          <span
            className="wordmark"
            aria-label={brand.name}
            dangerouslySetInnerHTML={{ __html: brand.assets.wordmark }}
          />
        ) : (
          <>
            <span className="logo" aria-hidden>{brand.assets.monogram}</span>
            <span>
              {brand.name} <span style={{ color: 'var(--chrome-text-muted)', fontWeight: 500 }}>Admin</span>
            </span>
          </>
        )}
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
      <div style={{ marginTop: 'auto', padding: 'var(--space-md)', fontSize: 11, color: 'var(--chrome-text-dim)' }}>
        v{APP_VERSION} · {brand.legal.legalName} · {brand.domain}
      </div>
    </aside>
  );
}
