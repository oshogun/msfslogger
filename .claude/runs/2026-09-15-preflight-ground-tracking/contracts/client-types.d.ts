// ── Client mirrors (reference artifact) ──────────────────────────────────────
//
// Appended to client/src/types.ts under a new "── Ground sessions ──" banner,
// plus the one-line change to the existing Status interface at the bottom.
// Hand-mirrored from src/types.ts; client/src/types.ts must not import from
// src/types.ts, exactly as SimFrame / StatusFrame / TrafficObject / the ACARS
// shapes are already mirrored. design.md §6.1 owns this file's contents.

export type GroundSessionSource = 'auto' | 'manual';

/** Mirrors src/types.ts GroundSessionEndReason. */
export type GroundSessionEndReason =
  | 'flight-started' | 'sim-exit' | 'crash' | 'slew'
  | 'superseded' | 'corrected' | 'manual'
  | (string & {});

/** Mirrors src/types.ts GroundSession — one ground_sessions row. */
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
  started_at: string;
  ended_at: string | null;
  ended_reason: GroundSessionEndReason | null;
  flight_id: number | null;
  created_at: string;
  updated_at: string;
}

/** POST /api/ground-sessions request body. */
export interface CreateGroundSessionRequest {
  icao: string;
  parking_position?: string | null;
  planned_leg_id?: number | null;
}

/** PATCH /api/ground-sessions/current request body. */
export interface UpdateGroundSessionRequest {
  parking_position: string | null;
}

/** GET /api/ground-sessions/current 200 body. `session` is null when none is open. */
export interface CurrentGroundSessionResponse {
  session: GroundSession | null;
}

/**
 * Mirrors src/types.ts GroundSessionLiveStatus. Present on Status only while
 * flightState === 'GROUND' — absent, never null, the rest of the time.
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
  tripId: number | null;
  tripName: string | null;
  departureIdent: string | null;
  destinationIdent: string | null;
  startedAt: string;
}

/** GET /api/planned-legs/:legId/acars-messages 200 body. */
export interface PlannedLegAcarsThread {
  planned_leg_id: number;
  messages: AcarsMessage[];
}

/** POST /api/planned-legs/:legId/acars-messages/wx 201 body. */
export interface PlannedLegWxRequestResponse {
  planned_leg_id: number;
  icao: string;
  available: boolean;
  request: AcarsMessage;
  reply: AcarsMessage;
  weather: WxWeatherPayload | null;
}

// The one change to an existing interface — the new key is optional, so every
// existing reader of Status keeps compiling untouched:
//
//   export interface Status {
//     ...
//     plannedLeg?: PlannedLegLiveStatus;
//     /** Present iff flightState === 'GROUND'. Never null. */
//     groundSession?: GroundSessionLiveStatus;
//     traffic?: TrafficObject[];
//   }

// Declared in client/src/types.ts already; named here only so this file
// type-checks as a standalone reference.
import type { AcarsMessage, WxWeatherPayload } from '../../../../client/src/types';
