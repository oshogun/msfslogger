import type { Flight, JourneyLeg, PlannedLegWithChildren } from '../../../types';
import { unwrapLonChains } from '../../../utils/geo';

export type LatLng = [number, number];

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
