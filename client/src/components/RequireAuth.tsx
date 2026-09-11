import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { setUnauthorizedHandler } from '../utils/api';
import { useSession } from '../hooks/useSession';

/**
 * Wraps <AppShell/>. Renders nothing while status === 'loading', redirects to
 * /login when 'anonymous', renders children when 'authenticated'.
 * /login, /print/flight/:id and /print/trip/:id are NOT wrapped.
 *
 * Registers the module-level 401 handler on mount and clears it on unmount, so
 * a mid-session expiry (any gated /api call answering 401) bounces the
 * operator to /login rather than leaving a half-loaded protected page up.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef<Location>(location);
  locationRef.current = location;

  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigate('/login', { state: { from: locationRef.current }, replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  if (session.status === 'loading') return null;

  if (session.status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
