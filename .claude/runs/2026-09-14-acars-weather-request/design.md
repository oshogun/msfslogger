# Design freeze — ACARS Weather Request (REQUEST WX)

Run `2026-09-14-acars-weather-request`. Task `T-001`.

This document is the contract for `T-002` (`backend_sr`) and `T-003`
(`frontend_sr`). Pull a slice with

    .claude/tools/ctx.sh design 2026-09-14-acars-weather-request 3 6

Section numbers are stable and are cited by task envelopes. Never renumber or
rename a heading; amend in place and record it in the table below.

**The numbering is internal to this document.** No `§` reference, run id, task
id, `design.md`, `plan.json` or review-file name may appear in a comment in
`src/`, `client/src/` or `tests/`. Where a decision below deserves a comment in
the code, the comment states the reasoning itself, not where it came from.

## Amendments

| # | Date | Section | What changed | Evidence that forced it |
|---|------|---------|--------------|--------------------------|
| — | —    | —       | None yet.    | —                        |

## 0. What this run builds on, and what it must not touch

This run adds one new route, one new network client module, one in-process
cache and a handful of pure helpers, on top of the substrate two prior runs
already froze:

- `acars_message_center` (`.claude/tools/ctx.sh design 2026-09-14-acars-message-center 2 3 4 5 6`)
  froze the `acars_messages` table (no migration needed here — the columns this
  run needs, `payload_json`, `correlation_id`, all already exist), the db module
  `src/db/acarsMessages.ts`, the pure module `src/acars.ts`, and the router
  `src/routes/acars.ts`. Its own row table (§3.1 there) already reserves the
  exact shapes this run fills in:

  | Message | `flight_id` | `planned_leg_id` | `direction` | `category` | `label` | `body` | `payload_json` | `correlation_id` | `dedup_key` |
  |---|---|---|---|---|---|---|---|---|---|
  | WX REQUEST `<ICAO>` | `{flight}` | `NULL` | `downlink` | `wx` | `WX REQUEST EGLL` | `"WX REQUEST EGLL"` | `{"icao"}` | `NULL` | `NULL` |
  | METAR/TAF reply | `{flight}` | `NULL` | `uplink` | `wx` | `METAR EGLL` | METAR + TAF text | `{"icao","metar","taf","fetched_at"}` | request id | `NULL` |
  | unavailable | `{flight}` | `NULL` | `uplink` | `wx` | `WX UNAVAILABLE` | `"WX DATA UNAVAILABLE FOR ZZZZ"` | `{"icao","reason"}` | request id | `NULL` |

  This design fills in exactly those three rows and does not deviate from the
  column values already frozen there.
- `acars_dispatch_loadsheet` (`.claude/tools/ctx.sh design 2026-09-14-acars-dispatch-loadsheet 5 6 7 8`)
  is the closest sibling precedent for a request/reply endpoint built on this
  substrate: a leg-scoped `POST .../loadsheet` that derives a reply from
  external data, returns both rows plus a parsed convenience payload, and
  merges by id on the client because its endpoint is idempotent. This run's
  endpoint is **not** idempotent (§5, §7) — the loadsheet's merge-by-id pattern
  is explicitly not reused; its append pattern is, instead, borrowed from the
  older canned-message action (`handleSend`, `client/src/pages/AcarsMessages.tsx:98-117`).

Per the intake's correction, this design uses `direction: 'downlink'` for the
crew-initiated request and `'uplink'` for the ground's answer — the reverse of
the story file's prose, matching the substrate's own frozen definition
(`acars_message_center` §3.2). Anyone implementing from the story text directly
would get this backwards; this document is the one to follow.

**No schema change. No migration. No new table.** Every row this run writes
goes through the existing `insertAcarsMessage()` (`src/db/acarsMessages.ts:29-53`),
unchanged.

## 1. The upstream source

### 1.1 Chosen source, and the evidence

**aviationweather.gov's public Data API**, the NOAA/NWS Aviation Weather Center
service at `https://aviationweather.gov/api/data/{metar,taf}`. No API key, no
auth header, no cookie.

Verified live against the real service on 2026-09-14 (not simulated, not taken
from documentation alone):

```
$ curl -s -w "HTTP:%{http_code} SIZE:%{size_download}\n" \
    "https://aviationweather.gov/api/data/metar?ids=KJFK&format=json"
[{"icaoId":"KJFK", ..., "rawOb":"METAR KJFK 142251Z 02013KT 10SM FEW060 22/08 A3014 RMK SLP198 T02280072 $", ...}]
HTTP:200

$ curl -sI "https://aviationweather.gov/api/data/metar?ids=KJFK&format=json"
HTTP/2 200
cache-control: max-age=60
...
(no www-authenticate, no set-cookie, no key/token echoed anywhere)
```

No request in any of the probes below carried a credential of any kind, and
none was rejected for lacking one. This matches `src/simbriefClient.ts`'s own
stance on SimBrief (`src/simbriefClient.ts:15-17`): a third-party service that
answers anyone, so nothing in this codebase may start sending it a credential.

**If this ever turns out to be wrong** — if aviationweather.gov starts
requiring a key, or its terms change to require one — that is a decision for
the Orchestrator, not something `weatherClient.ts` silently works around (e.g.
by falling back to a scraped source). Flag and stop; do not substitute a
different upstream without a new design freeze.

### 1.2 Usage / rate-limit guidance (story's non-functional requirement)

Fetched from `https://aviationweather.gov/data/api/` on 2026-09-14 (page text,
verbatim, not paraphrased):

> "Please keep requests limited in scope and frequency. Maximum results per
> query apply as well as rate limiting against frequent requests."

> "Wait between consecutive requests — maximum 100 requests per minute.
> Exceeding request limits will result in access being blocked."

> "All requests are rate limited to 100 requests per minute."

> "Consider product update frequency. For example most METARs update once per
> hour..."

> `429 Too Many Requests` — "Too many requests have been sent. You might see
> this error code when rate limits are applied."

None of this asks for a key; all of it asks for restraint, which is exactly
what §3's TTL cache provides. This is a single-operator desktop app issuing at
most one WX lookup per crew action — nowhere near 100 req/min even without the
cache — but the cache is still frozen at a few minutes (§3.3) both because the
story asks for it and because it is what the source's own guidance asks for.
`429` is handled as a distinct, named error (`RATE_LIMITED`, §3.2), not folded
into a generic failure, because it is the one status this source's own docs
call out by name and a repeat offender risks the docs' stated consequence
("access being blocked").

