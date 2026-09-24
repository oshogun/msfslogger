import type { Flight, PlannedLegWithChildren } from '../../mock/types';

export type MergedTripRow =
  | { kind: 'flight'; flight: Flight; flightIndex: number }
  | { kind: 'planned'; leg: PlannedLegWithChildren };

/**
 * Flown flights in order, with each unflown planned leg slotted in leg order:
 * before the first flown flight linked to a leg with a higher seq, else at the
 * end. Legs landing in the same slot are ordered by seq then id. A trip with
 * no unflown legs is just its flights.
 */
export function interleaveTripRows(flights: Flight[], plannedLegs: PlannedLegWithChildren[]): MergedTripRow[] {
  const unflown = plannedLegs
    .filter(l => l.linked_flight_id === null)
    .sort((a, b) => a.seq - b.seq || a.id - b.id);
  if (unflown.length === 0) return flights.map((flight, flightIndex) => ({ kind: 'flight', flight, flightIndex }));

  const legById = new Map(plannedLegs.map(l => [l.id, l] as const));
  const anchorSeq = flights.map(f => (f.planned_leg_id != null ? legById.get(f.planned_leg_id)?.seq ?? null : null));
  const slotFor = (seq: number) => {
    const i = anchorSeq.findIndex(s => s != null && s > seq);
    return i === -1 ? flights.length : i;
  };
  const buckets: PlannedLegWithChildren[][] = Array.from({ length: flights.length + 1 }, () => []);
  for (const leg of unflown) buckets[slotFor(leg.seq)].push(leg);

  const rows: MergedTripRow[] = [];
  flights.forEach((flight, flightIndex) => {
    for (const leg of buckets[flightIndex]) rows.push({ kind: 'planned', leg });
    rows.push({ kind: 'flight', flight, flightIndex });
  });
  for (const leg of buckets[flights.length]) rows.push({ kind: 'planned', leg });
  return rows;
}
