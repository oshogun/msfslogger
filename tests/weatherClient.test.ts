// tests/weatherClient.test.ts — the network client in src/weatherClient.ts.
//
// Scope: fetchOneProduct's full branch ladder (reached only through
// fetchWeather/getCachedWeather, since it is not exported itself), the
// METAR-fatal/TAF-degrades asymmetry in fetchWeather, and getCachedWeather's
// cache. **No test here performs a real network call**: the stub passed per
// call is the only fetch this file ever sees, and a mock's call count is the
// proof that a second lookup within the cache TTL never reached it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWeather,
  getCachedWeather,
  clearWeatherCache,
  WeatherFetchError,
  WEATHER_CACHE_TTL_MS,
} from '../src/weatherClient';
import { useFakeClock, useRealClock } from './helpers';

const RAW_FIELD: Record<'metar' | 'taf', 'rawOb' | 'rawTAF'> = { metar: 'rawOb', taf: 'rawTAF' };

function kindFromUrl(url: string): 'metar' | 'taf' {
  return new URL(url).pathname.endsWith('/taf') ? 'taf' : 'metar';
}

/** A stub that answers the same way for the METAR request and the TAF
 *  request — fetchWeather issues both, concurrently, against the same
 *  fetchImpl, so this is what "one branch of fetchOneProduct" looks like
 *  from the outside. `body` may depend on which product was asked for, so a
 *  success body can use the raw field each endpoint actually returns. */
function stubUniform(status: number, body: string | ((kind: 'metar' | 'taf') => string)): typeof fetch {
  return vi.fn(async (url: string) => {
    const kind = kindFromUrl(url);
    const b = typeof body === 'function' ? body(kind) : body;
    return { status, text: async () => b } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** A stub whose METAR and TAF behavior differ, for the asymmetry tests. */
function stubMixed(behavior: Record<'metar' | 'taf', () => Promise<Response>>): typeof fetch {
  return vi.fn(async (url: string) => behavior[kindFromUrl(url)]()) as unknown as typeof fetch;
}

function stubRejection(err: unknown): typeof fetch {
  return vi.fn(async () => {
    throw err;
  }) as unknown as typeof fetch;
}

function okBody(raw: string): (kind: 'metar' | 'taf') => string {
  return (kind) => JSON.stringify([{ [RAW_FIELD[kind]]: raw }]);
}

/** The error, or a failure if the call unexpectedly resolved. */
async function failureOf(promise: Promise<unknown>): Promise<WeatherFetchError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(WeatherFetchError);
    return err as WeatherFetchError;
  }
  throw new Error('expected the call to reject, but it resolved');
}

afterEach(() => clearWeatherCache());

describe('fetchWeather: the happy path', () => {
  it('resolves with icao, trimmed metar, trimmed taf', async () => {
    const fetchImpl = stubUniform(200, (kind) => JSON.stringify([{ [RAW_FIELD[kind]]: `  ${kind.toUpperCase()} TEXT  ` }]));
    const result = await fetchWeather('KSFO', { fetchImpl });
    expect(result.icao).toBe('KSFO');
    expect(result.metar).toBe('METAR TEXT');
    expect(result.taf).toBe('TAF TEXT');
    expect(typeof result.fetched_at).toBe('string');
  });
});

describe('fetchOneProduct: the "no current report" cases (not errors)', () => {
  it('HTTP 204 -> null', async () => {
    const result = await fetchWeather('KSFO', { fetchImpl: stubUniform(204, '') });
    expect(result.metar).toBeNull();
    expect(result.taf).toBeNull();
  });

  it('empty body on a 200 -> null', async () => {
    const result = await fetchWeather('KSFO', { fetchImpl: stubUniform(200, '') });
    expect(result.metar).toBeNull();
    expect(result.taf).toBeNull();
  });

  it('an empty JSON array -> null', async () => {
    const result = await fetchWeather('KSFO', { fetchImpl: stubUniform(200, '[]') });
    expect(result.metar).toBeNull();
    expect(result.taf).toBeNull();
  });
});

describe('fetchOneProduct: the error taxonomy', () => {
  it('HTTP 429 -> RATE_LIMITED', async () => {
    const err = await failureOf(fetchWeather('KSFO', { fetchImpl: stubUniform(429, '') }));
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.httpStatus).toBe(429);
    expect(err.userMessage).toContain('rate-limiting');
  });

  it('any other non-200 -> BAD_STATUS', async () => {
    const err = await failureOf(fetchWeather('KSFO', { fetchImpl: stubUniform(503, '') }));
    expect(err.code).toBe('BAD_STATUS');
    expect(err.httpStatus).toBe(503);
    expect(err.userMessage).toContain('HTTP 503');
  });

  it('non-JSON body on a 200 -> BAD_BODY', async () => {
    const err = await failureOf(fetchWeather('KSFO', { fetchImpl: stubUniform(200, 'not json {') }));
    expect(err.code).toBe('BAD_BODY');
    expect(err.message).toContain('first 200 chars: not json {');
  });

  it('JSON that is not an array -> BAD_BODY', async () => {
    const err = await failureOf(fetchWeather('KSFO', { fetchImpl: stubUniform(200, '{"rawOb":"x"}') }));
    expect(err.code).toBe('BAD_BODY');
  });

  it('array whose first element is missing rawOb/rawTAF -> BAD_BODY', async () => {
    const err = await failureOf(fetchWeather('KSFO', { fetchImpl: stubUniform(200, '[{}]') }));
    expect(err.code).toBe('BAD_BODY');
  });

  it('array whose first element has rawOb/rawTAF as an empty string -> BAD_BODY', async () => {
    const fetchImpl = stubUniform(200, (kind) => JSON.stringify([{ [RAW_FIELD[kind]]: '' }]));
    const err = await failureOf(fetchWeather('KSFO', { fetchImpl }));
    expect(err.code).toBe('BAD_BODY');
  });
});