### 1.3 Endpoint shape and response shape, as observed

Two independent endpoints, no combined METAR+TAF call:

```
GET https://aviationweather.gov/api/data/metar?ids=<ICAO>&format=json
GET https://aviationweather.gov/api/data/taf?ids=<ICAO>&format=json
```

`ids` takes one ICAO (comma-joined for multiple; this run always sends exactly
one). `format=json` is required — the default is a mixed HTML/XML page.

Both endpoints return a **JSON array**. The raw text lives at:

- METAR: `body[0].rawOb`, e.g. `"METAR KJFK 142251Z 02013KT 10SM FEW060 22/08 A3014 RMK SLP198 T02280072 $"`.
- TAF: `body[0].rawTAF`, e.g. `"TAF KJFK 142334Z 1500/1606 01011KT P6SM SKC FM150700 ..."`.

**The two endpoints disagree on how "no data" is signalled**, confirmed with
four live probes:

| Query | Result |
|---|---|
| `metar?ids=KJFK` (real station, has METAR) | `HTTP 200`, one-element array |
| `metar?ids=ZZZZ` / `ids=XXXX` (no such station) | `HTTP 204`, **empty body** |
| `metar?ids=AB` (not even 4 characters) | `HTTP 204`, empty body — the upstream does not validate ICAO shape itself, it just finds no match |
| `taf?ids=KJFK` (has a TAF on file) | `HTTP 200`, one-element array |
| `taf?ids=KRHV` (real, METAR-only small airfield — confirmed via its own METAR query returning data) | `HTTP 200`, **`[]`** |
| `taf?ids=ZZZZ` | `HTTP 200`, `[]` |
| *(no `ids` param at all)* | `HTTP 400`, `{"status":"error","error":"Must specify station IDs..."}` — never reached: this run always supplies a non-empty, shape-validated `ids` (§4) |

`weatherClient.ts`'s parser treats both forms identically: **HTTP 204, or HTTP
200 with a JSON array of length 0, or an HTTP 200 body that is the empty string,
all mean "no current report for this product/station" — a normal, successful
outcome, not an error** (§3.2).

## 2. Type ownership for the WX contract

Two files, mirrored by hand as `AcarsMessage`/`LoadsheetRequestResponse`
already are (`acars_dispatch_loadsheet` design §7). **`src/types.ts` is the
owner; `client/src/types.ts` copies verbatim except doc-comment length.**

### 2.1 `src/types.ts` — owner (`backend_sr`, T-002)

Append to the existing `── ACARS ──` block, after `LoadsheetRequestResponse`
and before `AcarsErrorBody`:

```ts
/** POST /api/flights/:id/acars-messages/wx request body. */
export interface RequestWxRequest {
  /** Any string; validated server-side (see isValidIcaoShape in src/acars.ts). */
  icao: string;
}

/**
 * The machine-readable twin of a successful WX reply's payload_json, and
 * weatherClient.ts's own return type — the raw METAR/TAF response maps
 * directly onto this shape, so no second struct exists for the same data.
 */
export interface WxWeatherPayload {
  /** Normalised (trimmed, uppercased) — never the caller's raw casing. */
  icao: string;
  /** Raw METAR text, e.g. "METAR KJFK 142251Z 02013KT 10SM FEW060 22/08 A3014". */
  metar: string;
  /** Raw TAF text, or null — a station with no TAF on file is not an error (§1.3). */
  taf: string | null;
  /** ISO 8601 UTC instant: when this fetch (or cache fill) happened. */
  fetched_at: string;
}

/** Why a WX reply is the rejection rather than the metar/taf reply. */
export type WxUnavailableReason =
  | 'NO_DATA'       // well-formed ICAO, upstream has no current METAR for it
  | 'NETWORK'       // could not reach the upstream at all
  | 'TIMEOUT'       // upstream did not respond in time
  | 'RATE_LIMITED'  // upstream answered 429
  | 'BAD_STATUS'    // upstream answered an unexpected non-2xx/204 status
  | 'BAD_BODY';     // upstream answered 200 with a body this client could not read

/** The machine-readable twin of a WX rejection reply's payload_json. */
export interface WxUnavailablePayload {
  icao: string;
  reason: WxUnavailableReason;
}

/** POST /api/flights/:id/acars-messages/wx 201 body. */
export interface WxRequestResponse {
  flight_id: number;
  /** Normalised (trimmed, uppercased) ICAO actually looked up. */
  icao: string;
  /** true when `reply` carries METAR/TAF text; false when it is the rejection. */
  available: boolean;
  /** direction 'downlink', label `WX REQUEST <ICAO>`. */
  request: AcarsMessage;
  /** direction 'uplink'; label 'METAR <ICAO>' when available, 'WX UNAVAILABLE' otherwise. */
  reply: AcarsMessage;
  /** The parsed convenience payload, present iff available === true. Mirrors reply.payload_json. */
  weather: WxWeatherPayload | null;
}
```

And **extend** the existing `AcarsErrorBody.code` union (`src/types.ts:521-528`),
the one edit to an existing type in this file:

```ts
  code:
    | 'INVALID_ID' | 'FLIGHT_NOT_FOUND' | 'INVALID_BODY'
    | 'UNKNOWN_CANNED_MESSAGE' | 'NOT_A_CANNED_MESSAGE'
    | 'DIRECTION_NOT_PERMITTED' | 'CATEGORY_NOT_PERMITTED'
    | 'PLANNED_LEG_NOT_FOUND' | 'NO_DISPATCH_DATA'
    | 'INVALID_ICAO';
```

(`'INVALID_ICAO'` is new this run; the rest already exist from the two prior
runs and are listed here so the union stays complete in one place.)

Machine-readable stub: `.claude/runs/2026-09-14-acars-weather-request/contracts/types.server.ts`.

### 2.2 `client/src/types.ts` — mirror (`frontend_sr`, T-003)

Append to the client's `── ACARS ──` block:

- `WxWeatherPayload` — verbatim.
- `WxUnavailableReason` — verbatim.
- `WxRequestResponse` — verbatim.

