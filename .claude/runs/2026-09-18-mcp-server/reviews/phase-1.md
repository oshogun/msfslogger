# Review — phase 1 (design gate), task T-002

**Verdict: approve.** 7/7 acceptance criteria verified independently. 0 blocking
findings, 5 non-blocking follow-ups. Phase 2 may start.

Reviewed: `design.md` (1064 lines, read whole), `intake.md`, `contracts/*.d.ts`,
`contracts/samples/*`, `plan.json` frozen decisions and T-001's task record.
The designer's report was not read. `prototypes/TRANSCRIPT.md` was read only to
locate its claims, which were then re-derived from scratch (see F1).

## Per-criterion verdicts

**AC1 — auth independence at module level: PASS.** §2.2 gives `mcpSha256` its own
local `createHash` and states "no import edge to `src/auth/ingestToken.ts`";
§2.3 makes `MCP_SCOPED_ROUTES` its own hardcoded constant; §2.4 mounts
`createMcpTokenGate` on the `/mcp` router only, never `app.use()` globally; §2.5
justifies the duplication against success criterion 4 explicitly. No shared
digest, constant or gate anywhere in §2, §3 or §9.2. §2.3's "hardcoded TS
constant, not an env var" matches how `INGEST_SCOPED_ROUTES` is really written —
verified: `src/auth/ingestScope.ts:15` is a `readonly [...]` literal.

**AC2 — 18 tool rows, 14 read + 4 write: PASS.** Counted §7.1 = 14 rows
(`list_flights`, `get_flight`, `search_flights`, `get_flight_stats`,
`list_trips`, `get_trip`, `get_journey`, `list_planned_legs`, `get_planned_leg`,
`get_acars_thread`, `get_weather`, `list_canned_messages`, `get_status`,
`get_ground_session`) and §7.2 = 4 rows (`update_flight_notes`, `create_trip`,
`assign_flight_to_trip`, `import_simbrief_leg`). Exactly `intake.md` lines 80–89,
no additions, no substitutions. Excluded actions: §3.1's closing paragraph names
every DELETE, `POST /api/flights/combine`, PDF, export, ACARS POST, SayIntentions,
`PUT /api/active-trip`, `.lnmpln` upload, `PATCH /api/planned-legs/:legId`,
planned-leg link/status PUTs and both settings PUTs as absent; §6.1 point 5 makes
it compile-time (`src/mcp/**` never imports `deleteFlight`, `deleteTrip`,
`deletePlannedLeg`, `combineFlights`, `setActiveTrip`, `setSetting`,
`sayIntentionsClient`); §3.2's startup assertion catches a nineteenth tool.
Traced each of the 18 rows to the function it calls — all exist with the stated
names (`src/db/flights.ts:69,109,113`, `src/db/trips.ts:10,17,42,78,151`,
`src/db/plannedLegs.ts:206,217,253`, `src/db/acarsMessages.ts:118,132`,
`src/db/groundSessions.ts:67`, `src/weatherClient.ts:277`, `src/journey.ts:184`,
`src/flightManager.ts:354,773,806`, `src/acars.ts:47`). None reaches an excluded
action. One disclosed side effect, not a defect: `import_simbrief_leg` writes a
dispatch-release `acars_messages` row, as `POST /api/planned-legs/simbrief` does
today — §8 states this outright.

**AC3 — `aircraft` unreachable by a concrete mechanism: PASS.** §7.3 gives two,
both required: the zod shape declares `flight_id` and `notes` only, and the
handler builds a fresh literal `updateFlight(flightId, { notes })`, never a
spread of `args`/`req.body`. Mechanism, not intent. The hazard is real —
`src/db/flights.ts:70` is `const allowed = ['aircraft', 'notes']` — and §7.3
names it before defending against it.

**AC4 — routing order and concrete response shapes: PASS.** §4.3 freezes
`/flights` → `/flights/combine` → `/flights/search` → `/flights/stats` →
`/flights/:id`, i.e. both new routes before the param route, with the
`parseInt('stats') → NaN` failure spelled out. Verified against the live file:
`src/routes/flights.ts:22,31,68` is `/flights`, `/flights/combine`,
`/flights/:id` today, so the insertion point is real. Shapes are codeable without
further decisions: `FlightStats`/`FlightSearchResult` fully typed in
`contracts/flightsQueries.d.ts`, 200/400/500 bodies in `contracts/samples/`, and
§10.1–10.3 pin aggregation, date normalisation (inclusive `from`, exclusive `to`,
`toISOString()` before comparison) and LIKE escaping. Every column §10.1 selects
and §10.3 searches exists in `src/db/schema.ts:187–206`.

**AC5 — real package, concrete session mode: PASS, and re-verified from the
registry rather than the transcript.** `npm view @modelcontextprotocol/sdk`
returns version `1.30.0`, `type: module`, and an `exports["./*"].require` →
`./dist/cjs/*` condition. Under Node 20.20.2:
`require('@modelcontextprotocol/sdk/server/mcp.js')` → `[ 'McpServer',
'ResourceTemplate' ]`, `.../streamableHttp.js` → `[
'StreamableHTTPServerTransport' ]`. Session mode is decided, not open: §5.3
freezes stateless (`sessionIdGenerator: undefined, enableJsonResponse: true`,
fresh server+transport per request) with the deployment as the deciding fact, and
§5.6 pre-decides the fallback if a real client refuses it.

