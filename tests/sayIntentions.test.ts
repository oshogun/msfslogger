// tests/sayIntentions.test.ts — the pure helpers in src/sayIntentions.ts (key
// validation, masking, the SayIntentionsErrorCode -> HTTP mapping, and the
// comm_history[] -> acars_messages mapping), plus the pull routes in
// src/routes/sayIntentions.ts against a real scratch database with
// sayIntentionsClient's getCommsHistory stubbed — no test here performs a
// real network call.

import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAYINTENTIONS_API_KEY_SETTING,
  MIN_SAYINTENTIONS_API_KEY_LENGTH,
  MAX_SAYINTENTIONS_API_KEY_LENGTH,
  validateSayIntentionsApiKey,
  maskApiKey,
  httpStatusForSayIntentionsError,
  responseCodeForSayIntentionsError,
  commHistoryDedupKey,
  pickText,
  normaliseStampZulu,
  mapCommEntryToRows,
  maxCommId,
} from '../src/sayIntentions';
import type { CommHistoryEntry, SayIntentionsErrorCode } from '../src/sayIntentionsClient';
import { createSayIntentionsRouter } from '../src/routes/sayIntentions';
import { createAcarsRouter } from '../src/routes/acars';
import { getSetting, setSetting } from '../src/db/settings';
import { getSayIntentionsLink, upsertSayIntentionsLink } from '../src/db/sayIntentionsLinks';
import { createScratchDb, destroyScratchDb, seedFlight, seedPlannedLeg, seedAcarsMessage, type ScratchDb } from './helpers/db';
import { clearanceDedupKey } from '../src/acars';
import type { AcarsThread, ClearanceDetails, PlannedLegAcarsThread } from '../src/types';

vi.mock('../src/sayIntentionsClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sayIntentionsClient')>();
  return { ...actual, getCommsHistory: vi.fn(), sayAs: vi.fn() };
});
import { getCommsHistory, sayAs, SayIntentionsFetchError } from '../src/sayIntentionsClient';
const getCommsHistoryMock = vi.mocked(getCommsHistory);
const sayAsMock = vi.mocked(sayAs);

describe('SAYINTENTIONS_API_KEY_SETTING', () => {
  it('is the frozen app_setting name', () => {
    expect(SAYINTENTIONS_API_KEY_SETTING).toBe('sayintentions_api_key');
  });
});

