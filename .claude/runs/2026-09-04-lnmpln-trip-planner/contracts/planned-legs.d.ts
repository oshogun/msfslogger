/**
 * LNMPLN trip planner — frozen interface contract.
 *
 * REFERENCE ONLY. This file is not compiled and is not imported by anything.
 * Each section names the real module the declarations belong in. Copy them
 * there; do not import this file.
 *
 * Amended 2026-09-04 (Amendment A in design.md): batch chain-sorting after three
 * real Little Navmap 3.0.18 files showed upload order is not route order.
 * Amended 2026-09-04 (Amendment B): procedure fields 9 -> 18 and the
 * UNKNOWN_ELEMENT warning, after the first real IFR plan wrote an element the
 * official XSD does not declare.
 *
 * Naming convention, matching the codebase:
 *   - snake_case  for persisted rows and row-shaped aggregates
 *                 (src/types.ts, following Flight / Trip / flight_count)
 *   - camelCase   for computed payloads
 *                 (src/lnmpln.ts, src/legMatcher.ts, following src/journey.ts)
 */

// ════════════════════════════════════════════════════════════════════════════
// src/geo.ts — shared geo helpers (NEW FILE, created by T-002)
//
// Byte-for-byte behavioural copies of the existing private helpers, so that a
// later consolidation of the three legacy copies is a pure deletion. The three
// existing copies in db.ts / airports.ts / flightManager.ts are NOT migrated by
// this feature; see design.md §4.1.
// ════════════════════════════════════════════════════════════════════════════

/** Great-circle distance in nautical miles. R = 3440.065. Antimeridian-safe. */
export declare function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number;

/** Initial great-circle bearing in degrees, 0..360. */
export declare function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number;


// ════════════════════════════════════════════════════════════════════════════
// src/lnmpln.ts — the parser's output shape (camelCase: computed, not persisted)
//
// This module must not import ./db, ./types or fs. It takes a string or Buffer
// and returns a value.
// ════════════════════════════════════════════════════════════════════════════

/** The XSD's SimpleWaypointType. Unrecognised values pass through as a raw string. */
export type LnmplnWaypointType = 'AIRPORT' | 'UNKNOWN' | 'WAYPOINT' | 'VOR' | 'NDB' | 'USER';

/** Reasons the parser refuses a file outright. Thrown, never returned. */
export type LnmplnRejectCode =
  | 'EMPTY_FILE'          // zero bytes, or whitespace only after BOM stripping
  | 'NOT_XML'             // XMLParser threw, or the root is not an object
  | 'NO_FLIGHTPLAN'       // no LittleNavmap.Flightplan node
  | 'TOO_FEW_WAYPOINTS'   // fewer than 2 Waypoint elements across all blocks
  | 'MISSING_IDENT'       // a Waypoint or Alternate with no non-empty Ident
  | 'MISSING_POSITION'    // a Waypoint with no Pos, or Pos without @Lat / @Lon
  | 'BAD_COORDINATE';     // non-finite, or lat outside ±90 / lon outside ±180

/** Reasons the parser accepts a file but wants the outcome recorded. */
export type LnmplnWarningCode =
  | 'BOM_STRIPPED'
  | 'DESCRIPTION_INSTEAD_OF_COMMENT'          // trap 2: the example's spelling
  | 'COMMENT_AND_DESCRIPTION_BOTH_PRESENT'    // trap 2: Comment wins
  | 'MULTIPLE_WAYPOINT_BLOCKS'                // trap 4: concatenated in document order
  | 'PROCEDURES_PRESENT_WAYPOINTS_ABSENT'     // trap 5: distance is even further short
  | 'SNIPPET_DEPARTURE_NOT_AIRPORT'           // trap 6
  | 'SNIPPET_DESTINATION_NOT_AIRPORT'         // trap 6
  | 'IDENT_NOT_ICAO_SHAPED'                   // trap 6: an AIRPORT ident that is not 3-4 [A-Z0-9]
  | 'WAYPOINT_ALT_INVALID'                    // trap 8: @Alt present but not finite -> null
  | 'ALTERNATE_POSITION_MISSING'              // trap 8: Alternate/Pos is optional
  | 'CRUISE_ALT_F_MISSING'                    // trap 9: fell back to CruisingAlt
  | 'CRUISE_ALT_MISSING'                      // trap 9: neither present -> null
  | 'CREATION_DATE_NO_OFFSET'                 // trap 10: parsed in the server's zone
  | 'CREATION_DATE_UNPARSEABLE'               // trap 10: stored as null
  | 'UNKNOWN_WAYPOINT_TYPE'                   // outside the XSD enumeration
  /**
   * An element the parser did not consume. NOT an error: Little Navmap writes
   * elements its own published XSD does not declare (<CustomOffsetAngle> is in a
   * real file and in no version of the schema), so the XSD is a guide, never an
   * authority on completeness. The message names up to ten unconsumed paths.
   * This is how an unknown field that turns out to matter becomes visible on the
   * first import rather than years later. design.md §5.4e.
   */
  | 'UNKNOWN_ELEMENT';

