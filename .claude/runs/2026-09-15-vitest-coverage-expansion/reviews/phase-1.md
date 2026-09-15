# Review — phase 1 (T-002, T-003, T-004)

**Verdict: approve.** 20 of 20 acceptance criteria across the three tasks verified
independently from the diff and live command output. No blocking findings.
Reports not read; the `risks` lists were the only implementer text consulted.

## Per-task verdicts

| Task | Files | Verdict | Criteria verified |
|---|---|---|---|
| T-002 | `tests/trafficStore.test.ts`, `tests/geo.test.ts` (both new) | approve | 5/5 |
| T-003 | `tests/weatherClient.test.ts` (new) | approve | 7/7 |
| T-004 | `tests/ingest.test.ts` (new) | approve | 6/6 |

Changed files, whole phase (`git status --porcelain tests/`):
`?? tests/geo.test.ts`, `?? tests/ingest.test.ts`, `?? tests/trafficStore.test.ts`,
`?? tests/weatherClient.test.ts`. Nothing else under `tests/`. In scope.
`tests/ingestCors.test.ts`, `tests/helpers/index.ts`, `tests/setup.ts` and
`vitest.config.ts` are tracked and report no modification — byte-for-byte untouched.
(`src/` carries pre-existing uncommitted ACARS/weather product code from earlier
work — `src/weatherClient.ts` is imported by `src/acars.ts` and `src/routes/acars.ts`;
`git diff HEAD -- src/` contains no test-related edit. Not this phase's.)

## T-005 criteria

1. **`npm test` passes in full** — `Test Files 23 passed (23) / Tests 493 passed (493)`.
   Pre-existing suite intact: `npx vitest run --exclude 'tests/{geo,ingest,trafficStore,weatherClient}.test.ts'`
   → `Test Files 19 passed (19) / Tests 411 passed (411)`; 411 + 82 new = 493, so no
   pre-existing test was removed or altered (design § 14 item 8).
2. **Toolchain** (exit code captured separately from the pipe, Node v20.20.2):
   `test:types exit=0`, `tsc exit=0`, `build exit=0`.
3. **No real network, no live db** — see below.
4. **Per-task criteria re-derived** — see below.

## Evidence the suite touches neither the network nor `flights.db`

- `grep` of the four new files for `./db` / `./airports` imports: none (one comment
  mention in `trafficStore.test.ts:4`). `src/geo.ts` and `src/weatherClient.ts` import
  nothing but `./types`; `src/ingest.ts`'s `FlightManager` import is `import type`.
- `grep -rn "flights.db" tests/` → one comment in `kmlExport.test.ts`, no path.
- Design § 3.3's falsifiable check: `FLIGHTS_DB_PATH=/nonexistent-directory/flights.db npm test`
  → `Tests 493 passed (493)`.
- Live db, tight window around one full `npm test` (exit 0):
  `md5 before=41953771bc1b54bf1e83683273a43b5a after=41953771bc1b54bf1e83683273a43b5a`,
  `mtime before=1789439587 after=1789439587` — **UNCHANGED**.
  (An earlier, wider window did show `a340…` → `4195…`; `flights.db-wal`/`-shm`
  kept ticking with no test running, i.e. the live server's own checkpoint —
  exactly the false positive design § 3.3 warns against. The tight window is the claim.)
- `weatherClient.test.ts` passes a `vi.fn()` `fetchImpl` on **every** call; the only
  `aviationweather.gov` / `127.0.0.1:310x` strings are URL assertions on the stub's
  `mock.calls`. No socket.
- `ingest.test.ts` does call bare `fetch()` (line 109) — against its own
  `app.listen(0, '127.0.0.1')` server, the pattern the frozen `ingestCors.test.ts`
  already uses (`ingestCors.test.ts:35,70`). Loopback to an in-process express app,
  torn down in `afterEach`; no external socket is opened. Criterion 3's literal
  wording ("no bare `fetch(`") is met in intent, not in letter — recorded, not a finding.
- No server of mine was started (`ss -ltn` shows nothing on 31xx); the user's
  PID 769344 on port 3000 was not touched. Scratch dir removed.

## T-002 — verified against `src/trafficStore.ts` and `src/geo.ts`

- `roundCoord`/`roundAlt`/`normHeading`/`distanceM`: non-trivial cases present;
  `normHeading(360) === 0` and `normHeading(359.96) === 0` pin the round-first-then-wrap
  ordering the source comment (`src/trafficStore.ts:19-23`) calls out, plus `-12.2 → 347.8`.
- `applyRetentionCap`: under-cap returns the same array identity (`toBe`) with a
  throwing `Proxy` as `lastFrame` — reads it and the test dies; over-cap with
  `lastFrame` uses 99 strictly-increasing-distance objects plus two tied at lon 500
  (checked: tied pair is farther than all 99, so the tiebreak really decides the
  100th slot) and asserts id 200 in, id 300 out; over-cap with `lastFrame: null`
  asserts `objects.slice(0, 100)` exactly.
- `TrafficStore`: `read()` after `replace()` asserted with `toBe`; the inclusive
  boundary and the "cleared, not filtered" second read both present.
- `geo.test.ts`: `haversineNm(0,0,0,1) ≈ 60.040461`; antimeridian 179E→179W equals
  `haversineNm(0,0,0,2)` to 6dp; `bearingDeg` north ≈ 0, east ≈ 90, west ≈ 270.
- `npx vitest run tests/trafficStore.test.ts tests/geo.test.ts` → **exit 0**.

**Mutation check (scratch copy, `src/trafficStore.ts` `>` → `>=`)**: the boundary test
fails — `× read(now) at exactly now - receivedAt === TRAFFIC_STALE_MS is still fresh (inclusive)`.
The assertion bites; it is not vacuous.

## T-003 — verified against `src/weatherClient.ts`

Every branch of `fetchOneProduct` is reached through `fetchWeather`/`getCachedWeather`
with the documented outcome: 204→null, empty body→null, `[]`→null, 429→`RATE_LIMITED`
(+`httpStatus`), 503→`BAD_STATUS`, `not json {`→`BAD_BODY`, non-array JSON→`BAD_BODY`,
`[{}]`→`BAD_BODY`, `rawOb: ''`→`BAD_BODY`. `TypeError`→`NETWORK`; `TimeoutError` direct
and `AbortError` cause-wrapped→`TIMEOUT`, with `userMessage` "did not respond within
3 seconds" for `timeoutMs: 3000` and 10 for the default. Asymmetry: METAR rejection is
fatal with TAF ok; TAF rejection yields `taf: null` with METAR ok. Cache: hit within TTL
keeps `toHaveBeenCalledTimes(2)`, cached failure replays as a rejection at 2 calls,
TTL+1 and `clearWeatherCache()` each take it to 4, keyed per ICAO.
`WEATHER_API_BASE_URL` re-read per call proven by two different overrides inside one
test. `npx vitest run tests/weatherClient.test.ts` → **exit 0**.

## T-004 — verified against `src/ingest.ts`

All ten `SimFrame` fields covered twice (missing + wrong type) → 400, `typeof body.error === 'string'`,
`onFrame` not called, plus a 204 control that asserts `onFrame` got the frame.
`/traffic`: array body, `{notObjects:[]}`, 201 objects, and nine invalid elements
(non-integer id, negative id, lat ±90.1, lon ±180.1, string altitude, string heading,
string `onGround`) → 400 with `replace` uncalled. Dedupe asserts the exact
`trafficStore.replace` argument: id 5 holds the **last** occurrence's rounded values at
the **first** position, id 6 second. `TRAFFIC_ENABLED`: unset→replace called; `'0'`,
`'off'`, `'  FALSE  '`→204 with replace uncalled; `'nope'`→enabled. Order: bad token on a
disabled server → **401**, not 204. Stale timer under `vi.useFakeTimers()`: +15 s →
`connected === false` and `onSimDisconnect` once; frame, +7 s, frame, +4 s → still
connected, never called. `npx vitest run tests/ingest.test.ts tests/ingestCors.test.ts` →
**exit 0**, `✓ tests/ingestCors.test.ts (5 tests)` unmodified and green.

**Mutation check (scratch copy, `byId.set` → first-occurrence-wins)**: `× de-duplicates by
id, keeping the last occurrence value at the first occurrence position`. The assertion bites.

## Findings

None blocking. No run-artifact citations in any new comment
(`grep -nE "\.claude/runs|design\.md|plan\.json|T-[0-9]{3}|§|Amendment|phase[0-9]"` → no hits).
Style matches the surrounding suite (header comment stating scope, `it.each` tables,
`makeFrame`/`useFakeClock` from `tests/helpers`).

## Non-blocking follow-ups

1. `createIngestRouter` registers an uncleared `setInterval(…, 5_000)`
   (`src/ingest.ts:195`). Each `startServer()` in `tests/ingest.test.ts` leaks one for
   the file's lifetime; harmless today (suite green, the closure holds only mocks) but a
   latent teardown/flake risk. Fixing it means a stop handle on the router — out of this
   phase's `allowed_paths`; worth a task if `src/ingest.ts` is reopened.
2. `tests/weatherClient.test.ts:243` snapshots `WEATHER_API_BASE_URL` in the `describe`
   body (collection time) rather than in `beforeEach` as T-003's criterion words it.
   Restoration in `afterEach` is equivalent here and verified green on repeat runs; a nit.
3. `/traffic` "non-object body" is covered only by an array. A JSON string or number
   body is untested (express `strict` makes it a 400 from the parser, not from
   `buildTrafficObjects`) — a small coverage gap, not a defect.
