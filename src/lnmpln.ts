// ── Little Navmap .lnmpln parser ──────────────────────────────────────────────
//
// One file in, one ParsedFlightPlan out, or a thrown LnmplnParseError. Never a
// partially-populated object and never a stack trace to the user: the REST layer
// maps `err instanceof LnmplnParseError` to 400 and anything else to 500, which
// is why rejection is a typed error and not a null return.
//
// This module is deliberately free of ./db, ./types and fs. It takes a string or
// a Buffer and returns a value, so the CLI inspector and the import route can
// both drive it and neither needs a database.
//
// The single most important rule in here is that the official XSD is a guide and
// not an authority on completeness: Little Navmap demonstrably writes elements
// its own published schema never declares (<CustomOffsetAngle> is in a real file
// and in no version of the schema). So everything is read by tag name, nothing
// is validated against the schema, and an element we do not recognise produces an
// UNKNOWN_ELEMENT *warning* — never a rejection.

import { XMLParser } from 'fast-xml-parser';
import { haversineNm } from './geo';

// ── Public types ──────────────────────────────────────────────────────────────

/** The XSD's SimpleWaypointType. Unrecognised values pass through as a raw string. */
export type LnmplnWaypointType = 'AIRPORT' | 'UNKNOWN' | 'WAYPOINT' | 'VOR' | 'NDB' | 'USER';

/** Reasons the parser refuses a file outright. Thrown, never returned. */
export type LnmplnRejectCode =
  | 'EMPTY_FILE'
  | 'NOT_XML'
  | 'NO_FLIGHTPLAN'
  | 'TOO_FEW_WAYPOINTS'
  | 'MISSING_IDENT'
  | 'MISSING_POSITION'
  | 'BAD_COORDINATE';

/** Reasons the parser accepts a file but wants the outcome recorded. */
export type LnmplnWarningCode =
  | 'BOM_STRIPPED'
  | 'DESCRIPTION_INSTEAD_OF_COMMENT'
  | 'COMMENT_AND_DESCRIPTION_BOTH_PRESENT'
  | 'MULTIPLE_WAYPOINT_BLOCKS'
  | 'PROCEDURES_PRESENT_WAYPOINTS_ABSENT'
  | 'SNIPPET_DEPARTURE_NOT_AIRPORT'
  | 'SNIPPET_DESTINATION_NOT_AIRPORT'
  | 'IDENT_NOT_ICAO_SHAPED'
  | 'WAYPOINT_ALT_INVALID'
  | 'ALTERNATE_POSITION_MISSING'
  | 'CRUISE_ALT_F_MISSING'
  | 'CRUISE_ALT_MISSING'
  | 'CREATION_DATE_NO_OFFSET'
  | 'CREATION_DATE_UNPARSEABLE'
  | 'UNKNOWN_WAYPOINT_TYPE'
  /**
   * An element the parser did not recognise. NOT an error — see the header
   * comment. The message names up to ten unconsumed paths, which is how a field
   * that turns out to matter becomes visible on the first import of a file that
   * carries it, rather than years later.
   */
  | 'UNKNOWN_ELEMENT';

export interface LnmplnWarning {
  code: LnmplnWarningCode;
  /** One line, naming the element and the value. Surfaced per file on import. */
  message: string;
}

/** Thrown by parseLnmpln. The REST layer maps this to 400 and anything else to 500. */
export class LnmplnParseError extends Error {
  readonly code: LnmplnRejectCode;

  constructor(code: LnmplnRejectCode, message: string) {
    super(message);
    this.name = 'LnmplnParseError';
    this.code = code;
  }
}

export interface ParsedPos {
  lat: number;
  lon: number;
  /** Pos/@Alt is optional in the format. */
  altFt: number | null;
}

export interface ParsedWaypoint {
  /**
   * 1-based document order across every <Waypoints> block. A waypoint is
   * identified by (leg, seq) and NEVER by ident: real files number their user
   * waypoints WP1/WP2/WP3 in every leg.
   */
  seq: number;
  ident: string;
  name: string | null;
  region: string | null;
  airway: string | null;
  track: string | null;
  /** Only 'AIRPORT' is behaviourally significant; anything else is display-only. */
  type: LnmplnWaypointType | string;
  /** <Comment> or <Description>, whichever the file used. */
  comment: string | null;
  lat: number;
  lon: number;
  /**
   * Little Navmap's COMPUTED profile altitude, not a planned constraint. Never
   * render it as a crossing restriction; cruiseAltFt is the leg's planned
   * altitude.
   */
  altFt: number | null;
}

export interface ParsedAlternate {
  seq: number;
  ident: string;
  name: string | null;
  type: string | null;
  /** Nullable: <Alternate><Pos> is optional, unlike <Waypoint><Pos>. */
  lat: number | null;
  lon: number | null;
  altFt: number | null;
}

/**
 * First / last waypoint of the plan. `isAirport` gates every ICAO claim: when it
 * is false the ident is shown as-is and never presented as an airport code.
 */
export interface ParsedEndpoint {
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  isAirport: boolean;
}

/**
 * The <Departure> element: where the plan starts on the field. Absent from four
 * of four real files, so nothing may depend on it — not the matcher, not the
 * map, not the leg row.
 */
