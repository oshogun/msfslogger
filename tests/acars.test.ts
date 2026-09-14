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

import { describe, expect, it } from 'vitest';
import {
  ACARS_DIRECTIONS,
  CANNED_MESSAGES,
  CLIENT_DIRECTION,
  KNOWN_ACARS_CATEGORIES,
  MAX_ACARS_BODY_LENGTH,
  cannedMessageIdList,
  findCannedMessage,
  findCannedMessageByBody,
  isAcarsDirection,
  isKnownAcarsCategory,
  isValidAcarsCategory,
  normaliseCannedBody,
  validateAcarsBody,
} from '../src/acars';

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
