// tests/simbrief.test.ts — the OFP parser in src/simbrief.ts.
//
// Scope: parseSimbriefPlan against the real captured response and against every
// rejection fixture, plus the two payload quirks that no real capture can show
// on its own (the single-element collapse, a fix with no position). The pilot
// ID validator is covered here too, since it lives in the same module.
//
// Fixtures are the committed ones under samples/simbrief/ — the real capture is
// read read-only and never rewritten. Nothing here touches the network, a
// database or a clock: the parser is pure by construction, and this file would
// stop compiling if that changed.
//
// Expected values were measured by running the real parser over the committed
// fixtures — reproduce with
// `npx ts-node src/inspect-simbrief.ts samples/simbrief/simbrief.userid.json`.

import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  parseSimbriefPlan,
  validateSimbriefUserId,
  MAX_SIMBRIEF_USER_ID_LENGTH,
  SIMBRIEF_USER_ID_SETTING,
  SimbriefParseError,
  type ParsedSimbriefPlan,
  type SimbriefDispatchFigures,
  type SimbriefRejectCode,
} from '../src/simbrief';

// ── Fixture paths, resolved from the repo root regardless of process cwd ──────

const ROOT = path.resolve(__dirname, '../samples/simbrief');
const SYNTHETIC_ROOT = path.join(ROOT, 'synthetic');

const REAL_CAPTURE = 'simbrief.userid.json';

function readReal(name: string): Buffer {
  return fs.readFileSync(path.join(ROOT, name));
}

function readSynthetic(name: string): Buffer {
  return fs.readFileSync(path.join(SYNTHETIC_ROOT, name));
}

/** The real capture as a mutable object, so a test can perturb one field. */
function realBody(): Record<string, unknown> {
  return JSON.parse(readReal(REAL_CAPTURE).toString()) as Record<string, unknown>;
}

// ── The real capture ──────────────────────────────────────────────────────────