**Not mirrored:** `RequestWxRequest` (the client builds its POST body inline,
`JSON.stringify({ icao })`, the same way `handleSend` already inlines
`{ canned_id: cannedId }` without importing `SendCannedAcarsMessageRequest`
— §5.1 of this doc) and `WxUnavailablePayload` (nothing client-side parses a
rejection's `payload_json`; the reply's `body` text is already what the thread
renders, following the same reasoning `acars_dispatch_loadsheet` design §7.2
gave for not mirroring `DispatchPayload`: a type with no client reader is a
maintenance cost with no consumer).

`AcarsErrorBody` does not exist client-side (unchanged from the prior run):
`apiFetch` surfaces `error` as `Error.message` and the client never branches on
`code`.

Machine-readable stub: `.claude/runs/2026-09-14-acars-weather-request/contracts/types.client.ts`.

## 3. `src/weatherClient.ts` (new file, T-002)

Modelled on `src/simbriefClient.ts`: the only module in the tree that talks to
aviationweather.gov, owns the network and nothing else — no database, no
express, no ACARS vocabulary. Header comment states this and cites §1.1's "no
credential" finding, in the style of `src/simbriefClient.ts:1-17`.

### 3.1 Exports, frozen

```ts
export type WeatherErrorCode =
  | 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'BAD_STATUS' | 'BAD_BODY';

/**
 * Thrown by fetchWeather/getCachedWeather, and the only thing either throws.
 * Modelled on SimbriefFetchError (src/simbriefClient.ts:35-56): `message` is
 * for the log; `userMessage` is written for a human and never contains a URL
 * or an ICAO the operator didn't already type.
 *
 * No `upstreamStatus` field: unlike SimBrief, aviationweather.gov does not
 * embed a machine-readable verdict string in its body (§1.3) — httpStatus is
 * the only signal there is.
 */
export class WeatherFetchError extends Error {
  readonly code: WeatherErrorCode;
  readonly userMessage: string;
  readonly httpStatus?: number;
  constructor(
    code: WeatherErrorCode,
    detail: string,
    userMessage: string,
    extra?: { httpStatus?: number },
  );
}

export interface FetchWeatherOptions {
  /** Injected by tests and by nothing else — see FetchSimbriefPlanOptions. */
  fetchImpl?: typeof fetch;
  /** Applies independently to the METAR fetch and the TAF fetch (§3.4). */
  timeoutMs?: number;
}

/**
 * Frozen: 5 minutes. "A few minutes" per the story; comfortably inside
 * METAR's ~1/hour and TAF's ~10-minute update cadence (§1.2), and short
 * enough that a crew re-requesting the same station mid-approach still gets a
 * report from within the same flight phase.
 */
export const WEATHER_CACHE_TTL_MS: number;

/**
 * Structurally identical to WxWeatherPayload (src/types.ts, §2.1) except
 * `metar` is nullable. fetchWeather/getCachedWeather return this, not
 * WxWeatherPayload directly, because a fetch can genuinely succeed with no
 * current METAR for the station (§1.3's "success paths" table) — that is not
 * an error this module throws, but it is also not the shape a stored,
 * available WX reply uses. src/routes/acars.ts (§5.3) is the one place that
 * narrows RawWeather into WxWeatherPayload, once `metar !== null` is
 * confirmed, and it imports this interface rather than redeclaring it.
 */
export interface RawWeather {
  icao: string;
  metar: string | null;
  taf: string | null;
  fetched_at: string;
}

/**
 * The uncached network call. Always hits aviationweather.gov: fetches METAR
 * and TAF for `icao` concurrently (§3.4) and returns the merged result, or
 * throws WeatherFetchError.
 *
 * CONTRACT: `icao` must already be normalised (trimmed, uppercased) and
 * shape-validated by the caller (src/acars.ts's isValidIcaoShape, §4.1). This
 * function does neither — it treats `icao` as an opaque string, exactly as
 * fetchSimbriefPlan treats `userId` (src/simbriefClient.ts:118-121). A
 * malformed icao is not this module's problem to reject; §5's route rejects
 * it before this module is ever called.
 */
export async function fetchWeather(
  icao: string,
  opts?: FetchWeatherOptions,
): Promise<RawWeather>;

/**
 * The cache-aware entry point, and the only one src/routes/acars.ts calls.
 * On a cache hit (§3.5), returns/throws the cached outcome WITHOUT calling
 * fetchWeather at all — so opts.fetchImpl is not invoked a second time. On a
 * miss, calls fetchWeather, and caches whatever it returns OR throws.
 */
export async function getCachedWeather(
  icao: string,
  opts?: FetchWeatherOptions,
): Promise<RawWeather>;

/** Test-only reset of the module-level cache. Not called by production code. */
export function clearWeatherCache(): void;
```

`WxWeatherPayload` is imported only as a type-check anchor
(`import type { WxWeatherPayload } from './types';`) — see §2.1's note that
`RawWeather` is deliberately shaped to match it field-for-field.

### 3.2 Error taxonomy, exactly

One internal helper, `fetchOneProduct(kind: 'metar' | 'taf', icao, opts)`,
shared by both products, returns `Promise<string | null>` (the raw text, or
`null` meaning "no current report") and throws `WeatherFetchError` for every
case in this table:

| Condition | Code | `httpStatus` | userMessage |
|---|---|---|---|
| `fetchImpl` throws, `AbortSignal` fired (same `isAbort()` helper as `src/simbriefClient.ts:104-109`) | `TIMEOUT` | — | "The weather service did not respond within `<timeoutMs / 1000>` seconds. Try again in a moment." |
| `fetchImpl` throws, not an abort | `NETWORK` | — | "Could not reach the weather service. Check your internet connection and try again." |
| response received, `res.status === 429` | `RATE_LIMITED` | `429` | "The weather service is rate-limiting requests right now. Try again in a minute." |
| response received, status is not `200` and not `204` and not `429` | `BAD_STATUS` | that status | "The weather service returned an error (HTTP `<status>`). Try again in a moment." |
| `res.text()` itself throws | `NETWORK` | that status | same as the plain NETWORK message |
| status `200`, body is not valid JSON, or is JSON but not an array | `BAD_BODY` | `200` | "The weather service returned a response this app could not read." |
| status `200`, array has ≥ 1 element, but element `[0]` lacks a string `rawOb` (metar) / `rawTAF` (taf) | `BAD_BODY` | `200` | same as above |

Success paths, **not errors**:

