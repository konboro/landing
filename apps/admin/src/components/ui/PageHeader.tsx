import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div style={{ marginBottom: 'var(--space-lg)' }}>
      {back ? <Link to={back.to} className="muted" style={{ fontSize: 13 }}>‹ {back.label}</Link> : null}
      <div className="between" style={{ marginTop: back ? 6 : 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>{title}</h2>
          {sub ? <div className="muted" style={{ marginTop: 2 }}>{sub}</div> : null}
        </div>
        {actions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
      </div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="between" style={{ margin: '4px 0 10px' }}>
      <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>{children}</h3>
      {right}
    </div>
  );
}
