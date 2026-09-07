/**
 * contracts/db-additions.d.ts — run 2026-09-07-manual-mark-flown, T-001.
 *
 * The ONLY two additions to `src/db.ts` (owner: T-003). Reference artifact,
 * not wired into the build.
 *
 * Everything else in src/db.ts is unchanged — in particular
 * setPlannedLegStatus (:1088-1106), PlannedLegHasLinkedFlightError
 * (:1006-1012), recordPlannedLegArrival (:1318-1322),
 * unlinkFlightFromPlannedLeg (:1259+), clearPlannedLegLink (:1284+),
 * linkFlightToPlannedLeg (:1207+), the planned_legs DDL and the ALTER TABLE
 * migration block (design.md §4.1, §4.4, must-not-change M-1..M-4).
 *
 * NO MIGRATION. `planned_legs.status` already CHECKs 'flown' (src/db.ts:101-102)
 * and `arrival_deviation_nm` already exists and is already nullable.
 *
 * src/db.ts does NOT import src/plannedLegClose.ts. The gate is composed in the
 * endpoint (design.md §6.1) — that is what lets T-002 and T-003 run in parallel.
 */

/**
 * Thrown by setPlannedLegHandOutcome() when the leg stopped qualifying between
 * the endpoint's decision and this transaction — e.g. a concurrent
 * `PUT /api/flights/:id/planned-leg {plannedLegId: null}` unlinked the flight.
 * design.md §4.3.
 *
 * `detail` is one of exactly three strings:
 *   'it has no linked flight'
 *   'its flight was not linked by hand'
 *   'its flight has not ended'
 *
 * Message: `Planned leg ${legId} cannot be closed by hand: ${detail}`
 * The endpoint maps it to 409 (design.md §5.3).
 *
 * This is NOT a second copy of the gate. It re-asserts only the three
 * persistent invariants this transaction reads anyway; the transition rule
 * (which source status may become which target status) stays in
 * src/plannedLegClose.ts and is deliberately NOT re-checked here.
 */
export declare class PlannedLegHandCloseConflictError extends Error {
  readonly legId: number;
  readonly detail: string;
  constructor(legId: number, detail: string);
}

/**
 * The hand-driven sibling of recordPlannedLegArrival(): writes the status and
 * the deviation a hand close-out decided (design.md §4.2). Place it next to
 * recordPlannedLegArrival(), not next to setPlannedLegStatus().
 *
 * `status` is 'flown' (forward) or 'planned' (reverse, `deviationNm` null).
 * NEVER 'diverted' — the touchdown rule is not mirrored here (design.md §3.4).
 *
 * Both columns move in ONE UPDATE inside ONE db.transaction(), preceded by the
 * invariant re-read described above. Returns false when the leg row does not
 * exist or the UPDATE changed nothing; throws
 * PlannedLegHandCloseConflictError when an invariant no longer holds.
 *
 * The link is NOT touched: after the reverse transition,
 * flights.planned_leg_id and flights.planned_leg_link_source are exactly what
 * they were (frozen decision 3, must-not-change M-3).
 *
 * CALLER SET: exactly one — PUT /api/flights/:id/planned-leg-status in
 * src/server.ts, after decideHandClose() returned `allowed: true`. Any new
 * caller MUST go through decideHandClose() first (design.md risk R-5).
 */
export declare function setPlannedLegHandOutcome(
  legId: number,
  status: 'planned' | 'flown',
  deviationNm: number | null
): boolean;
