/**
 * REFERENCE STUB — not compiled, not imported, not wired into the build.
 *
 * The exact declarations T-002 hands to src/types.ts and src/simbrief.ts for
 * run 2026-09-14-acars-dispatch-loadsheet. Copy the bodies, not this header;
 * nothing in src/ may carry a run id, a section number or a file name from
 * the run directory.
 *
 * Ownership:
 *   src/simbrief.ts  — SimbriefDispatchFigures, ParsedSimbriefPlan.dispatch
 *   src/types.ts     — DispatchPayload, LoadsheetFigures, LoadsheetRequestResponse,
 *                      the widened AcarsErrorBody.code
 *   src/acars.ts     — the constants and function signatures at the bottom
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

// ── src/simbrief.ts ───────────────────────────────────────────────────────────

/**
 * The dispatch/load-planning figures, in whatever unit `units` names. SimBrief
 * plans in one unit system per OFP and this carries its numbers forward
 * unconverted — nothing downstream multiplies a weight by anything.
 *
 * Every member is nullable: an OFP with no `fuel` node is still a usable route,
 * and nothing here may refuse a plan.
 */
export interface SimbriefDispatchFigures {
  /** params.units, verbatim: 'kgs' or 'lbs'. null when absent. */
  units: string | null;
  /** aircraft.reg, e.g. 'N201SB'. */
  aircraftReg: string | null;

  /** fuel.plan_ramp — block/ramp fuel, the load sheet's headline figure. */
  planRamp: number | null;
  /** fuel.plan_takeoff */
  planTakeoff: number | null;
  /** fuel.plan_landing */
  planLanding: number | null;
  /** fuel.taxi */
  taxi: number | null;
  /** fuel.enroute_burn — trip fuel. */
  enrouteBurn: number | null;
  /** fuel.contingency */
  contingency: number | null;
  /** fuel.reserve */
  reserve: number | null;
  /** fuel.alternate_burn */
  alternateBurn: number | null;

  /** times.est_time_enroute, SECONDS. */
  estTimeEnrouteSec: number | null;
  /** times.est_block, SECONDS, gate to gate. */
  estBlockSec: number | null;

  /** weights.oew — dry operating weight. */
  oew: number | null;
  /** weights.payload */
  payload: number | null;
  /** weights.est_zfw */
  estZfw: number | null;
  /** weights.max_zfw */
  maxZfw: number | null;
  /** weights.est_tow */
  estTow: number | null;
  /** weights.est_ldw */
  estLdw: number | null;
  /** weights.pax_count — a head count, not a weight. */
  paxCount: number | null;
  /** weights.cargo */
  cargo: number | null;
}

/** The one property added to the existing ParsedSimbriefPlan, as a sibling of `ofp`. */
export interface ParsedSimbriefPlanAddition {
  /**
   * Fuel, time and weight planning figures. Not part of CreatePlannedLegPlan;
   * read by the import route when it files the dispatch release.
   */
  dispatch: SimbriefDispatchFigures;
}

/** One value added to the existing SimbriefWarningCode union. */
export type SimbriefWarningCodeAddition = 'NO_DISPATCH_FIGURES';

// ── src/types.ts ──────────────────────────────────────────────────────────────

/**
 * The machine-readable twin of the dispatch-release body, stored in that
 * message's payload_json and read back — possibly days later — by the load-sheet
 * route. Deliberately self-contained: it is the only record of the OFP's fuel
 * and weight figures, and nothing may re-fetch or re-derive them.
 */
export interface DispatchPayload {
  /** Schema version of this blob. A reader that does not know it treats the payload as absent. */
  v: 1;
  /** Which upstream produced the figures. 'simbrief' is the only value today. */
  source: 'simbrief';
  ofp: {
    request_id: string | null;
    sequence_id: string | null;
    /** Epoch seconds, as a string, exactly as SimBrief sent it. */
    time_generated: string | null;
  };
  flight_number: string | null;
  aircraft_type: string | null;
  aircraft_reg: string | null;
  origin: string | null;
  destination: string | null;
  /** ICAO idents in plan order. [] when the plan was filed with none. */
  alternates: string[];
  /** The filed route string, untruncated. Truncation is a display rule. */
  route: string | null;
  cruise_alt_ft: number | null;
  /** 'kgs' | 'lbs' as SimBrief spelled it. Every weight below is in this unit. */
  units: string | null;
  ete_sec: number | null;
  block_time_sec: number | null;
  fuel: {
    ramp: number | null;
    takeoff: number | null;
    landing: number | null;
    taxi: number | null;
    enroute_burn: number | null;
    contingency: number | null;
    reserve: number | null;
    alternate_burn: number | null;
  };
  weights: {
    oew: number | null;
    payload: number | null;
    est_zfw: number | null;
    max_zfw: number | null;
    est_tow: number | null;
    est_ldw: number | null;
    pax_count: number | null;
    cargo: number | null;
  };
}

