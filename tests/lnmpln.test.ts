// tests/lnmpln.test.ts — the route-matching surface of src/lnmpln.ts.
//
// Scope: parseLnmpln and chainOrderForBatch, only for what feeds route
// matching — endpoints, waypoints, whether the departure is an airport, and
// leg ordering. Not every warning code in the 982-line parser.
//
// Fixtures are the committed ones under samples/lnmpln/ — real Little Navmap
// exports and the synthetic bad-*/route-matching family. Nothing here writes a
// fixture or globs samples/lnmpln/ for its *inputs*: every file is named
// explicitly. Expected values were measured by running the real parser over
// every committed fixture — reproduce with
// `npx ts-node src/inspect-lnmpln.ts 'samples/lnmpln/*.lnmpln'`.

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  parseLnmpln,
  chainOrderForBatch,
  LnmplnParseError,
  type ParsedFlightPlan,
  type LnmplnRejectCode,
  type BatchChainReason,
} from '../src/lnmpln';

// ── Fixture paths, resolved from the repo root regardless of process cwd ──────
// (never depend on cwd.)

const REAL_ROOT = path.resolve(__dirname, '../samples/lnmpln');
const SYNTHETIC_ROOT = path.join(REAL_ROOT, 'synthetic');

function readReal(name: string): Buffer {
  return fs.readFileSync(path.join(REAL_ROOT, name));
}

function readSynthetic(name: string): Buffer {
  return fs.readFileSync(path.join(SYNTHETIC_ROOT, name));
}

// ── The 5 real Little Navmap exports ───────────────────────────────────────────
// Filenames, expected departure/destination/waypointCount all transcribed from
// contracts/lnmpln-fixtures.json "real".

const REAL_FIXTURES: Array<{
  file: string;
  departure: string;
  destination: string;
  waypointCount: number;
}> = [
  {
    file: 'VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln',
    departure: 'KSBA',
    destination: 'KMRY',
    waypointCount: 7,
  },
  {
    file: 'VFR Monterey Rgnl (KMRY) to Charles M Schulz - Sonoma Coun (KSTS).lnmpln',
    departure: 'KMRY',
    destination: 'KSTS',
    waypointCount: 5,
  },
  {
    file: 'VFR Charles M Schulz - Sonoma Coun (KSTS) to California Redwood Coast-Humbo (KACV).lnmpln',
    departure: 'KSTS',
    destination: 'KACV',
    waypointCount: 6,
  },
  {
    file: 'VFR Monterey Rgnl (KMRY) to San Francisco Intl (KSFO).lnmpln',
    departure: 'KMRY',
    destination: 'KSFO',
    waypointCount: 18,
  },
  {
    file: 'IFR San Francisco Intl (KSFO) to Los Angeles Intl (KLAX).lnmpln',
    departure: 'KSFO',
    destination: 'KLAX',
    waypointCount: 3,
  },
];

describe('parseLnmpln: the 5 real Little Navmap exports', () => {
  for (const f of REAL_FIXTURES) {
    it(`parses "${f.file}" without throwing and pins departure/destination/waypointCount`, () => {
      const plan = parseLnmpln(readReal(f.file), f.file);
      expect(plan.departure.ident).toBe(f.departure);
      expect(plan.destination.ident).toBe(f.destination);
      expect(plan.waypoints).toHaveLength(f.waypointCount);
    });
  }

  it('orders waypoints departure-first, destination-last — the invariant buildPlannedLegCache() (src/flightManager.ts:118) depends on', () => {
    const file = 'VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln';
    const plan = parseLnmpln(readReal(file), file);
    expect(plan.waypoints[0].ident).toBe(plan.departure.ident);
    expect(plan.waypoints[0].ident).toBe('KSBA');
    expect(plan.waypoints[plan.waypoints.length - 1].ident).toBe(plan.destination.ident);
    expect(plan.waypoints[plan.waypoints.length - 1].ident).toBe('KMRY');
    expect(plan.departure.isAirport).toBe(true);
    expect(plan.destination.isAirport).toBe(true);
  });
});

