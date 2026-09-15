# Review — phase 1 (T-002 backend, T-003 frontend)

**Verdict: approve.** 4/4 story criteria and every design-frozen behaviour I
could exercise were verified independently, by re-running commands against a
scratch server (port 3100) and a scratch copy of `flights.db` — not by reading
the implementer reports, which I did not open. Four non-blocking follow-ups at
the end; none sends a task back.

- T-002 (`src/weatherClient.ts`, `src/acars.ts`, `src/routes/acars.ts`, `src/types.ts`, `src/server.ts`, `src/inspect-weather.ts`) — **approve**
- T-003 (`client/src/pages/AcarsMessages.tsx`, `client/src/types.ts`) — **approve**

## Safety

- Scratch copy of `flights.db` (+`-wal`/`-shm`) in the session scratchpad, a
  stub upstream on 3201, a scratch server on 3100. Both killed by the PID owning
  the scratch port; scratch directory removed. The user's server on 3000 was
  never touched (`ss -lnt sport = :3000` still shows one listener).
- **Live `flights.db` carries nothing from this review.** Its md5 did change
  (`eacb2d1f…` → `f527734e…`), but that is the user's own running server: two
  consecutive reads of `flights.db-wal` 20 s apart, with no action from me,
  gave `7d7b8d88…` then `0e6bbb86…`, mtime one second before the read. Positive
  evidence the writes are not mine: `select count(*) from acars_messages` on the
  live file = **0** (the 22 wx rows I created are in the scratch copy only), and
  `auth_user` is still `operator`, not the scratch `reviewer` account.

