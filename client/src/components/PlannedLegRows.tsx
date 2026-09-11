import type { Flight, PlannedLeg, PlannedLegWithChildren, PlannedLegStatus } from '../types';
import { coordStr, formatAlt, formatDate, formatDistance } from '../utils/format';

/**
 * The four-label badge vocabulary below is used verbatim wherever a planned
 * leg's status is shown. 'linked' has deliberately no badge of its own: a
 * leg that is linked but not yet landed still has status 'planned', so it
 * reads as 'Planned' until FlightManager sets 'flown'/'diverted' at
 * touchdown. Exported: the flight detail page needs the identical
 * vocabulary on a linked flight's own page, so this is the shared home for
 * it, not TripDetail.tsx.
 */
export function plannedLegBadge(status: PlannedLegStatus): { label: string; className: string } {
  switch (status) {
    case 'flown': return { label: 'Flown', className: 'badge-flown' };
    case 'diverted': return { label: 'Diverted', className: 'badge-diverted' };
    case 'skipped': return { label: 'Skipped', className: 'badge-skipped' };
    default: return { label: 'Planned', className: 'badge-planned' };
  }
}

/**
 * The landing outcome implied by `arrival_deviation_nm` was rendered
 * nowhere: it's written on both the 'flown' and the 'diverted' path, so
 * this is the one place that turns the number into words for every
 * consumer (the trip page's leg row, the ghost row, and FlightDetail's
 * Planned Leg section) rather than each inventing its own.
 *
 * Returns null whenever there is nothing to show: every leg not yet flown and
 * every leg imported before this phase has `arrival_deviation_nm === null`,
 * and that must render exactly as it did before.
 *
 * `flight` is the linked flight if the caller already has it in hand (it
 * always does — TripDetail.tsx's merged row already holds `f`, FlightDetail's
 * page already holds `flight` — this never triggers a new request). Only the
 * arrival fields this needs are read, so a Pick is enough. When `flight` is
 * omitted (the ghost row never carries a linked flight, since a leg with a
 * link is never an "unflown" row), the coordinate fallback degrades to '—'
 * rather than inventing an ICAO.
 */
export function plannedLegLandingNote(
  leg: Pick<PlannedLeg, 'status' | 'arrival_deviation_nm' | 'destination_ident'>,
  flight?: Pick<Flight, 'arrival_icao' | 'arrival_lat' | 'arrival_lon'> | null
): string | null {
  if (leg.arrival_deviation_nm == null) return null;
  const dev = `${formatDistance(leg.arrival_deviation_nm)} nm`;
  if (leg.status === 'flown') return `flown, ${dev} from plan`;
  if (leg.status === 'diverted') {
    // Same fallback convention as FlightDetail's own departure/arrival tiles:
    // flights.arrival_icao, or the coordinates when it did not resolve.
    const arrival = flight
      ? (flight.arrival_icao || coordStr(flight.arrival_lat, flight.arrival_lon))
      : '—';
    return `diverted, ${dev} from planned ${leg.destination_ident} · arrived ${arrival}`;
  }
  return null;
}

/**
 * How a planned leg interleaves with flown flights in the trip's legs table.
 * Pure, client-side. This is the frozen rule, not a fresh design: reproduced
 * here rather than reinvented.
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
 * flights-only mapping that existed before this feature.
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

  // Link-a-flight: TripDetail.tsx owns the open/closed flag, the fetched
  // candidate list and every busy/error flag — this stays presentational
  // and only renders what it's handed.
  linkPickerOpen: boolean;
  onToggleLinkPicker: () => void;
  linkBusy: boolean;
  linkError?: string;
  linkableFlights: Flight[] | null;
  linkFlightsError: string;
  linkFlightChoice: number | '';
  onLinkFlightChoiceChange: (flightId: number) => void;
  onConfirmLink: () => void;

  // Skip / unskip.
  skipBusy: boolean;
  skipError?: string;
  onToggleSkip: () => void;
}

/**
 * One planned leg rendered as a dimmed, dashed "ghost row" in the existing
 * legs table. Never claims an invented ICAO: a snippet's
 * departure/destination idents are shown exactly as parsed (they are real
 * values from the file, e.g. a USER waypoint like "WP1"), with a Snippet
 * badge so the reader never mistakes them for airport codes.
 *
 * Renders more than one <tr> (the row itself, plus an optional error row and
 * an optional picker row) — callers put a key on the <GhostLegRow key={...}/>
 * element itself, so the Fragment returned here needs none of its own.
 */
export function GhostLegRow({
  leg, onDelete, onMove, canMoveUp, canMoveDown, busy,
  linkPickerOpen, onToggleLinkPicker, linkBusy, linkError,
  linkableFlights, linkFlightsError, linkFlightChoice, onLinkFlightChoiceChange, onConfirmLink,
  skipBusy, skipError, onToggleSkip,
}: GhostLegRowProps) {
  const badge = plannedLegBadge(leg.status);
  const routeTitle = `${leg.departure_name || leg.departure_ident} → ${leg.destination_name || leg.destination_ident}`;
  const landingNote = plannedLegLandingNote(leg);

  return (
    <>
      <tr className="tr-ghost">
        <td className="td-stat">
          <span className="leg-color-swatch leg-color-swatch--ghost"></span>
          <span className={`badge ${badge.className}`}>{badge.label}</span>
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
          {/* A ghost row never carries a linked flight (a linked leg is
              never "unflown"), so arrival_deviation_nm is null
              here in every reachable case today. Rendered anyway so this row
              degrades the same way as the other two consumers if that ever
              changes, rather than silently dropping the fact. */}
          {landingNote && <div className="td-planned-meta">{landingNote}</div>}
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
          <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} disabled={linkBusy} onClick={onToggleLinkPicker}>
            {linkPickerOpen ? 'Cancel' : 'Link flight'}
          </button>
        </td>
        <td className="td-actions">
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.8rem' }}
            disabled={skipBusy}
            onClick={onToggleSkip}
          >{skipBusy ? 'Working…' : (leg.status === 'skipped' ? 'Unskip' : 'Skip')}</button>
          <button className="btn btn-danger" style={{ fontSize: '0.8rem' }} onClick={() => onDelete(leg.id)}>
            Delete
          </button>
        </td>
      </tr>
      {skipError && (
        <tr className="tr-ghost">
          <td colSpan={8}><span className="edit-error">{skipError}</span></td>
        </tr>
      )}
      {linkPickerOpen && (
        <tr className="tr-ghost tr-link-picker">
          <td colSpan={8}>
            <div className="link-picker">
              {linkableFlights === null ? (
                <span className="flight-plan-status">Loading flights…</span>
              ) : linkableFlights.length === 0 ? (
                <span className="flight-plan-status">No unlinked flights available.</span>
              ) : (
                <>
                  <select value={linkFlightChoice} onChange={e => onLinkFlightChoiceChange(Number(e.target.value))}>
                    <option value="">Choose a flight…</option>
                    {linkableFlights.map(lf => (
                      <option key={lf.id} value={lf.id}>
                        #{lf.id} · {lf.aircraft || 'Unknown'} · {formatDate(lf.start_time)}
                        {(lf.departure_icao || lf.arrival_icao) ? ` · ${lf.departure_icao || '???'} → ${lf.arrival_icao || '???'}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.8rem' }}
                    disabled={!linkFlightChoice || linkBusy}
                    onClick={onConfirmLink}
                  >{linkBusy ? 'Linking…' : 'Link'}</button>
                </>
              )}
              {linkFlightsError && <span className="edit-error">{linkFlightsError}</span>}
              {linkError && <span className="edit-error">{linkError}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
