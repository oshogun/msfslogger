# Review — phase 2 (T-003 … T-007)

**Verdict: `request_changes`.** One blocking finding class, five lines, all in
comments. Every behavioural, contract, auth and safety check passed. 7 of the 7
acceptance criteria in T-008 were verified independently by re-running the
evidence; none were taken from an implementer report (no `reports/` directory
exists — reports were envelopes, so nothing was read).

| Task | Verdict | Why |
|---|---|---|
| T-003 auth | approve | — |
| T-004 routes | approve | — |
| T-005 MCP server + read tools | request_changes | F-1 (3 lines) |
| T-006 write tools + extraction | request_changes | F-1 (1 line) |
| T-007 integration tests | request_changes | F-1 (1 line) |

All three go back to **one `backend_sr`** — same owner, same files, round 1 of 3.

## Criteria verified

1. **`npm test` / `test:types` / `tsc --noEmit`** — re-run under Node 20.20.2.
   `Test Files 42 passed (42) / Tests 1071 passed (1071)`; `tsc -p
   tsconfig.test.json` and `npx tsc --noEmit` both exit 0, no output.
2. **`tools/list` = exactly 18.** Scratch server (`:3187`, scratch db copy),
   `POST /mcp` with a valid bearer. `count 18`, names sorted:
   `assign_flight_to_trip, create_trip, get_acars_thread, get_flight,
   get_flight_stats, get_ground_session, get_journey, get_planned_leg,
   get_status, get_trip, get_weather, import_simbrief_leg,
   list_canned_messages, list_flights, list_planned_legs, list_trips,
   search_flights, update_flight_notes` — the 14 of design § 7.1 plus the 4 of
   § 7.2, verbatim, nothing else. `tools/call` for `delete_flight` →
   `Tool delete_flight not found`. `grep -rniE
   "deleteFlight|combineFlights|deletePlannedLeg|deleteTrip|pdf|sayintentions|setSetting|setPassword|createAuthUser"
   src/mcp/` → no match.
3. **MCP_TOKEN and INGEST_TOKEN independently revocable** — both directions,
   three scratch servers:
   - `/mcp` with the *ingest* token as bearer → `401`; with no auth → `401
     {"code":"INVALID_MCP_TOKEN"}`; with a valid MCP token **and** a garbage
     `X-Ingest-Token` header → `200`.
   - `/api/ingest/frame` with the *MCP* token → `401`; with the correct ingest
     token **and** a garbage `Authorization: Bearer` → `400` (auth accepted,
     body rejected), not `401`.
   - `:3189` with `INGEST_TOKEN` rotated, `MCP_TOKEN` unchanged: old ingest
     token → `401`, MCP `tools/list` → `200`, new ingest token → `400`.
   - `:3188` with `MCP_TOKEN` unset: startup logs `MCP endpoint disabled
     (MCP_TOKEN is not set).`, `POST /mcp` → `404` (unmounted, SPA catch-all),
     ingest unaffected. Must-not-change 12 holds.
4. **`update_flight_notes` cannot move `aircraft`** — seven input shapes against
   flight 93 (`aircraft = "Carenado C182Q N738RK"`) on the scratch db:
   flat `aircraft`; `AIRCRAFT`/`Aircraft`/`aircraft_type`/`"aircraft "`;
   nested `{update:{aircraft}}` and `{fields:{aircraft}}`; `__proto__` and
   `constructor.prototype` payloads; `notes` as an object carrying `aircraft`;
   `aircraft` at `params` level outside `arguments`; array-shaped `arguments`.
   Result: `AFTER: {"aircraft":"Carenado C182Q N738RK","notes":"probe-6"}` and
   `select count(*) from flights where aircraft like '%HACKED%' or notes like
   '%HACKED%'` → `0`. Zod strips (confirmed: the extra keys produce a normal
   success, not a rejection), but the strip is not load-bearing — the handler
   destructures `({flight_id, notes})` and calls `updateFlight(flight_id, {
   notes })` (`src/mcp/tools/write.ts:38`). `grep -rn "\.\.\.\(args\|req.body\)"
   src/mcp/` → no arg spreads anywhere. Both mechanisms of design § 7.3 present.