export interface ParsedDeparture {
  pos: ParsedPos | null;
  /** e.g. "PARKING 1", "RUNWAY 25R" */
  start: string | null;
  /** None | Airport | Runway | Parking | Helipad */
  startType: string | null;
  /** True heading. Parsed but not persisted. */
  headingTrueDeg: number | null;
}

/**
 * A flat projection of <Procedures>. Eighteen fields: a real custom approach is
 * characterised entirely by Type plus the Custom* values, and dropping any of
 * them loses the approach. Procedure LEGS are never modelled — the file never
 * contains them.
 */
export interface ParsedProcedures {
  sidName: string | null;
  /** The only place a departure runway appears: no real file has a <Departure>. */
  sidRunway: string | null;
  sidTransition: string | null;
  /** 'CUSTOMDEPART' for the manual's custom-departure form; the XSD omits it. */
  sidType: string | null;
  sidCustomDistanceNm: number | null;

  starName: string | null;
  starRunway: string | null;
  starTransition: string | null;

  /**
   * Opaque label. With approachType 'CUSTOM' it is a synthesized ICAO+runway
   * ("KLAX24R") and is NOT a fix reference — never resolve or join on it.
   */
  approachName: string | null;
  approachRunway: string | null;
  approachTransition: string | null;
  approachType: string | null;
  approachArinc: string | null;
  approachSuffix: string | null;
  approachTransitionType: string | null;
  approachCustomDistanceNm: number | null;
  approachCustomAltitudeFt: number | null;
  /** Written by real Little Navmap; absent from the official XSD entirely. */
  approachCustomOffsetDeg: number | null;
}

/**
 * The parser's complete output. One file in, one of these out — or a thrown
 * LnmplnParseError. Never a partially populated object.
 */
export interface ParsedFlightPlan {
  departure: ParsedEndpoint;
  destination: ParsedEndpoint;
  /** true when either endpoint is not an AIRPORT: a plan snippet. */
  isSnippet: boolean;

  /** CruisingAltF preferred over CruisingAlt, never the reverse. */
  cruiseAltFt: number | null;
  /** Header/FlightplanType, e.g. "IFR" | "VFR". */
  flightplanType: string | null;
  /** AircraftPerformance/Type, e.g. "BE51". Display-only; not a match criterion. */
  aircraftType: string | null;
  /** Header <Comment> or <Description>. */
  remarks: string | null;
  /** Header/CreationDate normalised to a full ISO instant. */
  createdAt: string | null;
  /** "<ProgramName> <ProgramVersion>", kept for provenance since the file is not. */
  sourceProgram: string | null;

  /**
   * <SimData> and <NavData Cycle="…">, verbatim. Provenance only, and read per
   * file precisely so that nothing caches or assumes them: cycles genuinely
   * differ between legs of one logbook (2609 in the real IFR plan, 1801 in the
   * VFR trio). Nothing may compare them across legs.
   *
   * Beyond the fields frozen in contracts/planned-legs.d.ts, and additive: they
   * are not persisted by any database column. They exist because the cycle
   * must be read per file, and because
   * silently not reading <SimData>/<NavData> would make every real file emit a
   * spurious UNKNOWN_ELEMENT warning.
   */
  simData: string | null;
  navDataSource: string | null;
  navDataCycle: string | null;

  departureStart: ParsedDeparture;
  procedures: ParsedProcedures;

  /** Every <Waypoint> from every <Waypoints> block, in document order. */
  waypoints: ParsedWaypoint[];
  /** Every <Alternate> from every <Alternates> block, in document order. */
  alternates: ParsedAlternate[];

  /**
   * Great-circle sum over the en-route waypoint chain, in nautical miles.
   * SID/STAR/approach legs are never in the file, so this is always short of the
   * real routing — and the shortfall is not a bounded correction. The real
   * KSFO→KLAX plan stores 293.5 nm against a 293.2 nm direct great circle: the
   * stored "route" is the straight line, because all of its shape lives in
   * WESLA5.SUSEY and IRNMN2.BURGL. No correction factor may be applied.
   */
  approxDistanceNm: number;
  /**
   * A literal type, not a boolean: no code path can set this to false, and no
   * view may render approxDistanceNm without an "approx." qualifier.
   */
  distanceIsApproximate: true;

  /** Everything the parser tolerated. Surfaced per file in the import response. */
  warnings: LnmplnWarning[];
}

// ── Parser configuration (frozen) ─────────────────────────────────────────────
//
// Do not set preserveOrder: it returns a positional shape, which is the very
// thing "parse by tag name, never by position" exists to avoid.
//
// parseTagValue and parseAttributeValue are OFF and mandatory: the format is full
// of numeric-looking STRINGS — an <Ident> of 1000, a <Region> of 07, a <Runway>
// of 09, a <Transition> of 05. A coerced ident silently loses leading zeros and
// stops comparing equal to the airport ident. Every numeric field below is
// therefore converted explicitly through toNumber(), which rejects NaN, Infinity
// and the empty string.
//
// XMLValidator is never run: the manual's own annotated example carries an
// unbalanced/nested comment block a strict validator would reject. Parse
// leniently, then validate the semantic shape ourselves.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // fast-xml-parser 5 types the second argument as string | MatcherView; with the
  // default jPath option it is the dotted string at runtime, so it is stringified
  // here rather than the option being changed. The four jpaths are frozen.
  isArray: (_name: string, jpath: string | { toString(): string }) =>
    [
      'LittleNavmap.Flightplan.Waypoints',
      'LittleNavmap.Flightplan.Waypoints.Waypoint',
      'LittleNavmap.Flightplan.Alternates',
      'LittleNavmap.Flightplan.Alternates.Alternate',
    ].includes(String(jpath)),
});

