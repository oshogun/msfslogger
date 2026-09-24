import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { listFlights, listTrips, subscribeMutations } from '../api';
import type { AppShellProps } from './AppShell';

type NavTrips = AppShellProps['trips'];
type NavLoose = AppShellProps['looseFlights'];
export interface NavTree { trips: NavTrips; loose: NavLoose }

/** Which halves of a fetch actually landed; a failed half is omitted, not []. */
interface PartialTree { trips?: NavTrips; loose?: NavLoose }

const route = (dep: string | null, arr: string | null) => `${dep ?? '???'} → ${arr ?? '???'}`;

/** How long a burst of writes is allowed to pile up before the tree is fetched again. */
const MUTATION_DEBOUNCE_MS = 150;
/** Live Sidebar's polling interval (components/Sidebar.tsx). */
const REFRESH_INTERVAL_MS = 30000;

/**
 * `trips` and `loose` are independent: trips carries its own flights embedded
 * (from listTrips()), loose is derived only from listFlights(). So one call
 * failing never has to blank the half that succeeded — the failed half is
 * simply absent from the result and the caller keeps whatever it had.
 */
async function fetchTree(): Promise<PartialTree | null> {
  const [tripsResult, flightsResult] = await Promise.allSettled([listTrips(), listFlights()]);
  if (tripsResult.status === 'rejected' && flightsResult.status === 'rejected') return null;

  const partial: PartialTree = {};
  if (tripsResult.status === 'fulfilled') {
    partial.trips = tripsResult.value.map(t => ({
      id: t.id,
      name: t.name,
      isActive: t.is_active === 1,
      legs: t.flights.map((f, i) => ({ id: f.id, label: `Leg ${i + 1} · ${route(f.departure_icao, f.arrival_icao)}` })),
    }));
  }
  if (flightsResult.status === 'fulfilled') {
    partial.loose = flightsResult.value
      .filter(f => f.trip_id == null)
      .map(f => ({ id: f.id, label: route(f.departure_icao, f.arrival_icao) }));
  }
  return partial;
}

/**
 * SideNav tree from GET /api/trips + GET /api/flights, refetched on mount,
 * on every write (subscribeMutations, debounced), on a route change, on a
 * 30 s interval and when the tab becomes visible again. An empty tree if the
 * very first fetch fails; any later failed refetch — of either half
 * independently — keeps whichever half was already shown. The tree is only
 * replaced when its content actually changed, so an open SideNavMenu keeps
 * its key and does not remount.
 */
export function useNavTree(): NavTree {
  const [tree, setTree] = useState<NavTree>({ trips: [], loose: [] });
  const location = useLocation();
  // The four refresh triggers below can have more than one fetch in flight
  // at once; a ticket per load() call means a response that lands after a
  // newer one has already resolved is dropped rather than overwriting it.
  const latestTicket = useRef(0);

  const load = useCallback(() => {
    const ticket = ++latestTicket.current;
    fetchTree().then(partial => {
      if (partial === null || ticket !== latestTicket.current) return;
      setTree(prev => {
        const next: NavTree = { trips: partial.trips ?? prev.trips, loose: partial.loose ?? prev.loose };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    });
  }, []);

  useEffect(() => {
    load();
  }, [load, location.pathname]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeMutations(() => {
      clearTimeout(timer);
      timer = setTimeout(load, MUTATION_DEBOUNCE_MS);
    });
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, [load]);

  return tree;
}
