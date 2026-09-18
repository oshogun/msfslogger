// tests/sayIntentionsClient.test.ts — the network client in
// src/sayIntentionsClient.ts.
//
// Scope: getCommsHistory's and sayAs's full branch ladders, including every
// SayIntentionsErrorCode and all four NO_ACTIVE_SESSION detection paths.
// **No test here performs a real network call**: the stub passed per call is
// the only fetch this file ever sees — the same fetchImpl-injection pattern
// tests/weatherClient.test.ts uses.

import { afterEach, describe, expect, it } from 'vitest';
import {
  getCommsHistory,
  sayAs,
  SayIntentionsFetchError,
  MAX_ACARS_IN_CHARS,
} from '../src/sayIntentionsClient';

function stub(status: number, body: string | (() => string)): typeof fetch {
  return (async (url: string) => {
    const b = typeof body === 'function' ? body() : body;
    return { status, text: async () => b, url } as unknown as Response;
  }) as unknown as typeof fetch;
}

function stubCapturing(status: number, body: string): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return { status, text: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

function stubRejection(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

/** The error, or a failure if the call unexpectedly resolved. */
async function failureOf(promise: Promise<unknown>): Promise<SayIntentionsFetchError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(SayIntentionsFetchError);
    return err as SayIntentionsFetchError;
  }
  throw new Error('expected the call to reject, but it resolved');
}

const previousBase = process.env.SAYINTENTIONS_API_BASE_URL;
afterEach(() => {
  if (previousBase === undefined) delete process.env.SAYINTENTIONS_API_BASE_URL;
  else process.env.SAYINTENTIONS_API_BASE_URL = previousBase;
});

describe('getCommsHistory: happy path', () => {
  it('parses flight_id, comm_history (sorted ascending by id), and mission', async () => {
    const body = JSON.stringify({
      flight_id: 8841207,
      comm_history: [
        { id: 51223, incoming_message: 'later' },
        { id: 51221, incoming_message: 'earlier' },
      ],
      mission: { mission_id: 4471, status: 'active' },
    });
    const result = await getCommsHistory('a-real-key', null, { fetchImpl: stub(200, body) });
    expect(result.flight_id).toBe('8841207');
    expect(result.comm_history.map((e) => e.id)).toEqual([51221, 51223]);
    expect(result.mission).toEqual({ mission_id: 4471, status: 'active' });
  });

  it('an absent or non-array comm_history is [], not an error', async () => {
    const result = await getCommsHistory('a-real-key', null, { fetchImpl: stub(200, '{}') });
    expect(result.comm_history).toEqual([]);
    expect(result.flight_id).toBeNull();
    expect(result.mission).toBeNull();
  });

  it('passes a malformed entry through untouched — dropping it is the caller\'s job', async () => {
    const body = JSON.stringify({ comm_history: [{ id: 5 }, 'not-an-object', { no_id: true }] });
    const result = await getCommsHistory('a-real-key', null, { fetchImpl: stub(200, body) });
    expect(result.comm_history).toHaveLength(3);
    expect(result.comm_history).toContainEqual('not-an-object' as unknown);
  });

  it('sends api_key and since_id via URLSearchParams, omitting since_id when null/non-finite/negative', async () => {
    const { fetchImpl, urls } = stubCapturing(200, '{}');
    await getCommsHistory('my-key', 42, { fetchImpl });
    expect(urls[0]).toContain('/getCommsHistory?');
    expect(urls[0]).toContain('api_key=my-key');
    expect(urls[0]).toContain('since_id=42');

    urls.length = 0;
    await getCommsHistory('my-key', -5, { fetchImpl });
    expect(urls[0]).not.toContain('since_id');
    urls.length = 0;
    await getCommsHistory('my-key', null, { fetchImpl });
    expect(urls[0]).not.toContain('since_id');
  });

  it('throws NO_KEY before any fetch when apiKey is empty/whitespace', async () => {
    const fetchImpl = stub(200, '{}');
    const err = await failureOf(getCommsHistory('', null, { fetchImpl }));
    expect(err.code).toBe('NO_KEY');
    const err2 = await failureOf(getCommsHistory('   ', null, { fetchImpl }));
    expect(err2.code).toBe('NO_KEY');
  });

  it('HTTP 401/403 -> BAD_KEY', async () => {
    const err401 = await failureOf(getCommsHistory('k', null, { fetchImpl: stub(401, '') }));
    expect(err401.code).toBe('BAD_KEY');
    const err403 = await failureOf(getCommsHistory('k', null, { fetchImpl: stub(403, '') }));
    expect(err403.code).toBe('BAD_KEY');
  });

  it('any other non-200 -> BAD_STATUS with httpStatus', async () => {
    const err = await failureOf(getCommsHistory('k', null, { fetchImpl: stub(503, '') }));
    expect(err.code).toBe('BAD_STATUS');
    expect(err.httpStatus).toBe(503);
  });

  it('unparseable body -> BAD_BODY', async () => {
    const err = await failureOf(getCommsHistory('k', null, { fetchImpl: stub(200, 'not json {') }));
    expect(err.code).toBe('BAD_BODY');
  });

  it('a JSON array (not an object) -> BAD_BODY', async () => {
    const err = await failureOf(getCommsHistory('k', null, { fetchImpl: stub(200, '[1,2,3]') }));
    expect(err.code).toBe('BAD_BODY');
  });

  it('a rejected fetchImpl (TypeError) -> NETWORK', async () => {
    const err = await failureOf(getCommsHistory('k', null, { fetchImpl: stubRejection(new TypeError('fetch failed')) }));
    expect(err.code).toBe('NETWORK');
  });

  it('an AbortError/TimeoutError -> TIMEOUT', async () => {
    const direct = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const err = await failureOf(getCommsHistory('k', null, { fetchImpl: stubRejection(direct) }));
    expect(err.code).toBe('TIMEOUT');
  });

  it('never puts the key in message/userMessage', async () => {
    const err = await failureOf(getCommsHistory('super-secret-key', null, { fetchImpl: stub(500, '') }));
    expect(err.message).not.toContain('super-secret-key');
    expect(err.userMessage).not.toContain('super-secret-key');
  });
});