// ── The 11 bad-*.lnmpln fixtures: each rejects with a specific reject code ────
// One assertion per fixture, no catch-all. Codes transcribed from
// contracts/lnmpln-fixtures.json "synthetic_rejected". Two traps recorded
// there, verified by these two entries rather than guessed from the filename:
// bad-not-xml.lnmpln rejects NO_FLIGHTPLAN (fast-xml-parser accepts the text,
// there's just no <LittleNavmap><Flightplan>), and NOT_XML actually comes from
// bad-truncated-comment.lnmpln.

const BAD_FIXTURES: Array<{ file: string; code: LnmplnRejectCode }> = [
  { file: 'bad-comment-swallowed-waypoints.lnmpln', code: 'TOO_FEW_WAYPOINTS' },
  { file: 'bad-empty.lnmpln', code: 'EMPTY_FILE' },
  { file: 'bad-lat-91.lnmpln', code: 'BAD_COORDINATE' },
  { file: 'bad-lon-minus-181.lnmpln', code: 'BAD_COORDINATE' },
  { file: 'bad-missing-ident.lnmpln', code: 'MISSING_IDENT' },
  { file: 'bad-missing-pos.lnmpln', code: 'MISSING_POSITION' },
  { file: 'bad-no-flightplan.lnmpln', code: 'NO_FLIGHTPLAN' },
  { file: 'bad-not-xml.lnmpln', code: 'NO_FLIGHTPLAN' },
  { file: 'bad-one-waypoint.lnmpln', code: 'TOO_FEW_WAYPOINTS' },
  { file: 'bad-truncated-comment.lnmpln', code: 'NOT_XML' },
  { file: 'bad-zero-waypoints.lnmpln', code: 'TOO_FEW_WAYPOINTS' },
];

describe('parseLnmpln: every bad-*.lnmpln synthetic fixture rejects with its specific LnmplnRejectCode', () => {
  for (const b of BAD_FIXTURES) {
    it(`"${b.file}" throws LnmplnParseError(${b.code})`, () => {
      expect.assertions(2);
      try {
        parseLnmpln(readSynthetic(b.file), b.file);
      } catch (err) {
        expect(err).toBeInstanceOf(LnmplnParseError);
        expect((err as LnmplnParseError).code).toBe(b.code);
      }
    });
  }
});

// ── Route-matching surface: non-airport endpoints, multi-block files, ─────────
// waypoints whose Pos carries no alt.

describe('parseLnmpln: route-matching surface pins', () => {
  it('a snippet whose departure is not an airport is parsed with the departure flagged not-an-airport — the property src/legMatcher.ts:130 turns into SNIPPET_NO_DEPARTURE_AIRPORT', () => {
    const file = 'snippet-non-airport-endpoints.lnmpln';
    const plan = parseLnmpln(readSynthetic(file), file);
    expect(plan.isSnippet).toBe(true);
    expect(plan.departure.ident).toBe('WP1');
    expect(plan.departure.isAirport).toBe(false);
    expect(plan.destination.ident).toBe('WP2');
    expect(plan.destination.isAirport).toBe(false);
    expect(plan.waypoints).toHaveLength(3);
  });

  it('a file with two <Waypoints> blocks and two <Alternates> blocks concatenates both in document order', () => {
    const file = 'two-waypoint-blocks-two-alternate-blocks.lnmpln';
    const plan = parseLnmpln(readSynthetic(file), file);
    expect(plan.departure.ident).toBe('KSFO');
    expect(plan.destination.ident).toBe('KLAX');
    expect(plan.waypoints).toHaveLength(4);
    expect(plan.alternates).toHaveLength(3);
    expect(plan.warnings.map((w) => w.code)).toContain('MULTIPLE_WAYPOINT_BLOCKS');
  });

  it('a waypoint whose <Pos> carries an unparseable Alt stores altFt: null and warns WAYPOINT_ALT_INVALID', () => {
    const file = 'waypoint-pos-without-alt.lnmpln';
    const plan = parseLnmpln(readSynthetic(file), file);
    expect(plan.departure.ident).toBe('KSBA');
    expect(plan.destination.ident).toBe('KMRY');
    expect(plan.waypoints).toHaveLength(3);
    const suddo = plan.waypoints.find((w) => w.ident === 'SUDDO');
    expect(suddo?.altFt).toBeNull();
    expect(plan.warnings.map((w) => w.code)).toContain('WAYPOINT_ALT_INVALID');
  });
});