export interface LnmplnWarning {
  code: LnmplnWarningCode;
  /** One line, naming the element and the value. Surfaced per file on import. */
  message: string;
}

/** Thrown by parseLnmpln. The REST layer maps this to 400 and anything else to 500. */
export declare class LnmplnParseError extends Error {
  readonly code: LnmplnRejectCode;
  constructor(code: LnmplnRejectCode, message: string);
}

export interface ParsedPos {
  lat: number;
  lon: number;
  /** Pos/@Alt is optional in the format. */
  altFt: number | null;
}

export interface ParsedWaypoint {
  /**
   * 1-based document order across every <Waypoints> block. A waypoint is
   * identified by (leg, seq) and NEVER by ident: real files number their user
   * waypoints WP1/WP2/WP3 in every leg. See design.md §5.4c.
   */
  seq: number;
  ident: string;
  name: string | null;
  region: string | null;
  airway: string | null;
  track: string | null;
  /** Only 'AIRPORT' is behaviourally significant; anything else is display-only. */
  type: LnmplnWaypointType | string;
  /** <Comment> or <Description>, whichever the file used. */
  comment: string | null;
  lat: number;
  lon: number;
  altFt: number | null;
}

export interface ParsedAlternate {
  seq: number;
  ident: string;
  name: string | null;
  type: string | null;
  /** Nullable: <Alternate><Pos> is optional, unlike <Waypoint><Pos>. */
  lat: number | null;
  lon: number | null;
  altFt: number | null;
}

/**
 * First / last waypoint of the plan. `isAirport` is `type === 'AIRPORT'`, and it
 * gates every ICAO claim: when it is false the ident is shown as-is and never
 * presented as an airport code.
 */
export interface ParsedEndpoint {
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  isAirport: boolean;
}

/**
 * The <Departure> element: where the plan starts on the field. More precise
 * than the departure waypoint but optional, so it is display-only — the matcher
 * uses ParsedEndpoint.lat/lon. (trap 12)
 */
export interface ParsedDeparture {
  pos: ParsedPos | null;
  /** e.g. "PARKING 1", "RUNWAY 25R" */
  start: string | null;
  /** None | Airport | Runway | Parking | Helipad */
  startType: string | null;
  /** True heading. Parsed but not persisted. */
  headingTrueDeg: number | null;
}

/**
 * A flat projection of <Procedures>. Eighteen fields, not the nine originally
 * frozen: a real custom approach is characterised entirely by Type plus the
 * Custom* values. Procedure LEGS are never modelled — the file never contains
 * them. design.md §2.2.1.
 */
export interface ParsedProcedures {
  sidName: string | null;
  /** The only place a departure runway appears: no real file has a <Departure>. */
  sidRunway: string | null;
  sidTransition: string | null;
  /** 'CUSTOMDEPART' for the manual's custom-departure form; the XSD omits it. */
  sidType: string | null;
  sidCustomDistanceNm: number | null;

  starName: string | null;
  starRunway: string | null;
  starTransition: string | null;

