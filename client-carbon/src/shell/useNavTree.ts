import { useEffect, useState } from 'react';
import { listFlights, listTrips, subscribeStore } from '../mock/api';
import type { AppShellProps } from './AppShell';

type NavTrips = AppShellProps['trips'];
type NavLoose = AppShellProps['looseFlights'];
export interface NavTree { trips: NavTrips; loose: NavLoose }

const route = (dep: string | null, arr: string | null) => `${dep ?? '?'} → ${arr ?? '…'}`;

/** How long writes are allowed to pile up before the tree is fetched again. */
const REFETCH_DEBOUNCE_MS = 150;

async function fetchTree(): Promise<NavTree> {
  const [trips, flights] = await Promise.all([listTrips(), listFlights()]);
  return {
    trips: trips.map(t => ({
      id: t.id,
      name: t.name,
      isActive: t.is_active === 1,
      legs: t.flights.map((f, i) => ({ id: f.id, label: `Leg ${i + 1} · ${route(f.departure_icao, f.arrival_icao)}` })),
    })),
    loose: flights
      .filter(f => f.trip_id == null)
      .map(f => ({ id: f.id, label: route(f.departure_icao, f.arrival_icao) })),
  };
}

/**
 * SideNav tree from the mock trips and flights, fetched on mount and again
 * (debounced) after every write to the store. An empty tree if the first
 * fetch fails; a failed refetch keeps the tree already shown. The tree is only
 * replaced when its content changed, and trips keep their keys, so an open
 * submenu stays open across refetches.
 */
export function useNavTree(): NavTree {
  const [tree, setTree] = useState<NavTree>({ trips: [], loose: [] });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest = 0;
    const load = () => {
      const ticket = ++latest;
      fetchTree()
        .then(next => {
          if (cancelled || ticket !== latest) return;
          setTree(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = subscribeStore(() => {
      clearTimeout(timer);
      timer = setTimeout(load, REFETCH_DEBOUNCE_MS);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
  return tree;
}
