import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, InlineNotification, PasswordInput, Stack, TextInput, Tile } from '@carbon/react';
import { useSession } from '../shell/SessionContext';

export function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  if (session.status === 'authenticated') return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await session.login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <Tile style={{ width: 'min(24rem, 90vw)' }}>
        <form onSubmit={onSubmit}>
          <Stack gap={6}>
            <img src="/sabianotext.svg" alt="Sabiá" style={{ height: '2rem', justifySelf: 'start' }} />
            <TextInput id="login-username" labelText="Username" value={username} autoComplete="username"
              onChange={e => setUsername(e.target.value)} />
            <PasswordInput id="login-password" labelText="Password" value={password} autoComplete="current-password"
              onChange={e => setPassword(e.target.value)} />
            {error && <InlineNotification kind="error" lowContrast hideCloseButton title={error} />}
            <Button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</Button>
          </Stack>
        </form>
      </Tile>
    </div>
  );
}
