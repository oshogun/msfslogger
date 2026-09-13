// tests/simbriefClient.test.ts — the network client in src/simbriefClient.ts.
//
// Scope: the request it builds, and every branch of the error taxonomy, driven
// by the `fetchImpl` seam. **No test here performs a real network call**: the
// stub passed per call is the only fetch this file ever sees, and a stub that
// is never called is itself an assertion in several tests below.
//
// The success and "unknown user" bodies are the committed real captures, so the
// verdict ladder is exercised against shapes SimBrief actually produced rather
// than against invented ones.

import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSimbriefPlan, SimbriefFetchError } from '../src/simbriefClient';

const ROOT = path.resolve(__dirname, '../samples/simbrief');

const SUCCESS_BODY = fs.readFileSync(path.join(ROOT, 'simbrief.userid.json')).toString();
const UNKNOWN_USER_BODY = fs.readFileSync(path.join(ROOT, 'simbrief.error.baduserid.txt')).toString();
const NO_PLAN_BODY = fs.readFileSync(path.join(ROOT, 'synthetic/bad-no-plan.json')).toString();

const USER_ID = '1099607';

/** A stub standing in for a whole HTTP exchange. Nothing opens a socket. */
function stubResponse(status: number, body: string): typeof fetch {
  return vi.fn(async () =>
    // Only .status and .text() are read; the cast keeps the stub to those two
    // rather than reimplementing the whole Response interface.
    ({ status, ok: status >= 200 && status < 300, text: async () => body }) as unknown as Response,
  ) as unknown as typeof fetch;
}

function stubRejection(err: unknown): typeof fetch {
  return vi.fn(async () => {
    throw err;
  }) as unknown as typeof fetch;
}

/** The error, or a failure if the call unexpectedly resolved. */
async function failureOf(
  fetchImpl: typeof fetch,
  over: { userId?: string; timeoutMs?: number } = {},
): Promise<SimbriefFetchError> {
  try {
    await fetchSimbriefPlan(over.userId ?? USER_ID, { fetchImpl, timeoutMs: over.timeoutMs });
  } catch (err) {
    expect(err).toBeInstanceOf(SimbriefFetchError);
    return err as SimbriefFetchError;
  }
  throw new Error('expected fetchSimbriefPlan to reject, but it resolved');
}

describe('fetchSimbriefPlan: the request', () => {
  const previousBase = process.env.SIMBRIEF_API_BASE_URL;

  afterEach(() => {
    if (previousBase === undefined) delete process.env.SIMBRIEF_API_BASE_URL;
    else process.env.SIMBRIEF_API_BASE_URL = previousBase;
  });

  it('defaults to the real SimBrief endpoint and asks for JSON', async () => {
    delete process.env.SIMBRIEF_API_BASE_URL;
    const fetchImpl = stubResponse(200, SUCCESS_BODY);
    await fetchSimbriefPlan(USER_ID, { fetchImpl });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://www.simbrief.com/api/xml.fetcher.php?userid=1099607&json=1');
    expect((init as RequestInit).headers).toEqual({ Accept: 'application/json' });
    expect((init as RequestInit).signal).toBeDefined();
  });

  it('sends no credential of any kind', async () => {
    const fetchImpl = stubResponse(200, SUCCESS_BODY);
    await fetchSimbriefPlan(USER_ID, { fetchImpl });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(Object.keys(headers)).toEqual(['Accept']);
  });

  it('reads SIMBRIEF_API_BASE_URL per call, so a scratch server can point at a stub', async () => {
    process.env.SIMBRIEF_API_BASE_URL = 'http://127.0.0.1:3101/api/xml.fetcher.php';
    const fetchImpl = stubResponse(200, SUCCESS_BODY);
    await fetchSimbriefPlan(USER_ID, { fetchImpl });
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3101/api/xml.fetcher.php?userid=1099607&json=1');
  });

  it('encodes the id as a parameter value, so it cannot smuggle in another one', async () => {
    const fetchImpl = stubResponse(200, SUCCESS_BODY);
    await fetchSimbriefPlan('1&static_id=evil', { fetchImpl });
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('userid=1%26static_id%3Devil');
    expect(url).not.toContain('&static_id=evil');
  });

  it('resolves with the decoded body on a Success envelope', async () => {
    const body = await fetchSimbriefPlan(USER_ID, { fetchImpl: stubResponse(200, SUCCESS_BODY) });
    expect((body as { fetch: { status: string } }).fetch.status).toBe('Success');
    expect((body as { origin: { icao_code: string } }).origin.icao_code).toBe('UHPP');
  });
});