5. **Live server and live `flights.db` untouched.** All work ran in a scratch
   rsync of the tree with `node_modules` symlinked, built there, three servers on
   `:3187`/`:3188`/`:3189` against `scratch.db`, all killed by tracked PID and the
   scratch tree removed. `md5sum flights.db` changed (`629f3391…` → `9a049191…`)
   — the live server's own WAL checkpointing, per `ENVIRONMENT.md`, so the
   structural check is the one that decides: `max(flights.id)=93 count=56`,
   `max(trips.id)=1 count=1`, `max(planned_legs.id)=37 count=21`, and flights
   with non-empty notes `= 0` — all identical before and after, and the last of
   those would be ≥ 1 if any `update_flight_notes` probe had reached the live
   file. `dist/index.js` and `client/dist/index.html` mtimes are `00:30` today,
   hours before this review. The user's server (pid 1311045, `:3000`) was never
   signalled and is still listening.
6. **Existing flows unaffected.** `tests/ingestScope.test.ts` is unmodified
   (`git status` clean for it) and its 96 tests pass. `src/auth/middleware.ts`,
   `src/auth/ingestScope.ts`, `src/auth/ingestToken.ts`, `src/db/schema.ts`,
   `client/`, `agent/` — all unmodified; `INGEST_SCOPED_ROUTES` still has 19
   entries. `/api/flights`, `/api/trips`, `/api/status`, `/api/flights/stats`,
   `/api/flights/search` all answer `401` both with and without an MCP bearer —
   no route gained a credential (must-not-change 6). `auth_session` rows: 1 in
   the live db, 1 in the scratch db after all MCP traffic — MCP allocates no
   session (must-not-change 5). Two test files *were* edited
   (`tests/config.test.ts`, `tests/db/flights.test.ts`) against the letter of
   must-not-change 13, but the diff is additions only — one new `MCP_TOKEN`
   member in the `ENV_VARS` expectation (unavoidable; `ENV_VARS` genuinely
   gained it per § 2.1) and new `describe` blocks. No existing assertion was
   removed or weakened.
7. Verdict and routing below.

## Design conformance spot-checks (all pass)

- **§ 6.5 extraction is pure code motion.** Diffed
  `src/routes/plannedLegs.ts`'s deleted block against `src/simbriefImport.ts`
  line by line: identical `NO_USER_ID` sentence, identical duplicate sentence,
  identical `[SIMBRIEF] import ok/duplicate/failed/dispatch release not filed`
  strings, identical dedup hash (`simbrief\n{requestId}\n{sequenceId}\n{timeGenerated}`)
  and `dispatchDedupKey(legId)`, identical step order with `createPlannedLeg`
  as the first and only `planned_legs` write and the ACARS release in its own
  try/catch. Route is now the two-line adapter § 6.5 froze. The trip-nested
  `POST /api/trips/:id/planned-legs/simbrief` is byte-identical (untouched in
  the diff) — must-not-change 8.
- **§ 4.3 routing order**, verified by inspecting the built router's stack:
  `GET /flights → POST /flights/combine → GET /flights/search → GET
  /flights/stats → GET /flights/:id → …`.
- **§ 10.1 / § 10.3** implemented as written: `ownDurationSec` reused, no
  `ORDER BY` on the stats select, flights→duration→name tie-break, top 5,
  one-decimal rounding at the end; search uses `COALESCE(col,'') LIKE '%'||?||'%'
  ESCAPE '\'` over the six named columns, AND across tokens, `ORDER BY
  start_time DESC LIMIT ? OFFSET ?`, `COUNT(*)` on the same `WHERE`.
- **§ 5.6 methods**: `GET /mcp` → `405` with `Allow: POST`; `DELETE` → `405`.
  **§ 5.5 malformed body**: `-d '{not json'` → `400 {"jsonrpc":"2.0","error":
  {"code":-32700,"message":"Parse error"},"id":null}`.