// ── Known element names ───────────────────────────────────────────────────────
//
// "Known" means recognised, not necessarily stored: FileVersion and Documentation
// are listed and deliberately unread, because this parser must never branch on,
// warn about or reject a file for its FileVersion. Anything NOT on these lists
// produces an UNKNOWN_ELEMENT warning — the mechanism that would have caught
// <CustomOffsetAngle> the day the first IFR plan arrived. Adding a name here is
// how a newly-understood element stops being reported.
//
// The rule this file holds to is total, not a list of interesting places: EVERY
// element the parser opens as a container — meaning every element it reads named
// children or attributes from — is scanned against its known set. A container
// that holds three known children and silently drops a fourth is exactly where a
// future Little Navmap will add a fourth procedure type or a missed-approach
// block, so <Procedures> and the <Waypoints>/<Alternates> blocks are scanned even
// though each has only one shape today, and <Pos>, <SimData> and <NavData> are
// scanned even though they carry their payload in attributes.
//
// The boundary: elements read as TEXT (<Ident>, <CruisingAlt>, <Name>, …) are not
// scanned. If one of those ever grows children it stops being a string and its
// value reads back as null, which is visible in the parse result — a different
// failure mode from silent disappearance, and not one this mechanism owns.

const KNOWN_LITTLENAVMAP = new Set(['Flightplan']);
const KNOWN_FLIGHTPLAN = new Set([
  'Header', 'SimData', 'NavData', 'AircraftPerformance', 'Departure',
  'Procedures', 'Alternates', 'Waypoints',
]);
const KNOWN_HEADER = new Set([
  'FlightplanType', 'CruisingAlt', 'CruisingAltF', 'Comment', 'Description',
  'CreationDate', 'FileVersion', 'ProgramName', 'ProgramVersion', 'Documentation',
]);
const KNOWN_AIRCRAFT_PERFORMANCE = new Set(['FilePath', 'Type', 'Name']);
const KNOWN_DEPARTURE = new Set(['Pos', 'Start', 'Type', 'Heading']);
const KNOWN_PROCEDURES = new Set(['SID', 'STAR', 'Approach']);
// SID carries the manual's Type=CUSTOMDEPART + CustomDistance form, which the
// XSD does not declare at all.
const KNOWN_SID = new Set(['Name', 'Runway', 'Transition', 'Type', 'CustomDistance']);
const KNOWN_STAR = new Set(['Name', 'Runway', 'Transition']);
const KNOWN_APPROACH = new Set([
  'Name', 'ARINC', 'Runway', 'Type', 'Suffix', 'Transition', 'TransitionType',
  'CustomDistance', 'CustomAltitude', 'CustomOffsetAngle',
]);
const KNOWN_WAYPOINTS_BLOCK = new Set(['Waypoint']);
const KNOWN_WAYPOINT = new Set([
  'Name', 'Ident', 'Region', 'Airway', 'Track', 'Type', 'Comment', 'Description', 'Pos',
]);
const KNOWN_ALTERNATES_BLOCK = new Set(['Alternate']);
const KNOWN_ALTERNATE = new Set(['Name', 'Ident', 'Type', 'Pos']);
/** <Pos>, <SimData> and <NavData> carry everything in attributes or text; any
 *  child element inside one is by definition something new. */
const KNOWN_NO_CHILDREN = new Set<string>();

const WAYPOINT_TYPES = new Set<string>(['AIRPORT', 'UNKNOWN', 'WAYPOINT', 'VOR', 'NDB', 'USER']);
const ICAO_SHAPE = /^[A-Z0-9]{3,4}$/;
const MAX_UNKNOWN_PATHS = 10;

// ── Small helpers ─────────────────────────────────────────────────────────────

type XmlNode = Record<string, unknown>;

function isRecord(v: unknown): v is XmlNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The frozen isArray list covers only four jpaths; everything else may arrive
 *  as an object or, if a file repeats it, as an array. Always take the first. */
function firstNode(v: unknown): XmlNode | undefined {
  const node = Array.isArray(v) ? v[0] : v;
  return isRecord(node) ? node : undefined;
}

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Text content of an element, trimmed; empty string counts as absent. */
function toText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.length > 0 ? toText(v[0]) : null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isRecord(v)) return toText(v['#text']);
  return null;
}

/**
 * The one numeric conversion in the module. parseTagValue is off, so every
 * number arrives as a string and passes through here; NaN, Infinity and the
 * empty string all become null rather than a silently wrong value. (trap 13)
 */
