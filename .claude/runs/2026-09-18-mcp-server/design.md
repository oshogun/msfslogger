# Design freeze — MCP server integration

Run: 2026-09-18-mcp-server. Frozen 2026-09-18.

Sections are numbered for `.claude/tools/ctx.sh design 2026-09-18-mcp-server <n>`.
The numbering is stable: an amendment edits a section in place and is recorded
in §0, it never renumbers or renames a heading.

Nothing in this document's numbering, and no run id, task id, file name or the
word "amendment", may appear in a comment in `src/**`, `client/src/**` or
`tests/**`. Where a decision's reasoning belongs in the code, write the
reasoning itself.

## 0. Amendments

| # | Date | Section | What reality contradicted | Evidence |
|---|---|---|---|---|
| 1 | 2026-09-18 | §9.2 / §6.4 | `FlightStatsFilter`, `AircraftStat`, `RouteStat`, `FlightStats` and `FlightSearchResult` were frozen into `src/types.ts`. They instead live in `src/db/flights.ts` (lines ~282–320, 416). `src/types.ts` was in no phase-2 task's `allowed_paths` (T-004, which introduced these types, was scoped to `src/db/flights.ts` / `src/routes/flights.ts` / `tests/db/flights.test.ts` only), so the implementer could not have complied. No consumer is cut off — `src/routes/flights.ts` and `src/mcp/tools/read.ts` both import them from `../db/flights` without issue. Accepted as-is; not worth a code move. | T-004's own report; confirmed independently by the phase-2 reviewer (`reviews/phase-2.md`, non-blocking follow-up). |
| 2 | 2026-09-18 | §5.2 | This section called for a `tsconfig.json` `baseUrl`/`paths` addition mapping `@modelcontextprotocol/sdk/*` to its shipped CJS build, reasoning that the Node10 module-resolution strategy (`module: commonjs`) would not see the package's `exports` field. In practice the SDK's own `typesVersions` field already resolves `@modelcontextprotocol/sdk/server/mcp.js` to `dist/esm/server/mcp.d.ts` for the type-checker while `require()` separately resolves `dist/cjs` via `exports` at runtime — two different builds of the same source, but both resolve correctly with no `tsconfig.json` change. T-005 did not make the addition; `npx tsc --noEmit` and `npx tsc --traceResolution` were used to confirm resolution succeeds without it. | Phase-2 reviewer, `reviews/phase-2.md`: `tsc --traceResolution` output showing `dist/esm/server/mcp.d.ts` resolved under the Node10 resolver with no `baseUrl`/`paths` set. |

## 1. Scope, frozen inputs, and the defaults this design takes

What this run adds: a Model Context Protocol endpoint served by the existing
Express app, a second credential that authorizes it, two new read-only `/api`
routes it needs, and 18 tools over the existing logbook. No schema change (§8),
no client change (§9).

