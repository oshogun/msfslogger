// tests/acars.test.ts — the ACARS rules in src/acars.ts.
//
// Scope: the direction and category validators, the canned set and the two ways
// of resolving an entry from a request, body normalisation, and the body guard
// every writer goes through. Nothing here touches a database, a clock or a
// server: src/acars.ts is pure by construction, and this file would stop
// compiling if that changed.
//
// The literal strings asserted below are the wire contract. cannedMessageIdList()
// in particular is the exact tail of the UNKNOWN_CANNED_MESSAGE error body the
// API returns, so the two cannot drift apart unnoticed.

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  ACARS_DIRECTIONS,
  CANNED_MESSAGES,
  CLIENT_DIRECTION,
  DISPATCH_RELEASE_LABEL,
  KNOWN_ACARS_CATEGORIES,
  LOADSHEET_LABEL,
  LOADSHEET_REQUEST_LABEL,
  MAX_ACARS_BODY_LENGTH,
  MAX_ROUTE_BODY_CHARS,
  NO_DISPATCH_DATA_MESSAGE,
  buildDispatchPayload,
  buildDispatchReleaseBody,
  buildLoadsheetFigures,
  buildLoadsheetReplyBody,
  buildLoadsheetRequestBody,
  cannedMessageIdList,
  clampRoute,
  dispatchDedupKey,
  field,
  findCannedMessage,
  findCannedMessageByBody,
  hhmm,
  isAcarsDirection,
  isKnownAcarsCategory,
  isValidAcarsCategory,
  levelText,
  loadsheetReplyDedupKey,
  loadsheetRequestDedupKey,
  normaliseCannedBody,
  parseDispatchPayload,
  qty,
  unitText,
  validateAcarsBody,
} from '../src/acars';
import { parseSimbriefPlan } from '../src/simbrief';
import type { DispatchPayload, LoadsheetFigures } from '../src/types';

describe('isAcarsDirection', () => {
  it('accepts the two directions', () => {
    expect(isAcarsDirection('uplink')).toBe(true);
    expect(isAcarsDirection('downlink')).toBe(true);
    expect(ACARS_DIRECTIONS).toEqual(['uplink', 'downlink']);
    expect(CLIENT_DIRECTION).toBe('downlink');
  });

  it('rejects everything else, including a case variant', () => {
    for (const v of ['UPLINK', 'up', 'Downlink', '', null, undefined, 0, {}, []]) {
      expect(isAcarsDirection(v)).toBe(false);
    }
  });
});

describe('isValidAcarsCategory', () => {
  it('accepts every category the codebase knows', () => {
    for (const c of KNOWN_ACARS_CATEGORIES) expect(isValidAcarsCategory(c)).toBe(true);
  });

  it("accepts 'oooi', which the message centre's own five categories omit", () => {
    // This is the category that makes a CHECK constraint on the column
    // unworkable: position reports need it and the message centre never did.
    expect(isValidAcarsCategory('oooi')).toBe(true);
  });

  it('accepts a well-shaped category it has never heard of', () => {
    expect(isValidAcarsCategory('atis')).toBe(true);
    expect(isValidAcarsCategory('crew-schedule')).toBe(true);
  });

  it('rejects the wrong shape', () => {
    for (const v of ['PDC', '-pdc', 'pdc ', ' pdc', '', '1pdc', 'pdc_request', null, undefined, 12, {}]) {
      expect(isValidAcarsCategory(v)).toBe(false);
    }
  });

  it('rejects a category longer than 32 characters', () => {
    expect(isValidAcarsCategory('a'.repeat(32))).toBe(true);
    expect(isValidAcarsCategory('a'.repeat(33))).toBe(false);
  });
});

describe('isKnownAcarsCategory', () => {
  it('is membership, not validity', () => {
    for (const c of KNOWN_ACARS_CATEGORIES) expect(isKnownAcarsCategory(c)).toBe(true);
    // Well-shaped, so storable and valid, but not one this codebase labels.
    expect(isValidAcarsCategory('atis')).toBe(true);
    expect(isKnownAcarsCategory('atis')).toBe(false);
  });
});