function toNumber(v: unknown): number | null {
  const t = toText(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function has(node: XmlNode | undefined, key: string): boolean {
  return node !== undefined && Object.prototype.hasOwnProperty.call(node, key);
}

// ── Warning collection ────────────────────────────────────────────────────────

class Warnings {
  private readonly list: LnmplnWarning[] = [];

  add(code: LnmplnWarningCode, message: string): void {
    this.list.push({ code, message });
  }

  all(): LnmplnWarning[] {
    return this.list;
  }
}

/**
 * <Comment> vs <Description>: the XSD declares the first, the manual's own
 * annotated example writes the second. Accept either, prefer Comment, and say so
 * when the file used the other spelling or both. (trap 2)
 */
function readRemark(node: XmlNode | undefined, where: string, warn: Warnings): string | null {
  if (node === undefined) return null;
  const comment = toText(node['Comment']);
  const description = toText(node['Description']);
  if (comment !== null && description !== null && comment !== description) {
    warn.add(
      'COMMENT_AND_DESCRIPTION_BOTH_PRESENT',
      `${where}: both <Comment> and <Description> present and different; using <Comment> ("${comment}")`,
    );
    return comment;
  }
  if (comment !== null) return comment;
  if (description !== null) {
    warn.add(
      'DESCRIPTION_INSTEAD_OF_COMMENT',
      `${where}: remark written as <Description> rather than <Comment> ("${description}")`,
    );
    return description;
  }
  return null;
}

/**
 * Collects child element names this parser does not recognise. Attributes (@_),
 * the #text pseudo-key and the root's xsi attributes are excluded; the caller
 * caps the collection at ten paths so a wildly unexpected file cannot produce an
 * unbounded message.
 */
function scanUnknown(node: XmlNode | undefined, known: Set<string>, path: string, out: string[]): void {
  if (node === undefined) return;
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    if (known.has(key)) continue;
    const p = `${path}/${key}`;
    if (!out.includes(p)) out.push(p);
  }
}

/**
 * CreationDate carries a timezone offset in forms new Date() handles
 * inconsistently — "+02" in the manual's example, a full "-03:00" in every real
 * file. Normalise to something Date parses the same way everywhere, and only ever
 * inspect the part after the "T" so the hyphens in the date half are never
 * mistaken for an offset. (trap 10)
 */
function normalizeCreationDate(raw: string): { normalized: string; hasOffset: boolean } {
  const tIdx = raw.indexOf('T');
  if (tIdx < 0) return { normalized: raw, hasOffset: false };
  const time = raw.slice(tIdx + 1);
  if (/[Zz]$/.test(time)) return { normalized: raw, hasOffset: true };
  if (/[+-]\d{2}:\d{2}$/.test(time)) return { normalized: raw, hasOffset: true };
  if (/[+-]\d{4}$/.test(time)) {
    return { normalized: raw.replace(/([+-])(\d{2})(\d{2})$/, '$1$2:$3'), hasOffset: true };
  }
  if (/[+-]\d{2}$/.test(time)) return { normalized: `${raw}:00`, hasOffset: true };
  return { normalized: raw, hasOffset: false };
}

// ── The parser ────────────────────────────────────────────────────────────────

/**
 * Parses one .lnmpln file.
 *
 * Accepts a Buffer (decoded as UTF-8) or a string; a leading BOM is stripped.
 *
 * @throws {LnmplnParseError} on any of the LnmplnRejectCode conditions.
 */
export function parseLnmpln(input: string | Buffer, sourceFilename?: string): ParsedFlightPlan {
  const where = sourceFilename ? `${sourceFilename}: ` : '';

  // A function declaration rather than a const arrow: TypeScript only narrows on
  // a never-returning call when the callee is declared this way, and the narrowing
  // is what keeps every `reject(...)` below from needing a redundant `return`.
  function reject(code: LnmplnRejectCode, message: string): never {
    throw new LnmplnParseError(code, `${where}${message}`);
  }

  const warn = new Warnings();

  // ── Bytes to a string ───────────────────────────────────────────────────────
  let raw = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
    warn.add('BOM_STRIPPED', 'File began with a UTF-8 byte order mark; stripped before parsing');
  }
  if (raw.trim() === '') reject('EMPTY_FILE', 'file is empty');

  // ── XML to a tree ───────────────────────────────────────────────────────────
  let tree: unknown;
  try {
    tree = parser.parse(raw);
  } catch (err) {
    reject('NOT_XML', `not valid XML (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!isRecord(tree)) reject('NOT_XML', 'XML did not parse to an object root');

  const root = firstNode((tree as XmlNode)['LittleNavmap']);
  const fp = firstNode(root?.['Flightplan']);
  if (fp === undefined) reject('NO_FLIGHTPLAN', 'no <LittleNavmap><Flightplan> element');

  const header = firstNode(fp['Header']);
  const perf = firstNode(fp['AircraftPerformance']);
  const departureEl = firstNode(fp['Departure']);
  const procsEl = firstNode(fp['Procedures']);

  // ── Waypoints: every <Waypoint> of every <Waypoints> block, document order ──
  // maxOccurs="unbounded" on the block, so the blocks are concatenated in array
  // order, which fast-xml-parser preserves. seq runs 1..N over the concatenation.
  const blocks = asArray(fp['Waypoints']);
  if (blocks.length > 1) {
    warn.add(
      'MULTIPLE_WAYPOINT_BLOCKS',
      `${blocks.length} <Waypoints> blocks present; their waypoints are concatenated in document order`,
    );
  }
  const rawWaypoints: XmlNode[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    for (const w of asArray(block['Waypoint'])) {
      if (isRecord(w)) rawWaypoints.push(w);
    }
  }
  if (rawWaypoints.length < 2) {
    reject(
      'TOO_FEW_WAYPOINTS',
      `plan has ${rawWaypoints.length} <Waypoint> element(s); a plan needs at least a departure and a destination`,
    );
  }

  // Every container the parser opens, without exception — see the known-names
  // block above for why the coverage is total rather than a list of the
  // interesting ones. <Procedures> in particular: it holds three known children
  // today and is the likeliest place for a fourth to appear.
  const unknownPaths: string[] = [];
  scanUnknown(root, KNOWN_LITTLENAVMAP, 'LittleNavmap', unknownPaths);
  scanUnknown(fp, KNOWN_FLIGHTPLAN, 'Flightplan', unknownPaths);
  scanUnknown(header, KNOWN_HEADER, 'Header', unknownPaths);
  scanUnknown(firstNode(fp['SimData']), KNOWN_NO_CHILDREN, 'SimData', unknownPaths);
  scanUnknown(firstNode(fp['NavData']), KNOWN_NO_CHILDREN, 'NavData', unknownPaths);
  scanUnknown(perf, KNOWN_AIRCRAFT_PERFORMANCE, 'AircraftPerformance', unknownPaths);
  scanUnknown(departureEl, KNOWN_DEPARTURE, 'Departure', unknownPaths);
  scanUnknown(firstNode(departureEl?.['Pos']), KNOWN_NO_CHILDREN, 'Departure/Pos', unknownPaths);
  scanUnknown(procsEl, KNOWN_PROCEDURES, 'Procedures', unknownPaths);
  scanUnknown(firstNode(procsEl?.['SID']), KNOWN_SID, 'Procedures/SID', unknownPaths);
  scanUnknown(firstNode(procsEl?.['STAR']), KNOWN_STAR, 'Procedures/STAR', unknownPaths);
  scanUnknown(firstNode(procsEl?.['Approach']), KNOWN_APPROACH, 'Procedures/Approach', unknownPaths);
  blocks.forEach((block, i) =>
    scanUnknown(firstNode(block), KNOWN_WAYPOINTS_BLOCK, `Waypoints[${i + 1}]`, unknownPaths),
  );
  asArray(fp['Alternates']).forEach((block, i) =>
    scanUnknown(firstNode(block), KNOWN_ALTERNATES_BLOCK, `Alternates[${i + 1}]`, unknownPaths),
  );

  const waypoints: ParsedWaypoint[] = rawWaypoints.map((w, i) => {
    const seq = i + 1;
    const ident = toText(w['Ident']);
    if (ident === null) reject('MISSING_IDENT', `waypoint ${seq} has no <Ident>`);

    const pos = firstNode(w['Pos']);
    if (pos === undefined) reject('MISSING_POSITION', `waypoint ${seq} (${ident}) has no <Pos>`);
    if (!has(pos, '@_Lat') || !has(pos, '@_Lon')) {
      reject('MISSING_POSITION', `waypoint ${seq} (${ident}) has a <Pos> without Lat and Lon`);
    }
    const lat = toNumber(pos['@_Lat']);
    const lon = toNumber(pos['@_Lon']);
    if (lat === null || lon === null) {
      reject('BAD_COORDINATE', `waypoint ${seq} (${ident}) has a non-numeric Lat/Lon`);
    }
    if (lat < -90 || lat > 90) {
      reject('BAD_COORDINATE', `waypoint ${seq} (${ident}) has Lat=${lat}, outside ±90`);
    }
    if (lon < -180 || lon > 180) {
      reject('BAD_COORDINATE', `waypoint ${seq} (${ident}) has Lon=${lon}, outside ±180`);
    }

    let altFt: number | null = null;
    if (has(pos, '@_Alt')) {
      altFt = toNumber(pos['@_Alt']);
      if (altFt === null) {
        warn.add(
          'WAYPOINT_ALT_INVALID',
          `waypoint ${seq} (${ident}) has Alt="${String(pos['@_Alt'])}", which is not a finite number; stored as null`,
        );
      }
    }

    const rawType = toText(w['Type']);
    const type = rawType ?? 'UNKNOWN';
    if (rawType === null) {
      warn.add('UNKNOWN_WAYPOINT_TYPE', `waypoint ${seq} (${ident}) has no <Type>; treated as UNKNOWN`);
    } else if (!WAYPOINT_TYPES.has(rawType)) {
      warn.add(
        'UNKNOWN_WAYPOINT_TYPE',
        `waypoint ${seq} (${ident}) has <Type>${rawType}</Type>, outside the documented set; kept verbatim`,
      );
    }

    scanUnknown(w, KNOWN_WAYPOINT, `Waypoint[${seq}]`, unknownPaths);
    scanUnknown(pos, KNOWN_NO_CHILDREN, `Waypoint[${seq}]/Pos`, unknownPaths);

    return {
      seq,
      ident,
      name: toText(w['Name']),
      region: toText(w['Region']),
      airway: toText(w['Airway']),
      track: toText(w['Track']),
      type,
      comment: readRemark(w, `waypoint ${seq} (${ident})`, warn),
      lat,
      lon,
      altFt,
    };
  });

  // ── Alternates ──────────────────────────────────────────────────────────────
  const rawAlternates: XmlNode[] = [];
  for (const block of asArray(fp['Alternates'])) {
    if (!isRecord(block)) continue;
    for (const a of asArray(block['Alternate'])) {
      if (isRecord(a)) rawAlternates.push(a);
    }
  }

  const alternates: ParsedAlternate[] = rawAlternates.map((a, i) => {
    const seq = i + 1;
    const ident = toText(a['Ident']);
    if (ident === null) reject('MISSING_IDENT', `alternate ${seq} has no <Ident>`);

    const pos = firstNode(a['Pos']);
    let lat: number | null = null;
    let lon: number | null = null;
    let altFt: number | null = null;

    // Unlike a waypoint's, an alternate's <Pos> is optional. Absence is tolerated
    // with a warning; a Pos that is present but carries an unusable coordinate is
    // still a rejection, because that value would otherwise reach the database.
    if (pos === undefined || (!has(pos, '@_Lat') && !has(pos, '@_Lon'))) {
      warn.add(
        'ALTERNATE_POSITION_MISSING',
        `alternate ${seq} (${ident}) has no position; lat/lon stored as null`,
      );
    } else {
      lat = toNumber(pos['@_Lat']);
      lon = toNumber(pos['@_Lon']);
      if (lat === null || lon === null) {
        reject('BAD_COORDINATE', `alternate ${seq} (${ident}) has a non-numeric Lat/Lon`);
      }
      if (lat < -90 || lat > 90) {
        reject('BAD_COORDINATE', `alternate ${seq} (${ident}) has Lat=${lat}, outside ±90`);
      }
      if (lon < -180 || lon > 180) {
        reject('BAD_COORDINATE', `alternate ${seq} (${ident}) has Lon=${lon}, outside ±180`);
      }
      if (has(pos, '@_Alt')) {
        altFt = toNumber(pos['@_Alt']);
        if (altFt === null) {
          warn.add(
            'WAYPOINT_ALT_INVALID',
            `alternate ${seq} (${ident}) has Alt="${String(pos['@_Alt'])}", which is not a finite number; stored as null`,
          );
        }
      }
    }

    scanUnknown(a, KNOWN_ALTERNATE, `Alternate[${seq}]`, unknownPaths);
    scanUnknown(pos, KNOWN_NO_CHILDREN, `Alternate[${seq}]/Pos`, unknownPaths);

    return { seq, ident, name: toText(a['Name']), type: toText(a['Type']), lat, lon, altFt };
  });

  // ── Endpoints ───────────────────────────────────────────────────────────────
  // First waypoint is the departure and last is the destination, always — but an
  // ident is only ever presented as an ICAO code when the type says AIRPORT.
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  const departure: ParsedEndpoint = {
    ident: first.ident,
    name: first.name,
    lat: first.lat,
    lon: first.lon,
    isAirport: first.type === 'AIRPORT',
  };
  const destination: ParsedEndpoint = {
    ident: last.ident,
    name: last.name,
    lat: last.lat,
    lon: last.lon,
    isAirport: last.type === 'AIRPORT',
  };
  if (!departure.isAirport) {
    warn.add(
      'SNIPPET_DEPARTURE_NOT_AIRPORT',
      `first waypoint ${departure.ident} has type ${first.type}, not AIRPORT; this plan is a snippet`,
    );
  } else if (!ICAO_SHAPE.test(departure.ident)) {
    warn.add(
      'IDENT_NOT_ICAO_SHAPED',
      `departure ident "${departure.ident}" is an AIRPORT but not 3-4 of [A-Z0-9]`,
    );
  }
  if (!destination.isAirport) {
    warn.add(
      'SNIPPET_DESTINATION_NOT_AIRPORT',
      `last waypoint ${destination.ident} has type ${last.type}, not AIRPORT; this plan is a snippet`,
    );
  } else if (!ICAO_SHAPE.test(destination.ident)) {
    warn.add(
      'IDENT_NOT_ICAO_SHAPED',
      `destination ident "${destination.ident}" is an AIRPORT but not 3-4 of [A-Z0-9]`,
    );
  }
  const isSnippet = !(departure.isAirport && destination.isAirport);

  // ── Header values ───────────────────────────────────────────────────────────
  // CruisingAltF is the precise value and CruisingAlt the rounded one, so the
  // fallback only ever runs in that direction. Never a rejection: the XSD calls
  // both required, and real files are not guaranteed to be.
  let cruiseAltFt = toNumber(header?.['CruisingAltF']);
  if (cruiseAltFt === null) {
    cruiseAltFt = toNumber(header?.['CruisingAlt']);
    if (cruiseAltFt === null) {
      warn.add('CRUISE_ALT_MISSING', 'neither <CruisingAltF> nor <CruisingAlt> is usable; cruise altitude is null');
    } else {
      warn.add(
        'CRUISE_ALT_F_MISSING',
        `<CruisingAltF> absent; fell back to the rounded <CruisingAlt> (${cruiseAltFt} ft)`,
      );
    }
  }

  let createdAt: string | null = null;
  const rawCreated = toText(header?.['CreationDate']);
  if (rawCreated !== null) {
    const { normalized, hasOffset } = normalizeCreationDate(rawCreated);
    if (!hasOffset) {
      warn.add(
        'CREATION_DATE_NO_OFFSET',
        `<CreationDate>${rawCreated}</CreationDate> carries no UTC offset; interpreted in the server's timezone`,
      );
    }
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) {
      warn.add('CREATION_DATE_UNPARSEABLE', `<CreationDate>${rawCreated}</CreationDate> could not be parsed; stored as null`);
    } else {
      createdAt = d.toISOString();
    }
  }

  // Provenance only. FileVersion is deliberately not read and never branched on:
  // the real files say 1.2, the manual says 1.0, and a version check would have
  // rejected every genuine file this project has seen.
  const programName = toText(header?.['ProgramName']);
  const programVersion = toText(header?.['ProgramVersion']);
  const sourceProgram = [programName, programVersion].filter((s) => s !== null).join(' ') || null;

  const navData = fp['NavData'];
  const navDataNode = firstNode(navData);

  // ── Departure element ───────────────────────────────────────────────────────
  let departurePos: ParsedPos | null = null;
  const depPosEl = firstNode(departureEl?.['Pos']);
  if (depPosEl !== undefined && (has(depPosEl, '@_Lat') || has(depPosEl, '@_Lon'))) {
    const lat = toNumber(depPosEl['@_Lat']);
    const lon = toNumber(depPosEl['@_Lon']);
    if (lat === null || lon === null) reject('BAD_COORDINATE', '<Departure><Pos> has a non-numeric Lat/Lon');
    if (lat < -90 || lat > 90) reject('BAD_COORDINATE', `<Departure><Pos> has Lat=${lat}, outside ±90`);
    if (lon < -180 || lon > 180) reject('BAD_COORDINATE', `<Departure><Pos> has Lon=${lon}, outside ±180`);
    departurePos = { lat, lon, altFt: toNumber(depPosEl['@_Alt']) };
  }
  const departureStart: ParsedDeparture = {
    pos: departurePos,
    start: toText(departureEl?.['Start']),
    startType: toText(departureEl?.['Type']),
    headingTrueDeg: toNumber(departureEl?.['Heading']),
  };

  // ── Procedures ──────────────────────────────────────────────────────────────
  const sid = firstNode(procsEl?.['SID']);
  const star = firstNode(procsEl?.['STAR']);
  const approach = firstNode(procsEl?.['Approach']);
  const procedures: ParsedProcedures = {
    sidName: toText(sid?.['Name']),
    sidRunway: toText(sid?.['Runway']),
    sidTransition: toText(sid?.['Transition']),
    sidType: toText(sid?.['Type']),
    sidCustomDistanceNm: toNumber(sid?.['CustomDistance']),

    starName: toText(star?.['Name']),
    starRunway: toText(star?.['Runway']),
    starTransition: toText(star?.['Transition']),

    approachName: toText(approach?.['Name']),
    approachRunway: toText(approach?.['Runway']),
    approachTransition: toText(approach?.['Transition']),
    approachType: toText(approach?.['Type']),
    approachArinc: toText(approach?.['ARINC']),
    approachSuffix: toText(approach?.['Suffix']),
    approachTransitionType: toText(approach?.['TransitionType']),
    approachCustomDistanceNm: toNumber(approach?.['CustomDistance']),
    approachCustomAltitudeFt: toNumber(approach?.['CustomAltitude']),
    approachCustomOffsetDeg: toNumber(approach?.['CustomOffsetAngle']),
  };
  if (procsEl !== undefined) {
    // Name the actual procedures rather than describing the situation in the
    // abstract: "the ILS DUYET approach is missing" tells the reader which part
    // of their own flight the distance leaves out, which a generic sentence
    // about SID/STAR/approach legs does not.
    const named = [
      procedures.sidName ? `the ${procedures.sidName} departure` : null,
      procedures.starName ? `the ${procedures.starName} arrival` : null,
      // The type is worth naming when it is a real one (ILS, RNAV, VOR). CUSTOM
      // is Little Navmap's own marker for a synthesized runway extension, and
      // the name is then just ICAO+runway — printing "the CUSTOM
      // KLAX24R approach" would show the reader an implementation detail.
      procedures.approachName
        ? `the ${[procedures.approachType === 'CUSTOM' ? null : procedures.approachType, procedures.approachName]
            .filter(Boolean)
            .join(' ')} approach`
        : null,
    ].filter((s): s is string => s !== null);

    const list =
      named.length === 0 ? 'its procedures'
      : named.length === 1 ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;

    warn.add(
      'PROCEDURES_PRESENT_WAYPOINTS_ABSENT',
      `This plan flies ${list}, but Little Navmap saves procedures by name only — ` +
        'their waypoints are not in the file. The route distance below covers just ' +
        'the en-route portion, so the real flight is longer.',
    );
  }

  // ── Distance ────────────────────────────────────────────────────────────────
  let approxDistanceNm = 0;
  for (let i = 1; i < waypoints.length; i++) {
    approxDistanceNm += haversineNm(
      waypoints[i - 1].lat, waypoints[i - 1].lon,
      waypoints[i].lat, waypoints[i].lon,
    );
  }

  // Read before the return so the trap-2 warning it may raise is definitely in
  // the list the return statement reads.
  const remarks = readRemark(header, 'header', warn);

  if (unknownPaths.length > 0) {
    const shown = unknownPaths.slice(0, MAX_UNKNOWN_PATHS);
    const more = unknownPaths.length - shown.length;
    warn.add(
      'UNKNOWN_ELEMENT',
      `element(s) this parser does not recognise, skipped: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`,
    );
  }

  return {
    departure,
    destination,
    isSnippet,
    cruiseAltFt,
    flightplanType: toText(header?.['FlightplanType']),
    aircraftType: toText(perf?.['Type']),
    remarks,
    createdAt,
    sourceProgram,
    simData: toText(fp['SimData']),
    navDataSource: toText(navData),
    navDataCycle: navDataNode ? toText(navDataNode['@_Cycle']) : null,
    departureStart,
    procedures,
    waypoints,
    alternates,
    approxDistanceNm,
    distanceIsApproximate: true,
    warnings: warn.all(),
  };
}