describe('fetchSimbriefPlan: the error taxonomy', () => {
  it('UNKNOWN_USER — the real 400 body for an id SimBrief does not know', async () => {
    const err = await failureOf(stubResponse(400, UNKNOWN_USER_BODY), { userId: '999999999' });
    expect(err.code).toBe('UNKNOWN_USER');
    expect(err.httpStatus).toBe(400);
    expect(err.upstreamStatus).toBe('Error: Unknown UserID');
    expect(err.message).toBe('UNKNOWN_USER (http 400, upstream "Error: Unknown UserID")');
    expect(err.userMessage).toContain('does not recognise that Pilot ID');
  });

  it('NO_PLAN — the real 400 body for an account that has never filed a plan', async () => {
    const err = await failureOf(stubResponse(400, NO_PLAN_BODY), { userId: '2' });
    expect(err.code).toBe('NO_PLAN');
    expect(err.upstreamStatus).toBe('Error: No flight plan on file for the specified user');
    expect(err.userMessage).toContain('no flight plan on file');
  });

  it('BAD_STATUS — any other "Error: …", carried through verbatim', async () => {
    const body = JSON.stringify({ fetch: { userid: USER_ID, status: 'Error: Rate limit exceeded', time: '0.1' } });
    const err = await failureOf(stubResponse(400, body));
    expect(err.code).toBe('BAD_STATUS');
    expect(err.userMessage).toBe('SimBrief returned an error: Error: Rate limit exceeded. Try again in a moment.');
  });

  it('BAD_STATUS — a non-200 whose body carries no verdict at all', async () => {
    const err = await failureOf(stubResponse(503, JSON.stringify({ maintenance: true })));
    expect(err.code).toBe('BAD_STATUS');
    expect(err.httpStatus).toBe(503);
    expect(err.userMessage).toBe('SimBrief returned an error: HTTP 503. Try again in a moment.');
  });

  it('checks the envelope before the HTTP status, since both failures are 400', async () => {
    // A 200 carrying an error envelope is still an error, and a 400 carrying
    // "Unknown UserID" is UNKNOWN_USER rather than a generic BAD_STATUS.
    const err = await failureOf(stubResponse(200, UNKNOWN_USER_BODY));
    expect(err.code).toBe('UNKNOWN_USER');
  });

  it('BAD_BODY — an HTML page where JSON was expected, excerpted into the log line', async () => {
    const html = `<!DOCTYPE html><html><body>503 Service Unavailable ${'x'.repeat(500)}</body></html>`;
    const err = await failureOf(stubResponse(200, html));
    expect(err.code).toBe('BAD_BODY');
    expect(err.message).toContain('first 200 chars: <!DOCTYPE html>');
    // The excerpt is bounded: the log line never carries the whole body.
    expect(err.message.length).toBeLessThan(300);
    expect(err.userMessage).toContain('could not read');
  });

  it('BAD_BODY — valid JSON with no Success in the envelope', async () => {
    const err = await failureOf(stubResponse(200, JSON.stringify({ params: { request_id: '1' } })));
    expect(err.code).toBe('BAD_BODY');
  });

  it('BAD_BODY — valid JSON that is not an object', async () => {
    const err = await failureOf(stubResponse(200, '[1,2,3]'));
    expect(err.code).toBe('BAD_BODY');
  });

  it('NETWORK — DNS, TLS or a refused connection', async () => {
    const err = await failureOf(stubRejection(new TypeError('fetch failed')));
    expect(err.code).toBe('NETWORK');
    expect(err.message).toBe('NETWORK (fetch failed)');
    expect(err.userMessage).toContain('Could not reach SimBrief');
  });

  it('TIMEOUT — an abort, however the runtime wraps it', async () => {
    const direct = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    expect((await failureOf(stubRejection(direct))).code).toBe('TIMEOUT');

    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    });
    const err = await failureOf(stubRejection(wrapped));
    expect(err.code).toBe('TIMEOUT');
    expect(err.userMessage).toContain('did not respond within 20 seconds');
  });

  it('never leaks a URL, a stack or the pilot ID into the sentence the user reads', async () => {
    const cases: Array<typeof fetch> = [
      stubResponse(400, UNKNOWN_USER_BODY),
      stubResponse(400, NO_PLAN_BODY),
      stubResponse(503, '<html>down</html>'),
      stubRejection(new TypeError('connect ECONNREFUSED 127.0.0.1:443')),
    ];
    for (const fetchImpl of cases) {
      const err = await failureOf(fetchImpl);
      expect(err.userMessage).not.toContain('simbrief.com/api');
      expect(err.userMessage).not.toContain(USER_ID);
      expect(err.userMessage).not.toContain('    at ');
      expect(err.userMessage.split('\n')).toHaveLength(1);
    }
  });
});

describe('fetchSimbriefPlan: the timeout is a real deadline', () => {
  it('aborts the request it issued, and reports the deadline it used', async () => {
    // A stub that never answers, exactly like SimBrief holding the connection
    // open. Real timers on purpose: AbortSignal.timeout runs on the runtime's
    // own timer, which a fake clock does not drive. 20 ms keeps it instant.
    const fetchImpl = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      })) as unknown as typeof fetch;

    const err = await failureOf(fetchImpl, { timeoutMs: 20 });
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('TIMEOUT (20ms)');
  });
});