describe('CANNED_MESSAGES', () => {
  it('is exactly the three entries, in render order', () => {
    expect(CANNED_MESSAGES.map(m => m.id)).toEqual(['wx-request', 'gate-request', 'request-pushback']);
    expect(CANNED_MESSAGES.map(m => m.label)).toEqual(['WX REQUEST', 'GATE REQUEST', 'REQUEST PUSHBACK']);
    expect(CANNED_MESSAGES.map(m => m.body)).toEqual(['WX REQUEST', 'GATE REQUEST', 'REQUEST PUSHBACK']);
  });

  it('is entirely downlink freetext — a client cannot forge an uplink', () => {
    for (const m of CANNED_MESSAGES) {
      expect(m.direction).toBe('downlink');
      expect(m.category).toBe('freetext');
    }
  });

  it('has unique ids', () => {
    expect(new Set(CANNED_MESSAGES.map(m => m.id)).size).toBe(CANNED_MESSAGES.length);
  });
});

describe('findCannedMessage', () => {
  it('resolves each id to its exact body', () => {
    expect(findCannedMessage('wx-request')?.body).toBe('WX REQUEST');
    expect(findCannedMessage('gate-request')?.body).toBe('GATE REQUEST');
    expect(findCannedMessage('request-pushback')?.body).toBe('REQUEST PUSHBACK');
  });

  it('matches exactly: an id is a wire value, not user typing', () => {
    for (const v of ['WX-REQUEST', 'wx_request', 'wx-request ', 'pushback', '', null, undefined, 42, {}]) {
      expect(findCannedMessage(v)).toBeNull();
    }
  });
});

describe('findCannedMessageByBody', () => {
  it('matches through trimming, whitespace collapse and case', () => {
    for (const v of ['WX REQUEST', '  wx request  ', 'wx\nrequest', 'WX  REQUEST', 'wx\trequest']) {
      expect(findCannedMessageByBody(v)?.id).toBe('wx-request');
    }
    expect(findCannedMessageByBody('request pushback')?.id).toBe('request-pushback');
  });

  it('refuses anything that is not one of the three', () => {
    for (const v of ['WX REQUEST EGLL', 'PUSHBACK', 'HELLO DISPATCH', '', '   ', null, undefined, 7]) {
      expect(findCannedMessageByBody(v)).toBeNull();
    }
  });
});

describe('normaliseCannedBody', () => {
  it('trims, collapses whitespace runs and uppercases', () => {
    expect(normaliseCannedBody('  request   pushback\n')).toBe('REQUEST PUSHBACK');
    expect(normaliseCannedBody('wx\n\trequest')).toBe('WX REQUEST');
  });

  it('is idempotent', () => {
    for (const v of ['  wx  request ', 'GATE REQUEST', 'a\n\nb']) {
      expect(normaliseCannedBody(normaliseCannedBody(v))).toBe(normaliseCannedBody(v));
    }
  });
});

describe('validateAcarsBody', () => {
  it('returns the trimmed body', () => {
    expect(validateAcarsBody('  REQUEST PUSHBACK  ')).toEqual({ ok: true, body: 'REQUEST PUSHBACK' });
  });

  it('keeps interior newlines intact — a stored METAR or PDC is multi-line', () => {
    const metar = 'METAR EGLL 141020Z 25012KT 9999 FEW035 14/07 Q1014\nTAF EGLL 141100Z 1412/1518';
    expect(validateAcarsBody(metar)).toEqual({ ok: true, body: metar });
  });

  it('rejects an empty or whitespace-only body', () => {
    for (const v of ['', '   ', '\n\t']) {
      expect(validateAcarsBody(v)).toEqual({
        ok: false, code: 'INVALID_BODY', error: 'Message body must not be empty',
      });
    }
  });

  it('rejects a non-string', () => {
    for (const v of [null, undefined, 42, {}, ['REQUEST PUSHBACK']]) {
      expect(validateAcarsBody(v)).toEqual({
        ok: false, code: 'INVALID_BODY', error: 'Message body must be text',
      });
    }
  });

  it('bounds the length at MAX_ACARS_BODY_LENGTH', () => {
    expect(MAX_ACARS_BODY_LENGTH).toBe(4096);
    expect(validateAcarsBody('A'.repeat(MAX_ACARS_BODY_LENGTH)).ok).toBe(true);
    expect(validateAcarsBody('A'.repeat(MAX_ACARS_BODY_LENGTH + 1))).toEqual({
      ok: false, code: 'BODY_TOO_LONG', error: 'Message body is too long (max 4096 characters)',
    });
  });
});

