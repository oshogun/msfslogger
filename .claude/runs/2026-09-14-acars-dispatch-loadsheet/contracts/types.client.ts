/**
 * REFERENCE STUB — not compiled, not imported, not wired into the build.
 *
 * Exactly what T-003 appends to client/src/types.ts, in the existing
 * `── ACARS ──` block, mirrored by hand from src/types.ts the way AcarsMessage
 * and AcarsThread already are. Copy the declarations, not this header.
 *
 * DispatchPayload is deliberately NOT mirrored: no client parses payload_json in
 * this run. The web page renders `body`, and the figures it needs arrive
 * pre-parsed as LoadsheetRequestResponse.sheet.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * The generated load sheet's figures. Illustrative planning numbers copied from
 * the SimBrief plan, not a loading calculation — see `estimated`.
 */
export interface LoadsheetFigures {
  /** 'kgs' | 'lbs' as SimBrief spelled it, or null. Every weight is in this unit. */
  units: string | null;
  block_fuel: number | null;
  taxi_fuel: number | null;
  takeoff_fuel: number | null;
  trip_fuel: number | null;
  payload: number | null;
  payload_source: 'simbrief' | 'derived' | 'unavailable';
  zero_fuel_weight: number | null;
  zfw_source: 'simbrief' | 'derived' | 'unavailable';
  max_zero_fuel_weight: number | null;
  dry_operating_weight: number | null;
  takeoff_weight: number | null;
  landing_weight: number | null;
  pax_count: number | null;
  cargo: number | null;
  /** Always true. Never present these as authoritative loading data. */
  estimated: boolean;
}

/**
 * POST /api/planned-legs/:legId/acars-messages/loadsheet 200/201 body. The
 * request takes no body at all.
 *
 * `created` is false when the leg already had a load sheet: the two messages are
 * then the stored ones, already in the thread, so they are merged into local
 * state by id rather than appended.
 */
export interface LoadsheetRequestResponse {
  planned_leg_id: number;
  created: boolean;
  /** direction 'downlink', label 'REQUEST LOADSHEET'. */
  request: AcarsMessage;
  /** direction 'uplink', label 'LOADSHEET'. correlation_id === request.id. */
  reply: AcarsMessage;
  sheet: LoadsheetFigures;
}

// Declared here only so this stub type-checks in isolation; the real one is
// already in client/src/types.ts and is not changed by this run.
interface AcarsMessage {
  id: number;
  flight_id: number | null;
  planned_leg_id: number | null;
  direction: 'uplink' | 'downlink';
  category: string;
  label: string | null;
  body: string;
  payload_json: string | null;
  correlation_id: number | null;
  dedup_key: string | null;
  sent_at: string;
  read_at: string | null;
}