// ── string vs Buffer input, and the BOM fixture ────────────────────────────────

describe('parseLnmpln: string and Buffer input', () => {
  it('accepts a Buffer (the real call shape — src/server.ts:481 passes file.buffer)', () => {
    const file = 'VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln';
    const buf = readReal(file);
    expect(Buffer.isBuffer(buf)).toBe(true);
    const plan = parseLnmpln(buf, file);
    expect(plan.departure.ident).toBe('KSBA');
  });

  it('accepts a string and parses identically to the equivalent Buffer', () => {
    const file = 'VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln';
    const buf = readReal(file);
    const str = buf.toString('utf8');
    const fromString = parseLnmpln(str, file);
    const fromBuffer = parseLnmpln(buf, file);
    expect(fromString).toEqual(fromBuffer);
  });

  it('the BOM fixture parses identically to its non-BOM equivalent, apart from the BOM_STRIPPED warning', () => {
    const withBom = readSynthetic('bom.lnmpln');
    expect(withBom[0]).toBe(0xef);
    expect(withBom[1]).toBe(0xbb);
    expect(withBom[2]).toBe(0xbf);
    // The non-BOM equivalent: the same bytes with the 3-byte UTF-8 BOM removed
    // in memory. Nothing is written to disk.
    const withoutBom = withBom.subarray(3);

    const bomPlan = parseLnmpln(withBom, 'bom.lnmpln');
    const noBomPlan = parseLnmpln(withoutBom, 'bom.lnmpln (BOM stripped in-memory)');

    expect(bomPlan.departure.ident).toBe('KSBA');
    expect(bomPlan.destination.ident).toBe('KMRY');
    expect(bomPlan.waypoints).toHaveLength(2);

    // Same substantive content...
    const strip = (p: ParsedFlightPlan) => ({ ...p, warnings: undefined });
    expect(strip(bomPlan)).toEqual(strip(noBomPlan));

    // ...but only the BOM-carrying buffer produced the BOM_STRIPPED warning.
    expect(bomPlan.warnings.map((w) => w.code)).toContain('BOM_STRIPPED');
    expect(noBomPlan.warnings.map((w) => w.code)).not.toContain('BOM_STRIPPED');
  });
});

// ── chainOrderForBatch ─────────────────────────────────────────────────────────
// Cases transcribed from contracts/lnmpln-fixtures.json "chainOrderForBatch",
// which was measured by running the real parser + chainOrderForBatch over the
// committed fixtures. BROKEN_CHAIN has no committed fixture pair (the contract
// notes every synthetic chain fixture is a round trip, which is NO_UNIQUE_HEAD)
// so it is built in-test below from two minimal in-memory plans.

function loadReal(file: string): ParsedFlightPlan {
  return parseLnmpln(readReal(file), file);
}

const KSBA_KMRY = 'VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln';
const KMRY_KSTS = 'VFR Monterey Rgnl (KMRY) to Charles M Schulz - Sonoma Coun (KSTS).lnmpln';
const KSTS_KACV = 'VFR Charles M Schulz - Sonoma Coun (KSTS) to California Redwood Coast-Humbo (KACV).lnmpln';
const KMRY_KSFO = 'VFR Monterey Rgnl (KMRY) to San Francisco Intl (KSFO).lnmpln';
const KSFO_KLAX = 'IFR San Francisco Intl (KSFO) to Los Angeles Intl (KLAX).lnmpln';

/**
 * A minimal, structurally complete ParsedFlightPlan for chainOrderForBatch
 * tests. chainOrderForBatch reads only departure/destination ident + isAirport
 * (src/lnmpln.ts:954-966), but the type is the real ParsedFlightPlan so a
 * signature change to it still breaks this file under tsc.
 */
