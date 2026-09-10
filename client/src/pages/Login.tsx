import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { useSession } from '../hooks/useSession';

interface LocationState {
  from?: Location;
}

/**
 * Username + password form. On success navigates to the `from` location the
 * redirect carried, defaulting to '/'. On 401 renders the server's message
 * verbatim ('Invalid username or password'); on 429 renders the server's
 * message including retryAfterSec. Never distinguishes unknown-user from
 * wrong-password, because the server does not either (design.md §9.2, §14.1).
 */
export function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await session.login(username, password);
      const from = (location.state as LocationState | null)?.from;
      navigate(from ? `${from.pathname}${from.search}${from.hash}` : '/', { replace: true });
    } catch (err) {
      // The server's message is rendered verbatim, whatever it is — an
      // "Invalid username or password" 401 or a "Too many login attempts..."
      // 429 look the same here, deliberately (§9.2, §14.1).
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>msfs<span>logger</span></h1>
        {error && <p className="login-error" role="alert">{error}</p>}
        <label>
          Username
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
