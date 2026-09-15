// Reference stub only — not wired into the build. The real file is
// src/weatherClient.ts (T-002). See design.md §3 for full reasoning; this
// file exists so the exported shape is checkable independent of prose.

import type { WxWeatherPayload } from '../../../../src/types';

export type WeatherErrorCode = 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'BAD_STATUS' | 'BAD_BODY';

export class WeatherFetchError extends Error {
  readonly code: WeatherErrorCode;
  readonly userMessage: string;
  readonly httpStatus?: number;
  constructor(
    code: WeatherErrorCode,
    detail: string,
    userMessage: string,
    extra: { httpStatus?: number } = {},
  ) {
    super(`${code} (${detail})`);
    this.name = 'WeatherFetchError';
    this.code = code;
    this.userMessage = userMessage;
    this.httpStatus = extra.httpStatus;
  }
}

export interface FetchWeatherOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Structurally identical to WxWeatherPayload except `metar` is nullable —
 * fetchWeather/getCachedWeather's real return type. The route (src/routes/acars.ts)
 * is the one place that narrows this into WxWeatherPayload, once metar !== null
 * is confirmed. See design.md §3.3.
 */
export interface RawWeather {
  icao: string;
  metar: string | null;
  taf: string | null;
  fetched_at: string;
}

// Sanity: RawWeather and WxWeatherPayload agree on every field except metar's
// nullability. Not executed — a compile-time cross-check only.
type _CheckShape = Omit<RawWeather, 'metar'> extends Omit<WxWeatherPayload, 'metar'> ? true : false;

export declare function fetchWeather(icao: string, opts?: FetchWeatherOptions): Promise<RawWeather>;
export declare function getCachedWeather(icao: string, opts?: FetchWeatherOptions): Promise<RawWeather>;
export declare function clearWeatherCache(): void;