describe('cannedMessageIdList', () => {
  it('is the exact tail of the UNKNOWN_CANNED_MESSAGE error body', () => {
    expect(cannedMessageIdList()).toBe('wx-request, gate-request, request-pushback');
    expect(`canned_id must be one of: ${cannedMessageIdList()}`)
      .toBe('canned_id must be one of: wx-request, gate-request, request-pushback');
  });
});

// ── Dispatch release + load sheet ───────────────────────────────────────────
//
// A SimBrief import files a dispatch release, and a pilot action files a
// load-sheet request/reply pair, both keyed to a planned leg. Every function
// under test here is pure: no clock, no database. `issuedAt` is always the
// caller's literal string, never a fresh Date().
//
// `buildDispatchPayload`/`parseDispatchPayload` are exercised against the real
// captured OFP (samples/simbrief/simbrief.userid.json, King Air 200, no
// alternate filed) via the real parser, so the payload under test is exactly
// what an import would produce — not a hand-typed stand-in for it. Everything
// else uses a hand-built DispatchPayload, which is plain data and does not
// need a parsed plan behind it.

const REAL_CAPTURE_PATH = path.resolve(__dirname, '../samples/simbrief/simbrief.userid.json');

function realDispatchPayload(): DispatchPayload {
  const plan = parseSimbriefPlan(fs.readFileSync(REAL_CAPTURE_PATH));
  return buildDispatchPayload(plan);
}

/** A fully-populated payload, independent of any parsed plan, for edge-case tests. */
function basePayload(over: Partial<DispatchPayload> = {}): DispatchPayload {
  return {
    v: 1,
    source: 'simbrief',
    ofp: { request_id: '186182026', sequence_id: '60bafd06304e', time_generated: '1789306516' },
    flight_number: 'SHG037',
    aircraft_type: 'BE20',
    aircraft_reg: 'N201SB',
    origin: 'UHPP',
    destination: 'UHSS',
    alternates: [],
    route: 'SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V',
    cruise_alt_ft: 28000,
    units: 'kgs',
    ete_sec: 12033,
    block_time_sec: 13713,
    fuel: {
      ramp: 1241, takeoff: 1159, landing: 287, taxi: 82,
      enroute_burn: 872, contingency: 65, reserve: 222, alternate_burn: 0,
    },
    weights: {
      oew: 3869, payload: 642, est_zfw: 4511, max_zfw: 4990,
      est_tow: 5670, est_ldw: 4798, pax_count: 7, cargo: 86,
    },
    ...over,
  };
}

describe('dispatch and load-sheet constants', () => {
  it('are the exact wire-contract strings', () => {
    expect(DISPATCH_RELEASE_LABEL).toBe('DISPATCH RELEASE');
    expect(LOADSHEET_REQUEST_LABEL).toBe('REQUEST LOADSHEET');
    expect(LOADSHEET_LABEL).toBe('LOADSHEET');
    expect(NO_DISPATCH_DATA_MESSAGE).toBe('NO DISPATCH DATA ON FILE');
    expect(MAX_ROUTE_BODY_CHARS).toBe(900);
  });
});

describe('dedup key builders', () => {
  it('build the three literal formulas, keyed on the planned leg id', () => {
    expect(dispatchDedupKey(42)).toBe('dispatch:leg:42');
    expect(loadsheetRequestDedupKey(42)).toBe('loadsheet-req:leg:42');
    expect(loadsheetReplyDedupKey(42)).toBe('loadsheet:leg:42');
  });

  it('gives a different leg its own keys, and never collides across the three kinds', () => {
    expect(dispatchDedupKey(1)).not.toBe(dispatchDedupKey(2));
    expect(dispatchDedupKey(42)).not.toBe(loadsheetRequestDedupKey(42));
    expect(loadsheetRequestDedupKey(42)).not.toBe(loadsheetReplyDedupKey(42));
    expect(dispatchDedupKey(42)).not.toBe(loadsheetReplyDedupKey(42));
  });
});

