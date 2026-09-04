export interface SimFrame {
  lat: number;
  lon: number;
  altitudeFt: number;
  airspeedKnots: number;
  groundSpeedKnots: number;
  headingDeg: number;
  verticalSpeedFpm: number;
  onGround: boolean;
  simRunning: number;
  aircraft: string;
}

export type FlightState = 'IDLE' | 'FLYING' | 'ENDED';

export interface AppState {
  flightState: FlightState;
  currentFlightId: number | null;
  connected: boolean;
  lastFrame: SimFrame | null;
  /** True while the sim is paused in any form, including Active Pause. */
  paused: boolean;
  /** Raw MSFS Pause_EX1 bitmask, so the UI can name the kind of pause. */
  pauseFlags: number;
}

export interface Flight {
  id: number;
  aircraft: string | null;
  departure_lat: number | null;
  departure_lon: number | null;
  arrival_lat: number | null;
  arrival_lon: number | null;
  start_time: string;
  end_time: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  max_altitude_ft: number | null;
  max_airspeed_kts: number | null;
  point_count: number | null;
  notes: string | null;
  trip_id: number | null;
  departure_icao: string | null;
  departure_name: string | null;
  arrival_icao: string | null;
  arrival_name: string | null;
  flight_plan_name: string | null;
  /** The planned leg this flight is attached to, or null. See design.md §12. */
  planned_leg_id: number | null;
  planned_leg_link_source: 'auto' | 'manual' | null;
  /** The trip_id held immediately before an auto/manual link; restored on unlink. */
  planned_leg_prev_trip_id: number | null;
}

export interface Trip {
  id: number;
  name: string;
  notes: string | null;
  created_at: string;
  /** 0 | 1. SQLite has no boolean. At most one trip has this set to 1. */
  is_active: number;
}

export interface TripWithFlights extends Trip {
  flights: FlightWithPoints[];
  flight_count: number;
  total_distance_nm: number | null;
  total_duration_sec: number | null;
  max_altitude_ft: number | null;
  planned_leg_count: number;
  /** Populated by GET /api/trips/:id; always [] from GET /api/trips. */
  planned_legs: PlannedLegWithChildren[];
}

export interface TripEditPayload {
  name?: string;
  notes?: string | null;
}

export interface FlightEditPayload {
  aircraft?: string | null;
  notes?: string | null;
}

export interface CombinePayload {
  id1: number;
  id2: number;
}

export interface FlightPoint {
  id: number;
  flight_id: number;
  ts: string;
  lat: number;
  lon: number;
  altitude_ft: number;
  airspeed_kts: number;
  ground_speed_kts: number;
  heading_deg: number;
  vertical_speed_fpm: number;
  on_ground: number;
}

export interface FlightWithPoints extends Flight {
  points: FlightPoint[];
}

// ── Planned legs ──────────────────────────────────────────────────────────────
//
// A planned leg is a route imported from a Little Navmap .lnmpln file and
// attached to a trip, before it is flown. Not to be confused with the existing
// PDF "flight plan" attachment (flights.flight_plan_name) — see design.md §1.
// Row types persisted by src/db.ts; the parser's own output shape lives in
// src/lnmpln.ts and is never imported here (design.md §4).

/**
 * 'linked' is deliberately absent: a leg is linked when a flight row points at
 * it, so the two facts cannot drift apart. 'flown' and 'diverted' are set by
 * the system only.
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
  /** <Departure> in the file: commonly absent (NULL) — see design.md §5.4b. */
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
  /** The only source of a departure runway; see design.md §5.4f. */
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
   *  "approx." qualifier — procedure legs are never in the file. design.md §6. */
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
   * planned altitude. See design.md §6.1.
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
