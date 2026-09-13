/**
 * Reference artifact for run 2026-09-13-simbrief-import. NOT part of the build:
 * nothing imports this file and it is outside tsconfig.json's include. The
 * shipped copies of these declarations live where design.md assigns them:
 *
 *   ParsedSimbriefPlan, SimbriefWarning, SimbriefParseError   -> src/simbrief.ts
 *   SimbriefFetchError, SimbriefErrorCode, fetchLatestOfp     -> src/simbrief.ts
 *   SimbriefSettings, SimbriefImportResponse (client mirrors) -> client/src/types.ts
 *
 * Every scalar in SimBrief's JSON is a string and every empty element is `{}`,
 * so the raw-side types below are deliberately `unknown` — the coercion
 * helpers are the only thing allowed to look at them.
 */

// ── Raw side: what SimBrief actually hands back ───────────────────────────────

/** The envelope present on BOTH success and error bodies. */
export interface SimbriefFetchEnvelope {
  /** Echo of the resolved pilot id. Empty string when the lookup failed. */
  userid: unknown;
  static_id: unknown;
  /** "Success", or a string beginning "Error: ". The only reliable verdict. */
  status: unknown;
  time: unknown;
}

export interface SimbriefRawResponse {
  fetch?: SimbriefFetchEnvelope;
  params?: Record<string, unknown>;
  general?: Record<string, unknown>;
  origin?: Record<string, unknown>;
  destination?: Record<string, unknown>;
  /** `{}` when none, a single object when one, an array when several. */
  alternate?: unknown;
  navlog?: { fix?: unknown };
  atc?: Record<string, unknown>;
  aircraft?: Record<string, unknown>;
  [k: string]: unknown;
}

// ── Parsed side: structurally compatible with CreatePlannedLegPlan (src/db.ts) ─

export type SimbriefWarningCode =
  | 'NO_ALTERNATES'
  | 'UNKNOWN_FIX_TYPE'
  | 'FIX_MISSING_POSITION'
  | 'NO_CRUISE_ALTITUDE'
  | 'ORIGIN_IN_NAVLOG'
  | 'PSEUDO_WAYPOINTS';

export interface SimbriefWarning {
  code: SimbriefWarningCode;
  message: string;
}

export interface SimbriefEndpoint {
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  isAirport: boolean;
}

export interface SimbriefWaypoint {
  seq: number;
  ident: string;
  name: string | null;
  region: string | null;
  airway: string | null;
  track: string | null;
  /** AIRPORT | WAYPOINT | VOR | NDB | USER | UNKNOWN. Only AIRPORT is behavioural. */
  type: string;
  comment: string | null;
  lat: number;
  lon: number;
  altFt: number | null;
}

export interface SimbriefAlternate {
  seq: number;
  ident: string;
  name: string | null;
  type: string | null;
  lat: number | null;
  lon: number | null;
  altFt: number | null;
}

/**
 * Structurally compatible with CreatePlannedLegPlan (src/db.ts), not imported —
 * the same seam src/lnmpln.ts's ParsedFlightPlan already uses.
 */
export interface ParsedSimbriefPlan {
  departure: SimbriefEndpoint;
  destination: SimbriefEndpoint;
  /** Always false: SimBrief cannot express a plan snippet. */
  isSnippet: false;
  cruiseAltFt: number | null;
  /** "IFR" | "VFR", derived from atc.flight_rules. */
  flightplanType: string | null;
  aircraftType: string | null;
  remarks: string | null;
  /** params.time_generated as a full ISO instant. */
  createdAt: string | null;
  /** Always "SimBrief". */
  sourceProgram: string;

  departureStart: { pos: null; start: null; startType: null };
  procedures: {
    sidName: string | null;
    sidRunway: string | null;
    sidTransition: string | null;
    sidType: null;
    sidCustomDistanceNm: null;
    starName: string | null;
    starRunway: string | null;
    starTransition: string | null;
    approachName: null;
    approachRunway: null;
    approachTransition: null;
    approachType: null;
    approachArinc: null;
    approachSuffix: null;
    approachTransitionType: null;
    approachCustomDistanceNm: null;
    approachCustomAltitudeFt: null;
    approachCustomOffsetDeg: null;
  };

  waypoints: SimbriefWaypoint[];
  alternates: SimbriefAlternate[];
  approxDistanceNm: number;

  /** SimBrief provenance. Not part of CreatePlannedLegPlan; read by the route. */
  ofp: {
    /** params.request_id — unique per OFP generation. */
    requestId: string | null;
    /** params.sequence_id. */
    sequenceId: string | null;
    /** params.time_generated, the raw epoch-seconds string. */
    timeGenerated: string | null;
    /** general.flight_number, e.g. "SHG037". */
    flightNumber: string | null;
    /** general.route, the filed route string. */
    routeString: string | null;
    /** The pilot id the plan was fetched for, echoed from fetch.userid. */
    userId: string | null;
  };

  warnings: SimbriefWarning[];
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Thrown by parseSimbriefPlan when the body cannot become a plan at all. */
export declare class SimbriefParseError extends Error {
  readonly code: 'NOT_JSON' | 'NOT_AN_OFP' | 'NO_ROUTE' | 'BAD_POSITION';
}

export type SimbriefErrorCode =
  | 'UNKNOWN_USER'
  | 'NO_PLAN'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_STATUS'
  | 'BAD_BODY';

export declare class SimbriefFetchError extends Error {
  readonly code: SimbriefErrorCode;
  /** The sentence shown to the user verbatim. Never contains a stack or a URL. */
  readonly userMessage: string;
  /** SimBrief's own fetch.status string, when there was one. */
  readonly upstreamStatus?: string;
  /** The HTTP status, when a response was received. */
  readonly httpStatus?: number;
}

export declare function fetchLatestOfp(
  userId: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<unknown>;

export declare function parseSimbriefPlan(body: unknown): ParsedSimbriefPlan;

// ── Settings (server side: src/db.ts) ────────────────────────────────────────

export declare function getSetting(name: string): string | null;
export declare function setSetting(name: string, value: string | null): void;

// ── Wire shapes (client mirror: client/src/types.ts) ─────────────────────────

export interface SimbriefSettings {
  /** null when never set or cleared. */
  simbrief_user_id: string | null;
}

export interface SimbriefImportResponse {
  /** Exactly one leg, so the shape still matches the .lnmpln response's array. */
  imported: unknown[];
  result: {
    status: 'imported' | 'duplicate';
    planned_leg_id: number;
    /** "UHPP → UHSS (SHG037)" — what the user sees confirmed. */
    label: string;
    warnings: SimbriefWarning[];
    /** Present only on 'duplicate'. */
    error?: string;
  };
}

export interface SimbriefImportErrorBody {
  error: string;
  code: SimbriefErrorCode | 'NO_USER_ID' | 'NOT_FOUND' | 'INVALID_ID' | string;
}