// ── Batch ordering ────────────────────────────────────────────────────────────

/**
 * Why a batch was or was not chain-sorted. Batch-level, and deliberately a
 * SEPARATE enum from LnmplnWarningCode: those are per-file parser warnings, this
 * is one verdict about the whole import.
 */
export type BatchChainReason =
  | 'CHAINED'
  | 'SINGLE_LEG'
  | 'SNIPPET_IN_BATCH'
  | 'NO_UNIQUE_HEAD'
  | 'AMBIGUOUS_SUCCESSOR'
  | 'BROKEN_CHAIN';

export interface BatchChainOrder {
  /** A permutation of indices into the input array; identity when not resolved. */
  order: number[];
  /**
   * True when `order` may be applied. CHAINED and SINGLE_LEG are both resolved —
   * a one-leg batch has exactly one possible order and it is the right one — so a
   * caller can warn on `!resolved` without special-casing the commonest import.
   */
  resolved: boolean;
  reason: BatchChainReason;
}

/**
 * Decides the insert order for one import batch by matching each leg's
 * destination ident to the next leg's departure ident.
 *
 * This exists because upload order is NOT route order. Little Navmap's default
 * filename is "VFR <depname> (ICAO) to <destname> (ICAO).lnmpln", and a file
 * picker hands them over alphabetically — which for the real KSBA→KMRY→KSTS→KACV
 * trip is the exact reverse of the route. Selecting every file at once is the
 * obvious way to import a trip, so this is the common case, not an edge case.
 *
 * The order is applied ONLY when the chain resolves uniquely: every leg
 * airport-to-airport, exactly one head, exactly one successor at each step, all
 * legs consumed. A round trip (A→B, B→A) has zero heads and falls back — that
 * case is the reason the rule is written this way, not an oversight, and no
 * tie-break may be added to rescue it. On any refusal the order is the identity
 * and the caller keeps upload order.
 *
 * Pure, and batch-local: it never sees, reorders or renumbers legs already in the
 * trip.
 */