**AC6 — nothing re-opens a frozen decision: PASS, no blocking finding.** Walked
all nine `ctx.sh frozen` entries. Remote/Streamable-HTTP/in-app mount → §1, §5.1,
§5.4. Separate credential + allow-list → §2, §3. Static bearer → §11.1 as a
recorded scope-down. No IP allow-list → §1 default 1 and §13 item 4. Backend-only
→ §9.1. Write-tool set → §7.2 exactly. The one apparent conflict is the frozen
line "`get_flight_stats` and `search_flights` are the only two tools with no
existing backing route" versus `get_weather`'s `route: null` (§7.3,
`ROUTELESS_TOOLS`) — **not a re-opening**: T-001's own acceptance criterion 8
*requires* `get_weather` to call `getCachedWeather()` rather than proxy
`POST .../acars-messages/wx`, because that route writes two ACARS rows. The plan
resolved this itself; the frozen-decisions phrasing is what is stale. Recorded
for the Orchestrator, not charged against the design. Likewise §7.2's
`import_simbrief_leg` "no new backend logic beyond the code motion in §6.5" is a
disclosed narrowing of T-001 AC10, argued in §6.5 and guarded by must-not-change
item 7 and risk 8 — the alternative (duplicating the dedup hash) is worse.

**AC7 — verdict with section references: PASS** (this document).

## Non-blocking findings

**F1 — §5.2's premise is false; the `tsconfig.json` `baseUrl`/`paths` addition
appears unnecessary.** §5.2 and `prototypes/TRANSCRIPT.md` § 2 claim the node10
resolver "cannot find the SDK's types on its own". It can: the SDK ships
`typesVersions: {"*":{"*":["./dist/esm/*"]}}`. Reproduction (scratch dir, Node
20.20.2, tsc 5.9.3, the repo's exact compilerOptions, `registerTool` +
`StreamableHTTPServerTransport` sample file):

    # with baseUrl+paths removed:
    npx tsc -p tsconfig.nopaths.json   → exit=0
    --traceResolution: '@modelcontextprotocol/sdk/server/mcp.js' was successfully
      resolved to '.../@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts'

Adding the mapping is harmless (it also compiles clean), but `baseUrl: "."`
changes non-relative resolution for every import in `src/**` to buy nothing.
Suggested: the phase-2 implementer compiles once without the addition and adds it
only if that fails, amending §5.2 in §0 either way.

**F2 — §5.1's zod constraint is correct; keep the `^4` pin exactly as frozen.**
Not a defect — recorded because it is the one claim that would silently cost a
round if an implementer "simplified" it. Same scratch harness: `zod@3.25.76` →
`src/t.ts(5,1): error TS2589: Type instantiation is excessively deep and possibly
infinite` at `registerTool`; `zod@4.6.5` → exit 0. The SDK's declared peer range
is `^3.25 || ^4.0`, so npm will not warn — only `tsc` catches it.

**F3 — contract stubs contradict §3.2/§6.4/§7.1 on `route`'s type.**
`contracts/mcpTools.d.ts` declares `McpToolDescriptor.route: string` and
`contracts/mcpAuth.d.ts` declares `assertToolRoutesAreScoped(tools: readonly {
name: string; route: string; kind }[])`, but the prose requires `route: string |
null` so `get_weather` can declare `null`. An implementer following the stub hits
a type error on the one tool the exemption exists for. Prose governs; the stubs
should read `string | null`.

**F4 — §3.2's assertion rule 2 is one-directional.** It fails a tool declaring
`kind: 'read'` on a `write` route, but not a tool declaring `kind: 'write'` on a
`read` route. Since the point is an honest audit table, an equality check
(`tool.kind === entry.kind`) costs nothing and closes the other direction.

**F5 — `isMcpScopedRoute` (§2.3 item 2, §9.2) has no caller.** Under §6.1's
in-process architecture nothing consults the list at request time, so the
predicate ships dead. Either name its consumer (a unit test over the table would
be a fair one) or drop it and keep the constant plus the assertion.

Nit, no action needed: §12 item 9 describes the existing `SyntaxError` path list
as `/api/ground-sessions*`; the code (`src/server.ts:215–220`) matches
`/api/ground-sessions` and `/api/ground-sessions/current` exactly. §12 item 2's
"19 entries" is correct — `src/auth/ingestScope.ts` lines 16–34.

## Follow-ups worth tracking (not for this phase)

- SDK 1.30.0 declares `express@^5.2.1`, `hono`, `jose`, `ajv`, `pkce-challenge`
  and `express-rate-limit` as **dependencies**, not optional peers. Nothing this
  design imports loads them, and the nested express 5 cannot shadow the repo's
  express 4, but it is a sizeable transitive tree arriving in a repo on express 4
  — worth a line in the DevOps/Ship step. §13 covers SDK churn but not footprint.
- §13 item 7's one-off check (`SELECT DISTINCT length(start_time) FROM flights`)
  should actually be run read-only during phase 2; §10.2's string comparison rests
  on it.

## Safety

Design review only — no code exists and none was written; this file is the only
file created. No server was started; nothing was built or emitted into `dist/`.
The live database was opened once, read-only, as a smoke check:
`md5(flights.db) = ea10eab7b3fa1a2af2605ff048c52401`, `max(flights.id) = 93` —
unchanged structure, no writes issued from this review. All verification ran in
the session scratchpad (`.../scratchpad/rev-mcp`, npm install + `tsc` only),
which has been removed.