**Inherited frozen decision (from `intake.md`, the user's own words):** remote
access is a hard requirement — "the server is meant to run headless in a homelab
scenario". A stdio-transport MCP server is therefore ruled out, and §5 freezes
Streamable HTTP inside the existing app.

**Defaults this design takes on questions the intake left open.** Recorded here
so they are decisions, not assumptions:

1. **Security model is TLS + bearer-token secrecy only. No IP allow-list, no
   OAuth 2.1, no mTLS in v1.** How the homelab exposes the port (reverse proxy,
   Tailscale, port-forward) stays the operator's business, documented not
   enforced. This matches the posture `INGEST_TOKEN` already has and is
   proportionate for one operator; §13 records what would falsify it.
2. **MCP is opt-in and off by default** — unset `MCP_TOKEN` means the endpoint is
   not mounted (§2.1). A pull that adds this feature must not change what the
   user's currently-running server does.
3. **Tools call in-process functions, not the server's own HTTP surface** (§6.1).
4. **Write tools are exactly the four in the intake's success criterion 3.** No
   DELETE, no combine, no PDF upload, no SayIntentions link/import/clearance/send,
   no settings or credential write is reachable — enforced three ways: the tool
   registry (§7), the allow-list assertion (§3.2), and the import list of
   `src/mcp/**` (§6.1).

**Deliberate scope-downs, so a later run can find them:** static bearer token
rather than OAuth 2.1 (§11.1); stateless sessions, so no server-initiated
notifications or resumable streams (§5.3); no MCP *resources* or *prompts*, only
tools (§11.5).

## 2. Auth — `MCP_TOKEN`, and why it shares nothing with the ingest token

### 2.1 The environment variable

`MCP_TOKEN` — **optional, with MCP disabled when unset.** This is deliberately
*not* `INGEST_TOKEN`'s required-with-fatal-refusal-to-start policy.

- `INGEST_TOKEN` is fatal-if-missing because `/api/ingest/*` is mounted
  unconditionally: an unset token would leave a live write path open to anyone
  who can reach the server. That hazard exists whether or not the operator wants
  the feature.
- The MCP endpoint is mounted *only* when a token is configured, so an unset
  token leaves no surface at all. Making it fatal would mean every existing
  deployment — including the user's running server — refuses to start after
  pulling this feature, which contradicts success criterion 5.

Resolution rules, in `loadConfig()` (`src/config.ts`), added as a new numbered
step after the existing Step 6 and before Step 7 (the session-secret step), so
that a bad `MCP_TOKEN` never pre-empts an existing fatal check:

| Condition | Behaviour |
|---|---|
| `MCP_TOKEN` unset or empty | `mcp = { token: null, enabled: false }`. One `console.log` line at startup: `MCP endpoint disabled (MCP_TOKEN is not set).` Not a warning — off is a valid steady state. |
| set, length < 16 | Warning, **not** fatal, mirroring Step 5's `INGEST_TOKEN` policy verbatim in shape: `MCP_TOKEN is shorter than 16 characters — consider a longer random value.` Feature still enables. |
| set, equal to `INGEST_TOKEN` | Warning, not fatal: `MCP_TOKEN and INGEST_TOKEN are set to the same value — revoking one will not revoke the other. Use two different random values.` See §11.2 for why not fatal. |
| set, and TLS disabled with `ALLOW_PLAINTEXT_HTTP` | Warning appended to the existing plaintext warning's neighbourhood (a separate `console.warn`, the existing string is not edited): `WARNING: the MCP token crosses the network unencrypted because ALLOW_PLAINTEXT_HTTP is set.` |

`AppConfig` gains exactly one key, `mcp: McpConfig`; `ENV_VARS` gains exactly one
entry, `'MCP_TOKEN'`. Types in `contracts/mcpAuth.d.ts`; ownership in §9.2.

The token is presented as **`Authorization: Bearer <token>`**, not a custom
header: every MCP client speaks bearer auth for HTTP transports, and a custom
`x-mcp-token` header would not be settable from a stock client. A missing or
wrong credential answers `401` with `WWW-Authenticate: Bearer
realm="msfslogger-mcp"` and the body in
`contracts/samples/mcp-401.json`, before the MCP transport sees the request.

### 2.2 `src/auth/mcpToken.ts` (new file)

A deliberate, self-contained copy of `src/auth/ingestToken.ts`'s shape:

- `mcpSha256(value): Buffer` — its own local `createHash('sha256')` helper. It
  does **not** import `sha256` from `ingestToken.ts`; see §2.5.
- `mcpTokenDigest(token: string | null): Buffer | null` — digest computed **once,
  at gate construction**, never per request.
- `mcpTokenMatches(presented: string | undefined, tokenDigest: Buffer): boolean`
  — `timingSafeEqual` over two 32-byte digests, so the comparison cannot throw on
  a length mismatch and leaks nothing about the token's length. An empty or
  missing credential is `false` without comparing.

Signatures in `contracts/mcpAuth.d.ts`.

### 2.3 `src/auth/mcpScope.ts` (new file)

Holds three things:

1. `MCP_SCOPED_ROUTES` — a **hardcoded TypeScript constant**, not an env var,
   exactly as `INGEST_SCOPED_ROUTES` is implemented today despite its ALL-CAPS
   name. Table in §3.
2. `isMcpScopedRoute(method, path)` — same predicate shape as
   `isIngestScopedRoute`.
3. `createMcpTokenGate(mcp: McpConfig): RequestHandler` — the gate described in
   §2.4, plus `assertToolRoutesAreScoped()` (§3.2).

### 2.4 How this composes with `requireAuth` / `requireSameOrigin`

**Frozen: the MCP endpoint's auth is fully separate from `/api`'s `requireAuth`
chain. `src/auth/middleware.ts` and `src/auth/ingestScope.ts` are not modified
by this run.**

The alternative — teaching `requireAuth` to accept an `'mcp'` scope result the
way it accepts `'ingest'` today — was considered and rejected (§11.3). The
deciding facts:

- With in-process tools (§6.1) nothing ever *needs* to authenticate an `/api`
  request with the MCP token, so extending `requireAuth` would widen the
  credential surface — an external client holding `MCP_TOKEN` could then call
  ~19 `/api` routes directly — without buying anything this run uses.
- Success criterion 5 ("nothing about the existing web UI, ingest path, or
  Windows-agent auth changes behaviour") is cheapest to guarantee, and cheapest
  for the Reviewer to check, when the files that implement that behaviour are
  untouched.

Concretely:

- `createMcpTokenGate` is mounted **only on the `/mcp` router**
  (`router.use(gate)`), never `app.use()`d globally. It never sees an `/api`
  request, never reads `req.session`, and marks nothing on the request object —
  there is no MCP analogue of `ingestScopeOf()`.
- `requireAuth` is `/api`-mounted; `/mcp` is outside `/api`, so it is not gated
  by it and does not need an exemption.
- `requireSameOrigin` already returns at its step 2 for any non-`/api` path, so
  `/mcp` is outside CSRF handling by construction — correctly: the endpoint
  authenticates by `Authorization` header, never by cookie, so a cross-site page
  cannot authenticate to it (a browser cannot attach an `Authorization` header
  cross-origin without a CORS preflight the server never approves — the MCP
  router sets no CORS headers at all).
- Session cookies are irrelevant to `/mcp` and must stay that way: the router is
  mounted **above** `express-session` (§5.4), so an MCP request never allocates
  or touches a session row.

### 2.5 Why this shares no digest, module or constant with the ingest token

Success criterion 4 is "revoking one must not affect the other". The design
takes that literally at the code level, not only at the value level: `MCP_TOKEN`
has its own config field, its own digest computed from its own value, its own
compare function, its own allow-list constant and its own gate. `src/auth/mcpToken.ts`
has **no import edge** to `src/auth/ingestToken.ts` — not even for the 3-line
`sha256` helper — so either file can be deleted, or either credential's policy
changed, without reading the other. Sharing a module would cost ~25 duplicated
lines and buy a coupling whose only failure mode (a caller passing the wrong
digest to a shared `tokenMatches`) is exactly the coupling criterion 4 forbids.

## 3. `MCP_SCOPED_ROUTES` — the allow-list

### 3.1 The table

Every method+path pair the 18 tools of §7 correspond to, cross-checked against
`docs/api.md`. Pattern style is copied from `INGEST_SCOPED_ROUTES`: anchored,
exact path, one `[^/]+` segment per `:param`, no trailing slash, no wildcards.
`name` is the stable audit name a tool descriptor cites.

| # | Method | Path | `name` | kind | Tool(s) |
|---|---|---|---|---|---|
| 1 | GET | `/api/flights` | `flights-list` | read | `list_flights` |
| 2 | GET | `/api/flights/search` | `flights-search` | read | `search_flights` |
| 3 | GET | `/api/flights/stats` | `flights-stats` | read | `get_flight_stats` |
| 4 | GET | `/api/flights/:id` | `flight-read` | read | `get_flight` |
| 5 | GET | `/api/flights/:id/acars-messages` | `flight-acars-read` | read | `get_acars_thread` |
| 6 | GET | `/api/trips` | `trips-list` | read | `list_trips` |
| 7 | GET | `/api/trips/:id` | `trip-read` | read | `get_trip` |
| 8 | GET | `/api/trips/:id/journey` | `trip-journey` | read | `get_journey` |
| 9 | GET | `/api/trips/:id/planned-legs` | `trip-planned-legs` | read | `list_planned_legs` (with `trip_id`) |
| 10 | GET | `/api/planned-legs` | `planned-legs-list` | read | `list_planned_legs` (without `trip_id`) |
| 11 | GET | `/api/planned-legs/:legId` | `planned-leg-read` | read | `get_planned_leg` |
| 12 | GET | `/api/planned-legs/:legId/acars-messages` | `planned-leg-acars-read` | read | `get_acars_thread` |
| 13 | GET | `/api/acars/canned-messages` | `acars-canned-messages` | read | `list_canned_messages` |
| 14 | GET | `/api/status` | `status` | read | `get_status` |
| 15 | GET | `/api/ground-sessions/current` | `ground-session-current` | read | `get_ground_session` |
| 16 | PATCH | `/api/flights/:id` | `flight-edit-notes` | write | `update_flight_notes` |
| 17 | POST | `/api/trips` | `trip-create` | write | `create_trip` |
| 18 | POST | `/api/trips/:id/flights` | `trip-assign-flight` | write | `assign_flight_to_trip` |
| 19 | POST | `/api/planned-legs/simbrief` | `planned-leg-simbrief-import` | write | `import_simbrief_leg` |

Rows 2 and 3 are the two new routes of §4; every other row exists today in
`docs/api.md`. Rows 1, 4, 6–11 and 16–18 are session-only today and stay
session-only — appearing here does not add a credential to them (§2.4). Rows 5,
12, 13, 14, 15 and 19 happen to also be in `INGEST_SCOPED_ROUTES`; the two lists
are independent constants that coincide, with no shared code and no shared name
space. Those six names (`flight-acars-read`, `planned-leg-acars-read`,
`acars-canned-messages`, `status`, `ground-session-current`,
`planned-leg-simbrief-import`) are spelled the same in both lists on purpose:
they name the same route, and a reader comparing the two lists should see the
match immediately.

Not present, and therefore unreachable, by design: every `DELETE`,
`POST /api/flights/combine`, the flight-plan PDF routes, every export route,
every ACARS **POST**, every SayIntentions route, `PUT /api/active-trip`, the
`.lnmpln` upload routes, `PATCH /api/planned-legs/:legId`, the planned-leg
link/status `PUT`s, `POST /api/ground-sessions`, `DELETE
/api/ground-sessions/current`, and both settings `PUT`s.

### 3.2 What makes the list load-bearing rather than decorative

Because tool handlers call in-process functions (§6.1), no Express gate consults
this list at request time. It is kept honest by a **startup assertion** instead:

- Each tool descriptor (§6.4) declares `route: string | null` and `kind: 'read' |
  'write'`.
- `assertToolRoutesAreScoped(tools)` runs once, inside `createMcpRouter()`, at
  server construction. It throws a plain `Error` — which surfaces the same way
  any startup failure does, before a listener is open — if any of these hold:
  1. a tool's `route` is not a `name` in `MCP_SCOPED_ROUTES`;
  2. a tool declares `kind: 'read'` while its route's entry is `kind: 'write'`;
  3. a tool's `route` is `null` and its name is not in the hardcoded
     `ROUTELESS_TOOLS` exemption set — which contains exactly one entry,
     `get_weather`, for the reason in §7.3.

So adding a nineteenth tool without an allow-list entry fails at startup, not in
production, and the Reviewer's audit of "what can MCP reach" is the §3.1 table
plus a one-line exemption set.

## 4. Two new API routes

Both are read-only, session-authenticated like the rest of
`src/routes/flights.ts`, additive, and useful to the web UI and the MCDU client
independently of MCP. They live in `createFlightsRouter()`
(`src/routes/flights.ts`) and are backed by two new functions in
`src/db/flights.ts` (§4.4). The MCP tools do **not** call these routes — they
call the same db functions in process (§6.1) — so the routes and the tools
cannot disagree about *data*, only about *presentation*.

### 4.1 `GET /api/flights/stats`

Aggregates over the whole logbook, optionally date-bounded.

**Query parameters**

| Name | Type | Required | Default | Rule |
|---|---|---|---|---|
| `from` | string | no | none | `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM[:SS[.mmm]]Z`. Inclusive lower bound on `start_time`. |
| `to` | string | no | none | Same grammar. **Exclusive** upper bound on `start_time`. |

Normalisation and comparison rules are in §10.2 — they are load-bearing and must
be implemented exactly as written there.

**Responses**

- `200` — body per `contracts/samples/flight-stats-200.json`; shape
  `FlightStats` (`contracts/flightsQueries.d.ts`). An empty logbook or an empty
  range returns zeros, `null` first/last, and empty `top_*` arrays — never `404`.
- `400 {"error": "from must be a date (YYYY-MM-DD) or a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)", "code": "INVALID_RANGE"}`
  — same body with `to` substituted when it is the bad one; `from` is validated
  first.
- `500 {"error": "<String(err)>"}` — the existing idiom in this router.

### 4.2 `GET /api/flights/search`

Free-text match over a flight's text columns.

**Query parameters**

| Name | Type | Required | Default | Rule |
|---|---|---|---|---|
| `q` | string | **yes** | — | 1–200 characters after trimming; 1–8 whitespace-separated terms. |
| `limit` | integer | no | `25` | 1–100. |
| `offset` | integer | no | `0` | ≥ 0. |

**Responses**

- `200` — `FlightSearchResult`, sample in `contracts/samples/flight-search-200.json`.
  `flights[]` are full `Flight` rows in exactly the shape `GET /api/flights`
  returns (no `points`), ordered `start_time DESC`. `total` is the match count
  ignoring `limit`/`offset`, so a caller can page.
- `400` `INVALID_QUERY` (missing, blank, or >200 chars — body in
  `contracts/samples/flight-search-400.json`), `TOO_MANY_TERMS` (>8 terms),
  `INVALID_LIMIT`, `INVALID_OFFSET`.
- `500 {"error": "<String(err)>"}`.

Matching semantics are in §10.3.

### 4.3 Routing order — load-bearing

Both routes **must be registered before `router.get('/flights/:id')`** in
`createFlightsRouter()`, for exactly the reason
`router.post('/flights/combine')` already sits there: Express matches in
registration order, so a later-registered literal is shadowed by the earlier
`:id` parameter route. The failure is silent and looks like a data bug, not a
routing bug — `GET /api/flights/stats` would reach the `:id` handler,
`parseInt('stats', 10)` would be `NaN`, and the endpoint would answer
`400 {"error":"Invalid id"}` forever.

Frozen order inside the router: `/flights` → `/flights/combine` →
**`/flights/search`** → **`/flights/stats`** → `/flights/:id` → the rest,
unchanged. The comment already above `/flights/combine` explains the rule; the
new routes get one line each saying the same thing in their own words, with no
cross-reference to this document.

Nothing else in the app can shadow them: `src/server.ts` mounts the flights
router before the trips/planned-legs/ACARS routers, and all of those match
different first segments or more segments.

### 4.4 New functions in `src/db/flights.ts`

Three exported functions, signatures in `contracts/flightsQueries.d.ts`:

- `getFlightStats(filter: FlightStatsFilter): FlightStats` — one prepared
  `SELECT` of nine columns, aggregated in TypeScript (§10.1). It reuses the
  module-private `ownDurationSec()` already in this file rather than a second
  duration rule.
- `searchFlights(tokens, limit, offset): Flight[]`
- `countSearchFlights(tokens): number` — the same `WHERE` clause, `COUNT(*)`.

`searchFlights` and `countSearchFlights` build their `WHERE` from the same
private helper so the two can never drift; the helper returns `{ sql, params }`
and is not exported.

No other function in `src/db/flights.ts` changes.

## 5. MCP transport, package, and mount

### 5.1 Package and version — verified against the real package

**`@modelcontextprotocol/sdk`, added to `dependencies` as `^1.30.0`** (1.30.0 is
what npm resolves today), plus **`zod` as a direct dependency at `^4.6.5`**.

Everything in this subsection was executed under Node 20.20.2 in the session
scratchpad, never in this checkout; the full transcript is
`prototypes/TRANSCRIPT.md` and the server that produced it is
`prototypes/mcp-streamable-http-proto.ts`.

- The SDK is published `"type": "module"`, and **every version checked** (1.12.3
  → 1.30.0) is, so "use an older CommonJS release" is not an option. It is
  nevertheless dual-published: `package.json#exports` carries a `require`
  condition per subpath and `dist/cjs/**` ships its own `.d.ts`. `require(
  '@modelcontextprotocol/sdk/server/mcp.js')` returns `{ McpServer,
  ResourceTemplate }` under Node 20.20.2 with no `ERR_REQUIRE_ESM`. The project
  keeps `"module": "commonjs"`.
- **zod 4 is required.** With `zod@3.25.76` — which the SDK also accepts at
  runtime — `server.registerTool(...)` fails to compile under this project's
  `strict` settings: `error TS2589: Type instantiation is excessively deep and
  possibly infinite`. With `zod@4.6.5` the same file compiles clean. Pin `^4`.

### 5.2 One `tsconfig.json` addition, and why it is the smallest one

`"module": "commonjs"` selects the *node10* resolver, which does not read
`package.json#exports`, so `tsc` cannot find the SDK's types on its own. Add to
`compilerOptions` (and nothing else):

```jsonc
"baseUrl": ".",
"paths": {
  "@modelcontextprotocol/sdk/*": ["./node_modules/@modelcontextprotocol/sdk/dist/cjs/*"]
}
```

Rejected alternative: switching to `"module": "node16"` — that is the
"correct" fix, but it changes resolution semantics for every import in `src/**`
at once, on a tree with no test coverage of module loading, to buy nothing this
run needs (§11.4). The `paths` entry affects exactly one package name.

`tsconfig.test.json` extends the root config, so `npm run test:types` picks the
mapping up automatically; the implementer verifies that rather than assuming it.

### 5.3 Stateless, not stateful

`new StreamableHTTPServerTransport({ sessionIdGenerator: undefined,
enableJsonResponse: true })` — a **fresh `McpServer` and a fresh transport per
HTTP request**, closed when the response closes.

The deciding fact is the deployment: one operator, a homelab box, a handful of
concurrent Claude clients at most, and a server that the user restarts by hand.
Stateful mode would buy resumable SSE streams and server-initiated notifications
at the cost of a session map that leaks memory on every client that disconnects
without a `DELETE`, survives no restart, and needs its own eviction policy.
Nothing in the 18 tools of §7 pushes data to the client, so there is nothing to
resume.

Verified in the prototype: with `sessionIdGenerator: undefined` the
`initialize` response carries **no** `mcp-session-id` header, and `tools/list` /
`tools/call` succeed on a *fresh* request with no prior handshake — which is
what makes per-request construction correct rather than merely convenient.

`enableJsonResponse: true` makes a request/response call answer
`content-type: application/json` instead of opening an SSE stream, which is
friendlier to a reverse proxy. Note (prototype finding, and the top cause of a
confusing manual test): **the SDK still requires the client to send `Accept:
application/json, text/event-stream`**; either type alone is answered
`{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must
accept both application/json and text/event-stream"},"id":null}`. Any `curl`
smoke test must send both.

### 5.4 Mount path and middleware order in `src/server.ts`

**Path: `/mcp`.** Top-level, deliberately outside `/api`: it is a protocol
endpoint, not a REST resource, it authenticates differently, and keeping it
outside `/api` is what lets §2.4 leave `requireAuth` alone.

Exactly one block is added to `createServer()`, immediately after the
`app.use('/api/ingest', ...)` mount and **before** `app.use(session({...}))`:

```ts
if (config.mcp.enabled) {
  app.use('/mcp', createMcpRouter(config.mcp, flightManager));
}
```

The position carries three guarantees, and the code comment there states them in
its own words:

1. `express.json()` (line 1 of the middleware chain) has already parsed the body
   — required by §5.5.
2. Above `session()`, for the same reason the ingest router is: an MCP client
   sends no cookie, and an MCP request must never allocate or touch a session
   row.
3. Far above the SPA catch-all `app.get('*')`, which would otherwise answer
   `GET /mcp` with `index.html`.

`express.static(client/dist)` sits above this mount and is harmless — there is no
file named `mcp` in the client build — but the guard against a future one is
that `/mcp` is a directory-less exact path and the static middleware calls
`next()` on a miss.

When `config.mcp.enabled` is false nothing is mounted, nothing is imported at
request time, and `GET /mcp` falls through to the SPA catch-all exactly as any
unknown path does today.

### 5.5 Coexisting with the already-mounted `express.json()`

`app.use(express.json({ limit: config.jsonBodyLimit }))` is the first middleware
in the app and is **not** changed, excluded, or re-ordered. The transport is
handed the parsed body explicitly:

```ts
await transport.handleRequest(req, res, req.body);
```

This is the SDK's documented path for a body-parser'd app and is what the
prototype exercised for every call in the transcript. Two consequences:

- The 100 KB JSON limit applies to MCP requests too. That is ample — the largest
  inbound MCP message is a `tools/call` with a handful of scalar arguments — and
  keeping one limit for the whole app is worth more than a bespoke one here.
- **A malformed JSON body never reaches the transport.** `express.json()` throws
  first, and today that lands in Express's default error handler, which answers
  an HTML page (confirmed in the prototype). The `SyntaxError` branch of the
  error middleware at the bottom of `src/server.ts` therefore gains `req.path ===
  '/mcp'` to its existing path list, answering `400` with
  `contracts/samples/mcp-parse-error.json` — a JSON-RPC parse error, `id: null`,
  per JSON-RPC 2.0. Every other path in that condition keeps its current body
  byte-for-byte (§12).

### 5.6 Methods: POST only; GET and DELETE answer 405

`createMcpRouter` handles `POST /` through the transport. `GET` and `DELETE`
answer `405` with `Allow: POST` and the body in
`contracts/samples/mcp-405.json`; every other method falls through to the same
405.

A stateless server has no server-initiated stream to offer, and the MCP spec
explicitly allows `405` for `GET` at an endpoint that does not support it. If
`GET` were left to the SDK it would happily open an SSE stream that can never
carry a message and would be held open by the client indefinitely — the
prototype confirms it returns `200 text/event-stream` and blocks. `DELETE`
(session teardown) is meaningless without sessions.

Fallback, pre-decided so it is not a new architectural decision mid-run: if a
real client turns out to refuse a server whose `GET` is 405, hand `GET` to
`transport.handleRequest` as well and record it as an amendment in §0 — do not
switch to stateful mode for it.

## 6. Tool implementation architecture

### 6.1 In-process calls, not internal HTTP — and what that costs

**Frozen: every tool handler calls the underlying `src/db/*.ts`, `src/acars.ts`,
`src/weatherClient.ts`, `src/journey.ts`, `src/simbriefImport.ts` and
`FlightManager` functions directly, in process. No tool makes an HTTP request
back into this server.** `MCP_SCOPED_ROUTES` is consequently an audit list
rather than a live Express gate — kept load-bearing by the startup assertion in
§3.2.

Why, given this server has no precedent for a loopback self-call:

1. **It would require trusting our own TLS cert from inside the process.** The
   server serves HTTPS with a self-signed cert; a loopback `fetch` would need
   `rejectUnauthorized: false` (a hostname check against `127.0.0.1` fails even
   with the cert as `ca`). A permanent "verification off" flag in `src/**` is a
   footgun that outlives this feature.
2. **It would need a second credential accepted on `/api`.** The loopback
   request has to authenticate, which means extending `requireAuth` to honour an
   MCP scope — widening the credential surface (§2.4) and touching the files
   success criterion 5 protects.
3. **It would need to guess its own reachable address** from `bindHost`/`port`
   (`0.0.0.0` → `127.0.0.1`, `::` → `::1`, otherwise the literal host), a rule
   with an edge case for every deployment shape.
4. **It is not unit-testable.** The Vitest suite mocks `./db` and never opens a
   socket (`.claude/ENVIRONMENT.md` § Verification); in-process handlers fit that
   harness, HTTP self-calls do not.
5. **"No deletes reachable" becomes a compile-time property.** `src/mcp/**`
   never imports `deleteFlight`, `deleteTrip`, `deletePlannedLeg`,
   `combineFlights`, `setActiveTrip`, `setSetting`, or anything under
   `src/sayIntentionsClient.ts`. A Reviewer checks it with one `grep` over the
   module's import lines, and a violation fails `tsc`, not a request.

What it costs, honestly: the tools' output shapes are *not* automatically the
routes' response shapes, so the two can drift in presentation. §6.3 answers that
by making the tool projections deliberately distinct and documented, rather than
pretending they mirror the API. The one place where genuine orchestration lives
in a route rather than in `src/db/**` is the SimBrief import, and §6.5 resolves
that by extracting it so both callers share one implementation.

### 6.2 Error mapping — `isError` content, never a thrown JSON-RPC error

Three layers, and the boundary between them is frozen:

| Layer | Example | Answer |
|---|---|---|
| Transport / auth | wrong or missing bearer token; malformed JSON; `GET /mcp` | HTTP status before the tool layer: `401` (§2.1), `400` parse error (§5.5), `405` (§5.6) |
| Protocol | unknown tool name; arguments that fail the zod schema | The SDK's own `-32602` handling, surfaced as `isError` content — verified in the prototype, not something the implementer writes |
| Tool | flight not found; no SimBrief pilot ID saved; weather upstream down | `toolError(sentence)` — `{ isError: true, content: [{ type: 'text', text: <sentence> }] }` |

Rules:

1. **A tool handler never throws for an expected failure.** Not found, empty,
   conflicting, upstream-refused: all return `toolError()` with one plain
   sentence a model can act on — `"No flight with id 999 exists in the logbook."`,
   `"No SimBrief pilot ID is saved on the server; set it in Settings first."`.
   Sample: `contracts/samples/mcp-tools-call-error.json`.
2. **Unexpected exceptions are caught by a shared wrapper**, `runTool(name, fn)`
   in `src/mcp/server.ts`, which logs `[MCP] tool <name> failed: <String(err)>`
   server-side and returns `toolError('Internal error while running <name>.
   Check the msfslogger server log.')`. This wrapper is not optional: without it
   the SDK stringifies the raw exception into the tool result (prototype item 6
   returned `"unhandled boom"` to the client), which can leak a SQL fragment, a
   filesystem path, or an upstream URL.
3. **No tool ever throws `McpError` deliberately.** JSON-RPC-level errors are the
   transport's business.
4. Error sentences never contain a stack trace, a file path, a SQL string, a
   token, or an API key.

### 6.3 Output shape and size discipline

Every successful tool returns **one text content block containing
`JSON.stringify(value)`** (no indentation, no `structuredContent`, no
`outputSchema`). Sample:
`contracts/samples/mcp-tools-call-get_flight.json`.

Why compact JSON in a text block: it is what every MCP client renders reliably
today, and `outputSchema`/`structuredContent` would add a second schema per tool
to keep in sync for no gain to the model.

The hard part is size — this logbook's natural objects are huge (a single
flight carries thousands of `flight_points`; `getTripById()` embeds every
flight's full track). Frozen caps, implemented in `src/mcp/projections.ts`:

| Tool family | Cap |
|---|---|
| `list_flights`, `search_flights`, `list_planned_legs` | `limit` default 25, max 100, plus `offset` |
| flight rows in any list | `FlightSummary` (11 fields), `notes` truncated to 200 chars with `…` appended iff truncated |
| `get_flight` | full row minus `points`; `track` is `null` unless `include_track: true`, then at most 200 points, downsampled per §10.4 |
| `get_trip` | trip fields + `flights: FlightSummary[]` (points stripped) + `planned_legs: PlannedLegSummary[]` |
| `get_planned_leg` | leg fields + waypoints and alternates, waypoints capped at 200 (`waypoints_truncated: true` when cut) |
| `get_acars_thread` | the 100 most recent messages, `truncated: true` when older ones were dropped |
| `get_status` | the projection in §7.3 — never the `traffic` array |

A tool that hits a cap says so in its payload; it never silently truncates.

### 6.4 File layout and type ownership

New files, one owner each, so parallel tasks do not collide:

| File | Owns |
|---|---|
| `src/auth/mcpToken.ts` | digest + timing-safe compare (§2.2) |
| `src/auth/mcpScope.ts` | `MCP_SCOPED_ROUTES`, `isMcpScopedRoute`, `ROUTELESS_TOOLS`, `assertToolRoutesAreScoped`, `createMcpTokenGate` (§2.3, §3.2) |
| `src/mcp/router.ts` | the Express router: gate, POST handler, 405s (§5.4–5.6) |
| `src/mcp/server.ts` | `buildMcpServer()`, `McpToolDescriptor`, `runTool()` (§6.2) |
| `src/mcp/tools/read.ts` | the 14 read tools (§7.1) |
| `src/mcp/tools/write.ts` | the 4 write tools (§7.2) |
| `src/mcp/projections.ts` | `FlightSummary`/`TripSummary`/`PlannedLegSummary`, `downsampleTrack`, `toolText`, `toolError` (§6.3) |
| `src/simbriefImport.ts` | `importSimbriefLooseLeg()` and its outcome type (§6.5) |

Modified files, and the whole of what changes in each: `src/config.ts` (one
config step, one `AppConfig` key, one `ENV_VARS` entry — §2.1); `src/server.ts`
(one mount block, one path added to the `SyntaxError` list — §5.4, §5.5);
`src/routes/flights.ts` (two routes — §4); `src/db/flights.ts` (three functions —
§4.4); `src/types.ts` (the stats/search types — §9.2); `src/routes/plannedLegs.ts`
(one handler reduced to an adapter — §6.5); `package.json`, `tsconfig.json`
(§5.1, §5.2).

MCP-only view types (`FlightSummary` and friends) live in
`src/mcp/projections.ts`, **not** `src/types.ts` — they are one consumer's
presentation, and putting them in the shared types file would invite a route or
the client to depend on them.

### 6.5 The one extraction: `src/simbriefImport.ts`

`import_simbrief_leg` is the only tool whose logic lives in a route handler
rather than in `src/db/**`: `POST /api/planned-legs/simbrief`
(`src/routes/plannedLegs.ts`) orchestrates settings read → SimBrief fetch →
parse → duplicate check → `createPlannedLeg()` → dispatch-release ACARS insert,
~85 lines, with a dedup hash and a dedup key that must not be computed twice in
two places. Duplicating it in the tool layer would put duplicate planned legs and
duplicate dispatch messages in the user's real logbook the first time the two
copies drift.

**Frozen: move that handler's body verbatim into a new module and have both
callers use it.**

- New file `src/simbriefImport.ts` exports `importSimbriefLooseLeg({
  allowDuplicates }): Promise<SimbriefImportOutcome>` — type in
  `contracts/simbriefImport.d.ts`. The outcome is a discriminated union carrying
  the exact `status` and `body` the route sends today, so the route handler
  becomes `const o = await importSimbriefLooseLeg({ allowDuplicates });
  res.status(o.status).json(o.body);`.
- **Pure code motion.** Every response body, status code and `console.log` /
  `console.error` string moves unchanged, including the `(no trip)` suffix and
  the `[SIMBRIEF]` prefixes. Step order — settings read, network call, parse,
  duplicate check, `createPlannedLeg` as the first and only write to
  `planned_legs`, then the ACARS dispatch release in its own try/catch — is the
  documented contract of that handler and does not move.
- **The trip-nested variant `POST /api/trips/:id/planned-legs/simbrief` is not
  touched.** It stays a separate copy. Deduplicating both is a bigger refactor
  than this run should carry, and the loose-leg route is the only one MCP needs.
- `res.status(200).json(x)` is byte-identical on the wire to today's
  `res.json(x)` for the duplicate case; that is the only call-shape change.

This is the one place where an implementer's `allowed_paths` must include
`src/routes/plannedLegs.ts`. If a phase-2 task's paths do not, the task is
blocked, not worked around.

## 7. Tool inventory — 18 tools

Names are `snake_case` verbs. Every input schema is a zod **raw shape**
(`{ field: z.… }`), which the SDK converts to JSON Schema for `tools/list`.
Unless a row says otherwise, output is `toolText(<the named value>)` (§6.3) and
failure is `toolError(<sentence>)` (§6.2). `route` is the `MCP_SCOPED_ROUTES`
name from §3.1 that the tool declares and the startup assertion checks.

### 7.1 Read tools (14)

| Tool | Input schema | Calls (in process) | Output | `route` |
|---|---|---|---|---|
| `list_flights` | `limit?: number.int().min(1).max(100)` (default 25), `offset?: number.int().min(0)` (default 0), `trip_id?: number.int()` | `getFlights()` (`src/db/flights.ts`), filtered by `trip_id` when given, then sliced | `{ total, limit, offset, flights: FlightSummary[] }` — already `start_time DESC` | `flights-list` |
| `get_flight` | `flight_id: number.int()`, `include_track?: boolean` (default false) | `getFlightById(id)`; `getTripName(trip_id)` when `trip_id` is set | Full flight row minus `points`, plus `trip_name` and `track` (`null`, or ≤200 downsampled points per §10.4). Not found → `toolError("No flight with id <id> exists in the logbook.")` | `flight-read` |
| `search_flights` | `q: string.min(1).max(200)`, `limit?` (1–100, default 25), `offset?` (≥0, default 0) | `searchFlights()` + `countSearchFlights()` (§4.4); tokenising and validation per §10.3, shared with the route | `{ query, total, limit, offset, flights: FlightSummary[] }` | `flights-search` |
| `get_flight_stats` | `from?: string`, `to?: string` (grammar in §4.1) | `getFlightStats()` (§4.4) | `FlightStats` verbatim (§4.1 sample) | `flights-stats` |
| `list_trips` | — (empty shape) | `getTrips()` | `{ trips: TripSummary[] }` — per-trip flights stripped; `getTrips()` already returns `planned_legs: []` | `trips-list` |
| `get_trip` | `trip_id: number.int()` | `getTripById(id)` | Trip fields + `flights: FlightSummary[]` + `planned_legs: PlannedLegSummary[]`. Not found → `toolError` | `trip-read` |
| `get_journey` | `trip_id: number.int()` | `getTripById(id)` then `buildJourney(trip.flights, trip.planned_legs)` (`src/journey.ts`) — the same two calls the route makes | `buildJourney`'s value verbatim | `trip-journey` |
| `list_planned_legs` | `trip_id?: number.int()`, `status?: enum('planned','flown','diverted','skipped')`, `limit?` (1–100, default 25), `offset?` (≥0, default 0) | `getPlannedLegsForTrip(trip_id)` when `trip_id` is given, else `getAllPlannedLegs()`; `status` filtered in JS | `{ total, limit, offset, planned_legs: PlannedLegSummary[] }` | `trip-planned-legs` when `trip_id` is given, else `planned-legs-list` — the descriptor declares `planned-legs-list`; both are on the list |
| `get_planned_leg` | `planned_leg_id: number.int()` | `getPlannedLegById(id)` | Leg fields + `waypoints` (≤200, `waypoints_truncated`) + `alternates`. Not found → `toolError` | `planned-leg-read` |
| `get_acars_thread` | `flight_id?: number.int()`, `planned_leg_id?: number.int()` — a zod `.refine` requires **exactly one** | `listAcarsMessagesForFlight(id)` or `listAcarsMessagesForPlannedLeg(id)` (`src/db/acarsMessages.ts`), after confirming the parent exists | `{ flight_id, planned_leg_id, total, truncated, messages }` — newest 100 (§6.3) | `flight-acars-read` (declared); `planned-leg-acars-read` is the same tool's other branch and is also on the list |
| `get_weather` | `icao: string.regex(/^[A-Za-z0-9]{3,4}$/)` — upper-cased before use | **`getCachedWeather(icao)` (`src/weatherClient.ts`) directly** — see §7.3 | `{ icao, metar, taf, fetched_at }` (`RawWeather`). `WeatherFetchError` → `toolError(err.userMessage)`, never the internal `message` | `null` (exempt, §3.2) |
| `list_canned_messages` | — | `CANNED_MESSAGES` (`src/acars.ts`), spread into a new array | `{ messages: CannedAcarsMessage[] }` — same envelope the route uses | `acars-canned-messages` |
| `get_status` | — | `flightManager.appState`, plus `getPlannedLegStatus(lat, lon)` while `FLYING` with a frame and `getGroundSessionStatus()` while `GROUND` | The projection in §7.3 — deliberately **not** `GET /api/status`'s body | `status` |
| `get_ground_session` | — | `getOpenGroundSession()` (`src/db/groundSessions.ts`) | `{ session: GroundSession \| null }` — the route's envelope, which distinguishes "none open" from an error | `ground-session-current` |

### 7.2 Write tools (4)

| Tool | Input schema | Calls (in process) | Output | `route` |
|---|---|---|---|---|
| `update_flight_notes` | `flight_id: number.int()`, `notes: string.max(4000)` — **no `aircraft` field exists in this schema** | `updateFlight(id, { notes })` then `getFlightById(id)` | The updated flight as `get_flight` renders it (no track). Not found → `toolError("No flight with id <id> exists in the logbook.")` | `flight-edit-notes` |
| `create_trip` | `name: string.min(1).max(200)` (trimmed), `notes?: string.max(4000).nullable()` | `createTrip(name.trim(), notes ?? null)` (`src/db/trips.ts`) — the exact call `POST /api/trips` makes after its own validation. No new backend logic. | `{ id, name, notes }` | `trip-create` |
| `assign_flight_to_trip` | `flight_id: number.int()`, `trip_id: number.int()` | `getTripById`, `getFlightById`, `assignFlightToTrip(flightId, tripId)`, then `flightManager.refreshPlannedLegForFlight(flightId)` — the exact sequence `POST /api/trips/:id/flights` performs, including the refresh, which is not optional: assignment can clear a planned-leg link and the live-status cache must be rebuilt. No new backend logic. | `{ ok: true, flight_id, trip_id, trip_name }` | `trip-assign-flight` |
| `import_simbrief_leg` | `allow_duplicates?: boolean` (default false) | `importSimbriefLooseLeg({ allowDuplicates })` (§6.5) — the same function `POST /api/planned-legs/simbrief` now calls. No new backend logic beyond the code motion in §6.5. | `kind: 'imported'` → `{ status: 'imported', planned_leg_id, label, warnings }`; `'duplicate'` → the same fields plus the duplicate sentence; `'error'` → `toolError(body.error)` | `planned-leg-simbrief-import` |

### 7.3 The tools that need more than a table cell

**`get_weather` calls `getCachedWeather()` directly, and has no route.** The
obvious HTTP equivalent is `POST /api/flights/:id/acars-messages/wx`, but that
route's job is to *file* ACARS messages: it writes a downlink request row and an
uplink reply row into the flight's thread. A nominally read-only tool that a
model may call speculatively ("what's the weather at EGLL?") must not mutate the
logbook, so the tool calls the side-effect-free read `getCachedWeather(icao)`
(`src/weatherClient.ts`) instead — the same function that route calls before it
writes anything. It shares the module's 5-minute cache, including the cached
failures, so a model retrying a dead ICAO does not hammer aviationweather.gov.
Because no `/api` route exposes this read, `get_weather` declares `route: null`
and is the single member of `ROUTELESS_TOOLS` (§3.2).

**`update_flight_notes` cannot reach `aircraft`, by construction.**
`PATCH /api/flights/:id` accepts `aircraft` and `notes`, and
`updateFlight()`'s own allow-list accepts both. Two mechanisms keep `aircraft`
unreachable from MCP, and both are required:

1. The tool's zod input shape declares `flight_id` and `notes` only. There is no
   `aircraft` key, so the SDK's validation strips/rejects it before the handler
   runs and `tools/list` never advertises it.
2. The handler builds a fresh object literal, `updateFlight(flightId, { notes }),`
   and **never forwards `req.body`, `args`, or a spread of either**. Even if the
   schema were later widened by accident, the payload handed to `updateFlight`
   has exactly one key.

The Reviewer checks both: the schema has no `aircraft`, and there is no spread
into `updateFlight` anywhere in `src/mcp/**`.

**`get_status` does not reuse `GET /api/status`'s body, on purpose.** That
handler is built inline in `src/server.ts` with a documented byte-identical
serialisation contract (conditional spreads so an unchanged `AppState`
serialises exactly as it did before `plannedLeg`/`groundSession`/`traffic`
existed), and it reads the `TrafficStore` instance that lives in
`createServer`'s closure. Extracting it would put that contract at risk for no
benefit. `get_status` returns its own flat projection instead:

```ts
{ connected, flight_state, current_flight_id, paused, pause_flags,
  sim_running, on_ground, aircraft,
  position: { lat, lon, altitude_ft, ground_speed_kts, heading_deg } | null,
  planned_leg: PlannedLegLiveStatus | null,
  ground_session: GroundSessionLiveStatus | null }
```

`traffic` is omitted entirely — up to 200 nearby AI aircraft are no use to a
language model and would dominate the payload.

**`list_planned_legs` and `get_acars_thread` each cover two allow-list rows.**
Each declares one `route` (`planned-legs-list` and `flight-acars-read`
respectively) for the §3.2 assertion; the second row in each case
(`trip-planned-legs`, `planned-leg-acars-read`) is the other branch of the same
tool and is listed in §3.1 so the audit table stays complete.

## 8. Data model and persistence

**No schema change. No migration. No DDL.** This run adds no table, no column,
no index, and no `ALTER TABLE` to `src/db/schema.ts`.

- The two new routes (§4) and the two new query functions (§4.4) are `SELECT`
  only.
- The four write tools (§7.2) write through functions that already exist and are
  already exercised by the web UI: `UPDATE flights SET notes`, `INSERT INTO
  trips`, `UPDATE flights SET trip_id` (plus the planned-leg bookkeeping
  `assignFlightToTrip` already does), and the SimBrief import's existing
  `planned_legs` + `acars_messages` inserts.
- `MCP_TOKEN` lives in the environment, never in the database — no `app_secret`
  row, nothing to migrate, and revocation is "unset the variable and restart".

Consequences for the live database, stated because the Reviewer checks them:
starting a server with this change against the user's existing `flights.db`
requires no migration step, and rolling back to the previous build leaves no
column or row that the old code cannot read. The only row a tool can create that
did not exist before is an ordinary `trips` row or an ordinary planned leg —
both indistinguishable from one the web UI would have made.

Performance note for `getFlightStats`: it reads nine columns for every matching
flight and aggregates in TypeScript rather than in SQL (§10.1), which is O(rows)
with a small constant on a single-operator logbook. §13 records the size at
which that stops being true.

## 9. Client contract and type ownership

### 9.1 The web client does not change in this run

`client/**` is untouched. The two new routes are additive and no component calls
them; no page, hook or type in `client/src` is added, removed or edited. If a
later run builds a stats page, it hand-mirrors the interface into
`client/src/types.ts` the way that file already mirrors `src/types.ts` — this run
does not introduce a shared package and does not pre-emptively copy types for a
consumer that does not exist.

The MCP client (Claude Desktop/Code) is the only consumer of `/mcp`, and its
contract is the tool list in §7 plus the transport in §5.

### 9.2 Where each shared type lives

| Type | File | Consumers |
|---|---|---|
| `McpConfig`, `AppConfig.mcp` | `src/config.ts` | `src/server.ts`, `src/auth/mcpScope.ts` |
| `McpScopedRoute`, `MCP_SCOPED_ROUTES`, `ROUTELESS_TOOLS` | `src/auth/mcpScope.ts` | `src/mcp/router.ts` |
| `McpToolDescriptor` | `src/mcp/server.ts` | `src/mcp/tools/*.ts` |
| `FlightSummary`, `TripSummary`, `PlannedLegSummary` | `src/mcp/projections.ts` | `src/mcp/tools/*.ts` only |
| `FlightStatsFilter`, `AircraftStat`, `RouteStat`, `FlightStats`, `FlightSearchResult` | `src/types.ts`, one contiguous block at the end of the flights section | `src/db/flights.ts`, `src/routes/flights.ts`, `src/mcp/tools/read.ts` |
| `SimbriefImportOutcome` | `src/simbriefImport.ts` | `src/routes/plannedLegs.ts`, `src/mcp/tools/write.ts` |

Stubs for all of these are in `contracts/` — `mcpAuth.d.ts`,
`flightsQueries.d.ts`, `mcpTools.d.ts`, `simbriefImport.d.ts`. They are reference
artifacts; nothing imports them.

## 10. Algorithms

Each rule below is written to be implemented twice and produce the same answer.
The route (§4) and the tool (§7) share one implementation of each — the tool
calls the db function, and the tokenising/normalising helpers live next to it.

### 10.1 Flight statistics aggregation

Input: the normalised `FlightStatsFilter` of §10.2. Steps:

1. `SELECT id, aircraft, start_time, end_time, duration_sec, distance_nm,
   departure_icao, arrival_icao, point_count FROM flights` with
   `WHERE start_time >= ?` and/or `WHERE start_time < ?` as the bounds require,
   no `ORDER BY`.
2. `totals.flights` = number of rows. `totals.completed_flights` = rows with
   `end_time` not null.
3. Per-row **effective duration** is the existing rule in `src/db/flights.ts`,
   reused, not re-derived: `duration_sec` when it is not null; otherwise
   `max(0, round((Date(end_time) - Date(start_time)) / 1000))`; otherwise `0`
   when there is no `end_time`. (This is `ownDurationSec()`, already in the file
   for `combineFlights`.) `totals.duration_sec` is the sum.
4. `totals.duration_hours` = `round(duration_sec / 3600 * 10) / 10`.
5. `totals.distance_nm` = `round(Σ (distance_nm ?? 0) * 10) / 10` — the same
   one-decimal rounding `combineFlights` uses.
6. `first_flight_start` / `last_flight_start` = lexicographic min/max of
   `start_time` over the matching rows, `null` when there are none.
7. **Top aircraft.** Group by `aircraft` exactly as stored — no trimming, no
   case folding, no model-name normalisation: "Cessna 172" and "Cessna 172
   Skyhawk" are different aircraft to this logbook, and guessing otherwise would
   invent data. Rows with a null or empty `aircraft` are skipped entirely (they
   are not bucketed under `"Unknown"`). Order by `flights` desc, then
   `duration_sec` desc, then `aircraft` ascending (byte order) as the
   tie-break. Take the first 5.
8. **Top routes.** Key `` `${departure_icao}-${arrival_icao}` ``, **directional**
   — `KSFO-KLAX` and `KLAX-KSFO` are two routes (§11.6). Rows missing either
   ICAO, or with an empty string for either, are skipped. Order by `flights`
   desc, then `route` ascending. Take the first 5.
9. Every `distance_nm` in a `top_*` entry is rounded to one decimal at the end,
   never per addend.

### 10.2 Date-range normalisation

Both `from` and `to` go through the same two steps, `from` validated first:

1. **Grammar.** The value must match
   `/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z)?$/` — a bare date, or a
   UTC timestamp with an explicit `Z`. A timestamp without `Z` is rejected
   rather than guessed: it would otherwise be parsed in the server's local zone
   and give a different answer on a different machine. A value that matches the
   grammar but is not a real date (`2026-02-31`) fails step 2.
2. **Normalisation.** `new Date(value)`; reject if `Number.isNaN(d.getTime())`;
   otherwise use `d.toISOString()` — always `YYYY-MM-DDTHH:MM:SS.mmmZ`, the
   exact format `flights.start_time` is written in. This is what makes the
   comparison in §10.1 step 1 a plain, correct string comparison: comparing a
   `…:04Z` bound against a stored `…:04.000Z` value lexicographically would
   otherwise exclude an equal instant.
3. A bare date becomes midnight UTC. `from` is **inclusive** (`>=`), `to` is
   **exclusive** (`<`), so `from=2026-01-01&to=2026-02-01` is exactly January.
4. `from > to` is not an error: it yields an empty result, zeros and nulls.

### 10.3 Free-text flight search

1. **Tokenise.** `q.trim().split(/\s+/)`, dropping empties. 0 tokens →
   `INVALID_QUERY`; more than 8 → `TOO_MANY_TERMS`. Each token is lower-cased
   for matching.
2. **Escape.** In each token, escape `\`, `%` and `_` with a backslash, and use
   `ESCAPE '\'` on every `LIKE` — so a note containing `100%` is searchable and
   a `%` in the query is a literal, not a wildcard.
3. **Match.** A flight matches iff **every** token matches **at least one** of
   these six columns (AND across tokens, OR across columns):
   `notes`, `departure_icao`, `arrival_icao`, `departure_name`, `arrival_name`,
   `aircraft`. Each comparison is `COALESCE(<col>, '') LIKE '%' || ? || '%'
   ESCAPE '\'`.
4. **Case.** SQLite's `LIKE` is ASCII case-insensitive by default, which is the
   behaviour wanted for ICAO codes and English notes. Non-ASCII letters (an
   accented airport name) fold only if they match exactly — a known, accepted
   limitation, documented in the tool description so the model can retry
   unaccented.
5. **Order.** `ORDER BY start_time DESC` — the same order `GET /api/flights`
   uses. There is no relevance ranking in v1: with one operator's logbook,
   recency is the ranking a human wants, and a scored ranking would be a second
   algorithm to keep consistent between the route and the tool (§11.7).
6. **Page.** `LIMIT ? OFFSET ?`. `total` comes from the identical `WHERE` clause
   under `COUNT(*)`.

### 10.4 Track downsampling for `get_flight`

Given `points` of length `n` and a cap `k = 200`:

- `n <= k` → return all points, in order, unchanged.
- otherwise return `k` points where output index `i` (0-based) is
  `points[Math.round(i * (n - 1) / (k - 1))]`. The first and last points are
  always included, indices are non-decreasing, and the result is deterministic —
  no time-based or distance-based thinning, which would need its own tuning.
- The payload carries `track_downsampled: true` and `point_count: n` whenever
  `n > k`, so a reader knows the track is a sample rather than the log.

Each point in the output keeps `ts, lat, lon, altitude_ft, ground_speed_kts,
heading_deg, on_ground` and drops `id`, `flight_id`, `airspeed_kts` and
`vertical_speed_fpm` — enough to describe a path, not a telemetry dump.

## 11. Alternatives considered

### 11.1 OAuth 2.1 instead of a static bearer token

The MCP specification's authorization section describes OAuth 2.1 with dynamic
client registration for remote HTTP servers, and a purist reading says a
publicly reachable MCP endpoint should implement it. **Rejected for v1** as
disproportionate: one operator, one client, no third-party authorization to
delegate, and no existing identity provider in this stack. The codebase's only
precedent for a non-browser credential is `INGEST_TOKEN`, a static shared secret
over TLS, and matching it keeps one mental model for the operator. Recorded here
as a deliberate scope-down: a future run that wants multi-user access or
revocable per-client grants should revisit it, and would find `/mcp` already
isolated behind a single gate function (§2.4) that an OAuth middleware could
replace without touching a tool.

### 11.2 Fatal error instead of a warning when `MCP_TOKEN == INGEST_TOKEN`

Considered, because success criterion 4 is about the two credentials being
independent, and an operator who pastes the same string has defeated it.
**Rejected**: a `ConfigError` strands the user's whole logbook server —
including the web UI and ingest — over a misconfiguration in an optional
feature. The warning names the consequence precisely and the server still comes
up. (The *reverse* argument, that this can only happen on a fresh edit and never
on an upgrade, is true; it just is not worth the downside.)

### 11.3 Extending `requireAuth` with an `'mcp'` scope

The design considered mirroring the ingest architecture fully: mark the request
in a scope gate, let `requireAuth` accept a valid MCP scope the way it accepts
`'ingest'`, and have the tools reach their data through real HTTP calls that the
gate polices. **Rejected** — see §2.4 and §6.1. The short version: it buys a
runtime gate this design does not need, at the price of editing the two files
success criterion 5 protects, widening the credential surface to ~19 `/api`
routes, and requiring the server to trust its own self-signed certificate from
inside its own process. The startup assertion of §3.2 recovers most of the
auditability without any of that.

### 11.4 `"module": "node16"` instead of a `paths` mapping

The textbook fix for consuming an `exports`-only package is to move the project
to Node16 module resolution. **Rejected for this run**: it changes resolution
semantics for every import in `src/**` simultaneously, on a codebase with no
test coverage of module loading, to solve a problem confined to one package. The
`paths` entry (§5.2) is reversible in one line and scoped to one package name.
A future run that wants ESM-first dependencies generally should do the migration
on its own budget.

### 11.5 MCP resources and prompts as well as tools

**Deferred.** Resources (e.g. a flight as a readable URI) and prompt templates
are real MCP features and would fit this data. They are out of v1 because every
one of them is a second surface to authorize and cap, and because tools alone
satisfy every success criterion. The transport and auth in §5 support them
unchanged if a later run adds them.

### 11.6 Non-directional route pairing in `get_flight_stats`

`KSFO-KLAX` and `KLAX-KSFO` could be folded into one "city pair", which is how a
pilot often thinks about a route. **Rejected for v1**: folding loses the
direction, and a model asking "what's my most-flown route?" can aggregate two
adjacent rows itself far more easily than it can un-fold one. Recorded so the
choice is visible if the user asks for city pairs later.

### 11.7 Relevance ranking in `search_flights`

Considered scoring matches (ICAO hit > notes hit, more tokens matched first).
**Rejected for v1**: it is a second algorithm to keep identical between the route
and the tool, its tuning is unfalsifiable without user feedback, and `start_time
DESC` with a `total` count lets the model page deterministically. §10.3 step 5.

### 11.8 Aggregating statistics in SQL

`getFlightStats` could be two or three `GROUP BY` queries. **Rejected**: the
duration rule has a fallback for rows predating `duration_sec` that already
exists as TypeScript (`ownDurationSec`), and expressing it in SQL would mean a
second implementation of the same rule plus a dependency on SQLite's date
parsing of ISO-8601-with-`Z` strings. Aggregating in TypeScript reuses the
existing rule verbatim and is unit-testable against the mocked `./db` the Vitest
suite already provides. §13 records the row count at which this should be
revisited.

## 12. Must-not-change list

The Reviewer checks these one at a time.

1. **`src/auth/middleware.ts` is not modified.** `requireAuth` and
   `requireSameOrigin` behave identically for every existing request, including
   the ingest-scope branches and the `X-Ingest-Token-Scope` header.
2. **`src/auth/ingestScope.ts` and `src/auth/ingestToken.ts` are not modified.**
   `INGEST_SCOPED_ROUTES` keeps exactly its current 19 entries, in order.
3. **The Windows agent's path is untouched.** `/api/ingest/frame`, `/event`,
   `/traffic`, their CORS handling for `coui://html_ui`, and `INGEST_TOKEN`'s
   required-with-fatal-refusal policy all behave as they do today.
4. **The web UI is untouched.** No file under `client/` changes; no existing
   `/api` response body, status code or header changes.
5. **Session handling is untouched.** An MCP request never creates, reads or
   touches an `auth_session` row; `express-session` is mounted with the same
   options in the same position.
6. **Existing routes keep their auth.** No route gains or loses a credential;
   in particular the ten flights/trips routes listed in §3.1 remain
   session-only.
7. **`POST /api/planned-legs/simbrief` is behaviour-identical after the §6.5
   extraction**: same status codes, same JSON bodies (including the exact
   duplicate and `NO_USER_ID` sentences), same `[SIMBRIEF]` log lines, same step
   order, same dedup hash, same dispatch dedup key. Verified case by case, not
   by inspection of the happy path alone.
8. **`POST /api/trips/:id/planned-legs/simbrief` (the trip-nested variant) is not
   touched at all.**
9. **The `SyntaxError` branch in `src/server.ts`'s error middleware keeps its
   current behaviour for every path it already covers** — `/api/settings/*`,
   `*/acars-messages`, `*/acars-messages/wx`, `/api/ground-sessions*` — and only
   gains `/mcp`.
10. **`GET /api/status`'s body is unchanged**, including the conditional spreads
    for `plannedLeg`, `groundSession` and `traffic`.
11. **The database schema is unchanged** (§8): `src/db/schema.ts` has no new
    table, column, index or `ALTER`.
12. **With `MCP_TOKEN` unset the server is byte-for-byte the server it is
    today**, minus one informational startup line: nothing mounted at `/mcp`,
    `GET /mcp` served by the SPA catch-all, no new failure mode at startup.
13. **`npm test` still passes unchanged**, and no existing test file is edited to
    accommodate this work.

## 13. Risks, and what would falsify this design

1. **No real MCP client has connected yet.** The prototype spoke raw JSON-RPC
   over `curl`; Claude Desktop/Code has not been pointed at a scratch server.
   *Falsified by:* a real client that refuses a stateless server, or that
   insists on `GET`-as-SSE (§5.6 names the pre-decided fallback), or that
   requires OAuth discovery metadata (`/.well-known/oauth-protected-resource`)
   before it will send a bearer token — the last would be the expensive one, and
   is the first thing the implementation phase should test.
2. **The SDK is a fast-moving dependency at 1.x.** `^1.30.0` will pick up minors
   that have, historically, moved transport APIs. *Mitigation:* the whole SDK
   surface this design uses is four symbols (`McpServer`, `registerTool`,
   `StreamableHTTPServerTransport`, `handleRequest`), all confined to
   `src/mcp/server.ts` and `src/mcp/router.ts`. *Falsified by:* a minor that
   drops the `require` condition from `package.json#exports`, which would break
   the CommonJS build — pin exactly if that ever happens.
3. **zod becomes a direct dependency at v4** while the SDK also accepts v3. If
   another dependency later pulls zod 3 into the tree, npm will nest them and
   the SDK may see a different zod than the tools do. *Falsified by:* a runtime
   "invalid schema" error on `registerTool` after an unrelated `npm install`.
4. **TLS + bearer secrecy is the entire security model** (§1 default 1). If the
   operator port-forwards `/mcp` to the public internet, the token is the only
   thing between a scanner and the logbook, and there is no rate limit on it —
   `LoginThrottle` covers `/api/auth/login` only. *Falsified by:* the user
   exposing this publicly rather than over Tailscale/VPN, which should trigger a
   follow-up run for throttling and/or an IP allow-list.
5. **A model can write to the logbook.** Four tools mutate real rows, with no
   confirmation step and no undo beyond the web UI. `update_flight_notes`
   overwrites notes wholesale rather than appending. *Falsified by:* the user
   losing a note to an over-eager edit — the mitigation, if so, is an
   append-only variant or a dry-run flag, not removing the tool.
6. **Statistics are aggregated in TypeScript** (§11.8). Fine for a logbook of
   hundreds or a few thousand flights; at roughly 100k rows the per-call
   allocation becomes noticeable and `getFlightStats` should move to SQL, keeping
   the §10.1 rules exactly. *Falsified by:* a measurable delay on
   `GET /api/flights/stats` against the real database.
7. **The `start_time` format assumption.** §10.2's string comparison assumes
   every `flights.start_time` is `toISOString()` output (`…Z`, 3-digit ms). Rows
   written by any older code path with a different format would sort and filter
   wrongly. *Falsified by:* a `SELECT DISTINCT length(start_time) FROM flights`
   returning more than one value on the real database — worth running once
   during implementation, read-only.
8. **The SimBrief extraction touches a live, token-scoped route** the MCDU client
   also calls (§6.5), and that route has no unit-test coverage. The risk is
   entirely in the code motion being less than pure. *Falsified by:* any
   difference in the response bodies or log lines, which §12 item 7 makes the
   Reviewer check explicitly.
