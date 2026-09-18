// Reference artifact for run 2026-09-18-mcp-server. NOT compiled, NOT imported
// by the build. Authoritative prose: design.md §4 (routes) and §10 (algorithms).
//
// Type ownership:
//   FlightStats, FlightStatsFilter, AircraftStat, RouteStat,
//   FlightSearchResult                → src/types.ts        (one block, §9.2)
//   getFlightStats, searchFlights,
//   countSearchFlights                → src/db/flights.ts   (§4.4)
//   FlightSummary (MCP projection)    → src/mcp/projections.ts (§6.3) — NOT src/types.ts

// ── src/types.ts ──────────────────────────────────────────────────────────────

/** Normalised, already-validated filter. Both bounds compare lexicographically
 *  against flights.start_time: `from` inclusive, `to` exclusive (§10.2). */
export interface FlightStatsFilter {
  /** ISO-8601 UTC instant, or null for "no lower bound". */
  from: string | null;
  /** ISO-8601 UTC instant, or null for "no upper bound". */
  to: string | null;
}

export interface AircraftStat {
  /** Exactly as stored in flights.aircraft — never normalised. */
  aircraft: string;
  flights: number;
  duration_sec: number;
  /** Rounded to 1 decimal. */
  distance_nm: number;
}

export interface RouteStat {
  /** `${departure_icao}-${arrival_icao}`, directional. */
  route: string;
  departure_icao: string;
  arrival_icao: string;
  flights: number;
  duration_sec: number;
  /** Rounded to 1 decimal. */
  distance_nm: number;
}

export interface FlightStats {
  filter: FlightStatsFilter;
  totals: {
    /** Rows matching the filter, including in-progress ones. */
    flights: number;
    /** Subset with end_time NOT NULL. */
    completed_flights: number;
    /** Sum of effectiveDurationSec() over matching rows (§10.1). */
    duration_sec: number;
    /** duration_sec / 3600, rounded to 1 decimal. */
    duration_hours: number;
    /** Sum of distance_nm treating NULL as 0, rounded to 1 decimal. */
    distance_nm: number;
    /** Earliest / latest start_time among matching rows; null when none. */
    first_flight_start: string | null;
    last_flight_start: string | null;
  };
  /** At most 5, ordered per §10.1. Empty array when no row has an aircraft. */
  top_aircraft: AircraftStat[];
  /** At most 5, ordered per §10.1. */
  top_routes: RouteStat[];
}

export interface FlightSearchResult {
  /** The raw q, echoed verbatim. */
  query: string;
  /** Total matches, ignoring limit/offset. */
  total: number;
  limit: number;
  offset: number;
  /** Flight rows, same shape as GET /api/flights (no points), start_time DESC. */
  flights: import('../../../../src/types').Flight[];
}

// ── src/db/flights.ts ─────────────────────────────────────────────────────────

/** One prepared SELECT of the 9 columns §10.1 names, aggregated in JS. */
export function getFlightStats(filter: FlightStatsFilter): FlightStats;

/** Tokenised LIKE match (§10.3). `tokens` is already split/validated by the
 *  caller; an empty array is a programming error, not a query that matches
 *  everything. */
export function searchFlights(
  tokens: readonly string[],
  limit: number,
  offset: number,
): import('../../../../src/types').Flight[];

/** Same WHERE clause as searchFlights, COUNT(*) only. */
export function countSearchFlights(tokens: readonly string[]): number;
