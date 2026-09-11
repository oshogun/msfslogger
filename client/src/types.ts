// ── Auth ──────────────────────────────────────────────────────────────────
//
// Mirrors src/types.ts byte-identically. Hand-maintained; there is no
// shared package and this run does not introduce one.

export interface SessionUser {
  username: string;
}

/** POST /api/auth/login request body. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** POST /api/auth/login 200 body. */
export interface LoginResponse {
  user: SessionUser;
}

/** GET /api/auth/session 200 body. Always 200, never 401. */
export type SessionResponse =
  | { authenticated: true; user: SessionUser }
  | { authenticated: false; user: null };

export interface FlightPoint {
  lat: number;
  lon: number;
  altitude_ft: number;
  timestamp: string;
}

export interface Flight {
  id: number;
  aircraft: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  max_altitude_ft: number | null;
  max_airspeed_kts: number | null;
  point_count: number | null;
  points?: FlightPoint[];
  departure_lat: number | null;
  departure_lon: number | null;
  departure_icao: string | null;
  departure_name: string | null;
  arrival_lat: number | null;
  arrival_lon: number | null;
  arrival_icao: string | null;
  arrival_name: string | null;
  notes: string | null;
  trip_id: number | null;
  flight_plan_name: string | null;
  /** The planned leg this flight is attached to, or null. */
  planned_leg_id: number | null;
  planned_leg_link_source: 'auto' | 'manual' | null;
  /** The trip_id held immediately before an auto/manual link; restored on unlink. */
  planned_leg_prev_trip_id: number | null;
}

export interface Trip {
  id: number;
  name: string;
  notes: string | null;
  flight_count: number;
  total_duration_sec: number | null;
  total_distance_nm: number | null;
  max_altitude_ft: number | null;
  flights: Flight[];
  /** 0 | 1. SQLite has no boolean. At most one trip has this set to 1. */
  is_active: number;
  planned_leg_count: number;
  /** Populated by GET /api/trips/:id; always [] from GET /api/trips. */
  planned_legs: PlannedLegWithChildren[];
}

// ── Planned legs ──────────────────────────────────────────────────────────────
//
// Mirrors src/types.ts and src/lnmpln.ts field-for-field, including
// nullability. This file is hand-maintained and nothing checks it against the
// server automatically beyond tools/check-type-mirror.js — keep it in sync by
// hand.

/**
 * 'linked' is deliberately absent: a leg is linked when a flight row points at
 * it, so the two facts cannot drift apart. 'diverted' is set by the system
 * only; 'flown' is set at touchdown, or — reversibly — by hand on a still
 * 'planned' leg whose flight was linked manually and has already ended.
 */
export type PlannedLegStatus = 'planned' | 'flown' | 'diverted' | 'skipped';

export interface PlannedLeg {
  id: number;
  trip_id: number;
  /** 1-based within the trip; gappy after a delete. Read with ORDER BY seq, id. */
  seq: number;
  status: PlannedLegStatus;

  /** First waypoint of the plan. Not necessarily an airport (plan snippets exist). */
  departure_ident: string;
  departure_name: string | null;
  departure_lat: number;
  departure_lon: number;
  /** 0 | 1. When 0, departure_ident is not an airport code. */
  departure_is_airport: number;
  /** <Departure> in the file: commonly absent (NULL). */
  departure_start: string | null;
  departure_start_type: string | null;
  departure_pos_lat: number | null;
  departure_pos_lon: number | null;

  /** Last waypoint of the plan, same airport caveat as the departure. */
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
  /** The only source of a departure runway. */
  sid_runway: string | null;
  sid_transition: string | null;
  /** 'CUSTOMDEPART' for the manual's custom-departure form; NULL otherwise. */
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
  /** Great-circle sum over the en-route waypoint chain. Always render with an
   *  "approx." qualifier — procedure legs are never in the file. */
  approx_distance_nm: number;
  /** Written at landing on both the 'flown' and the 'diverted' path. */
  arrival_deviation_nm: number | null;

  remarks: string | null;
  /** CreationDate normalised to a full ISO instant. */
  plan_created_at: string | null;
  source_filename: string;
  source_sha256: string;
  source_program: string | null;
  imported_at: string;
}

