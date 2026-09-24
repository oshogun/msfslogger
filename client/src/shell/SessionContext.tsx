import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../utils/api';
import type { LoginRequest, LoginResponse, SessionResponse, SessionUser } from '../types';

export type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: SessionUser };

export type SessionValue = SessionState & {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Marks the session anonymous without a network round trip. For a
   * mid-session 401 on some other call: the server already dropped us, so
   * there is nothing to ask it — this just makes the client's own state
   * agree, which is what lets RequireAuth's existing anonymous branch redirect.
   */
  expire: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Mounted once at the top of App so RequireAuth and the header's logout
 * control see the same value. Calls GET /api/auth/session once on mount;
 * login/logout update the same in-memory state rather than triggering a
 * second round trip.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null });

  useEffect(() => {
    let cancelled = false;
    apiFetch<SessionResponse>('/api/auth/session')
      .then(res => {
        if (cancelled) return;
        setState(res.authenticated ? { status: 'authenticated', user: res.user } : { status: 'anonymous', user: null });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'anonymous', user: null });
      });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const body: LoginRequest = { username, password };
    const res = await apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setState({ status: 'authenticated', user: res.user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // logout is idempotent server-side; the client clears its own state
      // regardless of how the request landed.
    }
    setState({ status: 'anonymous', user: null });
  }, []);

  const expire = useCallback(() => {
    setState({ status: 'anonymous', user: null });
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ ...state, login, logout, expire }),
    [state, login, logout, expire],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