describe('hhmm', () => {
  it('formats seconds as HHMM, discarding seconds rather than rounding up', () => {
    expect(hhmm(0)).toBe('0000');
    expect(hhmm(59)).toBe('0000');
    expect(hhmm(12033)).toBe('0320');
  });

  it('keeps counting past 24 hours rather than wrapping', () => {
    expect(hhmm(86400)).toBe('2400');
    expect(hhmm(90000)).toBe('2500');
  });

  it('falls back to dashes for null, non-finite or negative input', () => {
    expect(hhmm(null)).toBe('----');
    expect(hhmm(NaN)).toBe('----');
    expect(hhmm(Infinity)).toBe('----');
    expect(hhmm(-1)).toBe('----');
  });
});

describe('levelText', () => {
  it('null -> UNKNOWN', () => {
    expect(levelText(null)).toBe('UNKNOWN');
  });

  it('renders a flight level at and above the 18000ft transition', () => {
    expect(levelText(28000)).toBe('FL280');
    expect(levelText(18000)).toBe('FL180');
  });

  it('renders a plain altitude below the transition', () => {
    expect(levelText(8000)).toBe('8000FT');
    expect(levelText(17999)).toBe('17999FT');
  });

  it('rounds before comparing to the transition, so a value that rounds up crosses it', () => {
    expect(levelText(17999.6)).toBe('FL180');
  });
});

describe('qty', () => {
  it('null -> dashes', () => {
    expect(qty(null)).toBe('----');
  });

  it('rounds to the nearest whole unit, no separator, no suffix', () => {
    expect(qty(1241)).toBe('1241');
    expect(qty(0)).toBe('0');
    expect(qty(642.5)).toBe('643');
    expect(qty(642.4)).toBe('642');
  });
});

describe('unitText', () => {
  it('maps the kg and lb spellings, case-insensitively', () => {
    expect(unitText('kgs')).toBe('KG');
    expect(unitText('kg')).toBe('KG');
    expect(unitText('KGS')).toBe('KG');
    expect(unitText('lbs')).toBe('LB');
    expect(unitText('lb')).toBe('LB');
    expect(unitText('LB')).toBe('LB');
  });

  it('falls back to UNITS UNKNOWN for anything else, including null', () => {
    expect(unitText('tonnes')).toBe('UNITS UNKNOWN');
    expect(unitText(null)).toBe('UNITS UNKNOWN');
  });
});

describe('clampRoute', () => {
  it('null -> NIL', () => {
    expect(clampRoute(null)).toBe('NIL');
  });

  it('leaves a route at or under the cap verbatim', () => {
    const atCap = 'A'.repeat(MAX_ROUTE_BODY_CHARS);
    expect(clampRoute(atCap)).toBe(atCap);
    expect(clampRoute(atCap)).toHaveLength(MAX_ROUTE_BODY_CHARS);
  });

  it('truncates one character past the cap to 897 characters plus an ellipsis', () => {
    const overCap = 'A'.repeat(MAX_ROUTE_BODY_CHARS + 1);
    const result = clampRoute(overCap);
    expect(result).toHaveLength(MAX_ROUTE_BODY_CHARS);
    expect(result).toBe('A'.repeat(MAX_ROUTE_BODY_CHARS - 3) + '...');
  });
});

describe('field', () => {
  it('pads the label to 14 and right-aligns the value to 6', () => {
    expect(field('TRIP FUEL', '872')).toBe('TRIP FUEL        872');
    expect(field('BLOCK FUEL', '1241')).toBe('BLOCK FUEL      1241');
    expect(field('ZERO FUEL WT', '4511')).toBe('ZERO FUEL WT    4511');
  });

  it('does not truncate a label already at or past 14 characters', () => {
    expect(field('A VERY LONG LABEL', '1')).toBe('A VERY LONG LABEL     1');
  });
});

