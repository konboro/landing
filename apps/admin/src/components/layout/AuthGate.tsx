import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { LoginPage } from '@/pages/Login';
import { Spinner } from '@/components/ui/primitives';

/**
 * Blocks the panel until a staff session exists.
 *
 * No-op in mock mode (the demo panel is always "signed in"); in live mode it
 * shows the login screen until `admin-me` confirms an active staff row.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { live, loading, isAuthenticated } = useAuth();

  if (!live) return <>{children}</>;

  if (loading && !isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--color-bg)' }}>
        <Spinner />
      </div>
    );
  }
  if (!isAuthenticated) return <LoginPage />;
  return <>{children}</>;
}