describe('sayAs: happy path and message length', () => {
  it('resolves ok:true, carrying the parsed body and the truncated rawText', async () => {
    const body = JSON.stringify({ status: 'ok', message: 'Message queued for transmission' });
    const result = await sayAs('k', { channel: 'ACARS_IN', message: 'PDC test' }, { fetchImpl: stub(200, body) });
    expect(result.ok).toBe(true);
    expect(result.raw).toEqual({ status: 'ok', message: 'Message queued for transmission' });
    expect(result.rawText).toBe(body);
  });

  it('an unrecognised 2xx body with no failure marker and no hint is also success (the fallback)', async () => {
    const body = JSON.stringify({ tx_id: 99213, queued_at: '2026-09-17T14:33:12Z' });
    const result = await sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(200, body) });
    expect(result.ok).toBe(true);
  });

  it('throws BAD_BODY (not a silent truncation) when message exceeds the 128-char cap', async () => {
    const long = 'x'.repeat(MAX_ACARS_IN_CHARS + 1);
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: long }, { fetchImpl: stub(200, '{}') }));
    expect(err.code).toBe('BAD_BODY');
  });

  it('throws NO_KEY before any fetch when apiKey is empty', async () => {
    const err = await failureOf(sayAs('', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(200, '{}') }));
    expect(err.code).toBe('NO_KEY');
  });

  it('sends channel, message, from, message_type, rephrase via URLSearchParams', async () => {
    const { fetchImpl, urls } = stubCapturing(200, '{}');
    await sayAs('k', { channel: 'ACARS_IN', message: 'PDC KSFO', from: 'KSFO', messageType: 'cpdlc', rephrase: 0 }, { fetchImpl });
    expect(urls[0]).toContain('/sayAs?');
    expect(urls[0]).toContain('channel=ACARS_IN');
    expect(urls[0]).toContain('message=PDC');
    expect(urls[0]).toContain('from=KSFO');
    expect(urls[0]).toContain('message_type=cpdlc');
    expect(urls[0]).toContain('rephrase=0');
  });
});