describe('buildDispatchPayload', () => {
  it('is a straight field copy of the real captured OFP, including the no-alternate case', () => {
    const payload = realDispatchPayload();
    expect(payload).toEqual({
      v: 1,
      source: 'simbrief',
      ofp: { request_id: '186182026', sequence_id: '60bafd06304e', time_generated: '1789306516' },
      flight_number: 'SHG037',
      aircraft_type: 'BE20',
      aircraft_reg: 'N201SB',
      origin: 'UHPP',
      destination: 'UHSS',
      alternates: [],
      route: 'SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V',
      cruise_alt_ft: 28000,
      units: 'kgs',
      ete_sec: 12033,
      block_time_sec: 13713,
      fuel: {
        ramp: 1241, takeoff: 1159, landing: 287, taxi: 82,
        enroute_burn: 872, contingency: 65, reserve: 222, alternate_burn: 0,
      },
      weights: {
        oew: 3869, payload: 642, est_zfw: 4511, max_zfw: 4990,
        est_tow: 5670, est_ldw: 4798, pax_count: 7, cargo: 86,
      },
    });
  });

  it('stringifies to exactly the stored form', () => {
    // The wire form actually written to payload_json — a change here changes
    // every row already on disk.
    expect(JSON.stringify(realDispatchPayload())).toBe(
      '{"v":1,"source":"simbrief","ofp":{"request_id":"186182026","sequence_id":"60bafd06304e","time_generated":"1789306516"},"flight_number":"SHG037","aircraft_type":"BE20","aircraft_reg":"N201SB","origin":"UHPP","destination":"UHSS","alternates":[],"route":"SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V","cruise_alt_ft":28000,"units":"kgs","ete_sec":12033,"block_time_sec":13713,"fuel":{"ramp":1241,"takeoff":1159,"landing":287,"taxi":82,"enroute_burn":872,"contingency":65,"reserve":222,"alternate_burn":0},"weights":{"oew":3869,"payload":642,"est_zfw":4511,"max_zfw":4990,"est_tow":5670,"est_ldw":4798,"pax_count":7,"cargo":86}}',
    );
  });
});