- **§ 6.2 error mapping**: not-found and validation failures come back as
  `isError: true` content, HTTP 200, never a thrown JSON-RPC error — checked on
  `get_flight` 999999, `search_flights` empty `q`, `get_acars_thread` with
  neither and with both ids, `get_weather` `"../../etc/passwd"`,
  `get_flight_stats` `from=not-a-date`.
- **§ 7.3 `get_status` projection** returned exactly the frozen flat shape,
  `traffic` absent.
- **Security**: `q = "'; DROP TABLE flights; --"` returns `total: 0` and the
  table survives (every later query works); `q = "%"` returns `total: 0`, so the
  wildcard is escaped. No path reaches the filesystem from any tool input.
- **Scope**: every changed file is inside the union of T-003…T-007's
  `allowed_paths`, including T-006's amended `src/simbriefImport.ts` and
  `src/routes/plannedLegs.ts`. Nothing outside.

## Findings

**F-1 (blocking) — run-artifact citations in shipped comments.** Five new
comments point at documents a future reader of `src/` cannot find:

- `src/mcp/server.ts:27` — `/** Fresh McpServer per HTTP request (§5.3 of the frozen design: stateless,`
- `src/mcp/tools/read.ts:20` — `// The 14 read tools (design.md §7.1). Every tool handler calls the underlying`
- `src/mcp/tools/read.ts:36` — `*  written to be implemented twice (design.md §10, intro). */`
- `src/mcp/tools/write.ts:9` — `// The 4 write tools (design.md §7.2). Every one of them is additive or`
- `tests/mcp.test.ts:72` — `// The 18 tools T-005/T-006 registered, confirmed live by their own manual`

Reproduction: `grep -nE 'design\.md|T-[0-9]{3}|§' src/mcp/ -r tests/mcp.test.ts`
(the `README § HTTPS` hits in `src/config.ts` are pre-existing and point at a
real in-tree doc — leave them). Fix: drop the citation, keep the prose. E.g.
`tests/mcp.test.ts:72` becomes "A golden list of the 18 tools, deliberately not
derived from `MCP_TOOLS` …"; `read.ts:36`'s clause becomes "…the route does not
export it, and this grammar is small enough to state twice."

## Non-blocking follow-ups

- **Design § 9.2 / § 6.4 put `FlightStatsFilter`, `AircraftStat`, `RouteStat`,
  `FlightStats`, `FlightSearchResult` in `src/types.ts`; they landed in
  `src/db/flights.ts:282–320,416`.** Defensible — `src/types.ts` was in no
  task's `allowed_paths`, so the implementer could not have complied — and no
  consumer is cut off (`routes/flights.ts` and `mcp/tools/read.ts` both import
  them fine). `design.md` § 0 should get an amendment rather than the code being
  moved.
- **Design § 5.2's `baseUrl`/`paths` `tsconfig.json` addition was not made, and
  is not needed.** `tsc --traceResolution` shows the SDK's `typesVersions: {"*":
  …}` already resolves `@modelcontextprotocol/sdk/server/mcp.js` to
  `dist/esm/server/mcp.d.ts` under the Node10 resolver, while `require()` gets
  `dist/cjs` via `exports`. Types come from the ESM build and runtime from the
  CJS build — same source, but worth a line in § 0 as the falsified assumption.
- **T-006's verification made a real read-only call to the SimBrief API with the
  operator's saved pilot ID** (flagged by that task). Out of my criteria's scope
  — no msfslogger live server or live db was involved, and the structural check
  above confirms it — and it does not affect the verdict. Recorded so the
  Orchestrator can decide whether a mock fixture is wanted before the next run
  exercises `import_simbrief_leg`.
- `GET /api/flights/search` echoes the **untrimmed** `q` in `result.query`
  (`src/routes/flights.ts:132`). Design § 4.2 does not say which; harmless.
