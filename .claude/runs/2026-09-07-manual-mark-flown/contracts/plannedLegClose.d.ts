/**
 * contracts/plannedLegClose.d.ts — run 2026-09-07-manual-mark-flown, T-001.
 *
 * Frozen signatures for the NEW pure module `src/plannedLegClose.ts` (owner:
 * T-002). Reference artifact: this file is NOT wired into the build and must
 * not be imported by anything. `src/plannedLegClose.ts` is the single place
 * these types actually live at runtime.
 *
 * Behaviour is design.md §1 (the gate), §3 (deviation) and §9 (the algorithm
 * written out). This file fixes only the shapes.
 *
 * The module imports `./geo` and NOTHING else — no ./db, no ./server, no
 * ./flightManager, no ./types, no ./legMatcher, no fs, no http. It must not
 * contain ARRIVAL_RADIUS_NM, and 'diverted' is never an output (design.md
 * §3.4, must-not-change M-5).
 */

/** The only two statuses a hand close-out may request. Never 'diverted'. */
export type HandCloseRequest = 'flown' | 'planned';

/**
 * Why a request was refused. Internal contract between the module and
 * src/inspect-manual-mark.ts. NOT sent on the wire: the endpoint puts only
 * `message` in the 409 body (design.md §5.3).
 *
 * Evaluated in this exact order (design.md §1.2); the first match wins.
 */
export type HandCloseRefusal =
  | 'NOT_LINKED'
  | 'LINK_NOT_MANUAL'
  | 'FLIGHT_NOT_ENDED'
  | 'LEG_NOT_PLANNED'
  | 'LEG_NOT_FLOWN';

/**
 * A structural subset of src/types.ts `Flight` — same field names, same types,
 * same nullability (src/types.ts:27-53). Declared locally so the module can
 * stay free of ./types; the endpoint passes `getFlightById(id)` straight in and
 * TypeScript accepts it structurally. design.md §6.2.
 */
export interface HandCloseFlight {
  id: number;
  end_time: string | null;
  planned_leg_id: number | null;
  planned_leg_link_source: 'auto' | 'manual' | null;
  arrival_lat: number | null;
  arrival_lon: number | null;
}

/**
 * A structural subset of src/types.ts `PlannedLeg` / `PlannedLegWithChildren`
 * (src/types.ts:121, :146-147). `status` is spelled out rather than imported as
 * `PlannedLegStatus` for the same reason.
 */
export interface HandCloseLeg {
  id: number;
  status: 'planned' | 'flown' | 'diverted' | 'skipped';
  destination_lat: number;
  destination_lon: number;
}

/**
 * On `allowed: true`, `status` is ALWAYS the requested one (design.md §3.4) and
 * `deviationNm` is:
 *   - null when the request is 'planned' (the reverse clears the deviation);
 *   - null when either arrival coordinate is null (design.md §3.3);
 *   - otherwise Math.round(haversineNm(...) * 10) / 10 (design.md §3.2).
 */
export type HandCloseDecision =
  | { allowed: true; legId: number; status: HandCloseRequest; deviationNm: number | null }
  | { allowed: false; reason: HandCloseRefusal; message: string };

/**
 * The whole gate, pure. `leg` is the row `planned_legs.id =
 * flight.planned_leg_id`, or null when the flight has no link.
 *
 * Refusal order, normative (design.md §1.2):
 *   1 NOT_LINKED · 2 LINK_NOT_MANUAL · 3 FLIGHT_NOT_ENDED ·
 *   4 LEG_NOT_PLANNED (request 'flown') / LEG_NOT_FLOWN (request 'planned')
 *
 * Message text is frozen in design.md §5.3 and asserted by
 * src/inspect-manual-mark.ts.
 */
export declare function decideHandClose(
  requested: HandCloseRequest,
  flight: HandCloseFlight,
  leg: HandCloseLeg | null
): HandCloseDecision;

/**
 * design.md §3.2, character for character:
 *
 *   Math.round(haversineNm(flight.arrival_lat, flight.arrival_lon,
 *                          leg.destination_lat, leg.destination_lon) * 10) / 10
 *
 * Returns null when either arrival coordinate is null (§3.3). Exported
 * separately so the inspector can measure the deviation without going through
 * the gate.
 */
export declare function handCloseDeviationNm(
  flight: Pick<HandCloseFlight, 'arrival_lat' | 'arrival_lon'>,
  leg: Pick<HandCloseLeg, 'destination_lat' | 'destination_lon'>
): number | null;