describe('parseSimbriefPlan: the real captured OFP', () => {
  let plan: ParsedSimbriefPlan;

  beforeAll(() => {
    plan = parseSimbriefPlan(readReal(REAL_CAPTURE));
  });

  it('reads both endpoints as airports with positions', () => {
    expect(plan.departure).toEqual({
      ident: 'UHPP',
      name: 'YELIZOVO',
      lat: 53.169444,
      lon: 158.450556,
      isAirport: true,
    });
    expect(plan.destination).toEqual({
      ident: 'UHSS',
      name: 'KHOMUTOVO',
      lat: 46.888611,
      lon: 142.7175,
      isAirport: true,
    });
  });

  it('builds the chain as origin + 17 navlog fixes, without duplicating the destination', () => {
    // The origin is NOT in the navlog and the destination IS: 17 fixes in, 18
    // waypoints out, first UHPP, last UHSS exactly once.
    expect(plan.waypoints).toHaveLength(18);
    expect(plan.waypoints.map((w) => w.ident)).toEqual([
      'UHPP', 'PP003', 'SAMIK', 'TOC', 'UB', 'LEDRU', 'NAMUL', 'ROMUK', 'NATUN',
      'RUDOS', 'TOD', 'AGITA', 'BELNA', 'LEKPA', 'BAPMA', 'FARAT', 'CF19', 'UHSS',
    ]);
    expect(plan.waypoints.map((w) => w.seq)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(plan.waypoints.filter((w) => w.ident === 'UHSS')).toHaveLength(1);
  });

  it('maps fix types, keeping the computed lat/long points as USER', () => {
    const type = (ident: string): string => plan.waypoints.find((w) => w.ident === ident)!.type;
    expect(type('UHPP')).toBe('AIRPORT');
    expect(type('UHSS')).toBe('AIRPORT');
    expect(type('SAMIK')).toBe('WAYPOINT');
    expect(type('UB')).toBe('NDB');
    expect(type('TOC')).toBe('USER');
    expect(type('TOD')).toBe('USER');
  });

  it('keeps via_airway verbatim, including the literal DCT', () => {
    const airway = (ident: string): string | null => plan.waypoints.find((w) => w.ident === ident)!.airway;
    expect(airway('SAMIK')).toBe('SAMI4L');
    expect(airway('UB')).toBe('T577');
    expect(airway('LEKPA')).toBe('DCT');
    // Synthesized from origin, which has no airway of its own.
    expect(airway('UHPP')).toBeNull();
  });

  it('coerces every string scalar the mapping marks required', () => {
    expect(plan.cruiseAltFt).toBe(28000);
    expect(plan.flightplanType).toBe('IFR');
    expect(plan.aircraftType).toBe('BE20');
    expect(plan.isSnippet).toBe(false);
    expect(plan.sourceProgram).toBe('SimBrief');
    expect(plan.createdAt).toBe('2026-09-13T13:35:16.000Z');
    expect(plan.remarks).toBe(
      'SimBrief OFP SHG037 · SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V',
    );
    for (const w of plan.waypoints) {
      expect(typeof w.lat).toBe('number');
      expect(typeof w.lon).toBe('number');
      expect(w.ident).not.toBe('');
    }
  });

  it('carries the OFP identity the duplicate check is keyed on', () => {
    expect(plan.ofp).toEqual({
      requestId: '186182026',
      sequenceId: '60bafd06304e',
      timeGenerated: '1789306516',
      flightNumber: 'SHG037',
      routeString: 'SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V',
      userId: '1099607',
    });
  });

  it('reads the procedures, and leaves all nine approach fields null', () => {
    expect(plan.procedures.sidName).toBe('SAMI4L');
    expect(plan.procedures.sidRunway).toBe('34L');
    expect(plan.procedures.starName).toBe('LEKP4V');
    expect(plan.procedures.starRunway).toBe('19');
    // sid_trans and star_trans are {} in the capture — absent, not "".
    expect(plan.procedures.sidTransition).toBeNull();
    expect(plan.procedures.starTransition).toBeNull();
    expect(plan.procedures.approachName).toBeNull();
    expect(plan.procedures.approachType).toBeNull();
    expect(plan.procedures.approachCustomOffsetDeg).toBeNull();
    expect(plan.departureStart).toEqual({ pos: null, start: null, startType: null });
  });

  it('sums the chain to within a fraction of a percent of SimBrief own route_distance', () => {
    // SimBrief reports route_distance 754 for this OFP. The stored number is
    // ours, computed over the stored rows, so the leg and its waypoints agree.
    expect(plan.approxDistanceNm).toBeGreaterThan(750);
    expect(plan.approxDistanceNm).toBeLessThan(760);
    expect(Number(plan.approxDistanceNm.toFixed(1))).toBe(755.3);
  });

  it('warns about the empty alternate list and the pseudo-waypoints, and nothing else', () => {
    expect(plan.warnings.map((w) => w.code).sort()).toEqual(['NO_ALTERNATES', 'PSEUDO_WAYPOINTS']);
    expect(plan.alternates).toEqual([]);
  });

  it('carries the fuel, time and weight figures a dispatch release and load sheet are built from', () => {
    const dispatch: SimbriefDispatchFigures = plan.dispatch;
    expect(dispatch).toEqual({
      units: 'kgs',
      aircraftReg: 'N201SB',
      planRamp: 1241,
      planTakeoff: 1159,
      planLanding: 287,
      taxi: 82,
      enrouteBurn: 872,
      contingency: 65,
      reserve: 222,
      alternateBurn: 0,
      estTimeEnrouteSec: 12033,
      estBlockSec: 13713,
      oew: 3869,
      payload: 642,
      estZfw: 4511,
      maxZfw: 4990,
      estTow: 5670,
      estLdw: 4798,
      paxCount: 7,
      cargo: 86,
    });
  });

  it('does not warn NO_DISPATCH_FIGURES when the OFP carries real figures', () => {
    expect(plan.warnings.map((w) => w.code)).not.toContain('NO_DISPATCH_FIGURES');
  });
});

// ── plan.dispatch: absent and partial figures ─────────────────────────────────

describe('parseSimbriefPlan: dispatch figures, absent or partial', () => {
  it('yields an all-null dispatch node rather than rejecting the plan when fuel/times/weights are missing', () => {
    const body = realBody();
    delete body.fuel;
    delete body.times;
    delete body.weights;
    const plan = parseSimbriefPlan(body);
    expect(plan.dispatch).toEqual({
      units: 'kgs',
      aircraftReg: 'N201SB',
      planRamp: null,
      planTakeoff: null,
      planLanding: null,
      taxi: null,
      enrouteBurn: null,
      contingency: null,
      reserve: null,
      alternateBurn: null,
      estTimeEnrouteSec: null,
      estBlockSec: null,
      oew: null,
      payload: null,
      estZfw: null,
      maxZfw: null,
      estTow: null,
      estLdw: null,
      paxCount: null,
      cargo: null,
    });
    // The route itself is untouched — this is not a rejection condition.
    expect(plan.departure.ident).toBe('UHPP');
    expect(plan.destination.ident).toBe('UHSS');
  });

  it('warns NO_DISPATCH_FIGURES only when both plan_ramp and est_zfw are absent', () => {
    const body = realBody();
    delete body.fuel;
    delete body.weights;
    const plan = parseSimbriefPlan(body);
    expect(plan.dispatch.planRamp).toBeNull();
    expect(plan.dispatch.estZfw).toBeNull();
    const warning = plan.warnings.find((w) => w.code === 'NO_DISPATCH_FIGURES');
    expect(warning?.message).toBe(
      'SimBrief returned no fuel or weight figures; the dispatch release will carry no load data',
    );
  });

  it('does not warn when fuel is missing but weights still carries est_zfw', () => {
    const body = realBody();
    delete body.fuel;
    const plan = parseSimbriefPlan(body);
    expect(plan.dispatch.planRamp).toBeNull();
    expect(plan.dispatch.estZfw).toBe(4511);
    expect(plan.warnings.map((w) => w.code)).not.toContain('NO_DISPATCH_FIGURES');
  });

  it('does not warn when weights is missing but fuel still carries plan_ramp', () => {
    const body = realBody();
    delete body.weights;
    const plan = parseSimbriefPlan(body);
    expect(plan.dispatch.planRamp).toBe(1241);
    expect(plan.dispatch.estZfw).toBeNull();
    expect(plan.warnings.map((w) => w.code)).not.toContain('NO_DISPATCH_FIGURES');
  });
});

// ── The quirks no single capture can show ─────────────────────────────────────

describe('parseSimbriefPlan: PHP XML-to-JSON shapes', () => {
  it('reads a lone alternate delivered as a bare object, not an array', () => {
    // The capture was filed altn=NONE. A plan with exactly one alternate comes
    // back as a 38-key object; reading it without the normaliser drops it.
    const body = realBody();
    body.alternate = {
      icao_code: 'UHSH',
      name: 'OKHA',
      pos_lat: '53.821944',
      pos_long: '142.933056',
      cruise_altitude: '13000',
    };
    const plan = parseSimbriefPlan(body);
    expect(plan.alternates).toEqual([
      { seq: 1, ident: 'UHSH', name: 'OKHA', type: 'AIRPORT', lat: 53.821944, lon: 142.933056, altFt: 13000 },
    ]);
    expect(plan.warnings.map((w) => w.code)).not.toContain('NO_ALTERNATES');
  });

  it('reads a one-fix navlog delivered as a bare object', () => {
    const body = realBody();
    body.navlog = { fix: { ident: 'SAMIK', name: 'SAMIK', type: 'wpt', pos_lat: '53.038889', pos_long: '157.607778' } };
    const plan = parseSimbriefPlan(body);
    // origin + the lone fix + the destination, which is no longer last in the
    // navlog and so gets appended.
    expect(plan.waypoints.map((w) => w.ident)).toEqual(['UHPP', 'SAMIK', 'UHSS']);
  });

  it('drops a positionless fix with a warning instead of failing the import', () => {
    const body = realBody();
    const fixes = (body.navlog as { fix: Record<string, unknown>[] }).fix;
    fixes[1] = { ...fixes[1], pos_lat: {}, pos_long: {} };
    const plan = parseSimbriefPlan(body);
    expect(plan.waypoints).toHaveLength(17);
    expect(plan.waypoints.map((w) => w.ident)).not.toContain('SAMIK');
    expect(plan.warnings.find((w) => w.code === 'FIX_MISSING_POSITION')?.message).toContain('SAMIK');
  });

  it('does not prepend the origin when the navlog already starts with it', () => {
    const body = realBody();
    const fixes = (body.navlog as { fix: Record<string, unknown>[] }).fix;
    fixes.unshift({ ident: 'UHPP', name: 'YELIZOVO', type: 'apt', pos_lat: '53.169444', pos_long: '158.450556' });
    const plan = parseSimbriefPlan(body);
    expect(plan.waypoints).toHaveLength(18);
    expect(plan.waypoints.filter((w) => w.ident === 'UHPP')).toHaveLength(1);
    expect(plan.warnings.map((w) => w.code)).toContain('ORIGIN_IN_NAVLOG');
  });

  it('passes an unrecognised fix type through uppercased, with a warning', () => {
    const body = realBody();
    const fixes = (body.navlog as { fix: Record<string, unknown>[] }).fix;
    fixes[1] = { ...fixes[1], type: 'tailored' };
    const plan = parseSimbriefPlan(body);
    expect(plan.waypoints.find((w) => w.ident === 'SAMIK')!.type).toBe('TAILORED');
    expect(plan.warnings.find((w) => w.code === 'UNKNOWN_FIX_TYPE')?.message).toContain('SAMIK');
  });

  it('warns rather than throws when the cruise altitude is absent', () => {
    const body = realBody();
    (body.general as Record<string, unknown>).initial_altitude = {};
    const plan = parseSimbriefPlan(body);
    expect(plan.cruiseAltFt).toBeNull();
    expect(plan.warnings.map((w) => w.code)).toContain('NO_CRUISE_ALTITUDE');
  });
});

// ── Rejections ────────────────────────────────────────────────────────────────

const REJECTIONS: Array<{ file: string; code: SimbriefRejectCode }> = [
  { file: 'bad-not-json.txt', code: 'NOT_JSON' },
  { file: 'bad-no-route.json', code: 'NO_ROUTE' },
  { file: 'bad-no-plan.json', code: 'NOT_AN_OFP' },
  { file: 'bad-lat-91.json', code: 'BAD_POSITION' },
];

describe('parseSimbriefPlan: rejections', () => {
  for (const { file, code } of REJECTIONS) {
    it(`rejects ${file} with ${code} and a one-line reason`, () => {
      let thrown: unknown;
      try {
        parseSimbriefPlan(readSynthetic(file));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(SimbriefParseError);
      const err = thrown as SimbriefParseError;
      expect(err.code).toBe(code);
      expect(err.message).not.toBe('');
      expect(err.message).not.toContain('\n');
    });
  }

  it('rejects a body that is not an object at all', () => {
    expect(() => parseSimbriefPlan(null)).toThrow(SimbriefParseError);
    expect(() => parseSimbriefPlan(42)).toThrow(SimbriefParseError);
    expect(() => parseSimbriefPlan([])).toThrow(SimbriefParseError);
  });
});

// ── The pilot ID validator ────────────────────────────────────────────────────
//
// The accepted and rejected forms of a User ID, one test per rule. The messages
// are asserted verbatim because the client renders the server's string and has
// no lookup table of its own.

const DIGITS_ONLY_MESSAGE =
  'SimBrief User ID must be digits only — it is the numeric Pilot ID from your SimBrief account page, not your username';

describe('validateSimbriefUserId: accepted forms', () => {
  it('accepts a real pilot ID unchanged', () => {
    expect(validateSimbriefUserId('1099607')).toEqual({ ok: true, userId: '1099607' });
  });

  it('trims pasted whitespace', () => {
    expect(validateSimbriefUserId('  1099607  ')).toEqual({ ok: true, userId: '1099607' });
    expect(validateSimbriefUserId('\t1099607\n')).toEqual({ ok: true, userId: '1099607' });
  });

  it('preserves leading zeros and never parses the value as a number', () => {
    // The ID is an opaque identifier that happens to be spelled in digits; it
    // goes to SimBrief as a string.
    expect(validateSimbriefUserId('0012345')).toEqual({ ok: true, userId: '0012345' });
  });

  it('accepts the length boundary of 20 digits', () => {
    const twenty = '1'.repeat(MAX_SIMBRIEF_USER_ID_LENGTH);
    expect(validateSimbriefUserId(twenty)).toEqual({ ok: true, userId: twenty });
  });

  it('treats empty, whitespace, null and undefined as clearing the setting', () => {
    expect(validateSimbriefUserId('')).toEqual({ ok: true, userId: null });
    expect(validateSimbriefUserId('   ')).toEqual({ ok: true, userId: null });
    expect(validateSimbriefUserId(null)).toEqual({ ok: true, userId: null });
    expect(validateSimbriefUserId(undefined)).toEqual({ ok: true, userId: null });
  });
});

describe('validateSimbriefUserId: rejected forms', () => {
  it('rejects a value that is neither a string nor null', () => {
    for (const raw of [123, true, { a: 1 }, ['1']]) {
      expect(validateSimbriefUserId(raw)).toEqual({
        ok: false,
        code: 'INVALID_ID',
        error: 'SimBrief User ID must be text',
      });
    }
  });

  it('rejects a username, which SimBrief would answer with "Unknown UserID"', () => {
    expect(validateSimbriefUserId('oshogun')).toEqual({
      ok: false,
      code: 'INVALID_ID',
      error: DIGITS_ONLY_MESSAGE,
    });
  });

  it('rejects digits with anything else mixed in', () => {
    for (const raw of ['pilot123', '12 34', '1099607x', '+1099607', '10996.07']) {
      expect(validateSimbriefUserId(raw)).toMatchObject({ ok: false, error: DIGITS_ONLY_MESSAGE });
    }
  });

  it('rejects non-ASCII digits, which look numeric and are not', () => {
    expect(validateSimbriefUserId('1١٢')).toMatchObject({ ok: false, error: DIGITS_ONLY_MESSAGE });
  });

  it('rejects an id longer than the 20-digit ceiling', () => {
    expect(validateSimbriefUserId('1'.repeat(MAX_SIMBRIEF_USER_ID_LENGTH + 1))).toEqual({
      ok: false,
      code: 'INVALID_ID',
      error: 'SimBrief User ID is too long',
    });
  });

  it('rejects a value shaped like an injection attempt before it reaches the database', () => {
    expect(validateSimbriefUserId("1'; DROP TABLE app_setting;--")).toMatchObject({
      ok: false,
      code: 'INVALID_ID',
    });
  });
});

describe('the setting key', () => {
  it('is owned by this module so the string exists once', () => {
    expect(SIMBRIEF_USER_ID_SETTING).toBe('simbrief_user_id');
  });
});