/**
 * The generated load sheet's figures. Stored as the reply message's
 * payload_json and returned alongside it, so the row and the response can never
 * disagree. Illustrative planning numbers, never a loading calculation.
 */
export interface LoadsheetFigures {
  /** 'kgs' | 'lbs' as SimBrief spelled it, or null. Every weight is in this unit. */
  units: string | null;
  block_fuel: number | null;
  taxi_fuel: number | null;
  takeoff_fuel: number | null;
  trip_fuel: number | null;
  payload: number | null;
  /** 'derived' means est_zfw - oew; 'unavailable' means the figure is null. */
  payload_source: 'simbrief' | 'derived' | 'unavailable';
  zero_fuel_weight: number | null;
  /** 'derived' means oew + payload. */
  zfw_source: 'simbrief' | 'derived' | 'unavailable';
  max_zero_fuel_weight: number | null;
  dry_operating_weight: number | null;
  takeoff_weight: number | null;
  landing_weight: number | null;
  pax_count: number | null;
  cargo: number | null;
  /** Always true: SimBrief planning figures, not a loading calculation. */
  estimated: boolean;
}

/**
 * POST /api/planned-legs/:legId/acars-messages/loadsheet — 201 when the pair was
 * written, 200 when it already existed. The request takes no body.
 */
export interface LoadsheetRequestResponse {
  planned_leg_id: number;
  /** false when this leg already had a load sheet and these are the stored rows. */
  created: boolean;
  /** direction 'downlink', label 'REQUEST LOADSHEET'. */
  request: AcarsMessage;
  /** direction 'uplink', label 'LOADSHEET'. correlation_id === request.id. */
  reply: AcarsMessage;
  /** The figures, already parsed, so no client has to scrape the body text. */
  sheet: LoadsheetFigures;
}

/** The two values added to the existing AcarsErrorBody.code union. */
export type AcarsErrorCodeAddition = 'PLANNED_LEG_NOT_FOUND' | 'NO_DISPATCH_DATA';

// ── src/acars.ts ──────────────────────────────────────────────────────────────
// Pure. No database, no express, no I/O, and no clock: `issuedAt` is always a
// parameter, never read inside.

export const DISPATCH_RELEASE_LABEL = 'DISPATCH RELEASE';
export const LOADSHEET_REQUEST_LABEL = 'REQUEST LOADSHEET';
export const LOADSHEET_LABEL = 'LOADSHEET';
/** The one definition of the rejection phrase the story specifies. */
export const NO_DISPATCH_DATA_MESSAGE = 'NO DISPATCH DATA ON FILE';
/** Ceiling on the filed route inside a message body, so no body can exceed MAX_ACARS_BODY_LENGTH. */
export const MAX_ROUTE_BODY_CHARS = 900;

/** `dispatch:leg:${legId}` */
export declare function dispatchDedupKey(legId: number): string;
/** `loadsheet-req:leg:${legId}` */
export declare function loadsheetRequestDedupKey(legId: number): string;
/** `loadsheet:leg:${legId}` */
export declare function loadsheetReplyDedupKey(legId: number): string;

/** Field copy, no arithmetic. */
export declare function buildDispatchPayload(plan: unknown /* ParsedSimbriefPlan */): DispatchPayload;
/** Total: never throws. null means "no dispatch data on file". */
export declare function parseDispatchPayload(raw: string | null): DispatchPayload | null;
export declare function buildDispatchReleaseBody(p: DispatchPayload, issuedAt: string): string;
export declare function buildLoadsheetFigures(p: DispatchPayload): LoadsheetFigures;
export declare function buildLoadsheetRequestBody(p: DispatchPayload): string;
export declare function buildLoadsheetReplyBody(
  p: DispatchPayload,
  sheet: LoadsheetFigures,
  issuedAt: string,
): string;

// Shared formatters. Exported because they are the natural unit-test surface.
/** null/non-finite/negative -> '----'. Otherwise HHMM, seconds discarded. */
export declare function hhmm(sec: number | null): string;
/** null -> 'UNKNOWN'. >= 18000 ft -> 'FL280'. Otherwise '8000FT'. */
export declare function levelText(ft: number | null): string;
/** null -> '----'. Otherwise String(Math.round(v)). No separators, no unit. */
export declare function qty(v: number | null): string;
/** 'kgs'|'kg' -> 'KG'; 'lbs'|'lb' -> 'LB'; anything else -> 'UNITS UNKNOWN'. */
export declare function unitText(units: string | null): string;
/** null -> 'NIL'. <= MAX_ROUTE_BODY_CHARS -> verbatim. Otherwise first 897 chars + '...'. */
export declare function clampRoute(route: string | null): string;
/** label.padEnd(14) + value.padStart(6) — the whole fixed-field grid. */
export declare function field(label: string, value: string): string;

// Declared here only so this stub type-checks in isolation; the real one is in src/types.ts.
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