describe('fetchOneProduct: network and timeout', () => {
  it('a rejected fetchImpl (TypeError) -> NETWORK', async () => {
    const err = await failureOf(fetchWeather('KSFO', { fetchImpl: stubRejection(new TypeError('fetch failed')) }));
    expect(err.code).toBe('NETWORK');
    expect(err.message).toBe('NETWORK (fetch failed)');
    expect(err.userMessage).toContain('Could not reach the weather service');
  });

  it('an AbortError/TimeoutError, direct or wrapped in a cause, -> TIMEOUT, message naming the deadline used', async () => {
    const direct = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    const err1 = await failureOf(fetchWeather('KSFO', { fetchImpl: stubRejection(direct) }));
    expect(err1.code).toBe('TIMEOUT');
    expect(err1.userMessage).toContain('did not respond within 10 seconds'); // default WEATHER_TIMEOUT_MS = 10_000

    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    });
    const err2 = await failureOf(
      fetchWeather('KSFO', { fetchImpl: stubRejection(wrapped), timeoutMs: 3000 }),
    );
    expect(err2.code).toBe('TIMEOUT');
    expect(err2.message).toBe('TIMEOUT (3000ms)');
    expect(err2.userMessage).toContain('did not respond within 3 seconds');
  });
});

describe('fetchWeather: METAR is fatal, TAF only degrades', () => {
  it('a METAR rejection fails the whole call even when TAF succeeds', async () => {
    const fetchImpl = stubMixed({
      metar: async () => {
        throw new TypeError('fetch failed');
      },
      taf: async () => ({ status: 200, text: async () => okBody('TAF OK')('taf') }) as unknown as Response,
    });
    const err = await failureOf(fetchWeather('KSFO', { fetchImpl }));
    expect(err.code).toBe('NETWORK');
  });

  it('a TAF rejection degrades to taf: null when METAR succeeds', async () => {
    const fetchImpl = stubMixed({
      metar: async () => ({ status: 200, text: async () => okBody('METAR OK')('metar') }) as unknown as Response,
      taf: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const result = await fetchWeather('KSFO', { fetchImpl });
    expect(result.metar).toBe('METAR OK');
    expect(result.taf).toBeNull();
  });
});

describe('getCachedWeather: the cache', () => {
  beforeEach(() => useFakeClock());
  afterEach(() => useRealClock());

  it('a second call within the TTL does not invoke fetchImpl again', async () => {
    const fetchImpl = stubUniform(200, okBody('TEXT'));
    const first = await getCachedWeather('KSFO', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one METAR call, one TAF call

    vi.advanceTimersByTime(WEATHER_CACHE_TTL_MS - 1000);
    const second = await getCachedWeather('KSFO', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);
  });

  it('a cached failure is replayed as a rejection without a second fetchImpl call', async () => {
    const fetchImpl = stubUniform(503, '');
    const err1 = await failureOf(getCachedWeather('KSFO', { fetchImpl }));
    expect(err1.code).toBe('BAD_STATUS');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(WEATHER_CACHE_TTL_MS - 1000);
    const err2 = await failureOf(getCachedWeather('KSFO', { fetchImpl }));
    expect(err2.code).toBe('BAD_STATUS');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('after the TTL expires, a fresh call invokes fetchImpl again', async () => {
    const fetchImpl = stubUniform(200, okBody('TEXT'));
    await getCachedWeather('KSFO', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(WEATHER_CACHE_TTL_MS + 1);
    await getCachedWeather('KSFO', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('clearWeatherCache() forces a fresh call even within the TTL', async () => {
    const fetchImpl = stubUniform(200, okBody('TEXT'));
    await getCachedWeather('KSFO', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    clearWeatherCache();
    await getCachedWeather('KSFO', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('is keyed per icao — a different station is never a cache hit for this one', async () => {
    const fetchImpl = stubUniform(200, okBody('TEXT'));
    await getCachedWeather('KSFO', { fetchImpl });
    await getCachedWeather('KJFK', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('baseUrl: WEATHER_API_BASE_URL', () => {
  const previousBase = process.env.WEATHER_API_BASE_URL;

  afterEach(() => {
    if (previousBase === undefined) delete process.env.WEATHER_API_BASE_URL;
    else process.env.WEATHER_API_BASE_URL = previousBase;
  });

  it('defaults to the real aviationweather.gov endpoint, asking for JSON', async () => {
    delete process.env.WEATHER_API_BASE_URL;
    const fetchImpl = stubUniform(200, okBody('TEXT'));
    await fetchWeather('KSFO', { fetchImpl });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.startsWith('https://aviationweather.gov/api/data/metar?'))).toBe(true);
    expect(urls.some((u) => u.startsWith('https://aviationweather.gov/api/data/taf?'))).toBe(true);
    expect(urls.every((u) => u.includes('ids=KSFO') && u.includes('format=json'))).toBe(true);
    const [, init] = calls[0];
    expect((init as RequestInit).headers).toEqual({ Accept: 'application/json' });
  });

  it('is read per call, not cached at import, so a scratch server can override it mid-run', async () => {
    const fetchImpl = stubUniform(200, okBody('TEXT'));

    process.env.WEATHER_API_BASE_URL = 'http://127.0.0.1:3101/wx';
    await fetchWeather('KSFO', { fetchImpl });
    let urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(urls.every((u) => u.startsWith('http://127.0.0.1:3101/wx/'))).toBe(true);

    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    process.env.WEATHER_API_BASE_URL = 'http://127.0.0.1:3102/wx2';
    await fetchWeather('KSFO', { fetchImpl });
    urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(urls.every((u) => u.startsWith('http://127.0.0.1:3102/wx2/'))).toBe(true);
  });
});