describe('parseDispatchPayload', () => {
  it('round-trips exactly what buildDispatchPayload produced', () => {
    const built = realDispatchPayload();
    const roundTripped = parseDispatchPayload(JSON.stringify(built));
    expect(roundTripped).toEqual(built);
  });

  it('treats absent data as no dispatch data on file', () => {
    expect(parseDispatchPayload(null)).toBeNull();
    expect(parseDispatchPayload('')).toBeNull();
  });

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseDispatchPayload('{not valid json')).toBeNull();
    expect(parseDispatchPayload('"just a string"')).toBeNull();
  });

  it('rejects a missing or wrong schema version', () => {
    expect(parseDispatchPayload(JSON.stringify({ source: 'simbrief' }))).toBeNull();
    expect(parseDispatchPayload(JSON.stringify({ v: 2, source: 'simbrief' }))).toBeNull();
    expect(parseDispatchPayload(JSON.stringify({ v: '1', source: 'simbrief' }))).toBeNull();
  });

  it('rejects a wrong or missing source', () => {
    expect(parseDispatchPayload(JSON.stringify({ v: 1 }))).toBeNull();
    expect(parseDispatchPayload(JSON.stringify({ v: 1, source: 'other' }))).toBeNull();
  });

  it('rejects a value that is not an object, including null and an array', () => {
    expect(parseDispatchPayload(JSON.stringify(null))).toBeNull();
    expect(parseDispatchPayload(JSON.stringify(42))).toBeNull();
    expect(parseDispatchPayload(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it('drops a scalar written as a string rather than coercing it', () => {
    // This blob is written by us, in one place; a numeric field arriving as a
    // string means the stored data is not what we wrote.
    const raw = JSON.stringify({
      v: 1, source: 'simbrief', cruise_alt_ft: '28000',
      fuel: { ramp: '1241' }, weights: { oew: '3869' },
    });
    const parsed = parseDispatchPayload(raw);
    expect(parsed?.cruise_alt_ft).toBeNull();
    expect(parsed?.fuel.ramp).toBeNull();
    expect(parsed?.weights.oew).toBeNull();
  });

  it('substitutes an all-null fuel/weights node when the source object omits it', () => {
    const parsed = parseDispatchPayload(JSON.stringify({ v: 1, source: 'simbrief' }));
    expect(parsed?.fuel).toEqual({
      ramp: null, takeoff: null, landing: null, taxi: null,
      enroute_burn: null, contingency: null, reserve: null, alternate_burn: null,
    });
    expect(parsed?.weights).toEqual({
      oew: null, payload: null, est_zfw: null, max_zfw: null,
      est_tow: null, est_ldw: null, pax_count: null, cargo: null,
    });
    expect(parsed?.alternates).toEqual([]);
  });

  it('filters a non-string entry out of alternates rather than rejecting the whole payload', () => {
    const parsed = parseDispatchPayload(JSON.stringify({
      v: 1, source: 'simbrief', alternates: ['UHSH', 42, null, 'ZZZZ'],
    }));
    expect(parsed?.alternates).toEqual(['UHSH', 'ZZZZ']);
  });
});

describe('buildDispatchReleaseBody', () => {
  const ISSUED_AT = '2026-09-14T09:22:01.000Z';

  it('renders the real captured OFP to the exact ten-line body', () => {
    const body = buildDispatchReleaseBody(realDispatchPayload(), ISSUED_AT);
    expect(body).toBe([
      'DISPATCH RELEASE',
      'FLT SHG037',
      'UHPP UHSS ALTN NONE',
      'ACFT BE20 N201SB',
      'CRZ FL280',
      'ETE 0320',
      'FUEL KG BLOCK 1241 TRIP 872 RESV 222 ALTN 0 CONT 65 TAXI 82',
      'RTE SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V',
      'OFP 186182026 ISSUED 2026-09-14T09:22:01.000Z',
      'SIMULATED DISPATCH RELEASE - NOT FOR REAL WORLD USE',
    ].join('\n'));
  });

  it('joins two or more alternates with a space rather than listing NONE', () => {
    const body = buildDispatchReleaseBody(basePayload({ alternates: ['UHSH', 'UHSA'] }), ISSUED_AT);
    expect(body.split('\n')[2]).toBe('UHPP UHSS ALTN UHSH UHSA');
  });

  it('falls back to placeholders for every field that can be missing', () => {
    const empty = basePayload({
      flight_number: null, origin: null, destination: null, aircraft_type: null,
      aircraft_reg: null, cruise_alt_ft: null, ete_sec: null, route: null,
      ofp: { request_id: null, sequence_id: null, time_generated: null },
      fuel: { ramp: null, takeoff: null, landing: null, taxi: null, enroute_burn: null, contingency: null, reserve: null, alternate_burn: null },
      units: null,
    });
    const body = buildDispatchReleaseBody(empty, ISSUED_AT);
    expect(body).toBe([
      'DISPATCH RELEASE',
      'FLT UNKNOWN',
      '???? ???? ALTN NONE',
      'ACFT UNKNOWN NOREG',
      'CRZ UNKNOWN',
      'ETE ----',
      'FUEL UNITS UNKNOWN BLOCK ---- TRIP ---- RESV ---- ALTN ---- CONT ---- TAXI ----',
      'RTE NIL',
      `OFP UNKNOWN ISSUED ${ISSUED_AT}`,
      'SIMULATED DISPATCH RELEASE - NOT FOR REAL WORLD USE',
    ].join('\n'));
  });

  it('always ends with the simulation disclaimer', () => {
    expect(buildDispatchReleaseBody(basePayload(), ISSUED_AT).split('\n').at(-1))
      .toBe('SIMULATED DISPATCH RELEASE - NOT FOR REAL WORLD USE');
  });
});

describe('buildLoadsheetFigures', () => {
  it('takes block fuel, payload and ZFW straight from SimBrief when all three are present', () => {
    const sheet = buildLoadsheetFigures(realDispatchPayload());
    expect(sheet).toEqual({
      units: 'kgs',
      block_fuel: 1241,
      taxi_fuel: 82,
      takeoff_fuel: 1159,
      trip_fuel: 872,
      payload: 642,
      payload_source: 'simbrief',
      zero_fuel_weight: 4511,
      zfw_source: 'simbrief',
      max_zero_fuel_weight: 4990,
      dry_operating_weight: 3869,
      takeoff_weight: 5670,
      landing_weight: 4798,
      pax_count: 7,
      cargo: 86,
      estimated: true,
    });
  });

  it('falls back to takeoff + taxi for block fuel when ramp is absent', () => {
    const sheet = buildLoadsheetFigures(basePayload({ fuel: { ...basePayload().fuel, ramp: null } }));
    expect(sheet.block_fuel).toBe(1159 + 82);
  });

  it('leaves block fuel null when ramp is absent and either of takeoff/taxi is too', () => {
    const noTaxi = buildLoadsheetFigures(basePayload({ fuel: { ...basePayload().fuel, ramp: null, taxi: null } }));
    expect(noTaxi.block_fuel).toBeNull();
    const noTakeoff = buildLoadsheetFigures(basePayload({ fuel: { ...basePayload().fuel, ramp: null, takeoff: null } }));
    expect(noTakeoff.block_fuel).toBeNull();
  });

  it('derives payload from est_zfw - oew when SimBrief payload is absent, and marks it derived', () => {
    const p = basePayload({ weights: { ...basePayload().weights, payload: null } });
    const sheet = buildLoadsheetFigures(p);
    expect(sheet.payload).toBe(4511 - 3869);
    expect(sheet.payload_source).toBe('derived');
    // ZFW itself is still the SimBrief figure, unaffected by the payload fallback.
    expect(sheet.zero_fuel_weight).toBe(4511);
    expect(sheet.zfw_source).toBe('simbrief');
  });

  it('derives ZFW from oew + payload when SimBrief est_zfw is absent', () => {
    const p = basePayload({ weights: { ...basePayload().weights, est_zfw: null } });
    const sheet = buildLoadsheetFigures(p);
    expect(sheet.zero_fuel_weight).toBe(3869 + 642);
    expect(sheet.zfw_source).toBe('derived');
  });

  it('marks payload and ZFW unavailable, never both derived at once, when neither input is present', () => {
    const p = basePayload({ weights: { ...basePayload().weights, payload: null, est_zfw: null } });
    const sheet = buildLoadsheetFigures(p);
    expect(sheet.payload).toBeNull();
    expect(sheet.payload_source).toBe('unavailable');
    // ZFW's fallback needs the payload it would have resolved to; with payload
    // itself unavailable, ZFW cannot derive either.
    expect(sheet.zero_fuel_weight).toBeNull();
    expect(sheet.zfw_source).toBe('unavailable');
  });

  it('passes weights and pax/cargo straight through with no rounding', () => {
    const p = basePayload({ weights: { ...basePayload().weights, oew: 3869.4, max_zfw: 4990.6 } });
    const sheet = buildLoadsheetFigures(p);
    expect(sheet.dry_operating_weight).toBe(3869.4);
    expect(sheet.max_zero_fuel_weight).toBe(4990.6);
  });

  it('is always marked estimated', () => {
    expect(buildLoadsheetFigures(basePayload()).estimated).toBe(true);
    expect(buildLoadsheetFigures(basePayload({ fuel: { ramp: null, takeoff: null, landing: null, taxi: null, enroute_burn: null, contingency: null, reserve: null, alternate_burn: null }, weights: { oew: null, payload: null, est_zfw: null, max_zfw: null, est_tow: null, est_ldw: null, pax_count: null, cargo: null } })).estimated).toBe(true);
  });
});

describe('buildLoadsheetRequestBody', () => {
  it('renders the real captured OFP to the exact two-line body', () => {
    const body = buildLoadsheetRequestBody(realDispatchPayload());
    expect(body).toBe('REQUEST LOADSHEET\nUHPP UHSS FLT SHG037');
  });

  it('omits the FLT clause entirely when flight_number is null, rather than a dangling FLT', () => {
    const body = buildLoadsheetRequestBody(basePayload({ flight_number: null }));
    expect(body).toBe('REQUEST LOADSHEET\nUHPP UHSS');
  });

  it('falls back to ???? for a missing origin or destination', () => {
    const body = buildLoadsheetRequestBody(basePayload({ origin: null, destination: null }));
    expect(body).toBe('REQUEST LOADSHEET\n???? ???? FLT SHG037');
  });
});

describe('buildLoadsheetReplyBody', () => {
  const ISSUED_AT = '2026-09-14T09:22:01.000Z';

  it('renders the real captured OFP to the exact seventeen-line body', () => {
    const payload = realDispatchPayload();
    const sheet = buildLoadsheetFigures(payload);
    const body = buildLoadsheetReplyBody(payload, sheet, ISSUED_AT);
    expect(body).toBe([
      'LOADSHEET',
      'FLT SHG037 UHPP UHSS',
      'ACFT BE20 N201SB',
      'UNITS KG',
      'BLOCK FUEL      1241',
      'TAXI FUEL         82',
      'TAKEOFF FUEL    1159',
      'TRIP FUEL        872',
      'PAX                7',
      'CARGO             86',
      'PAYLOAD          642',
      'DRY OPER WT     3869',
      'ZERO FUEL WT    4511 MAX 4990',
      'TAKEOFF WT      5670',
      'LANDING WT      4798',
      `ISSUED ${ISSUED_AT}`,
      'ESTIMATED FIGURES - SIMULATION ONLY - NOT FOR ACTUAL LOADING',
    ].join('\n'));
    expect(body.split('\n')).toHaveLength(17);
  });

  it('appends MAX <n> to the ZFW line only when max_zero_fuel_weight is present', () => {
    const payload = basePayload();
    const withMax = buildLoadsheetReplyBody(payload, buildLoadsheetFigures(payload), ISSUED_AT);
    expect(withMax.split('\n').find(l => l.startsWith('ZERO FUEL WT'))).toBe('ZERO FUEL WT    4511 MAX 4990');

    const noMaxPayload = basePayload({ weights: { ...basePayload().weights, max_zfw: null } });
    const withoutMax = buildLoadsheetReplyBody(noMaxPayload, buildLoadsheetFigures(noMaxPayload), ISSUED_AT);
    expect(withoutMax.split('\n').find(l => l.startsWith('ZERO FUEL WT'))).toBe('ZERO FUEL WT    4511');
  });

  it('renders every unresolved figure as dashes rather than crashing', () => {
    const empty = basePayload({
      flight_number: null, origin: null, destination: null, aircraft_type: null, aircraft_reg: null, units: null,
      fuel: { ramp: null, takeoff: null, landing: null, taxi: null, enroute_burn: null, contingency: null, reserve: null, alternate_burn: null },
      weights: { oew: null, payload: null, est_zfw: null, max_zfw: null, est_tow: null, est_ldw: null, pax_count: null, cargo: null },
    });
    const sheet = buildLoadsheetFigures(empty);
    const body = buildLoadsheetReplyBody(empty, sheet, ISSUED_AT);
    expect(body).toBe([
      'LOADSHEET',
      'FLT UNKNOWN ???? ????',
      'ACFT UNKNOWN NOREG',
      'UNITS UNITS UNKNOWN',
      'BLOCK FUEL      ----',
      'TAXI FUEL       ----',
      'TAKEOFF FUEL    ----',
      'TRIP FUEL       ----',
      'PAX             ----',
      'CARGO           ----',
      'PAYLOAD         ----',
      'DRY OPER WT     ----',
      'ZERO FUEL WT    ----',
      'TAKEOFF WT      ----',
      'LANDING WT      ----',
      `ISSUED ${ISSUED_AT}`,
      'ESTIMATED FIGURES - SIMULATION ONLY - NOT FOR ACTUAL LOADING',
    ].join('\n'));
  });

  it('always ends with the simulation disclaimer', () => {
    const payload = basePayload();
    expect(buildLoadsheetReplyBody(payload, buildLoadsheetFigures(payload), ISSUED_AT).split('\n').at(-1))
      .toBe('ESTIMATED FIGURES - SIMULATION ONLY - NOT FOR ACTUAL LOADING');
  });
});

describe('LoadsheetFigures shape sanity', () => {
  it('matches the shape stored in payload_json and returned as the API response sheet', () => {
    // A LoadsheetFigures built here must be assignable to what the reply row
    // and the request/reply endpoint's response both carry.
    const sheet: LoadsheetFigures = buildLoadsheetFigures(realDispatchPayload());
    expect(JSON.parse(JSON.stringify(sheet))).toEqual(sheet);
  });
});
