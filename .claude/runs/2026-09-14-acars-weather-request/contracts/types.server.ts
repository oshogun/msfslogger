// Reference stub only — not wired into the build. Mirrors what T-002 adds to
// src/types.ts. See design.md §2.1.

import type { AcarsMessage } from '../../../../src/types';

/** POST /api/flights/:id/acars-messages/wx request body. */
export interface RequestWxRequest {
  icao: string;
}

/**
 * The machine-readable twin of a successful WX reply's payload_json, and
 * weatherClient.ts's own return type once a METAR was found.
 */
export interface WxWeatherPayload {
  icao: string;
  metar: string;
  taf: string | null;
  fetched_at: string;
}

export type WxUnavailableReason =
  | 'NO_DATA'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'BAD_STATUS'
  | 'BAD_BODY';

/** The machine-readable twin of a WX rejection reply's payload_json. */
export interface WxUnavailablePayload {
  icao: string;
  reason: WxUnavailableReason;
}

/** POST /api/flights/:id/acars-messages/wx 201 body. */
export interface WxRequestResponse {
  flight_id: number;
  icao: string;
  available: boolean;
  request: AcarsMessage;
  reply: AcarsMessage;
  weather: WxWeatherPayload | null;
}

/** Extends the existing AcarsErrorBody.code union in src/types.ts with one member. */
export type AcarsErrorBodyCodeAddition = 'INVALID_ICAO';