  /** Opaque label. With approachType 'CUSTOM' it is synthesized ICAO+runway
   *  ("KLAX24R") and is NOT a fix reference — never resolve or join on it. */
  approachName: string | null;
  approachRunway: string | null;
  approachTransition: string | null;
  approachType: string | null;
  approachArinc: string | null;
  approachSuffix: string | null;
  approachTransitionType: string | null;
  approachCustomDistanceNm: number | null;
  approachCustomAltitudeFt: number | null;
  /** Written by real Little Navmap; absent from the official XSD entirely. */
  approachCustomOffsetDeg: number | null;
}

/**
 * The parser's complete output. One file in, one of these out — or a thrown
 * LnmplnParseError. Never a partially populated object.
 */
export interface ParsedFlightPlan {
  departure: ParsedEndpoint;
  destination: ParsedEndpoint;
  /** true when either endpoint is not an AIRPORT: a plan snippet. (trap 6) */
  isSnippet: boolean;

  /** CruisingAltF preferred over CruisingAlt, never the reverse. (trap 9) */
  cruiseAltFt: number | null;
  /** Header/FlightplanType, e.g. "IFR" | "VFR". */
  flightplanType: string | null;
  /** AircraftPerformance/Type, e.g. "BE51". Display-only; not a match criterion. */
  aircraftType: string | null;
  /** Header <Comment> or <Description>. (trap 2) */
  remarks: string | null;
  /**
   * Header/CreationDate normalised to a full ISO instant. The file writes a
   * two-digit UTC offset ("2020-09-11T18:05:15+02") which Date parses
   * inconsistently, so it is expanded before parsing. (trap 10)
   */
  createdAt: string | null;
  /** "<ProgramName> <ProgramVersion>", kept for provenance since the file is not. */
  sourceProgram: string | null;

  departureStart: ParsedDeparture;
  procedures: ParsedProcedures;

  /** Every <Waypoint> from every <Waypoints> block, in document order. (trap 4) */
  waypoints: ParsedWaypoint[];
  /** Every <Alternate> from every <Alternates> block, in document order. (trap 4) */
  alternates: ParsedAlternate[];

  /**
   * Great-circle sum over the en-route waypoint chain, in nautical miles.
   * SID/STAR/approach legs are never in the file, so this is always short of the
   * real routing (trap 5) — and the shortfall is not a bounded correction. The
   * real KSFO->KLAX IFR plan stores 293.5 nm against a 293.2 nm direct great
   * circle: the stored "route" is the straight line, because all of its shape is
   * in WESLA5.SUSEY and IRNMN2.BURGL. No fixed correction factor may be applied.
   * design.md §6.
   */
  approxDistanceNm: number;
  /**
   * A literal type, not a boolean: no code path can set this to false, and no
   * view may render approxDistanceNm without an "approx." qualifier.
   */
  distanceIsApproximate: true;

  /** Everything the parser tolerated. Surfaced per file in the import response. */
  warnings: LnmplnWarning[];
}

/**
 * Parses one .lnmpln file.
 *
 * Accepts a Buffer (decoded as UTF-8) or a string; a leading BOM is stripped.
 * Configuration is frozen in design.md §5.1 — in particular parseTagValue and
 * parseAttributeValue are OFF (numeric-looking idents such as "0500" must stay
 * strings) and preserveOrder is NOT used.
 *
 * @throws {LnmplnParseError} on any of the LnmplnRejectCode conditions.
 */
export declare function parseLnmpln(input: string | Buffer, sourceFilename?: string): ParsedFlightPlan;


/**
 * Why a batch was or was not chain-sorted. Batch-level, and deliberately a
 * SEPARATE enum from LnmplnWarningCode: those are per-file parser warnings,
 * this is one verdict about the whole import. See design.md §9.2.1.
 */
export type BatchChainReason =
  | 'CHAINED'               // resolved uniquely; legs inserted in route order
  | 'SINGLE_LEG'            // fewer than 2 legs: trivially ordered, NOT a warning
  | 'SNIPPET_IN_BATCH'      // a leg's endpoints are not both airports; USER idents repeat across legs
  | 'NO_UNIQUE_HEAD'        // zero or 2+ legs whose departure is no other leg's destination
  | 'AMBIGUOUS_SUCCESSOR'   // a destination matched 2+ unused legs' departures
  | 'BROKEN_CHAIN';         // a destination matched no unused leg while legs remained