describe('validateSayIntentionsApiKey', () => {
  it('rejects a non-string, non-null/undefined value', () => {
    const result = validateSayIntentionsApiKey(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_API_KEY');
      expect(result.error).toBe('A SayIntentions API key must be text');
    }
  });

  it('null, undefined, and an all-whitespace string all mean "clear it"', () => {
    expect(validateSayIntentionsApiKey(null)).toEqual({ ok: true, apiKey: null });
    expect(validateSayIntentionsApiKey(undefined)).toEqual({ ok: true, apiKey: null });
    expect(validateSayIntentionsApiKey('   ')).toEqual({ ok: true, apiKey: null });
    expect(validateSayIntentionsApiKey('')).toEqual({ ok: true, apiKey: null });
  });

  it('trims surrounding whitespace before validating', () => {
    const result = validateSayIntentionsApiKey('  si_1a2b3c4d5e6f  ');
    expect(result).toEqual({ ok: true, apiKey: 'si_1a2b3c4d5e6f' });
  });

  it(`rejects a key shorter than ${MIN_SAYINTENTIONS_API_KEY_LENGTH} characters`, () => {
    const result = validateSayIntentionsApiKey('a'.repeat(MIN_SAYINTENTIONS_API_KEY_LENGTH - 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('8 to 200 characters');
  });

  it(`rejects a key longer than ${MAX_SAYINTENTIONS_API_KEY_LENGTH} characters`, () => {
    const result = validateSayIntentionsApiKey('a'.repeat(MAX_SAYINTENTIONS_API_KEY_LENGTH + 1));
    expect(result.ok).toBe(false);
  });

  it('accepts a key at exactly the min and max lengths', () => {
    expect(validateSayIntentionsApiKey('a'.repeat(MIN_SAYINTENTIONS_API_KEY_LENGTH)).ok).toBe(true);
    expect(validateSayIntentionsApiKey('a'.repeat(MAX_SAYINTENTIONS_API_KEY_LENGTH)).ok).toBe(true);
  });

  it('rejects a key containing a space in the middle', () => {
    const result = validateSayIntentionsApiKey('si_1a2b 3c4d5e6f');
    expect(result.ok).toBe(false);
  });

  it('rejects a key containing a non-printable-ASCII character', () => {
    const result = validateSayIntentionsApiKey('si_1a2b3c4d5e6fé');
    expect(result.ok).toBe(false);
  });

  it('accepts a plausible real-shaped key unchanged (aside from trimming)', () => {
    const result = validateSayIntentionsApiKey('si_1a2b3c4d5e6f7g8h9f2c');
    expect(result).toEqual({ ok: true, apiKey: 'si_1a2b3c4d5e6f7g8h9f2c' });
  });
});

describe('maskApiKey', () => {
  it('null in, null out', () => {
    expect(maskApiKey(null)).toBeNull();
  });

  it('any set key masks to the same fixed placeholder, revealing no characters and no length', () => {
    expect(maskApiKey('short')).toBe('••••••••');
    expect(maskApiKey('a'.repeat(11))).toBe('••••••••');
    expect(maskApiKey('123456789012')).toBe('••••••••');
    expect(maskApiKey('si_1a2b3c4d5e6f7g8h9f2c')).toBe('••••••••');
    expect(maskApiKey('x'.repeat(500))).toBe('••••••••');
  });
});

describe('httpStatusForSayIntentionsError / responseCodeForSayIntentionsError', () => {
  const cases: Array<[SayIntentionsErrorCode, number, string]> = [
    ['NO_KEY', 409, 'NO_API_KEY'],
    ['BAD_KEY', 409, 'BAD_API_KEY'],
    ['NO_ACTIVE_SESSION', 409, 'NO_ACTIVE_SESSION'],
    ['NETWORK', 502, 'UPSTREAM_UNREACHABLE'],
    ['TIMEOUT', 504, 'UPSTREAM_TIMEOUT'],
    ['BAD_STATUS', 502, 'UPSTREAM_ERROR'],
    ['BAD_BODY', 502, 'UPSTREAM_BAD_BODY'],
  ];

  it.each(cases)('%s -> %i / %s', (code, status, responseCode) => {
    expect(httpStatusForSayIntentionsError(code)).toBe(status);
    expect(responseCodeForSayIntentionsError(code)).toBe(responseCode);
  });
});

describe('commHistoryDedupKey', () => {
  it('matches the frozen format exactly', () => {
    expect(commHistoryDedupKey(42, 51221, 'out')).toBe('sayintentions:comm:42:51221:out');
    expect(commHistoryDedupKey(42, 51221, 'in')).toBe('sayintentions:comm:42:51221:in');
  });
});

describe('maxCommId', () => {
  it('returns the greatest id, never below initial', () => {
    expect(maxCommId([{ id: 5 }, { id: 12 }, { id: 3 }], 0)).toBe(12);
    expect(maxCommId([{ id: 5 }], 100)).toBe(100);
  });

  it('skips entries that are not plain objects, or whose id is not a finite number', () => {
    expect(maxCommId([null, undefined, 42, 'str', { id: 7 }], 0)).toBe(7);
    expect(maxCommId([{ id: 'nope' }, { id: NaN }, { id: Infinity }], 0)).toBe(0);
  });

  it('an all-invalid array leaves initial untouched', () => {
    expect(maxCommId([null, { foo: 'bar' }], 9)).toBe(9);
  });
});

describe('pickText', () => {
  it('prefers the first non-empty-after-trim argument', () => {
    expect(pickText('  hello  ', 'world')).toBe('hello');
  });

  it('falls through to the second when the first is empty, whitespace-only, or not a string', () => {
    expect(pickText('', 'world')).toBe('world');
    expect(pickText('   ', 'world')).toBe('world');
    expect(pickText(null, 'world')).toBe('world');
    expect(pickText(undefined, 42)).toBeNull();
  });

  it('returns null when neither argument is usable', () => {
    expect(pickText(null, undefined)).toBeNull();
    expect(pickText('  ', '')).toBeNull();
  });
});

describe('normaliseStampZulu', () => {
  const FALLBACK = '2026-09-17T12:00:00.000Z';

  const cases: Array<[unknown, string]> = [
    ['2026-09-17 14:33:12', '2026-09-17T14:33:12.000Z'],
    ['2026-09-17T14:33:12', '2026-09-17T14:33:12.000Z'],
    ['2026-09-17T14:33:12Z', '2026-09-17T14:33:12.000Z'],
    ['2026-09-17T14:33:12.482Z', '2026-09-17T14:33:12.482Z'],
    ['2026-09-17 14:33', '2026-09-17T14:33:00.000Z'],
    ['2026-09-17T14:33:12+02:00', '2026-09-17T12:33:12.000Z'],
    ['17 Sep 2026 14:33:12 GMT', '2026-09-17T14:33:12.000Z'],
    [1789654392, '2026-09-17T14:13:12.000Z'],
    [1789654392000, '2026-09-17T14:13:12.000Z'],
    ['', FALLBACK],
    ['   ', FALLBACK],
    ['not a date', FALLBACK],
    [null, FALLBACK],
    [undefined, FALLBACK],
    [{ nope: true }, FALLBACK],
    [NaN, FALLBACK],
  ];

  it.each(cases)('%j -> %s', (raw, expected) => {
    expect(normaliseStampZulu(raw, FALLBACK)).toBe(expected);
  });

  // Step 3 (the unstructured fallthrough, e.g. '2026/09/17 14:33:12') is the
  // one branch that is not timezone-independent — new Date() reads an
  // unzoned non-ISO string as local time. Every case above uses a zoned or
  // ISO-shaped input on purpose so this test suite passes under any TZ; the
  // GMT-named case here pins that an explicit zone is still honoured.
  it('an explicitly zoned non-ISO string is read in its own zone, not the host TZ', () => {
    expect(normaliseStampZulu('17 Sep 2026 14:33:12 GMT', FALLBACK)).toBe('2026-09-17T14:33:12.000Z');
  });
});

describe('mapCommEntryToRows', () => {
  const FALLBACK = '2026-09-17T12:00:00.000Z';

  it('an entry with both directions produces two rows, out before in, sharing sent_at', () => {
    const rows = mapCommEntryToRows({
      id: 51221,
      ident: 'swa1451',
      station_name: 'San Francisco Ground',
      stamp_zulu: '2026-09-17 14:31:02',
      outgoing_message: 'Ground, Southwest 1451, ready to taxi.',
      incoming_message: 'Southwest 1451, taxi to runway 28R.',
    }, 42, FALLBACK);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      flight_id: 42, direction: 'downlink', category: 'atc', label: 'SWA1451',
      body: 'Ground, Southwest 1451, ready to taxi.',
      dedup_key: 'sayintentions:comm:42:51221:out',
      sent_at: '2026-09-17T14:31:02.000Z',
    });
    expect(rows[1]).toMatchObject({
      flight_id: 42, direction: 'uplink', category: 'atc', label: 'SAN FRANCISCO GROUND',
      body: 'Southwest 1451, taxi to runway 28R.',
      dedup_key: 'sayintentions:comm:42:51221:in',
      sent_at: '2026-09-17T14:31:02.000Z',
    });
  });

  it('prefers the English rendering when both language variants are present', () => {
    const rows = mapCommEntryToRows({
      id: 1, outgoing_message: 'texte francais', outgoing_message_english: 'english text',
    }, 42, FALLBACK);
    expect(rows[0].body).toBe('english text');
  });

  it('an entry with only a station reply produces one uplink row', () => {
    const rows = mapCommEntryToRows({
      id: 51222, station_name: 'SFO CLNC', incoming_message: 'PDC KSFO KLAX CLRD',
    }, 42, FALLBACK);
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('uplink');
    expect(rows[0].label).toBe('SFO CLNC');
  });

  it('falls back to CREW / ATC when ident / station_name is missing or blank', () => {
    const rows = mapCommEntryToRows({
      id: 1, outgoing_message: 'roger', incoming_message: 'wilco', ident: '   ', station_name: null,
    }, 42, FALLBACK);
    expect(rows[0].label).toBe('CREW');
    expect(rows[1].label).toBe('ATC');
  });

  it('normalises a label: trims, upper-cases, collapses whitespace, caps at 40 chars', () => {
    const rows = mapCommEntryToRows({
      id: 1, outgoing_message: 'hi', ident: '  swa   1451  extra  long  callsign  that  keeps  going  ',
    }, 42, FALLBACK);
    expect(rows[0].label).toBe('SWA 1451 EXTRA LONG CALLSIGN THAT KEEPS ');
    expect(rows[0].label?.length).toBe(40);
  });

  it('clamps an oversized body with a trailing "..."', () => {
    const long = 'x'.repeat(4100);
    const rows = mapCommEntryToRows({ id: 1, outgoing_message: long }, 42, FALLBACK);
    expect(rows[0].body).toHaveLength(4096);
    expect(rows[0].body.endsWith('...')).toBe(true);
  });

  it('an entry with neither direction usable produces no rows', () => {
    expect(mapCommEntryToRows({ id: 1, outgoing_message: '', incoming_message: '   ' }, 42, FALLBACK)).toEqual([]);
  });

  it('an entry that is not a plain object produces no rows', () => {
    expect(mapCommEntryToRows(null, 42, FALLBACK)).toEqual([]);
    expect(mapCommEntryToRows('nope', 42, FALLBACK)).toEqual([]);
    expect(mapCommEntryToRows([1, 2], 42, FALLBACK)).toEqual([]);
  });

  it('an entry with a non-numeric or missing id produces no rows', () => {
    expect(mapCommEntryToRows({ outgoing_message: 'hi' }, 42, FALLBACK)).toEqual([]);
    expect(mapCommEntryToRows({ id: 'abc', outgoing_message: 'hi' }, 42, FALLBACK)).toEqual([]);
    expect(mapCommEntryToRows({ id: NaN, outgoing_message: 'hi' }, 42, FALLBACK)).toEqual([]);
  });

  it('stores the whole upstream entry verbatim in payload_json', () => {
    const entry = { id: 1, outgoing_message: 'hi', some_future_field: 'kept' };
    const rows = mapCommEntryToRows(entry, 42, FALLBACK);
    const payload = JSON.parse(rows[0].payload_json as string);
    expect(payload).toEqual({ v: 1, source: 'sayintentions', comm_id: 1, leg: 'out', entry });
  });
});

