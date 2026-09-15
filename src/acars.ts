/**
 * ACARS message rules. This module is deliberately free of database, express
 * and I/O imports — it reads no clock, no environment and no file — so every
 * rule below can be unit-tested on its own: values in, values out. The
 * persistence half lives in src/db/acarsMessages.ts and the transport half in
 * src/routes/acars.ts; neither vocabulary is duplicated there.
 */

import type { AcarsDirection, CannedAcarsMessage, DispatchPayload, LoadsheetFigures } from './types';
import type { ParsedSimbriefPlan } from './simbrief';

/** The two directions the codebase knows. The column itself has no CHECK. */
export const ACARS_DIRECTIONS = ['uplink', 'downlink'] as const;

/**
 * The categories this codebase knows how to label and colour today. NOT a
 * closed set: the column accepts any well-shaped category, so a new kind of
 * message needs no migration and no change to the validator — only to this
 * list, and only if it wants a badge of its own.
 */
export const KNOWN_ACARS_CATEGORIES = [
  'pdc', 'wx', 'freetext', 'position-report', 'dispatch', 'oooi',
] as const;

/** The single direction a client is permitted to write. */
export const CLIENT_DIRECTION = 'downlink';

/**
 * Generous ceiling that still bounds the column: a METAR+TAF pair and a full
 * PDC are each well under it.
 */
export const MAX_ACARS_BODY_LENGTH = 4096;

/**
 * The fixed outgoing set, in render order. A client may send these and nothing
 * else: free text is not accepted, and everything stored comes from the entry
 * rather than from the request.
 *
 * All three are 'freetext', including WX REQUEST — the category records what a
 * message *is*, and this one is a typed-out phrase that triggers no lookup and
 * carries no ICAO, so filing it as 'wx' would put an entry in the weather
 * category that no reply will ever correlate to.
 */
export const CANNED_MESSAGES: readonly CannedAcarsMessage[] = [
  { id: 'wx-request',       label: 'WX REQUEST',       body: 'WX REQUEST',       category: 'freetext', direction: 'downlink' },
  { id: 'gate-request',     label: 'GATE REQUEST',     body: 'GATE REQUEST',     category: 'freetext', direction: 'downlink' },
  { id: 'request-pushback', label: 'REQUEST PUSHBACK', body: 'REQUEST PUSHBACK', category: 'freetext', direction: 'downlink' },
];

export type AcarsBodyResult =
  | { ok: true; body: string }
  | { ok: false; code: 'INVALID_BODY' | 'BODY_TOO_LONG'; error: string };

export function isAcarsDirection(v: unknown): v is AcarsDirection {
  return typeof v === 'string' && (ACARS_DIRECTIONS as readonly string[]).includes(v);
}

/**
 * Shape, not membership: lower-kebab, starting with a letter, at most 32
 * characters. That is what actually protects the column — the enumeration is
 * open (see KNOWN_ACARS_CATEGORIES) — and it is also what makes a category safe
 * to interpolate into a CSS class name.
 */
export function isValidAcarsCategory(v: unknown): boolean {
  return typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v);
}

/** Membership, for display decisions. A different question from validity. */
export function isKnownAcarsCategory(v: string): boolean {
  return (KNOWN_ACARS_CATEGORIES as readonly string[]).includes(v);
}

/** Exact, case-sensitive match on id: an id is a wire value, not user typing. */
export function findCannedMessage(id: unknown): CannedAcarsMessage | null {
  if (typeof id !== 'string' || id === '') return null;
  return CANNED_MESSAGES.find(m => m.id === id) ?? null;
}

/**
 * Trims, collapses every run of whitespace (newlines and tabs included) to one
 * space, and uppercases. Applied only to a client-submitted body before it is
 * matched against the canned set — never to a stored body, which keeps its
 * newlines and its case exactly.
 */