export interface BatchChainOrder {
  /** A permutation of indices into the input array; identity when not resolved. */
  order: number[];
  resolved: boolean;
  reason: BatchChainReason;
}

/**
 * Decides the insert order for one import batch by matching each leg's
 * destination ident to the next leg's departure ident.
 *
 * Pure; reads only parsed endpoints. Lives here rather than in server.ts so
 * inspect-lnmpln.ts can exercise it against samples/lnmpln/*.lnmpln.
 *
 * Applies the order ONLY when the chain resolves uniquely (design.md §9.2.1):
 * every leg airport-to-airport, exactly one head, exactly one successor at each
 * step, all legs consumed. A round trip (A->B, B->A) has zero heads and falls
 * back — that case is the reason the rule is written this way, not an oversight.
 * On any refusal, `order` is the identity and the caller keeps upload order.
 *
 * Batch-local: it never sees, reorders or renumbers legs already in the trip.
 */
export declare function chainOrderForBatch(plans: ParsedFlightPlan[]): BatchChainOrder;

// ════════════════════════════════════════════════════════════════════════════
// src/types.ts — persisted rows (snake_case, mirroring Flight / Trip)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 'linked' is not a value here: a leg is linked when a flight row points at it.
 * 'flown' and 'diverted' are set by the system only; the PATCH endpoint accepts
 * 'planned' and 'skipped' and nothing else. Enforced by a CHECK constraint.
 */
export type PlannedLegStatus = 'planned' | 'flown' | 'diverted' | 'skipped';

export interface PlannedLeg {
  id: number;
  trip_id: number;
  /** 1-based within the trip; gappy after a delete. Read with ORDER BY seq, id. */
  seq: number;
  status: PlannedLegStatus;

  departure_ident: string;
  departure_name: string | null;
  departure_lat: number;
  departure_lon: number;
  /** 0 | 1. When 0, departure_ident is not an airport code. */
  departure_is_airport: number;
  departure_start: string | null;
  departure_start_type: string | null;
  departure_pos_lat: number | null;
  departure_pos_lon: number | null;

  destination_ident: string;
  destination_name: string | null;
  destination_lat: number;
  destination_lon: number;
  destination_is_airport: number;

  /** 0 | 1 */
  is_snippet: number;
  cruise_alt_ft: number | null;
  flightplan_type: string | null;
  aircraft_type: string | null;

  sid_name: string | null;
  /** The only source of a departure runway; see design.md §5.4f. */
  sid_runway: string | null;
  sid_transition: string | null;
  sid_type: string | null;
  sid_custom_distance_nm: number | null;

  star_name: string | null;
  star_runway: string | null;
  star_transition: string | null;

  /** Opaque label, not a fix reference when approach_type is 'CUSTOM'. */
  approach_name: string | null;
  approach_runway: string | null;
  approach_transition: string | null;
  approach_type: string | null;
  approach_arinc: string | null;
  approach_suffix: string | null;
  approach_transition_type: string | null;
  approach_custom_distance_nm: number | null;
  approach_custom_altitude_ft: number | null;
  approach_custom_offset_deg: number | null;

  waypoint_count: number;
  alternate_count: number;
  /** Always rendered with an "approx." qualifier. See design.md §6. */
  approx_distance_nm: number;
  /** Written at landing on both the 'flown' and the 'diverted' path. */
  arrival_deviation_nm: number | null;

  remarks: string | null;
  plan_created_at: string | null;
  source_filename: string;
  source_sha256: string;
  source_program: string | null;
  imported_at: string;
}

export interface PlannedWaypoint {
  id: number;
  planned_leg_id: number;
  seq: number;
  ident: string;
  name: string | null;
  region: string | null;
  airway: string | null;
  track: string | null;
  type: string;
  comment: string | null;
  lat: number;
  lon: number;
  /**
   * Little Navmap's COMPUTED profile altitude, not a planned constraint: a
   * waypoint mid-climb carries a lower value than cruise. Never render it as a
   * planned or crossing altitude — cruise_alt_ft is the leg's planned altitude.
   * See design.md §6.1.
   */
  alt_ft: number | null;
}

