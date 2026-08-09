import { useState, type FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useBrand } from '@/context/BrandContext';
import { Card, Button, Field, Input } from '@/components/ui/primitives';

/**
 * Staff sign-in. Only rendered in live mode — the mock data source keeps the
 * panel open so it can be demoed without a backend.
 *
 * Email + password because it needs no extra provider setup. Riders use phone
 * OTP; a rider account that signs in here is rejected by `admin-me` (403).
 */
export function LoginPage() {
  const { signIn, loading, authError } = useAuth();
  const { brand } = useBrand();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    await signIn(email.trim(), password);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--color-bg)',
        padding: 'var(--space-lg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              borderRadius: 'var(--radius-lg)',
              background: 'var(--color-primary)',
              color: 'var(--color-on-primary)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 24,
              fontWeight: 700,
              margin: '0 auto var(--space-md)',
            }}
          >
            {brand.assets.monogram}
          </div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{brand.name} Admin</h1>
          <p className="muted" style={{ marginTop: 4 }}>Sign in with your staff account</p>
        </div>

        <Card>
          <form className="card-pad stack" style={{ gap: 'var(--space-md)' }} onSubmit={submit}>
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                placeholder="you@company.com"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                placeholder="••••••••"
              />
            </Field>

            {authError ? (
              <div
                role="alert"
                style={{
                  background: 'var(--color-danger-soft, rgba(224,65,65,0.10))',
                  color: 'var(--color-danger)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-sm) var(--space-md)',
                  fontSize: 13,
                }}
              >
                {authError}
              </div>
            ) : null}

            <Button type="submit" variant="primary" disabled={loading || !email || !password}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="muted" style={{ textAlign: 'center', marginTop: 'var(--space-lg)', fontSize: 12 }}>
          Access is limited to active staff accounts.
        </p>
      </div>
    </div>
  );
}