## Build, tests, scope

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npm run build` (client `tsc && vite build`, then server `tsc`) | `✓ built in 2.05s`, `BUILD_EXIT=0` |
| `npm test` | `Test Files 19 passed (19) / Tests 411 passed (411)` |
| `npm run test:types` | exit 0 |
| Scope | `git status --porcelain -- src client/src` = exactly the 6 modified + 2 new files named in the envelope; `tests/` untouched |

## Story acceptance criteria

**AC1 — valid ICAO returns METAR text in the thread.**
`POST /api/flights/86/acars-messages/wx -d '{"icao":"kjfk "}'` → `HTTP:201`,
`request.label="WX REQUEST KJFK" direction=downlink`,
`reply.label="METAR KJFK" direction=uplink`, body = METAR + `\n` + TAF,
`correlation_id: 3` (the request's id), `available:true`. Input normalised
(`"kjfk "` → `KJFK`) before storage, per design §4.1.
Also verified against the **real** upstream (not the stub):
`npx ts-node src/inspect-weather.ts EGLL ZZ AB` → `metar METAR EGLL 150050Z AUTO 21009KT 9999 -RA BKN004 18/18 Q1018`,
plus `✗ REJECTED ZZ / AB: not a 4-character alphanumeric ICAO`, ~1 s round trip.

**AC2 — invalid/unknown ICAO is a clear rejection, never an unhandled error.**
Every row below re-run by hand; all match design §5.4 byte for byte, and none
wrote an `acars_messages` row (verified by row count afterwards):

| Input | Result |
|---|---|
| `{"icao":"AB"}` (malformed, short) | `400 {"error":"icao must be 4 letters or digits (e.g. EGLL)","code":"INVALID_ICAO"}` |
| `{"icao":"EG!!"}` (malformed, charset) | same `400 INVALID_ICAO` |
| `{"icao":"   "}` / `{}` / `{"icao":42}` / `[1,2]` | `400 {"error":"icao is required","code":"INVALID_BODY"}` |
| `{"icao":` (malformed JSON) | `400 {"error":"Invalid request body","code":"INVALID_BODY"}` — the §5.5 `src/server.ts` edit works |
| `:id` = `abc` / `999999` | `400 INVALID_ID` / `404 {"error":"Flight 999999 not found","code":"FLIGHT_NOT_FOUND"}` |
| no session | `401 {"error":"Authentication required"}` |
| `{"icao":"ZZZZ"}` (well-formed, unknown) | `201`, `available:false`, reply `WX UNAVAILABLE` / `WX DATA UNAVAILABLE FOR ZZZZ` / `{"icao":"ZZZZ","reason":"NO_DATA"}` |

**AC3 — repeated requests inside the window issue no second upstream fetch.**
Re-derived, not re-read. Stub upstream appends every hit to a log. Three
`{"icao":"KJFK"}` posts in a row → `201, 201, 201`, rows `3/4`, `5/6`, `7/8`
(a fresh pair each time), identical `fetched_at` on all three, and the upstream
log held exactly **2 lines** (`metar KJFK`, `taf KJFK`) throughout. At module
level, design §3.5's own frozen assertion:
`fetchImpl calls: after 1st=2  after 2nd(same icao)=2  after 3rd(diff icao)=4`,
`WEATHER_CACHE_TTL_MS = 300000`.

**AC4 — departure/destination pre-filled from the active leg.**
`GET /api/flights/86/acars-messages` → `planned_leg_id: 33` (read at
`AcarsMessages.tsx:92`); `GET /api/planned-legs/33` → `departure_ident=RJCN
departure_is_airport=1 destination_ident=RJCK destination_is_airport=1`.
Applying the component's own rule (`AcarsMessages.tsx:133-137`) to that payload
gives input pre-filled `"RJCK"` and quick-fill buttons `RJCN, RJCK` — design
§6.2's gating table, row 1. The remaining rows are visible in the JSX at
`AcarsMessages.tsx:273-290` (each button rendered only on its `*_is_airport`
flag; nothing rendered when `plannedLeg === null`).

## Design conformance and must-not-change

- **Direction convention** — every `wx` row in the scratch db: 11 `downlink`
  requests labelled `WX REQUEST …`, 11 `uplink` replies (`METAR <icao>` or
  `WX UNAVAILABLE`), every reply's `correlation_id` pointing at a downlink
  request. Matches the intake's correction and `acars_message_center` §3.2.
- **No dedup key, every call logged** — `any dedup_key set: false`,
  `any planned_leg_id set: false` across all 22 rows; `insertAcarsMessage` at
  `src/routes/acars.ts:176,197,206,217` (the wx handler), `insertAcarsMessageOnce`
  only at `:265,:274`, which is the pre-existing loadsheet handler.
- **No credential** — `src/weatherClient.ts:159-162` builds the only request in
  the module: `fetchImpl(url, { signal, headers: { Accept: 'application/json' } })`.
  Grep for `authorization|api[-_ ]?key|token|bearer|cookie|credential|secret|process.env`
  returns three hits: two prose lines in the header comment and
  `process.env.WEATHER_API_BASE_URL` (the test seam, §3.6). No key is read,
  built or sent. `ids` goes through `searchParams.set`, and the ICAO is already
  `^[A-Z0-9]{4}$`-validated before the module is reached.
- **Upstream outage cannot 500** — exercised, not reasoned about. Killed the
  stub, then requested a fresh (uncached) ICAO: `201`, `available:false`,
  `{"icao":"EGLL","reason":"NETWORK"}`, nothing on the server's stderr. A
  still-cached ICAO kept answering `available:true` during the outage. Stub
  fault injection also produced `RATE_LIMITED` (429), `BAD_STATUS` (503),
  `BAD_BODY` (200 + `{not json`) — all `201` + rejection row, matching §3.2/§5.3.
  A 400 ms timeout against a hanging socket gave `WeatherFetchError TIMEOUT`.
  Failures are cached as frozen: a repeat `E429` added 0 upstream calls and
  still wrote a fresh pair (rows 17/18).
- **METAR-without-TAF** — `KRHV` (stub returns `[]` for taf) → `available:true`,
  body is the METAR alone, `weather.taf: null`. §3.3's degrade rule holds.
- **`src/server.ts` edit** — the diff is exactly design §5.5: the two existing
  arms untouched, one `|| req.path.endsWith('/acars-messages/wx')` added. No
  other line of the file changed.
- **Must-not-change list** — `src/db/schema.ts`, `src/db/acarsMessages.ts`,
  `src/simbriefClient.ts`, `src/simbrief.ts`, `client/src/pages/FlightDetail.tsx`
  and `tests/` are absent from the diff. `src/acars.ts`'s change is append-only
  after line 398 — `CANNED_MESSAGES`, `KNOWN_ACARS_CATEGORIES`,
  `ACARS_DIRECTIONS`, `MAX_ACARS_BODY_LENGTH` unchanged. Existing routes
  re-checked live: `GET …/acars-messages` → `200 {flight_id, planned_leg_id,
  messages}`; `GET /api/acars/canned-messages` → `200`, still carrying the
  `wx-request` freetext entry; `POST /api/planned-legs/33/…/loadsheet` →
  `409 NO_DISPATCH_DATA` as before.

## Findings

All non-blocking. No blocking defect found.

1. **`src/types.ts:536` — design-section citation in shipped source.**
   `/** Raw TAF text, or null — a station with no TAF on file is not an error (§1.3). */`
   points at a `§`-numbered section of a run document the next reader of `src/`
   has no way to find. The design's §2.1 froze this comment verbatim, so the
   implementer copied it faithfully — the fix is to delete `(§1.3)`, nothing
   more. It is the only such citation in the diff (grep over all changed and new
   files for `.claude/runs|design\.md|plan\.json|§|T-0NN|phase N|Amendment`
   returns this one line).
2. **`src/weatherClient.ts:126` — "within 0 seconds" for sub-second timeouts.**
   `Math.round(timeoutMs / 1000)` renders an injected `timeoutMs: 400` as
   `"The weather service did not respond within 0 seconds."` Unreachable in
   production (the route passes no `opts`, so the default 10 000 ms → "10
   seconds"); only a test or a future caller with a short timeout would see it.
3. **No unit coverage for `src/weatherClient.ts`.** Design §3.5 spells out the
   exact assertable cache test (`fetchImpl` call count across a fake-clock TTL
   boundary); I re-derived it by hand above, but nothing in `tests/` will catch a
   regression. A natural follow-up run alongside the other uncovered modules.
4. **No in-flight coalescing in `getCachedWeather`.** Two concurrent misses for
   the same ICAO each call `fetchWeather` (4 upstream hits). Not a design
   violation — §3.5 froze the cache without coalescing — and the client disables
   the button while a request is in flight, so a single operator cannot trigger
   it. Worth knowing if a second client ever shares the endpoint.

Minor style note, not tracked: `src/routes/acars.ts:187` declares
`let replyMessage;` where design §5.3 showed `let replyMessage: AcarsMessage;`.
TypeScript's evolving-`let` inference plus the `WxRequestResponse` annotation on
the response object keeps it type-safe, and `tsc` is clean.
