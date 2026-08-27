import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { LoginPage } from '@/pages/Login';
import { Spinner } from '@/components/ui/primitives';

/**
 * Blocks the panel until a staff session exists: the login screen stays up until
 * `admin-me` confirms an active staff row.
 *
 * This used to short-circuit whenever the panel was not in "live mode" — a mode
 * chosen by an env var — so a deploy missing that variable served the whole panel
 * with no login at all.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated } = useAuth();

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
