// ── Server-side types for the ground session (reference artifact) ────────────
//
// Every declaration below is appended to src/types.ts, in this order, under a
// new "── Ground sessions ──" banner placed after the ACARS block. Nothing in
// this file is compiled or imported by the app; it is design.md §3/§5's type
// half, written out so an implementer can paste rather than re-derive.
//
// Ownership (design.md §6.1): src/types.ts owns these declarations; the
// identical declarations are mirrored BY HAND into client/src/types.ts, and
// neither file imports from the other — the same rule SimFrame, TrafficObject
// and the ACARS shapes already follow.

// ── Telemetry (src/types.ts, existing SimFrame interface) ────────────────────

/**
 * The three fields appended to the existing SimFrame interface. Optional, and
 * the optionality is load-bearing: the agent runs on the operator's Windows
 * machine and is upgraded separately from the server, so a server that has
 * this feature will keep receiving frames from an agent that does not. Absent
 * means "unknown", and unknown means ground detection stands down — it never
 * means false or zero. See design.md §2.4.
 */
export interface SimFrameGroundFields {
  /** BRAKE PARKING INDICATOR !== 0. */
  parkingBrake?: boolean;
  /** NUMBER OF ENGINES, clamped to 0..4. */
  engineCount?: number;
  /** How many of GENERAL ENG COMBUSTION:1..engineCount are non-zero. */
  enginesRunning?: number;
}

// ── Ground sessions ──────────────────────────────────────────────────────────

/** Who put a value there. Same vocabulary as flights.planned_leg_link_source. */
export type GroundSessionSource = 'auto' | 'manual';

/**
 * How an open session ended. Open on purpose, like AcarsCategory: the seven
 * below are what this design produces, and a later feature may add another
 * without a migration.
 */
export type GroundSessionEndReason =
  | 'flight-started' | 'sim-exit' | 'crash' | 'slew'
  | 'superseded' | 'corrected' | 'manual'
  | (string & {});

/** One row of ground_sessions, as every read returns it and as the API sends it. */
export interface GroundSession {
  id: number;
  source: GroundSessionSource;
  airport_icao: string | null;
  airport_name: string | null;
  lat: number | null;
  lon: number | null;
  parking_position: string | null;
  parking_position_source: GroundSessionSource | null;
  planned_leg_id: number | null;
  planned_leg_link_source: GroundSessionSource | null;
  aircraft: string | null;
  /** ISO 8601 UTC instant. */
  started_at: string;
  /** NULL means the session is open. At most one row is open at a time. */
  ended_at: string | null;
  ended_reason: GroundSessionEndReason | null;
  flight_id: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Argument to insertGroundSession (src/db/groundSessions.ts). snake_case, one
 * key per column, so a row can be checked against the table without a mapping
 * table in between. Every key but `source` and `started_at` defaults to NULL.
 */
export interface CreateGroundSession {
  source: GroundSessionSource;
  airport_icao?: string | null;
  airport_name?: string | null;
  lat?: number | null;
  lon?: number | null;
  parking_position?: string | null;
  parking_position_source?: GroundSessionSource | null;
  planned_leg_id?: number | null;
  planned_leg_link_source?: GroundSessionSource | null;
  aircraft?: string | null;
  /** Defaults to new Date().toISOString() when omitted. */
  started_at?: string;
}

/** POST /api/ground-sessions request body. */
export interface CreateGroundSessionRequest {
  /** Required. Validated with isValidIcaoShape() from src/acars.ts after normaliseIcao(). */
  icao: string;
  /** Free text, trimmed; '' is stored as NULL. Max 120 chars. */
  parking_position?: string | null;
  /** Must exist when given: 404 PLANNED_LEG_NOT_FOUND otherwise. */
  planned_leg_id?: number | null;
}

/** PATCH /api/ground-sessions/current request body. */
export interface UpdateGroundSessionRequest {
  /** Trimmed; '' and null both clear the field. Max 120 chars. */
  parking_position: string | null;
}

/** GET /api/ground-sessions/current 200 body. Always 200, never 404. */
export interface CurrentGroundSessionResponse {
  /** null when no session is open. */
  session: GroundSession | null;
}

/**
 * GET /api/status's `groundSession` key. Computed, camelCase, exactly like
 * PlannedLegLiveStatus. Present only while flightState === 'GROUND'; the
 * endpoint omits the key entirely otherwise, so this never appears as a null
 * field. `groundSessionId` is ground_sessions.id, so a client holding both
 * this and GET /api/ground-sessions/current can see they are the same row.
 */
export interface GroundSessionLiveStatus {
  groundSessionId: number;
  source: GroundSessionSource;
  airportIcao: string | null;
  airportName: string | null;
  parkingPosition: string | null;
  parkingPositionSource: GroundSessionSource | null;
  plannedLegId: number | null;
  plannedLegLinkSource: GroundSessionSource | null;
  /** The matched leg's trip, for the link the panel renders. Null when unlinked. */
  tripId: number | null;
  tripName: string | null;
  /** The leg's route, so the panel can name it without a second request. */
  departureIdent: string | null;
  destinationIdent: string | null;
  startedAt: string;
}

/** Every ground-session rejection body: { error, code }. */
export interface GroundSessionErrorBody {
  error: string;
  code:
    | 'INVALID_BODY' | 'INVALID_ICAO' | 'PLANNED_LEG_NOT_FOUND'
    | 'NO_OPEN_GROUND_SESSION';
}

// ── Leg-scoped ACARS ─────────────────────────────────────────────────────────

/**
 * GET /api/planned-legs/:legId/acars-messages 200 body. The leg-scoped twin of
 * AcarsThread, which is keyed on a flight. Separate interface rather than a
 * widened AcarsThread: AcarsThread.flight_id is a `number` today and every
 * existing consumer relies on it.
 */
export interface PlannedLegAcarsThread {
  planned_leg_id: number;
  /** Oldest first: sent_at ASC, id ASC. The client reverses for display. */
  messages: AcarsMessage[];
}

/**
 * POST /api/planned-legs/:legId/acars-messages/wx 201 body. Field-for-field
 * WxRequestResponse with planned_leg_id where flight_id was.
 */
export interface PlannedLegWxRequestResponse {
  planned_leg_id: number;
  icao: string;
  available: boolean;
  request: AcarsMessage;
  reply: AcarsMessage;
  weather: WxWeatherPayload | null;
}

// Declared in src/types.ts already; named here only so this file type-checks
// as a standalone reference.
import type { AcarsMessage, WxWeatherPayload } from '../../../../src/types';