export interface PlannedWaypoint {
  id: number;
  planned_leg_id: number;
  /** 1-based document order across every <Waypoints> block. Never keyed by ident. */
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
   * Little Navmap's COMPUTED profile altitude, not a planned constraint. Never
   * render it as a planned or crossing altitude — cruise_alt_ft is the leg's
   * planned altitude.
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
 * What every planned-leg endpoint returns. linked_flight_id is derived by a
 * subquery, not stored.
 */
export interface PlannedLegWithChildren extends PlannedLeg {
  linked_flight_id: number | null;
  waypoints: PlannedWaypoint[];
  alternates: PlannedAlternate[];
}

/** src/lnmpln.ts LnmplnWarning, mirrored (camelCase: computed, not persisted). */
export interface LnmplnWarning {
  code: string;
  /** One line, naming the element and the value. Surfaced per file on import. */
  message: string;
}

/**
 * Why a batch was or was not chain-sorted. src/lnmpln.ts BatchChainReason,
 * mirrored.
 */
export type BatchChainReason =
  | 'CHAINED'
  | 'SINGLE_LEG'
  | 'SNIPPET_IN_BATCH'
  | 'NO_UNIQUE_HEAD'
  | 'AMBIGUOUS_SUCCESSOR'
  | 'BROKEN_CHAIN';

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
  /**
   * Which ordering was used for `imported`, and why.
   *
   * Absent when nothing was imported: a chain verdict over zero legs says
   * nothing, so the server omits it rather than reporting a spurious one
   * (phase-1 review finding F-3). Branch on `batch?.ordering`, never assume it.
   */
  batch?: { ordering: 'chain' | 'upload'; reason: BatchChainReason };
}

/** GET and PUT /api/active-trip (future phase; declared here ahead of the endpoint). */
export interface ActiveTrip {
  tripId: number | null;
  name: string | null;
}

/**
 * Mirrors src/types.ts TrafficObject byte-identically (neither file imports
 * from the other, same as StatusFrame / SimFrame). All six fields are always
 * present on this wire — onGround is only optional on the agent's ingest
 * wire, never here.
 */
export interface TrafficObject {
  id: number;
  lat: number;
  lon: number;
  altitudeFt: number;
  headingDeg: number;
  onGround: boolean;
}

export interface StatusFrame {
  lat: number;
  lon: number;
  altitudeFt: number;
  airspeedKnots: number;
  groundSpeedKnots: number;
  headingDeg: number;
  verticalSpeedFpm: number;
  onGround: boolean;
}

/**
 * Mirrors src/types.ts PlannedLegLiveStatus. Present on Status only while
 * flightState === 'FLYING' and the flight is linked to a planned leg — absent,
 * never null, the rest of the time.
 */
export interface PlannedLegLiveStatus {
  plannedLegId: number;
  tripId: number;
  tripName: string;
  destinationIdent: string;
  nextWaypointIdent: string;
  remainingDistanceNm: number;
  distanceIsApproximate: true;
}

export interface Status {
  connected: boolean;
  flightState: string;
  currentFlightId: number | null;
  aircraft: string | null;
  frame: StatusFrame | null;
  /** True for any sim pause, including MSFS Active Pause. Flight time is not counted while true. */
  paused: boolean;
  /** Raw MSFS Pause_EX1 bitmask: 1 full, 2 with-sound, 4 active, 8 sim. */
  pauseFlags: number;
  plannedLeg?: PlannedLegLiveStatus;
  /** Present iff non-empty, mirroring plannedLeg. */
  traffic?: TrafficObject[];
}

export interface JourneyLeg {
  id: number;
  seq: number;
  aircraft: string | null;
  departureIcao: string | null;
  arrivalIcao: string | null;
  distanceNm: number | null;
  durationSec: number | null;
  startTime: string;
  track: [number, number][];
}

export interface JourneyAirport {
  icao: string;
  name: string | null;
  lat: number;
  lon: number;
  visits: number;
}

export interface Journey {
  legCount: number;
  totalDistanceNm: number;
  totalDurationSec: number;
  /** Absent, not zero, when the trip has no planned legs. */
  plannedRouteProgressPct?: number;
  aircraftCount: number;
  aircraft: { name: string; legs: number; distanceNm: number }[];
  maxAltitudeFt: number;
  maxAirspeedKts: number;
  longestLeg: { id: number; route: string; distanceNm: number } | null;
  countries: { name: string; flag: string; airports: number }[];
  airports: JourneyAirport[];
  longestChain: { length: number; from: string; to: string } | null;
  chainBreaks: number;
  legs: JourneyLeg[];
  firstFlight: string | null;
  lastFlight: string | null;
}