export interface PlannedAlternate {
  id: number;
  planned_leg_id: number;
  seq: number;
  ident: string;
  name: string | null;
  type: string | null;
  /** Nullable: Alternate/Pos is optional in the format. */
  lat: number | null;
  lon: number | null;
  alt_ft: number | null;
}

/**
 * What every planned-leg endpoint returns. `linked_flight_id` is derived by a
 * subquery, not stored — snake_case because it rides on a row payload, the same
 * choice getTrips() makes for flight_count and total_distance_nm.
 */
export interface PlannedLegWithChildren extends PlannedLeg {
  linked_flight_id: number | null;
  waypoints: PlannedWaypoint[];
  alternates: PlannedAlternate[];
}

// ── Additive changes to existing types in src/types.ts ──────────────────────
// interface Flight {
//   ... unchanged ...
//   planned_leg_id: number | null;
//   planned_leg_link_source: 'auto' | 'manual' | null;
//   /** The trip_id held immediately before the link; restored on unlink. */
//   planned_leg_prev_trip_id: number | null;
// }
//
// interface Trip {
//   ... unchanged ...
//   is_active: number;                            // 0 | 1
// }
//
// interface TripWithFlights extends Trip {
//   ... unchanged ...
//   planned_leg_count: number;
//   /** Populated by GET /api/trips/:id; always [] from GET /api/trips,
//    *  mirroring the existing flights[].points = [] in that endpoint. */
//   planned_legs: PlannedLegWithChildren[];
// }
//
// No existing field is removed, renamed or retyped.


// ════════════════════════════════════════════════════════════════════════════
// src/server.ts — API payloads (camelCase: computed, not rows)
// ════════════════════════════════════════════════════════════════════════════

/** Per-file outcome of a batch import. Partial success is the frozen policy. */
export interface PlannedLegImportResult {
  filename: string;
  status: 'imported' | 'duplicate' | 'rejected';
  /** Set for 'imported' (the new leg) and 'duplicate' (the existing leg). */
  planned_leg_id?: number;
  /** Set for 'rejected' and 'duplicate': a one-line reason, shown to the user. */
  error?: string;
  /** Set for 'imported' when the parser tolerated something worth reporting. */
  warnings?: LnmplnWarning[];
}

/** 201 when at least one file imported; 400 when none did (body still carries results). */
export interface PlannedLegImportResponse {
  /** Final seq order — route order after chain-sorting, generally NOT upload order. */
  imported: PlannedLegWithChildren[];
  /** One entry per uploaded file, in UPLOAD order, so an error maps to the file picked. */
  results: PlannedLegImportResult[];
  /** Which ordering was used for `imported`, and why. See design.md §9.2. */
  batch: { ordering: 'chain' | 'upload'; reason: BatchChainReason };
}

/** GET and PUT /api/active-trip. */
export interface ActiveTrip {
  tripId: number | null;
  name: string | null;
}

/** PATCH /api/trips/:id/planned-legs/order — the complete permutation, not a move. */
export interface PlannedLegOrderPayload {
  legIds: number[];
}

/** PUT /api/flights/:id/planned-leg — null unlinks. */
export interface PlannedLegLinkPayload {
  plannedLegId: number | null;
}

/** PATCH /api/planned-legs/:legId — 'flown' and 'diverted' are rejected with 400. */
export interface PlannedLegStatusPayload {
  status: 'planned' | 'skipped';
}


// ════════════════════════════════════════════════════════════════════════════
// src/legMatcher.ts — the auto-match contract (T-015)
//
// Pure. Must not import ./db, ./airports, fs or http. Imports ./geo only.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Every outcome the matcher can report. These strings are the contract between
 * the matcher, the [FlightManager] log, the API and the UI. Do not rename them,
 * do not add a case without adding it to design.md §13.4.
 */
