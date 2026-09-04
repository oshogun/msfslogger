import type { Flight, PlannedLegWithChildren } from '../types';
import { formatAlt, formatDistance } from '../utils/format';

/**
 * How a planned leg interleaves with flown flights in the trip's legs table.
 * Pure, client-side. design.md §9.3 — this is the frozen rule, not a fresh
 * design: reproduced here rather than reinvented.
 *
 *   1. The flown spine is `flights`, in the order the caller supplies it.
 *      `trip.flights` already arrives ordered by start_time ASC — exactly the
 *      order the legs table has always used — so it is NEVER re-sorted here.
 *      Flown rows keep the numbering/colour they always had, indexed by their
 *      position in `flights`, unaffected by any ghost row inserted around them.
 *   2. Each unflown planned leg (no linked flight — `linked_flight_id === null`)
 *      is inserted immediately before the first flown flight in the spine that
 *      is linked to a planned leg with a HIGHER seq than it; if there is no
 *      such flight, it goes at the end.
 *   3. Unflown legs that land in the same slot are ordered by seq ASC, id ASC.
 *
 * A trip with zero planned legs must produce byte-identical output to the
 * flights-only mapping that existed before this feature (§9.3, §18).
 */
export type MergedTripRow =
  | { kind: 'flight'; flight: Flight; flightIndex: number }
  | { kind: 'planned'; leg: PlannedLegWithChildren };

export function interleaveTripRows(
  flights: Flight[],
  plannedLegs: PlannedLegWithChildren[]
): MergedTripRow[] {
  const unflown = plannedLegs
    .filter((leg) => leg.linked_flight_id === null)
    .slice()
    .sort((a, b) => a.seq - b.seq || a.id - b.id); // rule 3

  // The common case, and the one that must be indistinguishable from the
  // pre-feature page: no planned legs (or none left unflown) means no ghost
  // rows and no reordering — just the flights, in the order given.
  if (unflown.length === 0) {
    return flights.map((flight, flightIndex) => ({ kind: 'flight', flight, flightIndex }));
  }

  const legById = new Map(plannedLegs.map((l) => [l.id, l] as const));
  // For each flown flight, the seq of the planned leg it is linked to (or null).
  const anchorSeq = flights.map((f) =>
    f.planned_leg_id != null ? legById.get(f.planned_leg_id)?.seq ?? null : null
  );

  function anchorIndexFor(seq: number): number {
    for (let i = 0; i < anchorSeq.length; i++) {
      const s = anchorSeq[i];
      if (s != null && s > seq) return i;
    }
    return flights.length; // "no such flight" -> the end
  }

  // Bucket index `flights.length` holds legs that land at the very end.
  const buckets: PlannedLegWithChildren[][] = Array.from({ length: flights.length + 1 }, () => []);
  for (const leg of unflown) buckets[anchorIndexFor(leg.seq)].push(leg);

  const rows: MergedTripRow[] = [];
  flights.forEach((flight, flightIndex) => {
    for (const leg of buckets[flightIndex]) rows.push({ kind: 'planned', leg });
    rows.push({ kind: 'flight', flight, flightIndex });
  });
  for (const leg of buckets[flights.length]) rows.push({ kind: 'planned', leg });
  return rows;
}

interface GhostLegRowProps {
  leg: PlannedLegWithChildren;
  onDelete: (legId: number) => void;
  onMove: (legId: number, direction: 'up' | 'down') => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy: boolean;
}

/**
 * One planned leg rendered as a dimmed, dashed "ghost row" in the existing
 * legs table (design.md §18). Never claims an invented ICAO: a snippet's
 * departure/destination idents are shown exactly as parsed (they are real
 * values from the file, e.g. a USER waypoint like "WP1"), with a Snippet
 * badge so the reader never mistakes them for airport codes.
 */
export function GhostLegRow({ leg, onDelete, onMove, canMoveUp, canMoveDown, busy }: GhostLegRowProps) {
  const routeTitle = `${leg.departure_name || leg.departure_ident} → ${leg.destination_name || leg.destination_ident}`;

  return (
    <tr className="tr-ghost">
      <td className="td-stat">
        <span className="leg-color-swatch leg-color-swatch--ghost"></span>
        <span className="badge badge-planned">Planned</span>
        {leg.is_snippet === 1 && <span className="badge badge-snippet">Snippet</span>}
      </td>
      <td className="td-aircraft">{leg.aircraft_type || 'Unknown'}</td>
      <td className="td-date">—</td>
      <td className="td-stat">—</td>
      <td className="td-stat">approx. {formatDistance(leg.approx_distance_nm)} nm</td>
      <td className="td-stat">
        <span
          className={`td-route${leg.is_snippet === 1 ? ' td-route-snippet' : ''}`}
          title={routeTitle}
        >
          {leg.departure_ident} → {leg.destination_ident}
        </span>
        <div className="td-planned-meta">
          {formatAlt(leg.cruise_alt_ft)} ft cruise · {leg.waypoint_count} wpt{leg.waypoint_count !== 1 ? 's' : ''}
        </div>
      </td>
      <td className="td-actions">
        <button
          className="btn btn-ghost btn-icon"
          disabled={busy || !canMoveUp}
          onClick={() => onMove(leg.id, 'up')}
          title="Move earlier"
          aria-label="Move earlier"
        >↑</button>
        <button
          className="btn btn-ghost btn-icon"
          disabled={busy || !canMoveDown}
          onClick={() => onMove(leg.id, 'down')}
          title="Move later"
          aria-label="Move later"
        >↓</button>
      </td>
      <td className="td-actions">
        <button className="btn btn-danger" style={{ fontSize: '0.8rem' }} onClick={() => onDelete(leg.id)}>
          Delete
        </button>
      </td>
    </tr>
  );
}