export function chainOrderForBatch(plans: ParsedFlightPlan[]): BatchChainOrder {
  const identity = plans.map((_, i) => i);

  // Fewer than two legs IS resolved — trivially, but genuinely: the one order
  // that exists is the route order. Reporting it as unresolved would set a trap
  // for the caller, whose obvious implementation warns whenever `resolved` is
  // false, and importing a single plan is the commonest import there is.
  // SINGLE_LEG carries no warning; returning true is what makes the data
  // structure enforce that rather than the caller remembering to.
  if (plans.length < 2) return { order: identity, resolved: true, reason: 'SINGLE_LEG' };

  // Eligibility. Chaining on non-airport idents would match unrelated legs
  // together: the real files number their USER waypoints WP1/WP2/WP3 in every
  // single leg, so a snippet endpoint is not a usable join key.
  for (const p of plans) {
    if (!p.departure.isAirport || !p.destination.isAirport) {
      return { order: identity, resolved: false, reason: 'SNIPPET_IN_BATCH' };
    }
  }

  const key = (s: string) => s.trim().toUpperCase();
  const deps = plans.map((p) => key(p.departure.ident));
  const dsts = plans.map((p) => key(p.destination.ident));
  const destIdents = new Set(dsts);

  const heads = identity.filter((i) => !destIdents.has(deps[i]));
  if (heads.length !== 1) return { order: identity, resolved: false, reason: 'NO_UNIQUE_HEAD' };

  const order: number[] = [];
  const used = new Set<number>();
  let current = heads[0];
  for (;;) {
    used.add(current);
    order.push(current);
    if (used.size === plans.length) break;
    const next = identity.filter((i) => !used.has(i) && deps[i] === dsts[current]);
    if (next.length === 0) return { order: identity, resolved: false, reason: 'BROKEN_CHAIN' };
    if (next.length > 1) return { order: identity, resolved: false, reason: 'AMBIGUOUS_SUCCESSOR' };
    current = next[0];
  }

  return { order, resolved: true, reason: 'CHAINED' };
}
