import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Form, InlineLoading, InlineNotification, PasswordInput, Stack, TextInput, Tile } from '@carbon/react';
import { useSession } from '../shell/SessionContext';
import './login/login.scss';

interface FromLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

/** Lives outside the shell. Redirects to the `from` location RequireAuth carried, else '/'. */
export function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fromLoc = (location.state as { from?: FromLocation } | null)?.from;
  const target = fromLoc ? `${fromLoc.pathname}${fromLoc.search ?? ''}${fromLoc.hash ?? ''}` : '/';

  if (session.status === 'authenticated') return <Navigate to={target} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await session.login(username, password);
      navigate(target, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <Tile className="login-card">
        <Form onSubmit={onSubmit} aria-label="Sign in">
          <Stack gap={6}>
            <h1 className="login-title">
              <img src="/sabia-logo.svg" alt="Sabiá" className="login-logo" />
            </h1>
            {error && (
              <InlineNotification
                kind="error"
                lowContrast
                hideCloseButton
                role="alert"
                title={error}
              />
            )}
            <TextInput
              id="login-username"
              name="username"
              labelText="Username"
              value={username}
              autoComplete="username"
              autoFocus
              required
              disabled={submitting}
              onChange={e => setUsername(e.target.value)}
            />
            <PasswordInput
              id="login-password"
              name="password"
              labelText="Password"
              value={password}
              autoComplete="current-password"
              required
              disabled={submitting}
              onChange={e => setPassword(e.target.value)}
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? <InlineLoading description="Signing in…" /> : 'Sign in'}
            </Button>
          </Stack>
        </Form>
      </Tile>
    </main>
  );
}
