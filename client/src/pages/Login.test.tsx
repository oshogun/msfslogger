import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Login } from './Login';
import { SessionProvider } from '../hooks/useSession';
import { formatDuration } from '../utils/format';
import { mockFetchRoutes } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';

const ANONYMOUS_SESSION: ResponseTuple = [200, { authenticated: false, user: null }];

/**
 * One test proving the whole component-test harness works end to end:
 * jsdom + React Testing Library render a real page, the stubbed global
 * `fetch` answers the calls that page's own hooks make, and a real app
 * utility import resolves correctly under this config.
 */
describe('component test harness smoke test', () => {
  it('renders Login, submits real credentials through the stubbed fetch, and formats a duration', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === '/api/auth/session' && (!init || init.method === undefined)) {
          return new Response(JSON.stringify({ authenticated: false, user: null }), { status: 200 });
        }
        if (url === '/api/auth/login' && init?.method === 'POST') {
          return new Response(JSON.stringify({ user: { username: 'operator' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'unexpected fetch ' + url }), { status: 500 });
      })
    );

    render(
      <MemoryRouter initialEntries={['/login']}>
        <SessionProvider>
          <Login />
        </SessionProvider>
      </MemoryRouter>
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/password/i), 'e2e-password-123');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(calls.some(c => c.url === '/api/auth/login')).toBe(true);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const loginCall = calls.find(c => c.url === '/api/auth/login');
    expect(loginCall?.init?.body).toBe(JSON.stringify({ username: 'operator', password: 'e2e-password-123' }));

    expect(formatDuration(3725)).toBe('1h 02m');
  });
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <SessionProvider>
        <Login />
      </SessionProvider>
    </MemoryRouter>
  );
}

describe('failed login', () => {
  it('renders the server\'s 401 error message', async () => {
    mockFetchRoutes({
      '/api/auth/session': ANONYMOUS_SESSION,
      '/api/auth/login': [401, { error: 'Invalid username or password' }],
    });

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password');
  });

  it('renders a 429 throttle message the same way, verbatim', async () => {
    mockFetchRoutes({
      '/api/auth/session': ANONYMOUS_SESSION,
      '/api/auth/login': [429, { error: 'Too many login attempts. Try again in 30 seconds.', retryAfterSec: 30 }],
    });

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/password/i), 'whatever');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many login attempts. Try again in 30 seconds.');
  });
});

describe('client-side validation', () => {
  it('never calls the login endpoint when both fields are left empty', async () => {
    mockFetchRoutes({ '/api/auth/session': ANONYMOUS_SESSION });

    renderLogin();
    await userEvent.setup().click(screen.getByRole('button', { name: /log in/i }));

    // required on both <input>s stops the browser from ever dispatching
    // submit — so the network call this test really cares about (login)
    // must never have gone out.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/session')).toBe(true);
    });
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/login')).toBe(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never calls the login endpoint when the password is left empty', async () => {
    mockFetchRoutes({ '/api/auth/session': ANONYMOUS_SESSION });

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/login')).toBe(false);
  });

  it('never calls the login endpoint when the username is left empty', async () => {
    mockFetchRoutes({ '/api/auth/session': ANONYMOUS_SESSION });

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/password/i), 'e2e-password-123');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/login')).toBe(false);
  });
});