export function normaliseCannedBody(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** The entry whose body normalises to the same text, or null. */
export function findCannedMessageByBody(body: unknown): CannedAcarsMessage | null {
  if (typeof body !== 'string') return null;
  const normalised = normaliseCannedBody(body);
  if (normalised === '') return null;
  return CANNED_MESSAGES.find(m => normaliseCannedBody(m.body) === normalised) ?? null;
}

/**
 * The guard for any writer of a message body, including the server-side ones.
 * The length is measured before trimming, so padding cannot smuggle a body past
 * the ceiling; the stored value is the trimmed string, with its interior
 * newlines intact.
 */
export function validateAcarsBody(raw: unknown): AcarsBodyResult {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'INVALID_BODY', error: 'Message body must be text' };
  }
  if (raw.length > MAX_ACARS_BODY_LENGTH) {
    return { ok: false, code: 'BODY_TOO_LONG', error: `Message body is too long (max ${MAX_ACARS_BODY_LENGTH} characters)` };
  }
  const body = raw.trim();
  if (body === '') {
    return { ok: false, code: 'INVALID_BODY', error: 'Message body must not be empty' };
  }
  return { ok: true, body };
}

/** 'wx-request, gate-request, request-pushback' — the tail of the error text. */
export function cannedMessageIdList(): string {
  return CANNED_MESSAGES.map(m => m.id).join(', ');
}

// ── Dispatch release + load sheet ───────────────────────────────────────────
//
// Server-generated messages: a SimBrief import files a dispatch release, and a
// pilot action files a load-sheet request/reply pair, both keyed to a planned
// leg rather than a flight (a planned leg exists before pushback, when there is
// no flights row yet). Every function below is pure — no clock, no database —
// so the emitter (src/routes/plannedLegs.ts, src/routes/acars.ts) and the
// reader cannot disagree about a dedup key or a body's wording.

export const DISPATCH_RELEASE_LABEL = 'DISPATCH RELEASE';
export const LOADSHEET_REQUEST_LABEL = 'REQUEST LOADSHEET';
export const LOADSHEET_LABEL = 'LOADSHEET';
/** The one definition of the rejection phrase a missing dispatch record answers with. */
export const NO_DISPATCH_DATA_MESSAGE = 'NO DISPATCH DATA ON FILE';
/** Ceiling on the filed route inside a message body, so no body can exceed MAX_ACARS_BODY_LENGTH. */
export const MAX_ROUTE_BODY_CHARS = 900;

/** Keyed on the planned leg, not the OFP: a re-imported OFP is a new leg and gets its own release. */
export function dispatchDedupKey(legId: number): string {
  return `dispatch:leg:${legId}`;
}
export function loadsheetRequestDedupKey(legId: number): string {
  return `loadsheet-req:leg:${legId}`;
}
export function loadsheetReplyDedupKey(legId: number): string {
  return `loadsheet:leg:${legId}`;
}

// ── Shared formatters ────────────────────────────────────────────────────────
// Used by both the dispatch-release body and the load-sheet bodies, so the two
// messages cannot disagree about how a number looks.

