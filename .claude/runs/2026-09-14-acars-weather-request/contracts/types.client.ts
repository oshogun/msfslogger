// Reference stub only — not wired into the build. Mirrors what T-003 adds to
// client/src/types.ts. See design.md §2.2. Verbatim copies of the server
// types except doc-comment length; AcarsMessage is already mirrored client-side.

import type { AcarsMessage } from '../../../../client/src/types';

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

/** POST /api/flights/:id/acars-messages/wx 201 body. */
export interface WxRequestResponse {
  flight_id: number;
  icao: string;
  available: boolean;
  request: AcarsMessage;
  reply: AcarsMessage;
  weather: WxWeatherPayload | null;
}

// Not mirrored client-side (see design.md §2.2): RequestWxRequest, WxUnavailablePayload.