| Condition | Result |
|---|---|
| `res.status === 204` | `null` |
| status `200`, body text is the empty string | `null` (defensive: matches the "no content" case even if a future response uses `200` + empty body instead of `204`) |
| status `200`, valid JSON array, length `0` | `null` |
| status `200`, valid JSON array, `[0].rawOb` / `[0].rawTAF` is a non-empty string | that string, `.trim()`'d |

### 3.3 `fetchWeather`, assembled

```ts
export async function fetchWeather(icao: string, opts: FetchWeatherOptions = {}): Promise<RawWeather> {
  const [metarSettled, tafSettled] = await Promise.allSettled([
    fetchOneProduct('metar', icao, opts),
    fetchOneProduct('taf', icao, opts),
  ]);

  // METAR failure is fatal: METAR is the product AC1 is about, and the story
  // has no notion of a WX reply carrying only a TAF.
  if (metarSettled.status === 'rejected') throw metarSettled.reason;
  const metar = metarSettled.value; // string | null — null means "no current METAR", not a bug

  // TAF failure degrades to null, exactly like "this station has no TAF on
  // file" (§1.3) — the story asks for TAF only "where available", and a
  // flaky TAF fetch is not a reason to fail a request that has a good METAR.
  const taf = tafSettled.status === 'fulfilled' ? tafSettled.value : null;

  return {
    icao,   // already normalised by the caller — see the CONTRACT note, §3.1
    metar,  // string | null — the route (§5.3) decides what a null metar means
    taf,
    fetched_at: new Date().toISOString(),
  };
}
```

The return type is `RawWeather` (§3.1), not `WxWeatherPayload` — `metar` stays
nullable all the way out of this module, because "no current METAR for this
ICAO" is a legitimate, successful result (§1.3), not something `weatherClient.ts`
is in a position to classify as "unavailable." That classification happens
once, in the route (§5.3), which is the only place a `RawWeather` with a
non-null `metar` is narrowed into a stored `WxWeatherPayload`.

### 3.4 Concurrency and timeout

METAR and TAF are fetched **concurrently** (`Promise.allSettled`, §3.3), not
sequentially — total worst-case latency for a WX request is one `timeoutMs`,
not two. `timeoutMs` defaults to **10 000 ms** per product: real captures
(§1.1) returned in ~1.7 s; 10 s leaves ample margin for a slow link while still
answering AC1's "within a reasonable time" — SimBrief's 20 s (`src/simbriefClient.ts:71`)
is generous for an OFP regeneration, which this is not.

Each product's `fetch` call uses `AbortSignal.timeout(timeoutMs)`, the same
idiom as `src/simbriefClient.ts:134`.

### 3.5 The cache, exactly

```ts
interface CacheEntry {
  expiresAt: number;              // Date.now() reading at insert + WEATHER_CACHE_TTL_MS
  result: RawWeather | null;      // set on a successful fetchWeather
  error: WeatherFetchError | null; // set when fetchWeather threw
}
const cache = new Map<string, CacheEntry>(); // key: the normalised icao, as given
```

`getCachedWeather(icao, opts)`:

1. `const now = Date.now();`
2. If `cache.has(icao)` and `cache.get(icao)!.expiresAt > now`: **cache hit.**
   Re-throw the cached `error` if set, else return the cached `result`.
   `fetchWeather` is **not called**, so `opts.fetchImpl` is **not invoked**.
3. Otherwise (**miss** — absent, or `expiresAt <= now`): call
   `fetchWeather(icao, opts)`. On success, `cache.set(icao, { expiresAt: now + WEATHER_CACHE_TTL_MS, result, error: null })`, return `result`.
   On throw, wrap in a `WeatherFetchError` if it is not already one, `cache.set(icao, { expiresAt: now + WEATHER_CACHE_TTL_MS, result: null, error })`, re-throw.