describe('sayAs: NO_ACTIVE_SESSION — all four detection paths', () => {
  it('HTTP 404 -> NO_ACTIVE_SESSION', async () => {
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(404, '{"error":"not found"}') }));
    expect(err.code).toBe('NO_ACTIVE_SESSION');
  });

  it('HTTP 409 -> NO_ACTIVE_SESSION', async () => {
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(409, '{}') }));
    expect(err.code).toBe('NO_ACTIVE_SESSION');
  });

  it('200 body with a failure marker AND a hint substring -> NO_ACTIVE_SESSION', async () => {
    const body = JSON.stringify({ status: 'error', error: 'No active flight session found for this API key' });
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(200, body) }));
    expect(err.code).toBe('NO_ACTIVE_SESSION');
  });

  it('200 body with a failure marker but NO hint substring -> BAD_STATUS, not NO_ACTIVE_SESSION', async () => {
    const body = JSON.stringify({ status: 'error', error: 'unexpected internal fault' });
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(200, body) }));
    expect(err.code).toBe('BAD_STATUS');
  });

  it('200 body with NO failure marker, but a hint substring in the text -> NO_ACTIVE_SESSION', async () => {
    const body = JSON.stringify({ note: 'no active session on this account right now' });
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(200, body) }));
    expect(err.code).toBe('NO_ACTIVE_SESSION');
  });
});

describe('sayAs: the rest of the error taxonomy', () => {
  it('HTTP 401/403 -> BAD_KEY (checked before the 404/409 no-session branch)', async () => {
    const err401 = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(401, '') }));
    expect(err401.code).toBe('BAD_KEY');
  });

  it('any other non-2xx (e.g. 500) -> BAD_STATUS', async () => {
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(500, 'Internal Server Error') }));
    expect(err.code).toBe('BAD_STATUS');
    expect(err.httpStatus).toBe(500);
  });

  it('200 with an unparseable body -> BAD_BODY', async () => {
    const err = await failureOf(
      sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(200, '<html><body>502 Bad Gateway</body></html>') }),
    );
    expect(err.code).toBe('BAD_BODY');
  });

  it('a rejected fetchImpl -> NETWORK', async () => {
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stubRejection(new TypeError('fetch failed')) }));
    expect(err.code).toBe('NETWORK');
  });

  it('an AbortError -> TIMEOUT', async () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    });
    const err = await failureOf(sayAs('k', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stubRejection(wrapped) }));
    expect(err.code).toBe('TIMEOUT');
  });

  it('never puts the key or the message in message/userMessage', async () => {
    const err = await failureOf(sayAs('super-secret-key', { channel: 'ACARS_IN', message: 'x' }, { fetchImpl: stub(500, '') }));
    expect(err.message).not.toContain('super-secret-key');
    expect(err.userMessage).not.toContain('super-secret-key');
  });
});

describe('baseUrl: SAYINTENTIONS_API_BASE_URL', () => {
  it('defaults to the real apipri.sayintentions.ai endpoint', async () => {
    delete process.env.SAYINTENTIONS_API_BASE_URL;
    const { fetchImpl, urls } = stubCapturing(200, '{}');
    await getCommsHistory('k', null, { fetchImpl });
    expect(urls[0].startsWith('https://apipri.sayintentions.ai/sapi/getCommsHistory?')).toBe(true);
  });

  it('is read per call, not cached at import, so a scratch server can override it mid-run', async () => {
    const { fetchImpl, urls } = stubCapturing(200, '{}');
    process.env.SAYINTENTIONS_API_BASE_URL = 'http://127.0.0.1:3101/sapi';
    await getCommsHistory('k', null, { fetchImpl });
    expect(urls[0].startsWith('http://127.0.0.1:3101/sapi/')).toBe(true);
  });
});
