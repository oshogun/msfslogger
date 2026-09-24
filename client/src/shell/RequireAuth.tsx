import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { setUnauthorizedHandler } from '../utils/api';
import { useSession } from './SessionContext';

/**
 * Renders nothing while loading, redirects to /login when anonymous. /login
 * and the print routes are never wrapped in this.
 *
 * Registers the module-level 401 handler on mount and clears it on unmount,
 * so a mid-session expiry (any gated /api call answering 401) bounces the
 * operator to /login rather than leaving a half-loaded protected page up.
 *
 * The handler only calls session.expire() — it does not navigate itself. The
 * session going anonymous is what makes the branch below render <Navigate>,
 * the one and only place that decides to leave the current page. A handler
 * that also navigated would fight that branch: the still-"authenticated"
 * session would let the page mount right back, call the same gated endpoint,
 * 401 again, and loop.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => session.expire());
    return () => setUnauthorizedHandler(null);
  }, [session.expire]);

  if (session.status === 'loading') return null;
  if (session.status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