**Frozen: failures are cached too, for the same TTL as successes.** A crew
that re-requests weather for a currently-unfetchable ICAO (upstream down, or a
station with genuinely no data) must not re-hit the upstream on every retry
within the window — the story's "avoid hammering the upstream" applies to a
failing lookup exactly as much as a succeeding one, and every REQUEST WX press
still writes a fresh pair of messages regardless (§0's row table, §5.4) so the
crew still sees an answer each time. §7 records the alternative (cache
successes only) and why it was rejected.

**Definition of a cache "hit," precisely, for AC3:** a second
`getCachedWeather(icao, opts)` call for the same `icao` string, made before
`expiresAt`, produces zero additional invocations of `opts.fetchImpl`. This is
directly assertable: call `getCachedWeather` twice with the same
`fetchImpl: vi.fn(...)`, and require
`(fetchImpl as Mock).mock.calls.length` to be identical after the second call
as after the first (not "grew by one" — by **zero**, since a single
`fetchWeather` call issues two `fetchImpl` invocations, one per product, so a
hit must add none of either). Time is advanced with `vi.useFakeTimers()` /
`vi.setSystemTime()` (which `Date.now()` reads directly, no clock injection
needed — the same fake-clock convention `.claude/ENVIRONMENT.md` names for the
rest of the suite) to place the second call inside and then outside the
window, proving both the hit and the eviction. `AbortSignal.timeout` is not
exercised by a stub `fetchImpl` that resolves immediately, so this does not
collide with `src/simbriefClient.ts`'s own use of **real** timers for its one
genuine timeout test (`tests/simbriefClient.test.ts:201-208`) — a
`weatherClient` timeout test, if written, follows that same real-timer
pattern in its own test, isolated from the fake-timer cache tests.

`clearWeatherCache()` exists purely so each test file starts cold; call it in
a `beforeEach`.

### 3.6 Overridable base URL

Same seam as `src/simbriefClient.ts:76-85`, for a scratch server to point at a
stub instead of the real service:

```ts
const WEATHER_API_BASE_URL_DEFAULT = 'https://aviationweather.gov/api/data';
function baseUrl(): string {
  return process.env.WEATHER_API_BASE_URL ?? WEATHER_API_BASE_URL_DEFAULT;
}
function productUrl(kind: 'metar' | 'taf', icao: string): URL {
  const url = new URL(`${baseUrl()}/${kind}`);
  url.searchParams.set('ids', icao);
  url.searchParams.set('format', 'json');
  return url;
}
```

`kind` is always one of the two string literals this module writes, never
request input, so building the path by template literal (rather than
`URL`/`searchParams` alone, as `src/simbriefClient.ts:127` does for the whole
URL) is safe; the *parameter* (`ids`) still goes through `searchParams.set`,
never concatenation. `WEATHER_API_BASE_URL` is a test seam, not part of
`src/config.ts`'s `ENV_VARS` — same reasoning as `SIMBRIEF_API_BASE_URL`
(`src/simbriefClient.ts:81-85`).

## 4. `src/acars.ts` additions (T-002)

Same purity guarantee as the rest of the file (`acars_message_center` design
§6.1): no database, no express, no I/O, no clock. `issuedAt` stays a parameter
everywhere, as it already is for the loadsheet builders.

### 4.1 ICAO shape validation — new here, not reused from `src/airports.ts`

**Confirmed: `src/airports.ts` exports no standalone ICAO validator.** Its only
shape check is the inline `icao.length !== 4 || !/^[A-Z0-9]{4}$/.test(icao)`
at `src/airports.ts:73`, embedded inside `parseCSV()` and not exported —
reusing it would mean importing a CSV-parsing module (which also pulls in
`https`/`http`/`fs`, breaking `src/acars.ts`'s purity guarantee, §6.1 of the
message-center design) for one regex. This run defines its own, in
`src/acars.ts`:

```ts
/** Trim, then uppercase. The one normalisation applied before validation,
 *  caching (weatherClient's cache key), and storage (the request/reply body
 *  and label both interpolate this normalised form, never the raw input). */
export function normaliseIcao(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Shape, matching the regex src/airports.ts uses internally (not exported
 *  there) for the same four-character alphanumeric ICAO shape. Applied to an
 *  ALREADY-normalised string — call normaliseIcao() first. */
export function isValidIcaoShape(v: string): boolean {
  return /^[A-Z0-9]{4}$/.test(v);
}
```

`isValidIcaoShape` takes a plain `string`, not `unknown`: the route (§5.2)
does its own `typeof` check on the request body before calling either
function, matching the existing style of `isAcarsDirection`/`isValidAcarsCategory`
taking `unknown` only where the caller genuinely doesn't know the type yet — here
the caller has already confirmed a string.

### 4.2 WX message builders

```ts
export const WX_UNAVAILABLE_LABEL = 'WX UNAVAILABLE';

/** 'WX REQUEST EGLL' — both the request row's label and its body, verbatim. */
export function wxRequestLabelAndBody(icao: string): string {
  return `WX REQUEST ${icao}`;
}

/** 'METAR EGLL' — the reply row's label when weather was found, regardless of
 *  whether a TAF was also found. */
export function wxReplyLabel(icao: string): string {
  return `METAR ${icao}`;
}

/** metar, or metar + '\n' + taf when a TAF was found. Never adds a TAF header
 *  line: the raw METAR and TAF text are each already self-identifying
 *  ("METAR KJFK...", "TAF KJFK..."). */
export function buildWxReplyBody(metar: string, taf: string | null): string {
  return taf !== null ? `${metar}\n${taf}` : metar;
}

/** 'WX DATA UNAVAILABLE FOR ZZZZ' — the one definition of this literal
 *  string, matching the story's AC2 wording exactly. */
export function buildWxUnavailableBody(icao: string): string {
  return `WX DATA UNAVAILABLE FOR ${icao}`;
}
```

No dedup key for any WX row — matching the message-center's own row table
(§0): a WX request/reply pair is filed fresh on every call, never deduplicated
by `insertAcarsMessageOnce`. `category: 'wx'` on both rows (already a member of
`KNOWN_ACARS_CATEGORIES`, `src/acars.ts:21-23` — no change needed there).

## 5. API surface: `POST /api/flights/:id/acars-messages/wx`

New handler in the existing `src/routes/acars.ts`, inside `createAcarsRouter()`,
after the existing `POST /flights/:id/acars-messages` handler and before the
`POST /planned-legs/:legId/acars-messages/loadsheet` handler (flight-scoped
routes grouped together, ahead of the leg-scoped one — no functional
requirement forces this order, it is purely so the file reads
flight-scoped-then-leg-scoped, matching its own two path prefixes).

Sibling to the existing `POST /flights/:id/acars-messages` (§0), *not* to the
leg-scoped loadsheet route: weather is flight-scoped because a crew can
request weather for any ICAO — an alternate, a diversion field — not
necessarily the linked leg's departure or destination (intake, "Goal").

### 5.1 Request

```
POST /api/flights/:id/acars-messages/wx
Content-Type: application/json

{ "icao": "EGLL" }
```

`icao` is the only key read; any other key is ignored (matching §5.3 of the
message-center design's stance on `PUT /api/settings/simbrief`). Casing and
surrounding whitespace do not matter — the handler normalises before
validating (§5.2).

### 5.2 Validation order, frozen

1. `const id = parseInt(req.params.id, 10)`; `isNaN(id)` → `400 {"error":"Invalid id","code":"INVALID_ID"}`. **No row written.**
2. `getFlightById(id)` missing → `404 {"error":"Flight <id> not found","code":"FLIGHT_NOT_FOUND"}`. **No row written.**
3. Body is not a JSON object, or `body.icao` is not a string, or
   `body.icao.trim() === ''` → `400 {"error":"icao is required","code":"INVALID_BODY"}`.
   **No row written.**
4. `const icao = normaliseIcao(body.icao as string);` then
   `isValidIcaoShape(icao)` false → `400 {"error":"icao must be 4 letters or digits (e.g. EGLL)","code":"INVALID_ICAO"}`.
   **No row written.** This is the intake's resolved distinction, verbatim: "a
   typo is not a WX request the crew made" — a malformed ICAO never reaches the
   thread at all, unlike a well-formed one the upstream can't answer (step 6).
5. Only past this point does anything get written. The downlink request row is
   inserted **unconditionally** once `icao` passes step 4 — regardless of
   whether the upstream lookup that follows succeeds, finds nothing, or fails.
6. `await getCachedWeather(icao, { fetchImpl: <test seam, else omitted> })` —
   see §5.3 for what happens with the result.
7. Anything thrown that is *not* a `WeatherFetchError` (a genuine bug, not a
   modeled upstream failure) → `500 {"error":"<String(err)>"}`, in the
   `try/catch` style of every other handler in this router. A `WeatherFetchError`
   is caught **inside** the handler and turned into the rejection reply
   (§5.3) — it never reaches this catch-all.

### 5.3 The two branches after a well-formed ICAO, exactly

```ts
const issuedAt = new Date().toISOString();
const requestMessage = insertAcarsMessage({
  flight_id: id,
  direction: 'downlink',
  category: 'wx',
  label: wxRequestLabelAndBody(icao),
  body: wxRequestLabelAndBody(icao),
  payload_json: JSON.stringify({ icao }),
  sent_at: issuedAt,
});

let available: boolean;
let replyMessage: AcarsMessage;
let weather: WxWeatherPayload | null;

try {
  const raw = await getCachedWeather(icao, opts); // RawWeather: metar: string | null
  if (raw.metar === null) {
    // Well-formed ICAO, upstream has nothing for it — a feature outcome, not
    // a thrown error (§1.3's "success paths" table).
    available = false;
    weather = null;
    replyMessage = insertAcarsMessage({
      flight_id: id, direction: 'uplink', category: 'wx',
      label: WX_UNAVAILABLE_LABEL, body: buildWxUnavailableBody(icao),
      payload_json: JSON.stringify({ icao, reason: 'NO_DATA' }),
      correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
    });
  } else {
    available = true;
    weather = { icao, metar: raw.metar, taf: raw.taf, fetched_at: raw.fetched_at };
    replyMessage = insertAcarsMessage({
      flight_id: id, direction: 'uplink', category: 'wx',
      label: wxReplyLabel(icao), body: buildWxReplyBody(raw.metar, raw.taf),
      payload_json: JSON.stringify(weather),
      correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
    });
  }
} catch (err) {
  if (!(err instanceof WeatherFetchError)) throw err; // → the route's 500 (§5.2 step 7)
  available = false;
  weather = null;
  replyMessage = insertAcarsMessage({
    flight_id: id, direction: 'uplink', category: 'wx',
    label: WX_UNAVAILABLE_LABEL, body: buildWxUnavailableBody(icao),
    payload_json: JSON.stringify({ icao, reason: err.code }),
    correlation_id: requestMessage.id, sent_at: new Date().toISOString(),
  });
}

const responseBody: WxRequestResponse = {
  flight_id: id, icao, available, request: requestMessage, reply: replyMessage, weather,
};
res.status(201).json(responseBody);
```

`reason` in the rejection's `payload_json` is exactly `WeatherFetchError.code`
(`'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'BAD_STATUS' | 'BAD_BODY'`) on a
thrown failure, or the literal `'NO_DATA'` on a clean "nothing found" result —
together the full `WxUnavailableReason` union (§2.1), so a reviewer can
enumerate every value this field ever takes by reading that one type.

**Status is always `201`, never `200` or `409`.** Unlike the loadsheet route
(idempotent, §0), this endpoint has no dedup key and therefore no "already
existed" case — every accepted call inserts exactly two brand-new rows, and
both "METAR found" and "no data" are successful, request-was-processed
outcomes (intake: "a 200/201... this is a feature outcome, not a server
error"). `201` was picked over `200` because two rows were, in fact, just
created — matching the existing `POST /flights/:id/acars-messages`'s `201`
(§0) for the same reason.

### 5.4 Rejections table

| Case | Status | Body | Row(s) written |
|---|---|---|---|
| `:id` not an integer | `400` | `{"error":"Invalid id","code":"INVALID_ID"}` | none |
| flight not found | `404` | `{"error":"Flight <id> not found","code":"FLIGHT_NOT_FOUND"}` | none |
| body not an object / `icao` missing, not a string, or blank | `400` | `{"error":"icao is required","code":"INVALID_BODY"}` | none |
| `icao` well-formed length/charset check fails | `400` | `{"error":"icao must be 4 letters or digits (e.g. EGLL)","code":"INVALID_ICAO"}` | none |
| well-formed `icao`, upstream has no METAR | `201` | `WxRequestResponse`, `available: false` | request + rejection reply |
| well-formed `icao`, fetch throws `WeatherFetchError` | `201` | `WxRequestResponse`, `available: false` | request + rejection reply |
| well-formed `icao`, weather found | `201` | `WxRequestResponse`, `available: true` | request + metar/taf reply |
| No session | `401` | `{"error":"Authentication required"}` — the existing gate, unchanged | none |
| Anything else thrown | `500` | `{"error":"<String(err)>"}` | request row may already be written (step 5 precedes this catch); the reply is not — a genuine bug here leaves an unanswered request in the thread, which is honest: the crew asked and the ground never came back, same as SimBrief's own '500' path leaves no partial state anywhere else in this codebase |

### 5.5 Malformed-JSON-body handling — one additive edit to `src/server.ts`

`src/server.ts:187-188`'s existing predicate,

```ts
if (err instanceof SyntaxError && 'body' in err &&
    (req.path.startsWith('/api/settings/') || req.path.endsWith('/acars-messages'))) {
```

does **not** match this route's path (`/api/flights/81/acars-messages/wx` ends
with `/wx`, not `/acars-messages`), so a malformed JSON body sent to this
endpoint would currently fall through to Express's default HTML error page
instead of the frozen `INVALID_BODY` JSON. **Frozen fix, additive, one line:**

```ts
if (err instanceof SyntaxError && 'body' in err &&
    (req.path.startsWith('/api/settings/') ||
     req.path.endsWith('/acars-messages') ||
     req.path.endsWith('/acars-messages/wx'))) {
```

The `/api/settings/` and `/acars-messages` arms are untouched; only the new
arm is added. No other line of `src/server.ts` changes — the router mount for
`createAcarsRouter()` (`src/server.ts:157`) needs no edit, since the new route
is registered inside the same router the mount already wires up.

## 6. Client contract — `client/src/pages/AcarsMessages.tsx` (T-003)

The MCDU client (`oshogun/msfslogger_mcdu`) is out of scope; this section is
the web page only.

### 6.1 New data dependency: the linked leg's departure/destination

The page currently holds only `plannedLegId: number | null` (from the thread
response, `client/src/pages/AcarsMessages.tsx:54,81`) — a number, no ICAO
strings. **Frozen: fetch `GET /api/planned-legs/:legId` when `plannedLegId` is
non-null**, the exact endpoint and pattern `client/src/pages/FlightDetail.tsx:83-111`
already uses for the same kind of lookup (`apiFetch<PlannedLegWithChildren>('/api/planned-legs/' + legId)`).
**No server change** — this endpoint already exists and already returns
`departure_ident`, `departure_is_airport`, `destination_ident`,
`destination_is_airport` (`src/types.ts:132-149`).

New state:

```ts
const [plannedLeg, setPlannedLeg] = useState<PlannedLegWithChildren | null>(null);
```

New effect, keyed on `plannedLegId` (mirrors `FlightDetail.tsx:83-111`, but
needs none of its trip-name lookup — this page only reads the two ICAO
fields):

```ts
useEffect(() => {
  if (plannedLegId === null) { setPlannedLeg(null); return; }
  let cancelled = false;
  apiFetch<PlannedLegWithChildren>(`/api/planned-legs/${plannedLegId}`)
    .then(leg => { if (!cancelled) setPlannedLeg(leg); })
    .catch(err => {
      // Convenience-only lookup: a failure here means no suggested ICAO, not
      // a page error. UnauthorizedError still bounces via apiFetch itself;
      // anything else is swallowed silently — the quick-fill buttons simply
      // don't render (§6.2), same as a non-airport waypoint would.
      if (!(err instanceof UnauthorizedError)) setPlannedLeg(null);
    });
  return () => { cancelled = true; };
}, [plannedLegId]);
```

### 6.2 The default-ICAO affordance, exactly

**One text input plus up to two quick-fill buttons**, not two standalone
action buttons — because the user flow (`user_stories/acars_weather_request.md`,
"Selects 'REQUEST WX,' optionally overriding the suggested ICAO") describes one
action with an editable, pre-filled value, not a choice between two fixed
airports.

```tsx
const [wxIcao, setWxIcao] = useState('');

// Re-derive the default whenever the leg (or its absence) changes — but only
// while the user has not already typed something, so a fetched leg cannot
// clobber mid-edit input.
useEffect(() => {
  if (wxIcao !== '') return;
  if (plannedLeg?.destination_is_airport) setWxIcao(plannedLeg.destination_ident);
  else if (plannedLeg?.departure_is_airport) setWxIcao(plannedLeg.departure_ident);
}, [plannedLeg]);
```

Gating table for AC4, exact:

| `departure_is_airport` | `destination_is_airport` | Input's initial value | Quick-fill buttons shown |
|---|---|---|---|
| 1 | 1 | destination's ICAO | both: departure's ICAO, destination's ICAO |
| 1 | 0 | departure's ICAO | departure's ICAO only |
| 0 | 1 | destination's ICAO | destination's ICAO only |
| 0 | 0 | `''` (empty) | none — "a non-airport waypoint has no ICAO to suggest" |
| `plannedLeg === null` (no linked leg, or the lookup failed/is still loading) | — | `''` (empty) | none |

Destination is preferred over departure as the *default* text because arrival
weather is what a crew mid-flight most often wants; departure is still one
click away via its own quick-fill button whenever it's an airport. A quick-fill
button is rendered even when its ICAO already matches the current input
(clicking it is then a harmless no-op) — simpler than tracking "which one is
currently selected," and there is no visible difference to the user.

Quick-fill buttons **only ever set `wxIcao`**; they never submit. This is what
makes "optionally overriding" natural: type over the input, or click the other
button, or clear it and type an alternate's ICAO — the user flow's step 4
("re-request another airport... without leaving the page").

**REQUEST WX is never gated by `plannedLegId`.** Unlike `REQUEST LOADSHEET`
(disabled when `plannedLegId === null`, `client/src/pages/AcarsMessages.tsx:200-201`),
weather has no leg dependency at all (§0, §5): the button is enabled whenever
`sendingId === null` and the current input, trimmed and uppercased, is 4
alphanumeric characters (a client-side mirror of `isValidIcaoShape`, inlined —
see §6.4 — purely to grey out an obviously-invalid submission; the server is
still the authority and answers a bad one with `400 INVALID_ICAO` regardless).

### 6.3 Sending the request and merging the result

```ts
const WX_SENDING_ID = 'wx';

async function handleRequestWx() {
  const icao = wxIcao.trim().toUpperCase();
  setSendingId(WX_SENDING_ID);
  setSendError('');
  try {
    const response = await apiFetch<WxRequestResponse>(`/api/flights/${id}/acars-messages/wx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icao }),
    });
    // Every accepted call creates two brand-new rows (§5.3 of the design) —
    // never rows already in state, unlike the loadsheet's re-request. A plain
    // append is correct here, the same shape as handleSend's canned-message
    // append (AcarsMessages.tsx:110), not the loadsheet's merge-by-id.
    setMessages(prev => [...prev, response.request, response.reply]);
  } catch (err) {
    if (err instanceof UnauthorizedError) return;
    setSendError((err as Error).message);
  } finally {
    setSendingId(null);
  }
}
```

`wxIcao` is **left as-is** after a send (not cleared, not reset to the
suggested default) — the user flow's "re-request another airport" is served
just as well by editing the existing value as by retyping from scratch, and
leaving it matches the real MCDU behaviour of a scratchpad that persists until
overwritten. Existing `sendError`/`sendingId` state is reused, not duplicated —
`REQUEST WX`'s own gating (§6.2) already ensures a second send cannot start
while one is in flight, the same invariant every other action in this
component already relies on.

### 6.4 Placement and client-side shape check

Rendered in the existing `.acars-send` row (`AcarsMessages.tsx:186-207`),
after the `REQUEST LOADSHEET` button: the input, then any quick-fill buttons,
then the `REQUEST WX` submit button. No new CSS class — `btn btn-ghost` for the
buttons, the existing text-input styling (none is currently used elsewhere on
this page; a plain `<input>` with no additional class is acceptable, since the
page has no existing input to match against).

```ts
function isPlausibleIcao(v: string): boolean {
  return /^[A-Za-z0-9]{4}$/.test(v.trim());
}
```

Inlined in the component, **not** imported from anywhere — the server owns
validation (§5.2); this is UX polish only, exactly as no client-side mirror of
`isValidAcarsCategory` exists today.

## 7. Alternatives considered

| Option | Why not |
|---|---|
| Cache successes only, always re-fetch on a prior failure | Defeats the "avoid hammering" goal for the one case (a flaky or down upstream) where hammering is most likely to actually happen; §3.5 caches both, for the same TTL. |
| A combined METAR+TAF upstream call | aviationweather.gov's Data API has no such endpoint (§1.3) — `/api/data/metar` and `/api/data/taf` are the only two, confirmed live. |
| Fail the whole WX request when the TAF fetch fails but METAR succeeds | Contradicts the story's own "and, where available, TAF" wording and AC1, which only requires METAR; §3.3 degrades a TAF-only failure to `taf: null`, indistinguishable from "this station files no TAF." |
| Dedupe *in-flight* concurrent requests for the same ICAO (a promise cache, not just a completed-result cache) | AC3 is phrased as "requesting... twice... within the cache window," i.e. sequential, not concurrent; a promise cache is real complexity (races, cleanup on rejection) for a scenario this single-operator desktop app is unlikely to hit. Accepted as a known gap, not a silent one. |
| Leg-scoped endpoint (`POST /planned-legs/:legId/acars-messages/wx`), matching the loadsheet's own scope | The intake's own resolution: weather isn't tied to a specific leg's dispatch data, and a crew can ask about an alternate that isn't the leg's departure or destination at all — flight-scoped is the only scope that doesn't arbitrarily privilege one ICAO. |
| Two separate quick-fill buttons as the entire UI (no free-text input) | Fails "an alternate" from the user flow — a crew must be able to type an ICAO that is neither the departure nor the destination. |
| `insertAcarsMessageOnce` + a dedup key derived from `(flight_id, icao, time-bucket)` | The message-center's own row table (§0) already specifies `dedup_key: NULL` for every wx row — every request is logged, deliberately, even a repeat; only the network call is deduped, by the cache, not the database. Inventing a dedup key here would contradict a decision already frozen upstream of this run. |
| `200` for the "no data"/rejection outcome, `201` only for a found METAR | Both are the same shape of event from the server's perspective — two new rows inserted — and splitting the status code by outcome content would make a client branch on HTTP status to learn something already in the body (`available`). |

## 8. Must-not-change list

The Reviewer checks each of these against the diff:

- `acars_messages` schema (`src/db/schema.ts`) — **no migration, no new column,
  no new index.** This run's rows use only columns already shipped by
  `acars_message_center`.
- `src/db/acarsMessages.ts` — **no exported function's signature changes.**
  This run calls `insertAcarsMessage` exactly as it exists today
  (`src/db/acarsMessages.ts:29-53`); it does not need
  `insertAcarsMessageOnce`, `findAcarsMessageByDedupKey`, or any new db
  function.
- The existing three ACARS routes (`GET`/`POST /flights/:id/acars-messages`,
  `GET /acars/canned-messages`) and the loadsheet route
  (`POST /planned-legs/:legId/acars-messages/loadsheet`) — **unchanged
  request/response shape, unchanged status codes, unchanged rejection
  bodies.** This run only adds a new route to the same router.
- `src/server.ts` — the **only** edit is the one-line widening in §5.5. The
  router mount (`src/server.ts:157`), the MulterError branch, and every other
  route's mount order are untouched.
- `src/simbriefClient.ts`, `src/simbrief.ts` — untouched. `src/weatherClient.ts`
  is modelled on the former but is a new, separate file.
- `CANNED_MESSAGES` (`src/acars.ts:44-48`) — unchanged, including the existing
  `wx-request` canned "WX REQUEST" freetext button, which stays exactly as
  frozen by the message-center design (§6.3 there): a typed-out phrase with no
  ICAO and no lookup, distinct from this run's real `wx`-category REQUEST WX
  action.
- `KNOWN_ACARS_CATEGORIES`, `ACARS_DIRECTIONS`, `MAX_ACARS_BODY_LENGTH` — no
  change; `'wx'` already exists as a known category.
- `client/src/pages/FlightDetail.tsx` — read for precedent only (§6.1); not
  edited by this run.
- Every existing test in `tests/` — none of this run's files are imported by
  existing test suites; `npm test` must pass unmodified before and after.

## 9. Risks

- **aviationweather.gov is a US federal government service** on a
  `.weather.gov`/`aviationweather.gov` domain, not a contracted, versioned API
  like SimBrief's. It has no published SLA, and NOAA/NWS web services have
  historically gone dark during federal funding lapses. This run's rejection
  path (§5.3, "no data / fetch failure" → `WX DATA UNAVAILABLE FOR <ICAO>`)
  already treats total upstream unavailability as an expected, handled
  outcome rather than a crash, per the story's own non-functional note — so an
  extended outage degrades this one feature, not the app, but it is worth
  flagging as a real and not-hypothetical risk for this specific source.
  **Falsified by:** a sustained run of `BAD_STATUS`/`NETWORK`/`TIMEOUT`
  rejections in the ACARS thread with no code change.
- **The JSON shape (`rawOb`, `rawTAF`, and the 204-vs-200-`[]` asymmetry) is
  observed from live responses, not a published, versioned schema** — §1.3's
  probes are the only ground truth this design has. `weatherClient.ts`'s
  `BAD_BODY` path (§3.2) is exactly the guard against this: a field rename or
  a shape change upstream degrades to a rejection message, not an unhandled
  exception, but every existing WX reply for a station whose data was already
  fetched successfully today could start silently rejecting on some future
  date if the upstream schema quietly changes. **Falsified by:** a spike in
  `BAD_BODY` reasons in stored `payload_json` with no corresponding upstream
  incident.
- **Caching a failure for the full TTL (§3.5)** means a transient network
  blip on this machine (not the upstream) can make an ICAO answer "unavailable"
  for up to 5 minutes even after connectivity returns, since the cache has no
  way to distinguish "the network was briefly down" from "the upstream is
  genuinely broken." Accepted per §7's reasoning; **falsified by** user reports
  of a WX request repeatedly failing for longer than 5 minutes past a known,
  brief local network interruption — if that happens often, failures should
  get a shorter TTL than successes, which would be an amendment to §3.5, not
  a re-litigation of "cache failures at all."
- **No in-flight de-duplication (§7's rejected alternative)**: two REQUEST WX
  presses for the same ICAO within milliseconds of each other (a double-click,
  or two browser tabs) both miss the cache and both hit the upstream,
  producing two request/reply pairs instead of one. Accepted as out of scope
  for a single-operator desktop app; **falsified by** this pattern showing up
  in practice as a real nuisance rather than a theoretical race.
