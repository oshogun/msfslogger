import type { Flight, FlightPoint, TripWithFlights, PlannedLegWithChildren } from '../types';

// MCP-only view types. Deliberately not src/types.ts: these are one
// consumer's presentation of a row, not a shape any route or the web client
// should come to depend on. A route and a tool can read the exact same
// database row and still render it differently — that is the point of
// keeping these here rather than sharing Flight/Trip/PlannedLeg verbatim.

/** The compact flight shape every list-ish tool returns. */
export interface FlightSummary {
  id: number;
  aircraft: string | null;
  start_time: string;
  end_time: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  departure_icao: string | null;
  arrival_icao: string | null;
  trip_id: number | null;
  planned_leg_id: number | null;
  /** flights.notes truncated to 200 chars; '…' appended iff truncated. */
  notes: string | null;
}

export interface TripSummary {
  id: number;
  name: string;
  notes: string | null;
  created_at: string;
  is_active: number;
  flight_count: number;
  planned_leg_count: number;
  total_distance_nm: number | null;
  total_duration_sec: number | null;
}

export interface PlannedLegSummary {
  id: number;
  trip_id: number | null;
  trip_name: string | null;
  seq: number;
  status: 'planned' | 'flown' | 'diverted' | 'skipped';
  departure_ident: string | null;
  destination_ident: string | null;
  cruise_alt_ft: number | null;
  aircraft_type: string | null;
  approx_distance_nm: number | null;
  waypoint_count: number | null;
  is_snippet: number;
  imported_at: string | null;
}

/** A flight_points row, trimmed to what describes a path rather than a
 *  telemetry dump — no id, flight_id, airspeed_kts or vertical_speed_fpm. */
export interface TrackPoint {
  ts: string;
  lat: number;
  lon: number;
  altitude_ft: number;
  ground_speed_kts: number;
  heading_deg: number;
  on_ground: number;
}

const NOTES_MAX_CHARS = 200;

function truncateNotes(notes: string | null): string | null {
  if (notes === null || notes.length <= NOTES_MAX_CHARS) return notes;
  return `${notes.slice(0, NOTES_MAX_CHARS)}…`;
}

export function toFlightSummary(f: Flight): FlightSummary {
  return {
    id: f.id,
    aircraft: f.aircraft,
    start_time: f.start_time,
    end_time: f.end_time,
    duration_sec: f.duration_sec,
    distance_nm: f.distance_nm,
    departure_icao: f.departure_icao,
    arrival_icao: f.arrival_icao,
    trip_id: f.trip_id,
    planned_leg_id: f.planned_leg_id,
    notes: truncateNotes(f.notes),
  };
}

export function toTripSummary(t: TripWithFlights): TripSummary {
  return {
    id: t.id,
    name: t.name,
    notes: t.notes,
    created_at: t.created_at,
    is_active: t.is_active,
    flight_count: t.flight_count,
    planned_leg_count: t.planned_leg_count,
    total_distance_nm: t.total_distance_nm,
    total_duration_sec: t.total_duration_sec,
  };
}

export function toPlannedLegSummary(
  l: PlannedLegWithChildren & { trip_name?: string | null },
): PlannedLegSummary {
  return {
    id: l.id,
    trip_id: l.trip_id,
    trip_name: l.trip_name ?? null,
    seq: l.seq,
    status: l.status,
    departure_ident: l.departure_ident,
    destination_ident: l.destination_ident,
    cruise_alt_ft: l.cruise_alt_ft,
    aircraft_type: l.aircraft_type,
    approx_distance_nm: l.approx_distance_nm,
    waypoint_count: l.waypoint_count,
    is_snippet: l.is_snippet,
    imported_at: l.imported_at,
  };
}

export function toTrackPoint(p: FlightPoint): TrackPoint {
  return {
    ts: p.ts,
    lat: p.lat,
    lon: p.lon,
    altitude_ft: p.altitude_ft,
    ground_speed_kts: p.ground_speed_kts,
    heading_deg: p.heading_deg,
    on_ground: p.on_ground,
  };
}

/**
 * Even-stride sample of `points` down to at most `max` entries — deterministic
 * (no time/distance-based thinning to tune), and always keeps the first and
 * last point. Output index i is points[round(i * (n - 1) / (max - 1))].
 */
export function downsampleTrack<T>(points: readonly T[], max: number): T[] {
  const n = points.length;
  if (n <= max) return [...points];
  if (max <= 1) return n > 0 ? [points[0]] : [];
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round((i * (n - 1)) / (max - 1))]);
  }
  return out;
}

export interface ToolTextResult {
  // The SDK's own CallToolResult allows arbitrary extra keys (it is a "loose"
  // result object); this index signature is what makes ToolTextResult/
  // ToolErrorResult structurally assignable to it.
  [key: string]: unknown;
  content: [{ type: 'text'; text: string }];
}

export interface ToolErrorResult {
  [key: string]: unknown;
  isError: true;
  content: [{ type: 'text'; text: string }];
}

export type ToolResult = ToolTextResult | ToolErrorResult;

/** Success envelope: one text content block holding compact JSON — no
 *  indentation, no structuredContent, no outputSchema. */
export function toolText(value: unknown): ToolTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** Failure envelope for an expected failure (not found, empty, conflicting,
 *  upstream-refused): one plain sentence a model can act on. Never a stack
 *  trace, a file path, a SQL string, a token or an API key. */
export function toolError(message: string): ToolErrorResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
