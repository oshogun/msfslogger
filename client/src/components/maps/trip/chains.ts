import type { Flight, JourneyLeg, PlannedLegWithChildren } from '../../../mock/types';

export type LatLng = [number, number];

/**
 * Unwraps longitudes across an ordered group of chains as if they were one
 * continuous route, while still returning one array per input chain.
 *
 * Unwrapping each leg on its own, anchored to its own first point, lets leg
 * N+1 land 360 degrees from where leg N ended whenever an odd number of
 * antimeridian crossings lies between them. Threading a running reference
 * longitude through every chain keeps the whole trip in one reference frame.
 */
export function unwrapLonChains(chains: LatLng[][]): LatLng[][] {
  const out: LatLng[][] = [];
  let prevLon: number | null = null;
  for (const chain of chains) {
    if (chain.length === 0) {
      out.push(chain);
      continue;
    }
    const unwrapped: LatLng[] = [];
    for (const [lat, lon0] of chain) {
      let lon = lon0;
      if (prevLon !== null) {
        while (lon - prevLon > 180) lon -= 360;
        while (lon - prevLon < -180) lon += 360;
      }
      unwrapped.push([lat, lon]);
      prevLon = lon;
    }
    out.push(unwrapped);
  }
  return out;
}

export function sortedPlannedLegs(plannedLegs: PlannedLegWithChildren[]): PlannedLegWithChildren[] {
  return plannedLegs.slice().sort((a, b) => a.seq - b.seq);
}

/** One chain per planned leg, in seq order, waypoints in seq order. */
export function plannedLegChains(plannedLegs: PlannedLegWithChildren[]): LatLng[][] {
  return unwrapLonChains(
    sortedPlannedLegs(plannedLegs).map(leg =>
      leg.waypoints.slice().sort((a, b) => a.seq - b.seq).map(w => [w.lat, w.lon] as LatLng),
    ),
  );
}

/** One chain per flight, in the order given. */
export function flightChains(flights: Flight[]): LatLng[][] {
  return unwrapLonChains(flights.map(f => (f.points ?? []).map(p => [p.lat, p.lon] as LatLng)));
}

export function sortedJourneyLegs(legs: JourneyLeg[]): JourneyLeg[] {
  return legs.slice().sort((a, b) => a.seq - b.seq);
}

export function journeyLegChains(legs: JourneyLeg[]): LatLng[][] {
  return unwrapLonChains(sortedJourneyLegs(legs).map(l => l.track as LatLng[]));
}

/**
 * Unwrapped position for each airport ICAO, taken from the first leg chain that
 * touches it. `ordered` and `trackChains` are aligned by index.
 */
export function airportPositions(ordered: JourneyLeg[], trackChains: LatLng[][]): Map<string, LatLng> {
  const positions = new Map<string, LatLng>();
  ordered.forEach((leg, i) => {
    const chain = trackChains[i];
    if (chain.length === 0) return;
    if (leg.departureIcao !== null && !positions.has(leg.departureIcao)) positions.set(leg.departureIcao, chain[0]);
    if (leg.arrivalIcao !== null && !positions.has(leg.arrivalIcao)) positions.set(leg.arrivalIcao, chain[chain.length - 1]);
  });
  return positions;
}
