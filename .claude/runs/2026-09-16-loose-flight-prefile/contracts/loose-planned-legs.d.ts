// Frozen type contract for the loose-prefile run (2026-09-16-loose-flight-prefile).
//
// REFERENCE ARTIFACT ONLY. Nothing imports this file and nothing compiles it
// into the build. It is the single place the exact shapes live so a server
// task and a client task cannot drift. Each block names the real file that
// owns the declaration.
//
// Only the members that CHANGE or are NEW are written out. Every member not
// shown here is unchanged, and an implementer must not touch it.

/* ────────────────────────────────────────────────────────────────────────────
   src/types.ts  — server row and wire types
   ──────────────────────────────────────────────────────────────────────────── */

export interface PlannedLeg_server {
  id: number;
  /**
   * CHANGED: was `number`. NULL means the leg belongs to no trip — a "loose"
   * prefile. Every other consumer treats it exactly as it treats a
   * trip-linked one.
   */
  trip_id: number | null;
  /**
   * UNCHANGED type. 1-based within a trip; loose legs form their own
   * sequence, numbered the same way and never reordered.
   */
  seq: number;
  // ... every other field unchanged
}

/** NEW. GET /api/planned-legs element. Owned by src/types.ts. */
export interface PlannedLegListItem_server /* extends PlannedLegWithChildren */ {
  /**
   * The owning trip's name, resolved server-side by a LEFT JOIN so the client
   * needs no second request. NULL if and only if trip_id is NULL — the
   * foreign key guarantees a non-null trip_id names an existing trip.
   */
  trip_name: string | null;
}

export interface PlannedLegLiveStatus_server {
  plannedLegId: number;
  /** CHANGED: was `number`. Null when the linked leg is loose. */
  tripId: number | null;
  /** CHANGED: was `string`. Null when the linked leg is loose. */
  tripName: string | null;
  destinationIdent: string;
  nextWaypointIdent: string;
  remainingDistanceNm: number;
  distanceIsApproximate: true;
}

/** UNCHANGED. The active-trip JOIN guarantees tripId is never null here. */
export interface LegMatchCandidate_unchanged {
  tripId: number;
}

/* ────────────────────────────────────────────────────────────────────────────
   src/db/plannedLegs.ts — CRUD
   ──────────────────────────────────────────────────────────────────────────── */

export interface CreatePlannedLegInput_server {
  /** CHANGED: was `number`. null creates a loose leg. The ONLY change here. */
  tripId: number | null;
  plan: unknown;            // CreatePlannedLegPlan, unchanged
  sourceFilename: string;
  sourceSha256: string;
}

/**
 * CHANGED signature. `tripId === null` is its own duplicate-detection pool,
 * disjoint from every trip's pool.
 *   SELECT * FROM planned_legs WHERE trip_id IS ? AND source_sha256 = ? LIMIT 1
 * `IS` and not `=`: `trip_id = NULL` is NULL, never true, so `=` would report
 * "no duplicate" for every loose re-import. For a non-null tripId, `IS` is
 * row-for-row and plan-for-plan identical to `=` (measured).
 */
export declare function findPlannedLegBySource(
  tripId: number | null,
  sha256: string,
): unknown /* PlannedLeg | null */;

/**
 * NEW. Every planned leg, loose and trip-linked, children attached, trip name
 * resolved. Ordering:
 *   ORDER BY (l.trip_id IS NULL) DESC, l.trip_id ASC, l.seq ASC, l.id ASC
 * Loose legs first, then each trip's legs in ascending trip id, each trip's
 * block in exactly the (seq, id) order GET /api/trips/:id/planned-legs uses.
 */
export declare function getAllPlannedLegs(): unknown /* PlannedLegListItem[] */;

/** UNCHANGED. Trip-scoped; loose legs are never reordered. */
export declare function reorderPlannedLegs(tripId: number, legIds: number[]): boolean;

/** UNCHANGED. */
export declare function getTripName(tripId: number): string | null;

/* ────────────────────────────────────────────────────────────────────────────
   src/flightManager.ts — in-memory cache (module-private interface)
   ──────────────────────────────────────────────────────────────────────────── */

export interface PlannedLegCache_server {
  flightId: number;
  plannedLegId: number;
  /** CHANGED: was `number`. */
  tripId: number | null;
  /**
   * CHANGED: was `string` with a `?? ''` fallback. Now:
   *   leg.trip_id === null ? null : getTripName(leg.trip_id)
   * getTripName is never called with null.
   */
  tripName: string | null;
  destinationIdent: string;
  waypoints: { ident: string; lat: number; lon: number }[];
  remainingFromNm: number[];
}

/* ────────────────────────────────────────────────────────────────────────────
   client/src/types.ts — mirrors the server 1:1
   ──────────────────────────────────────────────────────────────────────────── */

export interface PlannedLeg_client {
  id: number;
  /** CHANGED: was `number`. PlannedLegWithChildren inherits this. */
  trip_id: number | null;
  seq: number;
  // ... every other field unchanged
}

/** NEW, mirrors PlannedLegListItem_server. */
export interface PlannedLegListItem_client {
  trip_name: string | null;
}

export interface PlannedLegLiveStatus_client {
  plannedLegId: number;
  /** CHANGED: was `number`. */
  tripId: number | null;
  /** CHANGED: was `string`. */
  tripName: string | null;
  destinationIdent: string;
  nextWaypointIdent: string;
  remainingDistanceNm: number;
  distanceIsApproximate: true;
}

/**
 * UNCHANGED shapes, reused verbatim by the two new loose routes:
 *   PlannedLegImportResponse  — POST /api/planned-legs        (multipart)
 *   PlannedLegImportResult
 *   SimbriefImportResponse    — POST /api/planned-legs/simbrief (JSON)
 *   SimbriefImportResult
 * The loose routes answer with the same keys, the same statuses and the same
 * per-file/per-plan outcome objects as their trip-nested counterparts, so the
 * client's existing response parsing is reused with no new branch.
 */
