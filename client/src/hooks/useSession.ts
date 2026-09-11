import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../utils/api';
import type { LoginRequest, LoginResponse, SessionResponse, SessionUser } from '../types';

export interface SessionState {
  /** 'loading' while the first GET /api/auth/session is still in flight. */
  status: 'loading' | 'authenticated' | 'anonymous';
  user: SessionUser | null;
  /** POST /api/auth/login. Resolves on 200, rejects with Error(body.error). */
  login(username: string, password: string): Promise<void>;
  /** POST /api/auth/logout. Always resolves; drives the redirect to /login. */
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Mounted once at the top of App so RequireAuth and Sidebar's logout control
 * see the same value. Calls GET /api/auth/session once on mount; login/logout
 * update the same in-memory state rather than triggering a second round trip.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'anonymous'>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SessionResponse>('/api/auth/session')
      .then(res => {
        if (cancelled) return;
        if (res.authenticated) {
          setUser(res.user);
          setStatus('authenticated');
        } else {
          setUser(null);
          setStatus('anonymous');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const body: LoginRequest = { username, password };
    const res = await apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // logout is idempotent server-side; the client state is cleared
      // regardless of how the request landed.
    }
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<SessionState>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout]
  );

  return createElement(SessionContext.Provider, { value }, children);
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