function fakePlan(depIdent: string, dstIdent: string, isAirport = true): ParsedFlightPlan {
  const endpoint = (ident: string) => ({ ident, name: null, lat: 0, lon: 0, isAirport });
  return {
    departure: endpoint(depIdent),
    destination: endpoint(dstIdent),
    isSnippet: !isAirport,
    cruiseAltFt: null,
    flightplanType: null,
    aircraftType: null,
    remarks: null,
    createdAt: null,
    sourceProgram: null,
    simData: null,
    navDataSource: null,
    navDataCycle: null,
    departureStart: { pos: null, start: null, startType: null, headingTrueDeg: null },
    procedures: {
      sidName: null, sidRunway: null, sidTransition: null, sidType: null, sidCustomDistanceNm: null,
      starName: null, starRunway: null, starTransition: null,
      approachName: null, approachRunway: null, approachTransition: null, approachType: null,
      approachArinc: null, approachSuffix: null, approachTransitionType: null,
      approachCustomDistanceNm: null, approachCustomAltitudeFt: null, approachCustomOffsetDeg: null,
    },
    waypoints: [],
    alternates: [],
    approxDistanceNm: 0,
    distanceIsApproximate: true,
    warnings: [],
  };
}

describe('chainOrderForBatch', () => {
  it('sorts the VFR trio uploaded in alphabetical (reverse-route) order into route order: CHAINED', () => {
    const plans = [loadReal(KSTS_KACV), loadReal(KMRY_KSTS), loadReal(KSBA_KMRY)];
    const result = chainOrderForBatch(plans);
    expect(result).toEqual({ order: [2, 1, 0], resolved: true, reason: 'CHAINED' });
  });

  it('refuses to order all four VFR files (KMRY has two successors): AMBIGUOUS_SUCCESSOR', () => {
    const plans = [loadReal(KSBA_KMRY), loadReal(KMRY_KSTS), loadReal(KSTS_KACV), loadReal(KMRY_KSFO)];
    const result = chainOrderForBatch(plans);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe<BatchChainReason>('AMBIGUOUS_SUCCESSOR');
    expect(result.order).toEqual([0, 1, 2, 3]);
  });

  it('a single-leg batch is trivially resolved: SINGLE_LEG', () => {
    const plans = [loadReal(KSFO_KLAX)];
    const result = chainOrderForBatch(plans);
    expect(result).toEqual({ order: [0], resolved: true, reason: 'SINGLE_LEG' });
  });

  it('the chain-roundtrip-1/-2 fixture pair (A->B, B->A) has zero heads: NO_UNIQUE_HEAD', () => {
    const plans = [
      parseLnmpln(readSynthetic('chain-roundtrip-1-KAAA-to-KBBB.lnmpln'), 'chain-roundtrip-1-KAAA-to-KBBB.lnmpln'),
      parseLnmpln(readSynthetic('chain-roundtrip-2-KBBB-to-KAAA.lnmpln'), 'chain-roundtrip-2-KBBB-to-KAAA.lnmpln'),
    ];
    const result = chainOrderForBatch(plans);
    expect(result).toEqual({ order: [0, 1], resolved: false, reason: 'NO_UNIQUE_HEAD' });
  });

  it('a real leg plus the non-airport-endpoints snippet is never chained: SNIPPET_IN_BATCH', () => {
    const plans = [
      loadReal(KSBA_KMRY),
      parseLnmpln(readSynthetic('snippet-non-airport-endpoints.lnmpln'), 'snippet-non-airport-endpoints.lnmpln'),
    ];
    const result = chainOrderForBatch(plans);
    expect(result).toEqual({ order: [0, 1], resolved: false, reason: 'SNIPPET_IN_BATCH' });
  });

  it('a chain that starts uniquely but hits a dead end partway through: BROKEN_CHAIN (no committed fixture pair; built in-memory)', () => {
    // Two legs: KAAA -> KAAA (a self-loop, so KAAA is not a usable head — it is
    // its own destination) and KCCC -> KDDD, unrelated. KCCC never appears as
    // anyone's destination, so it is the unique head; chaining then looks for a
    // successor whose departure is KDDD and finds none — a dead end, not an
    // ambiguity and not "no head at all".
    const plans = [fakePlan('KAAA', 'KAAA'), fakePlan('KCCC', 'KDDD')];
    const result = chainOrderForBatch(plans);
    expect(result).toEqual({ order: [0, 1], resolved: false, reason: 'BROKEN_CHAIN' });
  });
});