// ── Routes R3–R6 ─────────────────────────────────────────────────────────────
//
// A real scratch database (never mocked) and a real HTTP server; only
// getCommsHistory is stubbed, via the module mock above.

function commEntry(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 51221,
    ident: 'SWA1451',
    station_name: 'SAN FRANCISCO GROUND',
    stamp_zulu: '2026-09-17T14:31:02Z',
    outgoing_message: 'Ground, Southwest 1451, ready to taxi.',
    incoming_message: 'Southwest 1451, taxi to runway 28R.',
    ...over,
  };
}

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api', createAcarsRouter());
  app.use('/api', createSayIntentionsRouter());

  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Test server did not bind to a TCP port'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((res, rej) => {
          server.close(err => (err ? rej(err) : res()));
        }),
      });
    });
    server.on('error', reject);
  });
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

async function postJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { method: 'POST' });
  return { status: res.status, body: await res.json() };
}

async function deleteJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

describe('SayIntentions pull routes', () => {
  let scratch: ScratchDb;
  let server: TestServer;

  beforeEach(async () => {
    scratch = createScratchDb();
    server = await startServer();
  });

  afterEach(async () => {
    getCommsHistoryMock.mockReset();
    await server.close();
    destroyScratchDb(scratch);
  });

  describe('GET /flights/:id/sayintentions/link', () => {
    it('400s on a non-numeric id', async () => {
      const { status, body } = await getJson(`${server.baseUrl}/api/flights/nope/sayintentions/link`);
      expect(status).toBe(400);
      expect(body).toEqual({ error: 'Invalid id', code: 'INVALID_ID' });
    });

    it('404s on a flight that does not exist', async () => {
      const { status, body } = await getJson(`${server.baseUrl}/api/flights/999/sayintentions/link`);
      expect(status).toBe(404);
      expect(body).toEqual({ error: 'Flight 999 not found', code: 'FLIGHT_NOT_FOUND' });
    });

    it('is total: no key, no link -> 200 with linked:false, api_key_set:false', async () => {
      const flightId = seedFlight(scratch.db);
      const { status, body } = await getJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(status).toBe(200);
      expect(body).toEqual({ flight_id: flightId, linked: false, link: null, api_key_set: false });
    });

    it('reports an existing link', async () => {
      const flightId = seedFlight(scratch.db);
      upsertSayIntentionsLink({
        flight_id: flightId, upstream_flight_id: '8841207', since_id: null,
        baseline_comm_id: 5, linked_at: '2026-09-17T14:30:00.000Z',
      });
      const { status, body } = await getJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(status).toBe(200);
      expect(body.linked).toBe(true);
      expect(body.link.upstream_flight_id).toBe('8841207');
    });
  });

  describe('POST /flights/:id/sayintentions/link', () => {
    it('409s with NO_API_KEY when no key is saved, never 500 or a crash', async () => {
      const flightId = seedFlight(scratch.db);
      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(status).toBe(409);
      expect(body.code).toBe('NO_API_KEY');
      expect(typeof body.error).toBe('string');
      expect(getCommsHistoryMock).not.toHaveBeenCalled();
    });

    it('links a flight, defaulting to from=session_start', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '8841207',
        comm_history: [commEntry({ id: 100 }), commEntry({ id: 101 })],
        mission: null,
      });

      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(status).toBe(201);
      expect(body.created).toBe(true);
      expect(body.pending_messages).toBe(2);
      expect(body.link).toMatchObject({
        flight_id: flightId, upstream_flight_id: '8841207', since_id: null, baseline_comm_id: 101,
      });
    });

    it('?from=now sets since_id to the baseline and pending_messages to 0', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '8841207', comm_history: [commEntry({ id: 100 })], mission: null,
      });

      const { body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link?from=now`);
      expect(body.pending_messages).toBe(0);
      expect(body.link.since_id).toBe(100);
      expect(body.link.baseline_comm_id).toBe(100);
    });

    it('an unrecognised ?from value behaves like the default (session_start), not an error', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '8841207', comm_history: [commEntry({ id: 100 })], mission: null,
      });

      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link?from=whatever`);
      expect(status).toBe(201);
      expect(body.link.since_id).toBeNull();
    });

    it('re-linking an already-linked flight returns 200, created:false, and overwrites the session', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      getCommsHistoryMock.mockResolvedValue({
        flight_id: '111', comm_history: [commEntry({ id: 1 })], mission: null,
      });
      await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);

      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '222', comm_history: [commEntry({ id: 5 })], mission: null,
      });
      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(status).toBe(200);
      expect(body.created).toBe(false);
      expect(body.link.upstream_flight_id).toBe('222');
    });

    it('409s with NO_COMMS_TO_LINK when upstream has no session id and no comms', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      getCommsHistoryMock.mockResolvedValueOnce({ flight_id: null, comm_history: [], mission: null });

      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(status).toBe(409);
      expect(body.code).toBe('NO_COMMS_TO_LINK');
    });

    it('maps an upstream BAD_KEY rejection to 409 BAD_API_KEY, echoing the client\'s userMessage', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      getCommsHistoryMock.mockRejectedValueOnce(
        new SayIntentionsFetchError('BAD_KEY', 'http 401', 'the saved key was rejected'),
      );

      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(status).toBe(409);
      expect(body).toEqual({ error: 'the saved key was rejected', code: 'BAD_API_KEY' });
    });

    it('a null element in comm_history is dropped, not a crash: links successfully with a zero baseline', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '8841207',
        comm_history: [null as unknown as CommHistoryEntry],
        mission: null,
      });

      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(status).toBe(201);
      expect(body.link).toMatchObject({
        flight_id: flightId, upstream_flight_id: '8841207', since_id: null, baseline_comm_id: 0,
      });
    });
  });

  describe('DELETE /flights/:id/sayintentions/link', () => {
    it('400s on a non-numeric id, 404s on a missing flight', async () => {
      expect((await deleteJson(`${server.baseUrl}/api/flights/nope/sayintentions/link`)).status).toBe(400);
      expect((await deleteJson(`${server.baseUrl}/api/flights/999/sayintentions/link`)).status).toBe(404);
    });

    it('unlinked:false when there was nothing to delete, true when there was', async () => {
      const flightId = seedFlight(scratch.db);
      const empty = await deleteJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(empty.body).toEqual({ flight_id: flightId, unlinked: false });

      upsertSayIntentionsLink({
        flight_id: flightId, upstream_flight_id: null, since_id: null,
        baseline_comm_id: 0, linked_at: '2026-09-17T14:30:00.000Z',
      });
      const real = await deleteJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/link`);
      expect(real.body).toEqual({ flight_id: flightId, unlinked: true });
      expect(getSayIntentionsLink(flightId)).toBeNull();
    });
  });

  describe('POST /flights/:id/sayintentions/import', () => {
    it('409s with NO_API_KEY when no key is saved', async () => {
      const flightId = seedFlight(scratch.db);
      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(status).toBe(409);
      expect(body.code).toBe('NO_API_KEY');
    });

    it('409s with NOT_LINKED when a key is saved but the flight was never linked', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(status).toBe(409);
      expect(body.code).toBe('NOT_LINKED');
    });

    it.each([
      ['NETWORK', 502, 'UPSTREAM_UNREACHABLE'],
      ['TIMEOUT', 504, 'UPSTREAM_TIMEOUT'],
      ['BAD_STATUS', 502, 'UPSTREAM_ERROR'],
      ['BAD_BODY', 502, 'UPSTREAM_BAD_BODY'],
    ] as Array<[SayIntentionsErrorCode, number, string]>)(
      'upstream %s maps to %i / %s, never a stack trace',
      async (code, status, responseCode) => {
        const flightId = seedFlight(scratch.db);
        setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
        upsertSayIntentionsLink({
          flight_id: flightId, upstream_flight_id: null, since_id: null,
          baseline_comm_id: 0, linked_at: '2026-09-17T14:30:00.000Z',
        });
        getCommsHistoryMock.mockRejectedValueOnce(new SayIntentionsFetchError(code, 'detail', 'a clear sentence'));

        const res = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
        expect(res.status).toBe(status);
        expect(res.body).toEqual({ error: 'a clear sentence', code: responseCode });
      },
    );

    it('imports comm_history into acars_messages, and a repeat import writes zero new rows', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      upsertSayIntentionsLink({
        flight_id: flightId, upstream_flight_id: null, since_id: null,
        baseline_comm_id: 0, linked_at: '2026-09-17T14:30:00.000Z',
      });

      const beforeThread = await getJson(`${server.baseUrl}/api/flights/${flightId}/acars-messages`);
      expect((beforeThread.body as AcarsThread).messages).toHaveLength(0);

      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '8841207',
        comm_history: [
          commEntry({ id: 51221 }), // out + in -> 2 rows
          commEntry({ id: 51222, outgoing_message: '', ident: null }), // in only -> 1 row
          commEntry({ id: 51223, outgoing_message: '', incoming_message: '' }), // neither -> skipped
        ],
        mission: null,
      });

      const first = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ imported: 3, already_seen: 0, skipped: 1, since_id: 51223 });
      expect(first.body.messages).toHaveLength(3);

      const afterFirst = await getJson(`${server.baseUrl}/api/flights/${flightId}/acars-messages`);
      expect((afterFirst.body as AcarsThread).messages).toHaveLength(3);

      // Second call: the stubbed client returns the identical window (since_id
      // captured from the mock call below proves the cursor is being used).
      let capturedSinceId: number | null | undefined;
      getCommsHistoryMock.mockImplementationOnce(async (_key, sinceId) => {
        capturedSinceId = sinceId ?? null;
        return {
          flight_id: '8841207',
          comm_history: [
            commEntry({ id: 51221 }),
            commEntry({ id: 51222, outgoing_message: '', ident: null }),
            commEntry({ id: 51223, outgoing_message: '', incoming_message: '' }),
          ],
          mission: null,
        };
      });

      const second = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(capturedSinceId).toBe(51223);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ imported: 0, already_seen: 3, skipped: 1, since_id: 51223 });
      expect(second.body.messages).toHaveLength(0);

      const afterSecond = await getJson(`${server.baseUrl}/api/flights/${flightId}/acars-messages`);
      expect((afterSecond.body as AcarsThread).messages).toHaveLength(3);
    });

    it('the since_id cursor advances and is used on the next call, across two different windows', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      upsertSayIntentionsLink({
        flight_id: flightId, upstream_flight_id: null, since_id: null,
        baseline_comm_id: 0, linked_at: '2026-09-17T14:30:00.000Z',
      });

      const sinceIdsSeen: Array<number | null> = [];
      getCommsHistoryMock.mockImplementationOnce(async (_key, sinceId) => {
        sinceIdsSeen.push(sinceId ?? null);
        return { flight_id: '8841207', comm_history: [commEntry({ id: 100 })], mission: null };
      });
      const firstRes = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(firstRes.body.since_id).toBe(100);

      getCommsHistoryMock.mockImplementationOnce(async (_key, sinceId) => {
        sinceIdsSeen.push(sinceId ?? null);
        return { flight_id: '8841207', comm_history: [commEntry({ id: 200 })], mission: null };
      });
      const secondRes = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(secondRes.body.since_id).toBe(200);

      expect(sinceIdsSeen).toEqual([null, 100]);
    });

    it('409s with SESSION_CHANGED when upstream now names a different session, and writes nothing', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      upsertSayIntentionsLink({
        flight_id: flightId, upstream_flight_id: '111', since_id: null,
        baseline_comm_id: 0, linked_at: '2026-09-17T14:30:00.000Z',
      });
      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '222', comm_history: [commEntry({ id: 1 })], mission: null,
      });

      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(status).toBe(409);
      expect(body.code).toBe('SESSION_CHANGED');

      const thread = await getJson(`${server.baseUrl}/api/flights/${flightId}/acars-messages`);
      expect((thread.body as AcarsThread).messages).toHaveLength(0);
      expect(getSayIntentionsLink(flightId)?.since_id).toBeNull();
    });

    it('backfills upstream_flight_id when the link was made without one', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      upsertSayIntentionsLink({
        flight_id: flightId, upstream_flight_id: null, since_id: null,
        baseline_comm_id: 0, linked_at: '2026-09-17T14:30:00.000Z',
      });
      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '8841207', comm_history: [commEntry({ id: 1 })], mission: null,
      });

      await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(getSayIntentionsLink(flightId)?.upstream_flight_id).toBe('8841207');
    });

    it('an empty comm_history leaves the cursor untouched and reports 200 with all-zero counts', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      upsertSayIntentionsLink({
        flight_id: flightId, upstream_flight_id: '111', since_id: 50,
        baseline_comm_id: 50, linked_at: '2026-09-17T14:30:00.000Z',
      });
      getCommsHistoryMock.mockResolvedValueOnce({ flight_id: '111', comm_history: [], mission: null });

      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(status).toBe(200);
      expect(body).toMatchObject({ imported: 0, already_seen: 0, skipped: 0, since_id: 50 });
    });

    it('a null element mixed into comm_history is dropped, not a crash: the real entry still imports and the cursor still advances', async () => {
      const flightId = seedFlight(scratch.db);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      upsertSayIntentionsLink({
        flight_id: flightId, upstream_flight_id: null, since_id: null,
        baseline_comm_id: 0, linked_at: '2026-09-17T14:30:00.000Z',
      });
      getCommsHistoryMock.mockResolvedValueOnce({
        flight_id: '8841207',
        comm_history: [
          commEntry({ id: 2, outgoing_message: '', incoming_message: 'second' }),
          null as unknown as CommHistoryEntry,
        ],
        mission: null,
      });

      const { status, body } = await postJson(`${server.baseUrl}/api/flights/${flightId}/sayintentions/import`);
      expect(status).toBe(201);
      expect(body).toMatchObject({ imported: 1, already_seen: 0, skipped: 1, since_id: 2 });
      expect(body.messages).toHaveLength(1);

      const thread = await getJson(`${server.baseUrl}/api/flights/${flightId}/acars-messages`);
      expect((thread.body as AcarsThread).messages).toHaveLength(1);
    });
  });
});

// ── Route R7 — the push route ────────────────────────────────────────────────
//
// A real scratch database and a real HTTP server; only sayAs is stubbed, via
// the module mock above. No test here performs a real network call.

const SAMPLE_CLEARANCE: ClearanceDetails = {
  v: 1,
  departure_icao: 'KSFO',
  destination_icao: 'KLAX',
  route: 'SSTIK3 BSR Q13 RZS KWANG2',
  initial_altitude_ft: 5000,
  squawk: '2451',
};
const SAMPLE_CONDENSED = 'PDC KSFO KLAX CLRD SSTIK3 BSR Q13 RZS KWANG2 CLB 5000FT SQ 2451';

describe('SayIntentions push route', () => {
  let scratch: ScratchDb;
  let server: TestServer;

  beforeEach(async () => {
    scratch = createScratchDb();
    server = await startServer();
  });

  afterEach(async () => {
    sayAsMock.mockReset();
    await server.close();
    destroyScratchDb(scratch);
  });

  // seedAcarsMessage's helper has no payload_json column, so it is written
  // directly with a follow-up UPDATE — the same shape the real clearance
  // route stores (buildClearanceDetails' output, JSON-encoded).
  function seedClearance(legId: number, details: ClearanceDetails = SAMPLE_CLEARANCE): number {
    const id = seedAcarsMessage(scratch.db, {
      planned_leg_id: legId,
      direction: 'in',
      category: 'pdc',
      body: 'PDC\nKSFO TO KLAX\nCLEARED VIA SSTIK3 BSR Q13 RZS KWANG2\nCLIMB AND MAINTAIN 5000FT\nSQUAWK 2451\nSIMULATED CLEARANCE - NOT FOR REAL WORLD USE',
      dedup_key: clearanceDedupKey(legId),
      sent_at: '2026-09-17T14:33:12.000Z',
    });
    scratch.db.prepare('UPDATE acars_messages SET payload_json = ? WHERE id = ?').run(JSON.stringify(details), id);
    return id;
  }

  it('400s on a non-numeric leg id', async () => {
    const { status, body } = await postJson(`${server.baseUrl}/api/planned-legs/nope/sayintentions/clearance`);
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Invalid id', code: 'INVALID_ID' });
    expect(sayAsMock).not.toHaveBeenCalled();
  });

  it('404s on a planned leg that does not exist', async () => {
    const { status, body } = await postJson(`${server.baseUrl}/api/planned-legs/999/sayintentions/clearance`);
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Planned leg 999 not found', code: 'PLANNED_LEG_NOT_FOUND' });
  });

  it('409s with NO_API_KEY when no key is saved, and never calls sayAs', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    seedClearance(legId);

    const { status, body } = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    expect(status).toBe(409);
    expect(body.code).toBe('NO_API_KEY');
    expect(sayAsMock).not.toHaveBeenCalled();
  });

  it('409s with NO_CLEARANCE when no clearance has been requested for this leg yet', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');

    const { status, body } = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    expect(status).toBe(409);
    expect(body).toEqual({
      error: 'No clearance has been issued for this leg yet. Press REQUEST CLEARANCE first.',
      code: 'NO_CLEARANCE',
    });
    expect(sayAsMock).not.toHaveBeenCalled();
  });

  it('409s with NO_CLEARANCE when the stored PDC row has unparseable payload_json, without crashing', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
    seedAcarsMessage(scratch.db, {
      planned_leg_id: legId, direction: 'in', category: 'pdc', body: 'PDC',
      dedup_key: clearanceDedupKey(legId), sent_at: '2026-09-17T14:33:12.000Z',
    });

    const { status, body } = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    expect(status).toBe(409);
    expect(body.code).toBe('NO_CLEARANCE');
  });

  it('sends the condensed clearance via sayAs(channel=ACARS_IN, rephrase=0), records a new row, and round-trips through GET', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    const clearanceMessageId = seedClearance(legId);
    setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
    sayAsMock.mockResolvedValueOnce({ ok: true, raw: { status: 'ok' }, rawText: '{"status":"ok"}' });

    const { status, body } = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    expect(status).toBe(201);
    expect(body.planned_leg_id).toBe(legId);
    expect(body.sent_text).toBe(SAMPLE_CONDENSED);
    expect(body.message).toMatchObject({
      planned_leg_id: legId,
      flight_id: null,
      direction: 'uplink',
      category: 'pdc',
      label: 'PDC SENT',
      body: SAMPLE_CONDENSED,
      correlation_id: clearanceMessageId,
      dedup_key: null,
    });

    expect(sayAsMock).toHaveBeenCalledTimes(1);
    expect(sayAsMock).toHaveBeenCalledWith(
      'si_1a2b3c4d5e6f7g8h9f2c',
      { channel: 'ACARS_IN', message: SAMPLE_CONDENSED, from: 'KSFO', messageType: 'cpdlc', rephrase: 0 },
    );

    const payload = JSON.parse(body.message.payload_json);
    expect(payload).toMatchObject({
      v: 1, source: 'sayintentions', channel: 'ACARS_IN', message_type: 'cpdlc',
      from: 'KSFO', sent_text: SAMPLE_CONDENSED, upstream_excerpt: '{"status":"ok"}',
    });

    const thread = await getJson(`${server.baseUrl}/api/planned-legs/${legId}/acars-messages`);
    const legThread = thread.body as PlannedLegAcarsThread;
    const pushRow = legThread.messages.find(m => m.label === 'PDC SENT');
    expect(pushRow).toBeDefined();
    expect(pushRow?.body).toBe(SAMPLE_CONDENSED);
  });

  it('falls back to from=DISPATCH when the clearance has no departure ICAO on file', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    const details: ClearanceDetails = { ...SAMPLE_CLEARANCE, departure_icao: null };
    seedAcarsMessage(scratch.db, {
      planned_leg_id: legId, direction: 'in', category: 'pdc', body: 'PDC',
      dedup_key: clearanceDedupKey(legId), sent_at: '2026-09-17T14:33:12.000Z',
    });
    // seedAcarsMessage's helper has no payload_json column, so write it directly.
    scratch.db.prepare('UPDATE acars_messages SET payload_json = ? WHERE dedup_key = ?')
      .run(JSON.stringify(details), clearanceDedupKey(legId));
    setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
    sayAsMock.mockResolvedValueOnce({ ok: true, raw: null, rawText: '' });

    await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    expect(sayAsMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ from: 'DISPATCH' }),
    );
  });

  it('409s with NO_ACTIVE_SESSION when sayAs reports no active session, and writes nothing — an expected outcome, not a bug', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    seedClearance(legId);
    setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
    sayAsMock.mockRejectedValueOnce(new SayIntentionsFetchError(
      'NO_ACTIVE_SESSION', 'http 409',
      'SayIntentions has no active flight session for this key right now, so the message was not sent. Start the sim with SayIntentions connected and try again.',
    ));

    const { status, body } = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    expect(status).toBe(409);
    expect(body).toEqual({
      error: 'SayIntentions has no active flight session for this key right now, so the message was not sent. Start the sim with SayIntentions connected and try again.',
      code: 'NO_ACTIVE_SESSION',
    });

    const thread = await getJson(`${server.baseUrl}/api/planned-legs/${legId}/acars-messages`);
    const legThread = thread.body as PlannedLegAcarsThread;
    expect(legThread.messages.some(m => m.label === 'PDC SENT')).toBe(false);
  });

  it('maps an upstream BAD_KEY rejection to 409 BAD_API_KEY', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    seedClearance(legId);
    setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
    sayAsMock.mockRejectedValueOnce(new SayIntentionsFetchError('BAD_KEY', 'http 401', 'the saved key was rejected'));

    const { status, body } = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'the saved key was rejected', code: 'BAD_API_KEY' });
  });

  it.each([
    ['NETWORK', 502, 'UPSTREAM_UNREACHABLE'],
    ['TIMEOUT', 504, 'UPSTREAM_TIMEOUT'],
    ['BAD_STATUS', 502, 'UPSTREAM_ERROR'],
    ['BAD_BODY', 502, 'UPSTREAM_BAD_BODY'],
  ] as Array<[SayIntentionsErrorCode, number, string]>)(
    'upstream %s maps to %i / %s, never a stack trace, and writes nothing',
    async (code, status, responseCode) => {
      const legId = seedPlannedLeg(scratch.db, { trip_id: null });
      seedClearance(legId);
      setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
      sayAsMock.mockRejectedValueOnce(new SayIntentionsFetchError(code, 'detail', 'a clear sentence'));

      const res = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: 'a clear sentence', code: responseCode });

      const thread = await getJson(`${server.baseUrl}/api/planned-legs/${legId}/acars-messages`);
      const legThread = thread.body as PlannedLegAcarsThread;
      expect(legThread.messages.some(m => m.label === 'PDC SENT')).toBe(false);
    },
  );

  it('a repeat send is allowed and files a second row rather than being deduplicated', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    seedClearance(legId);
    setSetting(SAYINTENTIONS_API_KEY_SETTING, 'si_1a2b3c4d5e6f7g8h9f2c');
    sayAsMock.mockResolvedValue({ ok: true, raw: null, rawText: '' });

    const first = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    const second = await postJson(`${server.baseUrl}/api/planned-legs/${legId}/sayintentions/clearance`);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.message.id).not.toBe(second.body.message.id);

    const thread = await getJson(`${server.baseUrl}/api/planned-legs/${legId}/acars-messages`);
    const legThread = thread.body as PlannedLegAcarsThread;
    expect(legThread.messages.filter(m => m.label === 'PDC SENT')).toHaveLength(2);
  });
});