export type LegMatchReason =
  | 'MATCHED'
  | 'NO_ACTIVE_TRIP'
  | 'NO_PLANNED_LEGS'
  | 'NO_LEG_IN_RADIUS'
  | 'AMBIGUOUS'                      // two or more eligible legs in radius: refuse, never guess
  | 'LEG_ALREADY_FLOWN'
  | 'LEG_ALREADY_LINKED'
  | 'LEG_SKIPPED'
  | 'SNIPPET_NO_DEPARTURE_AIRPORT'
  | 'FLIGHT_ALREADY_LINKED';

/** One candidate leg, flattened by the caller from the DB row. No I/O in here. */
export interface LegMatchCandidate {
  plannedLegId: number;
  tripId: number;
  seq: number;
  /** Null when departureIsAirport is false. */
  departureIdent: string | null;
  departureIsAirport: boolean;
  departureLat: number;
  departureLon: number;
  status: PlannedLegStatus;
  linkedFlightId: number | null;
  /** Carried for the log and a possible future tie-break; not used in v1. */
  aircraftType: string | null;
}

export interface LegMatchInput {
  /** Takeoff position, from the frame that tripped the airborne debounce. */
  lat: number;
  lon: number;
  /** ISO. Carried for the log; does not influence the result in v1. */
  startTime: string;
  /** Carried for the log; does not influence the result in v1. */
  aircraft: string | null;
  /** null means no trip is marked active -> NO_ACTIVE_TRIP. */
  activeTripId: number | null;
  /** Non-null means the flight already has a link -> FLIGHT_ALREADY_LINKED. */
  flightAlreadyLinkedTo: number | null;
  /** Loaded once at takeoff, ordered seq ASC, id ASC. Includes ineligible legs. */
  candidates: LegMatchCandidate[];
  /** Overrides DEPARTURE_RADIUS_NM. For the scenario harness and tuning only. */
  radiusNm?: number;
}

export interface LegMatchResult {
  /** Non-null only when reason === 'MATCHED'. */
  plannedLegId: number | null;
  tripId: number | null;
  /** Always set, including on success. No path returns a bare null. */
  reason: LegMatchReason;
  /** Distance to the chosen leg, or to the nearest candidate on a refusal. */
  distanceNm: number | null;
  /**
   * Ascending. Its membership depends on `reason`, and the difference is
   * load-bearing:
   *
   * - `AMBIGUOUS` -> the ELIGIBLE ids only (design.md §13.2 step 6, "their ids").
   *   An ineligible leg is not a cause of ambiguity, so naming one in the
   *   refusal would blame the wrong leg.
   * - every other post-radius outcome -> ALL ids within the radius, which is
   *   the more useful log payload (§13.5's line reads "within 10 nm").
   * - `NO_ACTIVE_TRIP`, `NO_PLANNED_LEGS`, `FLIGHT_ALREADY_LINKED`,
   *   `NO_LEG_IN_RADIUS` -> empty; the radius was never usefully applied.
   *
   * Clarified 2026-09-05 after T-015 implemented both readings where the two
   * texts differed. Do not collapse them into one rule.
   */
  nearbyLegIds: number[];
}

/**
 * Departure radius in nautical miles.
 *
 * 10 nm, matching findNearestAirport's default maxNm so the flight's own
 * departure_icao and the matched leg's departure_ident are resolved from the
 * same neighbourhood. startFlight() fires ~3 s after rotation (3 debounce frames
 * at 1 Hz), so the ordinary case is well inside it; the radius is sized for
 * large fields, a missed rotation after an agent reconnect, and aircraft loaded
 * already airborne. Widening it does not cause wrong matches — two departures
 * within 10 nm of each other refuse as AMBIGUOUS. See design.md §13.3.
 */
export declare const DEPARTURE_RADIUS_NM: number;

/** Arrival radius for the landing outcome, same rationale. See design.md §14. */
export declare const ARRIVAL_RADIUS_NM: number;