/** null, non-finite or negative -> '----'. Otherwise HHMM, seconds discarded (never rounded up). */
export function hhmm(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '----';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

/** null -> 'UNKNOWN'. >= 18000 ft -> flight level, e.g. 'FL280'. Otherwise '8000FT'. */
export function levelText(ft: number | null): string {
  if (ft === null) return 'UNKNOWN';
  const r = Math.round(ft);
  return r >= 18000 ? `FL${String(Math.round(r / 100)).padStart(3, '0')}` : `${r}FT`;
}

/** null -> '----'. Otherwise the rounded value, no thousands separator, no unit suffix. */
export function qty(v: number | null): string {
  return v === null ? '----' : String(Math.round(v));
}

/** 'kgs'/'kg' -> 'KG'; 'lbs'/'lb' -> 'LB'; anything else including null -> 'UNITS UNKNOWN'. */
export function unitText(units: string | null): string {
  const u = (units ?? '').toLowerCase();
  return u === 'kgs' || u === 'kg' ? 'KG' : u === 'lbs' || u === 'lb' ? 'LB' : 'UNITS UNKNOWN';
}

/** null -> 'NIL'. At or under the cap, verbatim. Otherwise truncated with a trailing '...'. */
export function clampRoute(route: string | null): string {
  if (route === null) return 'NIL';
  return route.length <= MAX_ROUTE_BODY_CHARS ? route : `${route.slice(0, MAX_ROUTE_BODY_CHARS - 3)}...`;
}

/** label.padEnd(14) + value.padStart(6) — the fixed-field grid the load sheet's body is built from. */
export function field(label: string, value: string): string {
  return `${label.padEnd(14, ' ')}${value.padStart(6, ' ')}`;
}

/** Field copy, no arithmetic, no unit conversion — the parser's numbers, unmodified. */
export function buildDispatchPayload(plan: ParsedSimbriefPlan): DispatchPayload {
  const d = plan.dispatch;
  return {
    v: 1,
    source: 'simbrief',
    ofp: {
      request_id: plan.ofp.requestId,
      sequence_id: plan.ofp.sequenceId,
      time_generated: plan.ofp.timeGenerated,
    },
    flight_number: plan.ofp.flightNumber,
    aircraft_type: plan.aircraftType,
    aircraft_reg: d.aircraftReg,
    origin: plan.departure.ident,
    destination: plan.destination.ident,
    alternates: plan.alternates.map((a) => a.ident),
    route: plan.ofp.routeString,
    cruise_alt_ft: plan.cruiseAltFt,
    units: d.units,
    ete_sec: d.estTimeEnrouteSec,
    block_time_sec: d.estBlockSec,
    fuel: {
      ramp: d.planRamp,
      takeoff: d.planTakeoff,
      landing: d.planLanding,
      taxi: d.taxi,
      enroute_burn: d.enrouteBurn,
      contingency: d.contingency,
      reserve: d.reserve,
      alternate_burn: d.alternateBurn,
    },
    weights: {
      oew: d.oew,
      payload: d.payload,
      est_zfw: d.estZfw,
      max_zfw: d.maxZfw,
      est_tow: d.estTow,
      est_ldw: d.estLdw,
      pax_count: d.paxCount,
      cargo: d.cargo,
    },
  };
}

/**
 * Total: never throws. `null` is "no usable dispatch data on file" — an absent
 * or unparseable blob, or one written by a schema version this build does not
 * know. A string is written by us, in one place; a scalar that arrives as a
 * string here means the stored data is not what we wrote, so it is dropped
 * rather than coerced.
 */
export function parseDispatchPayload(raw: string | null): DispatchPayload | null {
  if (raw === null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  if (p['v'] !== 1 || p['source'] !== 'simbrief') return null;

  const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {});
  const ofp = rec(p['ofp']);
  const fuel = rec(p['fuel']);
  const weights = rec(p['weights']);
  const alternatesRaw = p['alternates'];

  return {
    v: 1,
    source: 'simbrief',
    ofp: {
      request_id: strOrNull(ofp['request_id']),
      sequence_id: strOrNull(ofp['sequence_id']),
      time_generated: strOrNull(ofp['time_generated']),
    },
    flight_number: strOrNull(p['flight_number']),
    aircraft_type: strOrNull(p['aircraft_type']),
    aircraft_reg: strOrNull(p['aircraft_reg']),
    origin: strOrNull(p['origin']),
    destination: strOrNull(p['destination']),
    alternates: Array.isArray(alternatesRaw) ? alternatesRaw.filter((s): s is string => typeof s === 'string') : [],
    route: strOrNull(p['route']),
    cruise_alt_ft: numOrNull(p['cruise_alt_ft']),
    units: strOrNull(p['units']),
    ete_sec: numOrNull(p['ete_sec']),
    block_time_sec: numOrNull(p['block_time_sec']),
    fuel: {
      ramp: numOrNull(fuel['ramp']),
      takeoff: numOrNull(fuel['takeoff']),
      landing: numOrNull(fuel['landing']),
      taxi: numOrNull(fuel['taxi']),
      enroute_burn: numOrNull(fuel['enroute_burn']),
      contingency: numOrNull(fuel['contingency']),
      reserve: numOrNull(fuel['reserve']),
      alternate_burn: numOrNull(fuel['alternate_burn']),
    },
    weights: {
      oew: numOrNull(weights['oew']),
      payload: numOrNull(weights['payload']),
      est_zfw: numOrNull(weights['est_zfw']),
      max_zfw: numOrNull(weights['max_zfw']),
      est_tow: numOrNull(weights['est_tow']),
      est_ldw: numOrNull(weights['est_ldw']),
      pax_count: numOrNull(weights['pax_count']),
      cargo: numOrNull(weights['cargo']),
    },
  };
}

/** The dispatch-release body: route, cruise altitude, planned fuel, alternates, ETE. */
export function buildDispatchReleaseBody(p: DispatchPayload, issuedAt: string): string {
  const lines = [
    'DISPATCH RELEASE',
    `FLT ${p.flight_number ?? 'UNKNOWN'}`,
    `${p.origin ?? '????'} ${p.destination ?? '????'} ALTN ${p.alternates.length ? p.alternates.join(' ') : 'NONE'}`,
    `ACFT ${p.aircraft_type ?? 'UNKNOWN'} ${p.aircraft_reg ?? 'NOREG'}`,
    `CRZ ${levelText(p.cruise_alt_ft)}`,
    `ETE ${hhmm(p.ete_sec)}`,
    `FUEL ${unitText(p.units)} BLOCK ${qty(p.fuel.ramp)} TRIP ${qty(p.fuel.enroute_burn)} RESV ${qty(p.fuel.reserve)} ALTN ${qty(p.fuel.alternate_burn)} CONT ${qty(p.fuel.contingency)} TAXI ${qty(p.fuel.taxi)}`,
    `RTE ${clampRoute(p.route)}`,
    `OFP ${p.ofp.request_id ?? 'UNKNOWN'} ISSUED ${issuedAt}`,
    'SIMULATED DISPATCH RELEASE - NOT FOR REAL WORLD USE',
  ];
  return lines.join('\n');
}

/**
 * Derives block fuel, payload and zero-fuel weight from the dispatch payload.
 * Payload is resolved before ZFW, and ZFW's fallback consumes the
 * already-resolved payload, so the two fallbacks can never both fire on the
 * same plan.
 */
export function buildLoadsheetFigures(p: DispatchPayload): LoadsheetFigures {
  const f = p.fuel;
  const w = p.weights;

  const blockFuel = f.ramp !== null ? f.ramp
    : f.takeoff !== null && f.taxi !== null ? f.takeoff + f.taxi
      : null;

  const payload = w.payload !== null ? w.payload
    : w.est_zfw !== null && w.oew !== null ? w.est_zfw - w.oew
      : null;
  const payloadSource: LoadsheetFigures['payload_source'] =
    w.payload !== null ? 'simbrief' : payload !== null ? 'derived' : 'unavailable';

  const zfw = w.est_zfw !== null ? w.est_zfw
    : w.oew !== null && payload !== null ? w.oew + payload
      : null;
  const zfwSource: LoadsheetFigures['zfw_source'] =
    w.est_zfw !== null ? 'simbrief' : zfw !== null ? 'derived' : 'unavailable';

  return {
    units: p.units,
    block_fuel: blockFuel,
    taxi_fuel: f.taxi,
    takeoff_fuel: f.takeoff,
    trip_fuel: f.enroute_burn,
    payload,
    payload_source: payloadSource,
    zero_fuel_weight: zfw,
    zfw_source: zfwSource,
    max_zero_fuel_weight: w.max_zfw,
    dry_operating_weight: w.oew,
    takeoff_weight: w.est_tow,
    landing_weight: w.est_ldw,
    pax_count: w.pax_count,
    cargo: w.cargo,
    estimated: true,
  };
}

/** The pilot's load-sheet request: two lines, no figures — the figures arrive in the reply. */
export function buildLoadsheetRequestBody(p: DispatchPayload): string {
  const fltClause = p.flight_number ? ` FLT ${p.flight_number}` : '';
  return `REQUEST LOADSHEET\n${p.origin ?? '????'} ${p.destination ?? '????'}${fltClause}`;
}

/** The generated load-sheet reply: fixed-field figures, in `field()`'s aligned grid. */
export function buildLoadsheetReplyBody(p: DispatchPayload, sheet: LoadsheetFigures, issuedAt: string): string {
  const zfwLine = sheet.max_zero_fuel_weight === null
    ? field('ZERO FUEL WT', qty(sheet.zero_fuel_weight))
    : `${field('ZERO FUEL WT', qty(sheet.zero_fuel_weight))} MAX ${qty(sheet.max_zero_fuel_weight)}`;

  const lines = [
    'LOADSHEET',
    `FLT ${p.flight_number ?? 'UNKNOWN'} ${p.origin ?? '????'} ${p.destination ?? '????'}`,
    `ACFT ${p.aircraft_type ?? 'UNKNOWN'} ${p.aircraft_reg ?? 'NOREG'}`,
    `UNITS ${unitText(sheet.units)}`,
    field('BLOCK FUEL', qty(sheet.block_fuel)),
    field('TAXI FUEL', qty(sheet.taxi_fuel)),
    field('TAKEOFF FUEL', qty(sheet.takeoff_fuel)),
    field('TRIP FUEL', qty(sheet.trip_fuel)),
    field('PAX', qty(sheet.pax_count)),
    field('CARGO', qty(sheet.cargo)),
    field('PAYLOAD', qty(sheet.payload)),
    field('DRY OPER WT', qty(sheet.dry_operating_weight)),
    zfwLine,
    field('TAKEOFF WT', qty(sheet.takeoff_weight)),
    field('LANDING WT', qty(sheet.landing_weight)),
    `ISSUED ${issuedAt}`,
    'ESTIMATED FIGURES - SIMULATION ONLY - NOT FOR ACTUAL LOADING',
  ];
  return lines.join('\n');
}

// ── Weather request ──────────────────────────────────────────────────────────
//
// A crew-initiated request/reply pair, filed fresh on every call (no dedup
// key, unlike the dispatch/loadsheet messages above): a WX request answers a
// question about "right now," so repeating it is meaningful, not a duplicate.

export const WX_UNAVAILABLE_LABEL = 'WX UNAVAILABLE';

/** Trim, then uppercase. The one normalisation applied before validation,
 *  caching (weatherClient's cache key), and storage (the request/reply body
 *  and label both interpolate this normalised form, never the raw input). */
export function normaliseIcao(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Shape check for a four-character alphanumeric ICAO. Applied to an
 *  ALREADY-normalised string — call normaliseIcao() first. */
export function isValidIcaoShape(v: string): boolean {
  return /^[A-Z0-9]{4}$/.test(v);
}

/** 'WX REQUEST EGLL' — both the request row's label and its body, verbatim. */
export function wxRequestLabelAndBody(icao: string): string {
  return `WX REQUEST ${icao}`;
}

/** 'METAR EGLL' — the reply row's label when weather was found, regardless of
 *  whether a TAF was also found. */
export function wxReplyLabel(icao: string): string {
  return `METAR ${icao}`;
}

/** metar, or metar + '\n' + taf when a TAF was found. Never adds a TAF header
 *  line: the raw METAR and TAF text are each already self-identifying
 *  ("METAR KJFK...", "TAF KJFK..."). */
export function buildWxReplyBody(metar: string, taf: string | null): string {
  return taf !== null ? `${metar}\n${taf}` : metar;
}

/** 'WX DATA UNAVAILABLE FOR ZZZZ' — the one definition of this literal string. */
export function buildWxUnavailableBody(icao: string): string {
  return `WX DATA UNAVAILABLE FOR ${icao}`;
}
