import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { useSession } from '../hooks/useSession';
import type { Flight, Trip } from '../types';

const COLLAPSE_KEY = 'sidebarCollapsed';
const COLLAPSE_DEFAULT_BREAKPOINT = 900;
const REFRESH_INTERVAL_MS = 30000;

/**
 * Which trip (if any) the current route implies should be expanded: the trip
 * itself on /trip/:id, or the trip holding the open flight on /flight/:id.
 * Neither route is guaranteed to be a match (id may not exist yet, or the
 * flight may be ungrouped) — null covers both.
 */
function routeTripId(pathname: string, trips: Trip[]): number | null {
  const tripMatch = /^\/trip\/(\d+)/.exec(pathname);
  if (tripMatch) return Number(tripMatch[1]);

  const flightMatch = /^\/flight\/(\d+)/.exec(pathname);
  if (flightMatch) {
    const flightId = Number(flightMatch[1]);
    const parent = trips.find(t => t.flights.some(f => f.id === flightId));
    return parent ? parent.id : null;
  }

  return null;
}

/** Leg {n} · DEP → ARR, falling back to the aircraft name when neither ICAO is set. */
function legLabel(f: Flight, index: number): string {
  const route = (f.departure_icao || f.arrival_icao)
    ? `${f.departure_icao ?? '???'} → ${f.arrival_icao ?? '???'}`
    : (f.aircraft || 'Unknown');
  return `Leg ${index + 1} · ${route}`;
}

/** Same route-or-aircraft fallback, without the "Leg N" prefix a standalone flight has no use for. */
function flightLabel(f: Flight): string {
  return (f.departure_icao || f.arrival_icao)
    ? `${f.departure_icao ?? '???'} → ${f.arrival_icao ?? '???'}`
    : (f.aircraft || 'Unknown');
}

function navItemClass(extra?: string) {
  return ({ isActive }: { isActive: boolean }) =>
    `sidebar-item${extra ? ` ${extra}` : ''}${isActive ? ' is-active' : ''}`;
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Trips the user has explicitly clicked open/closed — these win over the
  // route-derived auto-expand for as long as the component stays mounted.
  // A ref, not state: recording a toggle never needs a render of its own,
  // the expanded-state update that accompanies it already causes one.
  const userToggledRef = useRef<Set<number>>(new Set());

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (window.localStorage.getItem(COLLAPSE_KEY) === '1') return true;
    return window.innerWidth <= COLLAPSE_DEFAULT_BREAKPOINT;
  });

  const loadData = useCallback(async () => {
    // Same two calls and the same Promise.allSettled Home.tsx uses (lines
    // 24-27) — but failing soft here means rendering whatever loaded rather
    // than bailing out, since a rail with no explanation is worse than a
    // half-populated one.
    const [flightsResult, tripsResult] = await Promise.allSettled([
      apiFetch<Flight[]>('/api/flights'),
      apiFetch<Trip[]>('/api/trips'),
    ]);

    if (flightsResult.status === 'fulfilled') setFlights(flightsResult.value);
    if (tripsResult.status === 'fulfilled') setTrips(tripsResult.value);

    const failure = flightsResult.status === 'rejected'
      ? flightsResult.reason
      : tripsResult.status === 'rejected' ? tripsResult.reason : null;
    setError(failure ? `Couldn't load sidebar: ${(failure as Error).message}` : null);
  }, []);

  // Refetch on mount and whenever the route changes.
  useEffect(() => {
    loadData();
  }, [loadData, location.pathname]);

  // Refetch on a 30s interval and whenever the tab becomes visible again.
  useEffect(() => {
    const interval = setInterval(loadData, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) loadData(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadData]);

  const impliedTripId = useMemo(() => routeTripId(location.pathname, trips), [location.pathname, trips]);

  // Seed/refresh auto-expansion from the route, unless the user has already
  // toggled that trip by hand.
  useEffect(() => {
    if (impliedTripId == null) return;
    if (userToggledRef.current.has(impliedTripId)) return;
    setExpanded(prev => (prev.has(impliedTripId) ? prev : new Set(prev).add(impliedTripId)));
  }, [impliedTripId]);

  function toggleTrip(tripId: number, e: React.MouseEvent) {
    e.stopPropagation();
    userToggledRef.current.add(tripId);
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(tripId) ? next.delete(tripId) : next.add(tripId);
      return next;
    });
  }

  async function handleLogout() {
    await session.logout();
    navigate('/login');
  }

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      if (next) window.localStorage.setItem(COLLAPSE_KEY, '1');
      else window.localStorage.removeItem(COLLAPSE_KEY);
      return next;
    });
  }

  // Home.tsx:161-163, verbatim: flights not present in any trip.
  const tripFlightIds = new Set(trips.flatMap(t => t.flights.map(f => f.id)));
  const ungrouped = flights.filter(f => !tripFlightIds.has(f.id));

  return (
    <nav className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '»' : '«'}
      </button>

      {!collapsed && (
        <div className="sidebar-content">
          <NavLink to="/" end className={navItemClass('sidebar-home')}>Home</NavLink>
          <NavLink to="/flights" className={navItemClass()}>All flights</NavLink>

          {error && <p className="sidebar-error">{error}</p>}

          <div className="sidebar-section">
            <div className="sidebar-section-title">Trips</div>
            {trips.map(trip => {
              const isExpanded = expanded.has(trip.id);
              return (
                <div key={trip.id} className="sidebar-trip">
                  <div className="sidebar-trip-row">
                    <button
                      type="button"
                      className="sidebar-disclosure"
                      onClick={e => toggleTrip(trip.id, e)}
                      aria-label={isExpanded ? 'Collapse trip' : 'Expand trip'}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                    <NavLink to={`/trip/${trip.id}`} className={navItemClass('sidebar-trip-link')}>
                      <span className="sidebar-trip-name">
                        {trip.name}
                        {trip.is_active === 1 && <span className="badge badge-active-trip">Active</span>}
                      </span>
                      <span className="sidebar-leg-count">{trip.flight_count}</span>
                    </NavLink>
                  </div>
                  {isExpanded && (
                    <div className="sidebar-trip-legs">
                      {trip.flights.map((f, i) => (
                        <NavLink key={f.id} to={`/flight/${f.id}`} className={navItemClass('sidebar-leg')}>
                          {legLabel(f, i)}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Flights</div>
            {ungrouped.map(f => (
              <NavLink key={f.id} to={`/flight/${f.id}`} className={navItemClass()}>
                {flightLabel(f)}
              </NavLink>
            ))}
          </div>

          {session.user && (
            <div className="sidebar-section sidebar-account">
              <span className="sidebar-username">{session.user.username}</span>
              <button type="button" className="sidebar-logout" onClick={handleLogout}>
                Log out
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