/**
 * Chooses the planned leg a just-started flight belongs to, or refuses with a
 * reason. Pure and deterministic: same input, same output, no I/O, no clock.
 *
 * Algorithm, frozen in design.md §13.2:
 *   0. flight already linked                  -> FLIGHT_ALREADY_LINKED
 *   1. no active trip                         -> NO_ACTIVE_TRIP
 *   2. no candidates in the active trip       -> NO_PLANNED_LEGS
 *   3. great-circle distance to each candidate's departure (never degree deltas)
 *   4. none within the radius                 -> NO_LEG_IN_RADIUS
 *   5. filter the near ones by eligibility; if none remain, report the nearest
 *      one's obstacle (LEG_ALREADY_FLOWN | LEG_SKIPPED | LEG_ALREADY_LINKED |
 *      SNIPPET_NO_DEPARTURE_AIRPORT, in that precedence)
 *   6. two or more eligible                   -> AMBIGUOUS (refuse, never guess)
 *   7. exactly one                            -> MATCHED
 */
export declare function matchPlannedLeg(input: LegMatchInput): LegMatchResult;


// ════════════════════════════════════════════════════════════════════════════
// src/db.ts — the CRUD surface T-003 and T-011 must provide
// Signatures only. All SQL lives in db.ts; see contracts/schema.sql.
// ════════════════════════════════════════════════════════════════════════════

/** Everything needed to insert one leg with its children, in one transaction. */
export interface CreatePlannedLegInput {
  tripId: number;
  plan: ParsedFlightPlan;
  sourceFilename: string;
  sourceSha256: string;
}

/**
 * Inserts leg + waypoints + alternates atomically. seq = MAX(seq)+1 for the trip,
 * so the caller controls route order purely by the order it calls this — which is
 * chainOrderForBatch's order, not upload order. See design.md §9.2.3.
 */
export declare function createPlannedLeg(input: CreatePlannedLegInput): number;

/** Legs of a trip, ORDER BY seq ASC, id ASC, children attached. */
export declare function getPlannedLegsForTrip(tripId: number): PlannedLegWithChildren[];

export declare function getPlannedLegById(legId: number): PlannedLegWithChildren | null;

/** Returns the existing leg when this trip already holds a leg with these bytes. */
export declare function findPlannedLegBySource(tripId: number, sha256: string): PlannedLeg | null;

/**
 * Deletes a leg. Children go by ON DELETE CASCADE and any linked flight is
 * unlinked by ON DELETE SET NULL — but the flight's bookkeeping columns must be
 * cleared and its trip_id restored in the same transaction. See design.md §16.
 */
export declare function deletePlannedLeg(legId: number): boolean;

/** Full permutation. Caller has already checked legIds is exactly this trip's set. */
export declare function reorderPlannedLegs(tripId: number, legIds: number[]): boolean;

/** 'planned' | 'skipped' only; 'flown' and 'diverted' are system-set. */
export declare function setPlannedLegStatus(legId: number, status: 'planned' | 'skipped'): boolean;

/** Clear first, then set — see design.md §11.2. null clears the active trip. */
export declare function setActiveTrip(tripId: number | null): void;

export declare function getActiveTripId(): number | null;

/**
 * Candidates for the auto-matcher: EVERY leg of the active trip, one query.
 *
 * Deliberately unfiltered. The matcher's step 5 (design.md §13.2) is the single
 * place eligibility is decided, so that each refusal carries its specific reason
 * code. Filtering 'flown' and 'diverted' here instead would make
 * LEG_ALREADY_FLOWN unreachable in production and degrade the common "you
 * already flew that one" case into a bare NO_LEG_IN_RADIUS. Amendment C.
 */
export declare function getPlannedLegCandidatesForActiveTrip(): LegMatchCandidate[];

/** Captures prev trip_id, then moves the flight into the leg's trip. Throws on a double link. */
export declare function linkFlightToPlannedLeg(flightId: number, legId: number, source: 'auto' | 'manual'): void;

/** Restores planned_leg_prev_trip_id into trip_id, resets the leg to 'planned'. */
export declare function unlinkFlightFromPlannedLeg(flightId: number): boolean;

/**
 * Same as unlink EXCEPT that trip_id is not restored, because the flight row is
 * about to be destroyed. Called by deleteFlight() and by combineFlights() for
 * BOTH source flights. See design.md §16.
 */
export declare function clearPlannedLegLink(flightId: number): void;

/** Called by endFlight() for a linked flight. See design.md §14. */
export declare function recordPlannedLegArrival(legId: number, status: 'flown' | 'diverted', deviationNm: number): void;
