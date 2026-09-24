import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'carbonproto.session';
const LOGIN_DELAY_MS = 300;
const PROTOTYPE_PASSWORD = 'sabia';

export type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: { username: string } };

export type SessionValue = SessionState & {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

function readStored(): { username: string } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username?: unknown };
    return typeof parsed.username === 'string' ? { username: parsed.username } : null;
  } catch {
    return null;
  }
}

/** Fake session backed by localStorage; no cookie, no network. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null });

  useEffect(() => {
    const user = readStored();
    setState(user ? { status: 'authenticated', user } : { status: 'anonymous', user: null });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await new Promise(resolve => setTimeout(resolve, LOGIN_DELAY_MS));
    if (password !== PROTOTYPE_PASSWORD) throw new Error('Invalid username or password');
    const user = { username: username.trim() || 'operator' };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    setState({ status: 'authenticated', user });
  }, []);

  const logout = useCallback(async () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ status: 'anonymous', user: null });
  }, []);

  const value = useMemo<SessionValue>(() => ({ ...state, login, logout }), [state, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
