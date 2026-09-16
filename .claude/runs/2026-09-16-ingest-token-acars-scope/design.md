# Design freeze — 2026-09-16-ingest-token-acars-scope

Scoped `x-ingest-token` authorization for the status, ACARS and ground-session-read
routes.

**Status: frozen.** Sections are numbered and the numbers are stable; slice them with
`.claude/tools/ctx.sh design 2026-09-16-ingest-token-acars-scope <n> …`.

**Relay note.** §2, §5 and §6 are written to stand alone and are the sections meant to
be relayed verbatim to the `msfslogger_mcdu` session, which cannot read this tree.
Nothing in them requires having read `src/server.ts`.

**Implementer note.** The section numbers, this file's name, the run id and the task ids
are internal to this workflow. None of them may appear in a comment in `src/`,
`client/src/` or `tests/`. Where a section's reasoning belongs in the code, write the
reasoning itself.

## Amendments

| # | Date | Section | What changed | Evidence that forced it |
|---|------|---------|--------------|-------------------------|
| — | —    | —       | None yet.    | —                       |

---

## 1. Scope

### 1.1 What this run changes

A request carrying the correct `x-ingest-token` header and **no session cookie** is
allowed to reach ten named routes (§2.1). Every other `/api` route is untouched: it
still requires `req.session.user` and still answers `401 {"error":"Authentication
required"}` without one, including when a *valid* token is presented (§4.3).

This is a widened scope for the existing `INGEST_TOKEN` — the same secret the Windows
agent already sends to `/api/ingest/*`. No new secret, no login flow for the sidecar,
no prefix or wildcard bypass.

### 1.2 Frozen decisions inherited from the intake

Quoted from the user's `AskUserQuestion` answers, and not reopened here:

> **Chosen: "Extend ingest-token scope"** — Add a token-authorized path for GET
> /api/status, the ACARS read/write routes, and ground-session reads — same shared
> secret the agent already uses, no cookie, no login UI.

> **Chosen: "Widen the existing INGEST_TOKEN"** — Simplest: one shared secret, already
> deployed to the agent and the sidecar's config.json. […] A leak exposes telemetry
> ingest plus ACARS/loadsheet/WX access, but nothing session-only (flight history
> browsing, account settings, etc.).

Also frozen by the intake, and honoured here: the enumeration stays explicit
(method + exact path), matching how `/api/ingest/*` is already special-cased, **not**
a prefix match; ground-session *writes* are off the list; there is no second token and
no DevOps/secrets change.

### 1.3 What this run does not change

The blanket gate `app.use('/api', requireAuth)` keeps its position and keeps gating
every route registered after it. The web client's cookie flow, the agent's
`/api/ingest/*` flow, every route body, every response shape and the database schema
are all untouched. The full list a Reviewer walks is §12.

---

## 2. The finalized route list

Ten routes. This is the whole list; the allowlist in code is these ten entries and
nothing else.

### 2.1 The routes, and the need each one answers

| # | Method | Path | Why the sidecar needs it |
|---|--------|------|--------------------------|
| 1 | GET | `/api/status` | Intake: "sidecar needs `currentFlightId`, `groundSession`, `plannedLeg` to pick flight- vs leg-scoped ACARS calls". It is the poll the client already runs; without it, it cannot choose a scope at all. |
| 2 | GET | `/api/acars/canned-messages` | The server rejects any downlink that is not in its canned set, and `src/routes/acars.ts` says why this endpoint exists: "the canned set is served rather than mirrored in the client because the server is the one that rejects anything outside it, and because the MCDU client lives in another repository and cannot import a constant from here." Read-only, no session data in it. |
| 3 | GET | `/api/flights/:id/acars-messages` | In-flight message-center page: renders the thread for the live flight. |
| 4 | POST | `/api/flights/:id/acars-messages` | In-flight message-center page: sends a canned downlink. |
| 5 | POST | `/api/flights/:id/acars-messages/wx` | WX REQUEST page while airborne (the `2026-09-14-acars-weather-request` feature the client is building against). |
| 6 | GET | `/api/planned-legs/:legId/acars-messages` | Pre-flight twin of #3. The MCDU is used at the gate, before a `flights` row exists. |
| 7 | POST | `/api/planned-legs/:legId/acars-messages` | Pre-flight twin of #4. |
| 8 | POST | `/api/planned-legs/:legId/acars-messages/wx` | Pre-flight twin of #5. |
| 9 | POST | `/api/planned-legs/:legId/acars-messages/loadsheet` | The dispatch/loadsheet MCDU page (`2026-09-14-acars-dispatch-loadsheet`). Leg-scoped only — there is no flight-scoped loadsheet route in the server. |
| 10 | GET | `/api/ground-sessions/current` | Included; see §2.2 for the judgment call. |

### 2.2 `GET /api/ground-sessions/current` — the judgment call, and why it is in

The external client said this is probably redundant for them because they read
`groundSession` off `GET /api/status`. **It is included anyway**, for one concrete
reason rather than symmetry:

`GET /api/status` emits the `groundSession` key **only while `flightState === 'GROUND'`**
(`src/server.ts` builds it as `flightState === 'GROUND' ? getGroundSessionStatus() : null`
and spreads it in only when non-null). `flightState` is `'IDLE'` whenever the agent is
not streaming qualifying frames — which includes every moment before the sim is
running, and the first five frames after it starts (the parked debounce is five
consecutive frames). An open ground-session row can exist in all of those moments: a
manually-created session, or one adopted from an earlier run.

So a sidecar that boots before the sim does, polls `/api/status`, and sees no
`groundSession` key cannot conclude there is no session — but `GET
/api/ground-sessions/current` answers that question directly and unconditionally. That
is exactly the pre-flight, leg-scoped case the MCDU pages are for. The route is
read-only, returns no session/account data, and exposes a strict superset of nothing
the client cannot already see in `GROUND` state.

Cost of including it: one more row in the allowlist. Cost of omitting it: the client
has a blind spot it can only work around by out-of-band knowledge of the `GROUND`
debounce. Included.

### 2.3 Candidates and neighbours deliberately left off

| Route | Why not |
|-------|---------|
| `POST /api/ground-sessions` | Confirmed out by the external client: it has no plan to create sessions. A write, and the intake calls ground-session creation "agent-telemetry-driven or a manual web-app action". |
| `DELETE /api/ground-sessions/current` | Same; confirmed out. Closing a session is an operator action. |
| `POST /api/trips/:id/planned-legs/simbrief` | Never a candidate. This is what *files the dispatch release* a loadsheet is built from (`src/routes/plannedLegs.ts` inserts the `DISPATCH RELEASE` message on import), so it is tempting — but it is a SimBrief-credentialled import action belonging to the web app, and the intake's list is a ceiling. Consequence for the client is stated in §5.7. |
| `GET /api/planned-legs/:legId`, `GET /api/trips`, `GET /api/flights`, `GET /api/flights/:id` | Not candidates. Flight and trip *browsing* is exactly the session-only surface the user's frozen decision named as staying out of the token's blast radius. |
| `/api/auth/*`, `/api/settings/*` | Not candidates. Account surface. |

### 2.4 Matching rules

The allowlist matches on **HTTP method** and the **exact request path**, and it is
deliberately literal:

- **Path parameters** match one path segment (`[^/]+`), exactly like the express route
  they mirror. `GET /api/flights/abc/acars-messages` therefore *is* on the list and
  reaches the handler, which answers its usual `400 {"error":"Invalid id","code":"INVALID_ID"}`
  — the same thing a session caller gets. The allowlist must never diverge from the
  route table by being stricter about ids.
- **Query strings are ignored.** `GET /api/status?t=123` matches (verified, §10.4).
- **Trailing slash is not matched.** `GET /api/status/` reaches the route in express
  (non-strict routing) but is *not* on the allowlist, so it answers `401`. Fail-closed,
  and callers must use the exact paths in §2.1.
- **Matching is case-sensitive.** `GET /API/status` is not on the list → `401`.
- **Method is matched exactly.** `HEAD` and `OPTIONS` on `/api/status` are not on the
  list → `401`. The web client never does this; the sidecar must not either.

All four behaviours were exercised against a running server (§10.4).

---

## 3. Mechanism

Three files change and two are added. Type/module ownership is explicit so parallel
work cannot collide.

### 3.1 New — `src/auth/ingestToken.ts` (owns the token comparison)

The single implementation of the ingest-token comparison, extracted from
`src/ingest.ts` so there is exactly one copy. Exports, frozen:

```ts
export function sha256(value: string): Buffer;
export function ingestTokenDigest(token: string | null): Buffer | null;
export function ingestTokenMatches(header: string | undefined, tokenDigest: Buffer): boolean;
```

`ingestTokenMatches` is byte-for-byte the rule `src/ingest.ts` uses today (today's lines
167–178): compare `sha256(header)` against the precomputed `sha256(token)` with
`crypto.timingSafeEqual`, so the two buffers are always 32 bytes, `timingSafeEqual`
cannot throw on a length mismatch, and the comparison leaks nothing about the token's
length. A missing or empty header returns `false` without comparing.

No `express` import in this module and no config read — it takes the digest as an
argument. That keeps it trivially unit-testable.

### 3.2 New — `src/auth/ingestScope.ts` (owns the allowlist and the classifier)

Exports, frozen:

```ts
export type IngestScopeResult = 'valid' | 'invalid' | 'absent';
export const INGEST_SCOPED_ROUTES: readonly { method: 'GET' | 'POST'; pattern: RegExp; name: string }[];
export function isIngestScopedRoute(method: string, path: string): boolean;
export function ingestScopeOf(req: Request): IngestScopeResult | undefined;
export function createIngestTokenScopeGate(ingest: IngestConfig): RequestHandler;
```

`INGEST_SCOPED_ROUTES` is the ten entries of §2.1, one per line, each with a
human-readable `name` so `src/inspect-routes.ts` and a test can print them.

`createIngestTokenScopeGate(config.ingest)` is a factory, not a bare middleware,
because it computes the token digest **once at construction** — the same pattern
`createIngestRouter(…, config.ingest)` already uses — and because it must not reach for
`getConfig()` behind the caller's back.

The returned middleware, in order, and it **never sends a response**:

1. If the configured token is `null` → `next()`. (See §9.1: with
   `ALLOW_UNAUTHENTICATED_INGEST` and no token, the scope is off entirely.)
2. If `req.path` does not start with `/api/` → `next()`.
3. If `req.session?.user` is set → `next()` **without marking**. A valid session always
   wins and is never affected by a stray or wrong token header. This is also what keeps
   the CSRF check at full strength for a browser (§7.2).
4. If `(req.method, req.path)` is not in `INGEST_SCOPED_ROUTES` → `next()` **without
   marking**. This is the branch that makes the token useless everywhere else.
5. Otherwise read `x-ingest-token` and mark the request with `'absent'` (no header or
   empty), `'invalid'` (header present, digest mismatch) or `'valid'` (digest match),
   then `next()`.

### 3.3 The mark is a module-private `Symbol`, and the gate is a classifier

The mark is stored under `const INGEST_SCOPE = Symbol('ingestScope')`, module-private to
`src/auth/ingestScope.ts` and readable only through `ingestScopeOf(req)`. Not a string
property on `Request`:

- A symbol key cannot be set by a request body, a query string, a header, or any
  middleware that copies user input onto `req`. A string property such as
  `req.ingestTokenAuth` is one prototype-pollution or one careless `Object.assign(req,
  body)` away from being a global authentication bypass. The symbol has no such
  failure mode.
- It needs no `declare global` augmentation of `Express.Request`, so no other module
  can see or set it.

The gate classifies and never responds. All 401s are emitted by `requireAuth`, exactly
where they are emitted today. That preserves today's precedence between the CSRF `403`
and the auth `401` (§7.3) and keeps every response body in the two functions a reviewer
already reads for auth behaviour.

**Absent mark = today's behaviour.** Every request that does not match the allowlist
carries no mark, and `requireAuth` with no mark is byte-for-byte the function that ships
today. Any future mount of `requireAuth` somewhere the gate does not run therefore fails
closed.

### 3.4 Change — `src/auth/middleware.ts`, `requireAuth`

Today (lines 12–18):

```ts
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session && req.session.user) { next(); return; }
  res.status(401).json({ error: 'Authentication required' });
}
```

After:

```ts
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session && req.session.user) { next(); return; }

  const scope = ingestScopeOf(req);
  if (scope === 'valid') { next(); return; }
  if (scope !== undefined) {
    // The route would have accepted an ingest token; say so on the failure,
    // so a token client can tell "wrong secret" from "not my route".
    res.set('X-Ingest-Token-Scope', 'accepted');
  }
  if (scope === 'invalid') {
    res.status(401).json({ error: 'Invalid or missing ingest token', code: 'INVALID_INGEST_TOKEN' });
    return;
  }
  res.status(401).json({ error: 'Authentication required' });
}
```

The session branch stays first and unchanged. The `scope === undefined` path — every
off-list route — reaches the same `res.status(401).json({ error: 'Authentication
required' })` it does today, with no extra header.

`src/auth/middleware.ts` gains one import from `./ingestScope`. There is no cycle:
`ingestScope.ts` imports `./ingestToken` and `../config` types only.

### 3.5 Change — `src/auth/middleware.ts`, `requireSameOrigin`

One new step, immediately after the existing `/api/ingest/` exemption (today's lines
39–42), with the same justification. Full rules and the cookie precondition are in §7.

```ts
  // Step 3b — the sidecar is not a browser either: no cookie at all, and
  // authenticated by the same token instead. A browser that has a session
  // cookie still takes the Origin check below, even on these routes.
  if (ingestScopeOf(req) === 'valid' && !sessionCookieFrom(req)) { next(); return; }
```

`sessionCookieFrom` already exists in this file (lines 125–137) and is used for nothing
else in the request path; this is its second caller.

### 3.6 Change — `src/server.ts`, one insertion point

Exactly one new line plus its comment, and **no existing mount moves**. Insert after the
`app.use(session({ … }))` call ends (today line 70) and before the
`// CSRF defence in depth …` comment (today lines 72–74):

```ts
  // Classifier, not a gate: marks a request that matches the ingest-token
  // route allowlist. Mounted after session() because it must see
  // req.session.user, and before requireSameOrigin, which reads the mark.
  app.use(createIngestTokenScopeGate(config.ingest));
```

Mounted with **no path prefix**, like `app.use(requireSameOrigin)` on the next line.
This is load-bearing: inside `app.use('/api', fn)` express strips the mount path and
`req.path` would be `/status`, not `/api/status`. With no prefix, `req.path` is the full
path and the allowlist patterns can be written as the full paths a reader recognises —
the same convention `requireSameOrigin` already relies on with `req.path.startsWith('/api/')`.

`app.use('/api', requireAuth)` (today line 81) keeps its exact position and its exact
form. `GET /api/status` (line 83) and the routers at lines 134, 140, 146, 153, 158, 165
and 171 keep their exact positions. Nothing is mounted ahead of the blanket gate.

### 3.7 Change — `src/ingest.ts`, delete the duplicate comparison

`src/ingest.ts` today defines a private `sha256` (lines 116–120) and inlines the
comparison in `checkAuth` (lines 167–178). After this change it imports from
`./auth/ingestToken` and the local `sha256` and the `crypto` import are deleted:

```ts
const tokenDigest = ingestTokenDigest(token);
…
const checkAuth = (req: Request, res: Response): boolean => {
  if (!tokenDigest) return true;
  if (ingestTokenMatches(req.get('x-ingest-token'), tokenDigest)) return true;
  res.status(401).json({ error: 'Invalid or missing ingest token' });
  return false;
};
```

`/api/ingest/*` behaviour is unchanged, including its 401 body, which keeps **no**
`code` field (§6.4). Verified: the full Vitest suite, including `tests/ingest.test.ts`
and `tests/ingestCors.test.ts`, passes against the patched tree (§10.5).

### 3.8 Doc comments to correct in the same change

`src/routes/acars.ts` (header comment) and `src/routes/groundSessions.ts` (header
comment) both say the router is mounted "behind `requireAuth` and `requireSameOrigin`".
That stays true but is now incomplete. Add one clause naming that some of these routes
also accept the ingest token with no cookie. State the fact, not a pointer to this
document.

`README.md` line 56–57 says the ingest token's "same value must be configured on the
Windows agent". After this run the token is also what a datalink/MCDU client
authenticates with. One sentence there, e.g. "The same value is also what a datalink
client (the MCDU app) uses to reach the status and ACARS endpoints."

---

## 4. Route-by-route middleware chain

Chains are listed in execution order. Everything in `[brackets]` runs but is not an auth
decision. This is the table Review re-derives against a live server.

### 4.1 A scoped route, token, no cookie — the new path

Example: `GET /api/status` with `x-ingest-token: <correct>`.

| Order | Middleware | What it does |
|-------|-----------|--------------|
| 1 | `[express.json]` | parses the body |
| 2 | `[express.static]` | no match |
| 3 | `[/api/ingest router]` | path does not match, skipped |
| 4 | `[session]` | no cookie → generates an unsaved, in-memory session; **no `Set-Cookie`** (§6.5) |
| 5 | `ingestTokenScopeGate` | on-list, digest matches → marks `'valid'`, `next()` |
| 6 | `requireSameOrigin` | GET → returns at step 1. (For a POST: exempt at the new step 3b, §7.) |
| 7 | `requireAuth` | no `session.user`; mark is `'valid'` → `next()` |
| 8 | handler | runs exactly as it does for a session caller |

Result: `200` with the same body a cookie caller gets (byte-identical; §10.3).

### 4.2 A scoped route, no valid token

Same chain to 7, where `requireAuth` answers `401` — body per §6.1.

### 4.3 An off-list route, valid token — the property Review verifies

Example: `GET /api/flights` with `x-ingest-token: <correct>`.

| Order | Middleware | What it does |
|-------|-----------|--------------|
| 1–4 | as above | — |
| 5 | `ingestTokenScopeGate` | `isIngestScopedRoute('GET', '/api/flights')` is `false` → `next()` **without reading the header and without marking** |
| 6 | `requireSameOrigin` | GET → returns at step 1 |
| 7 | `requireAuth` | no `session.user`, `ingestScopeOf(req) === undefined` → falls through both new branches to the unchanged final line, `res.status(401).json({ error: 'Authentication required' })` |
| 8 | flights router | **never reached** |

**The precise code path that produces the off-list 401 is the last line of `requireAuth`
in `src/auth/middleware.ts`, unchanged from today, reached because the gate never marked
the request.** The token header is not even read on this path. Verified against a
running server for `/api/flights`, `/api/flights/1`, `/api/trips`, `/api/active-trip`,
`/api/planned-legs/1`, `/api/settings/simbrief`, `POST /api/ground-sessions`,
`DELETE /api/ground-sessions/current`, and an unmatched `/api/nonexistent` (§10.2).

### 4.4 Any route, valid session cookie — unchanged

| Order | Middleware | What it does |
|-------|-----------|--------------|
| 4 | `[session]` | loads the session; `rolling: true` re-sets the cookie as today |
| 5 | `ingestTokenScopeGate` | `req.session.user` is set → `next()` **without marking**, whatever headers are present |
| 6 | `requireSameOrigin` | unchanged: mark is absent, so step 3b cannot fire |
| 7 | `requireAuth` | first branch, `next()` — the code that runs today |

### 4.5 `/api/ingest/*` — unchanged

The ingest router is mounted at line 42, above `session()`, so it returns before the
gate, `requireSameOrigin` and `requireAuth` ever run. Its own `checkAuth` still answers
`401 {"error":"Invalid or missing ingest token"}` with no `code` field.

### 4.6 The ten scoped routes, at a glance

Every row runs chain §4.1 on the token path and chain §4.4 on the cookie path. Nothing
route-specific differs between them.

| Route | Gate marks? | `requireSameOrigin` | Gated by |
|-------|-------------|---------------------|----------|
| `GET /api/status` | yes | step 1 (GET) | `requireAuth`, mark-aware |
| `GET /api/acars/canned-messages` | yes | step 1 (GET) | `requireAuth`, mark-aware |
| `GET /api/flights/:id/acars-messages` | yes | step 1 (GET) | `requireAuth`, mark-aware |
| `POST /api/flights/:id/acars-messages` | yes | step 3b when token-only | `requireAuth`, mark-aware |
| `POST /api/flights/:id/acars-messages/wx` | yes | step 3b when token-only | `requireAuth`, mark-aware |
| `GET /api/planned-legs/:legId/acars-messages` | yes | step 1 (GET) | `requireAuth`, mark-aware |
| `POST /api/planned-legs/:legId/acars-messages` | yes | step 3b when token-only | `requireAuth`, mark-aware |
| `POST /api/planned-legs/:legId/acars-messages/wx` | yes | step 3b when token-only | `requireAuth`, mark-aware |
| `POST /api/planned-legs/:legId/acars-messages/loadsheet` | yes | step 3b when token-only | `requireAuth`, mark-aware |
| `GET /api/ground-sessions/current` | yes | step 1 (GET) | `requireAuth`, mark-aware |
| *(example off-list)* `GET /api/flights` | **no** | step 1 (GET) | `requireAuth`, **unchanged branch → 401** |

---

## 5. Client contract

Written for a reader who cannot see this repository.

### 5.1 How to authenticate

Send the HTTP header `x-ingest-token: <INGEST_TOKEN>` — the same shared secret the
Windows telemetry agent sends to `/api/ingest/frame`. Case-insensitive header name, sent
as a plain header value, on every request. Send **no cookie**. No login call, no session,
no CSRF token, and no `Origin` header is required.

One secret, and it is the only credential the sidecar holds. It grants exactly the ten
routes in §5.3 and nothing else.

### 5.2 Ground rules

- Use the exact paths below: no trailing slash, correct case. Query strings are fine.
- Use the exact methods below: a `HEAD` or `OPTIONS` on a listed path is **not** in
  scope and answers `401`.
- The token never sets a cookie; there is no session to keep (§6.5). Every request is
  independent.
- Serve over HTTPS on anything but loopback — this token is a bearer credential and a
  plaintext deployment puts it on the wire.

### 5.3 The routes

All bodies are JSON; all requests with a body send `Content-Type: application/json`.
Behaviour on these routes is identical to a browser session in every respect — same
status codes, same bodies, same side effects.

| Method | Path | Request body | Success | Notable non-auth failures |
|--------|------|--------------|---------|---------------------------|
| GET | `/api/status` | — | `200` — see §5.4 | — |
| GET | `/api/acars/canned-messages` | — | `200 {"messages":[{id,label,body,category,direction}, …]}` | — |
| GET | `/api/flights/:id/acars-messages` | — | `200 {"flight_id":n,"planned_leg_id":n\|null,"messages":[…]}` oldest-first | `400 INVALID_ID`, `404 FLIGHT_NOT_FOUND` |
| POST | `/api/flights/:id/acars-messages` | `{"canned_id":"…"}` | `201` — the stored message object | `400 UNKNOWN_CANNED_MESSAGE`, `400 NOT_A_CANNED_MESSAGE`, `403 DIRECTION_NOT_PERMITTED`, `403 CATEGORY_NOT_PERMITTED`, `404 FLIGHT_NOT_FOUND` |
| POST | `/api/flights/:id/acars-messages/wx` | `{"icao":"EGLL"}` | `201 {"flight_id":n,"icao","available":bool,"request":{…},"reply":{…},"weather":{…}\|null}` | `400 INVALID_BODY`, `400 INVALID_ICAO`, `404 FLIGHT_NOT_FOUND` |
| GET | `/api/planned-legs/:legId/acars-messages` | — | `200 {"planned_leg_id":n,"messages":[…]}` oldest-first | `400 INVALID_ID`, `404 PLANNED_LEG_NOT_FOUND` |
| POST | `/api/planned-legs/:legId/acars-messages` | `{"canned_id":"…"}` | `201` — the stored message object | same set as the flight-scoped POST, with `404 PLANNED_LEG_NOT_FOUND` |
| POST | `/api/planned-legs/:legId/acars-messages/wx` | `{"icao":"EGLL"}` | `201 {"planned_leg_id":n,"icao","available","request","reply","weather"}` | `400 INVALID_BODY`, `400 INVALID_ICAO`, `404 PLANNED_LEG_NOT_FOUND` |
| POST | `/api/planned-legs/:legId/acars-messages/loadsheet` | none (the leg id is the only input) | `201` first time, `200` on a repeat (idempotent) — `{"planned_leg_id":n,"created":bool,"request","reply","sheet"}` | `404 PLANNED_LEG_NOT_FOUND`, `409 NO_DISPATCH_DATA` (§5.7) |
| GET | `/api/ground-sessions/current` | — | `200 {"session": {…} \| null}` | — |

Notes that bite:

- **Only canned messages can be sent.** `canned_id` must be one of the ids from
  `GET /api/acars/canned-messages` (today: `wx-request`, `gate-request`,
  `request-pushback` — read them, do not hard-code them). Free text is refused, and a
  client may only send `direction: "downlink"`.
- **Message-send is not deduplicated** on the two plain POST routes: pressing the key
  twice files two messages, deliberately, exactly as a real MCDU would.
- **The loadsheet route is** deduplicated: a repeat returns the same pair with
  `created: false` and status `200`.
- **`/wx` is not idempotent** and both "METAR found" and "no data for this ICAO" are
  `201` successes; `available` distinguishes them.

### 5.4 `GET /api/status` — every key a token caller receives

A token-authenticated caller gets the **byte-identical** response a session caller gets.
No key is filtered, computed differently, or withheld (§5.5). Verified byte-for-byte
against a running server (§10.3).

Always present:

| Key | Type | Meaning |
|-----|------|---------|
| `connected` | `boolean` | the telemetry agent is currently streaming |
| `flightState` | `'IDLE' \| 'GROUND' \| 'FLYING' \| 'ENDED'` | the server's flight state machine |
| `currentFlightId` | `number \| null` | the live flight's id, or `null` when no flight is in progress |
| `paused` | `boolean` | sim pause |
| `pauseFlags` | `number` | raw pause bitfield |
| `simRunning` | `number` | last frame's sim state (`0` when there is no frame) |
| `onGround` | `boolean` | last frame's on-ground flag (`true` when there is no frame) |
| `aircraft` | `string \| null` | last frame's aircraft title |
| `frame` | `object \| null` | `{lat, lon, altitudeFt, airspeedKnots, groundSpeedKnots, headingDeg, verticalSpeedFpm, onGround}`, or `null` before the first frame |

Conditionally present — **the key is absent, never `null`**, when the condition does not
hold:

| Key | Present when | Shape |
|-----|--------------|-------|
| `plannedLeg` | `flightState === 'FLYING'` **and** a frame exists **and** the flight is linked to a leg | `{plannedLegId, tripId, tripName, destinationIdent, nextWaypointIdent, remainingDistanceNm, distanceIsApproximate: true}` |
| `groundSession` | `flightState === 'GROUND'` **and** a session is being tracked | `{groundSessionId, source, airportIcao, airportName, parkingPosition, parkingPositionSource, plannedLegId, plannedLegLinkSource, tripId, tripName, departureIdent, destinationIdent, startedAt}` — `plannedLegId` is `number \| null` |
| `traffic` | the traffic store is non-empty | `[{id, lat, lon, altitudeFt, headingDeg, onGround}, …]` |

The four fields the external client's scope selection depends on —
`currentFlightId`, `flightState`, `groundSession.plannedLegId`, `plannedLeg` — are all
present for a token caller under their normal conditions. Observed live, token-only, no
cookie (§10.3):

```json
{"connected":true,"flightState":"GROUND","currentFlightId":null,"paused":false,
 "pauseFlags":0,"simRunning":1,"onGround":true,"aircraft":"A320",
 "frame":{"lat":51.4775,"lon":-0.4614,"altitudeFt":80,"airspeedKnots":0,
          "groundSpeedKnots":0,"headingDeg":90,"verticalSpeedFpm":0,"onGround":true},
 "groundSession":{"groundSessionId":1,"source":"auto","airportIcao":"EGLL",
   "airportName":"London Heathrow Airport","parkingPosition":null,
   "parkingPositionSource":null,"plannedLegId":1,"plannedLegLinkSource":"auto",
   "tripId":1,"tripName":"Proto trip","departureIdent":"EGLL",
   "destinationIdent":"LFPG","startedAt":"2026-09-16T12:15:55.843Z"}}
```

### 5.5 Nothing is withheld from a token caller, and why

No key is session-only. Every field above is live simulator telemetry or a derived view
of it; most of it is data the holder of this very token *produced*, by posting frames to
`/api/ingest/frame`. `traffic` is literally the agent's own uploads read back. There is
no account, credential, or logbook-history field in the response. Withholding a key
would also force an auth-mode branch into the status handler, which is the one thing
that could make a token caller and a session caller disagree — the design refuses that
on purpose: **the handlers never learn how the request was authenticated.**

### 5.6 Choosing flight scope vs leg scope

Deterministic rule for the client, from a single `GET /api/status` poll:

1. `currentFlightId !== null` → a flight is in progress: use the **flight-scoped**
   routes with `:id = currentFlightId`.
2. Otherwise, if `groundSession` is present and `groundSession.plannedLegId !== null` →
   pre-flight at a gate with a leg on file: use the **leg-scoped** routes with
   `:legId = groundSession.plannedLegId`.
3. Otherwise, if `groundSession` is absent (which includes `flightState !== 'GROUND'`),
   call `GET /api/ground-sessions/current`; if it returns a session with a non-null
   `planned_leg_id`, use that as `:legId`. (Note the snake_case: the ground-session
   route returns the stored row, where `/api/status` returns a camelCase computed view.)
4. Otherwise there is no scope: no flight and no leg. Show "NO FLIGHT PLAN" rather than
   guessing an id.

Do not derive `:legId` from anything else; a leg id that does not exist answers
`404 PLANNED_LEG_NOT_FOUND`, not a silent empty thread.

### 5.7 What the token deliberately cannot do

- It cannot create or close a ground session.
- It cannot read or write flights, trips, planned legs, settings, or account data. Those
  answer `401` (§6.3).
- It cannot **create** a dispatch release. The release is filed by the web app when a
  SimBrief plan is imported into a leg. Until that has happened,
  `POST …/acars-messages/loadsheet` answers `409 {"error":"NO DISPATCH DATA ON
  FILE","code":"NO_DISPATCH_DATA"}`. Treat that as a normal, expected MCDU message
  ("NO DISPATCH DATA"), not an error condition to retry.

---

## 6. Error contract

### 6.1 The failure modes, exactly

Statuses and bodies, verified live (§10.2):

| # | Situation | Status | Body | Extra response header |
|---|-----------|--------|------|-----------------------|
| a | Scoped route, **no** `x-ingest-token` header (or an empty one) and no session | `401` | `{"error":"Authentication required"}` | `X-Ingest-Token-Scope: accepted` |
| b | Scoped route, header present but **wrong** token, no session | `401` | `{"error":"Invalid or missing ingest token","code":"INVALID_INGEST_TOKEN"}` | `X-Ingest-Token-Scope: accepted` |
| c | **Off-list** route, valid token, no session | `401` | `{"error":"Authentication required"}` | *(none)* |
| d | Any `/api` route, no credential of any kind | `401` | `{"error":"Authentication required"}` | present iff the route is on the list |
| e | Cross-origin non-GET rejected by the CSRF check (§7) | `403` | `{"error":"Cross-origin request rejected"}` | *(none)* |
| f | `/api/ingest/*` with a bad token (unchanged) | `401` | `{"error":"Invalid or missing ingest token"}` — **no `code`** | *(none)* |

Beyond these, the scoped routes' own non-auth failures are unchanged and listed in §5.3;
they all use the existing `{ error, code }` convention.

### 6.2 The client's decision tree — no out-of-band knowledge needed

| Observation | Conclusion |
|-------------|------------|
| No HTTP response (connection refused, TLS failure, timeout) | **Not reachable.** Server down, wrong host/port, or wrong scheme. |
| `401` + body `code === 'INVALID_INGEST_TOKEN'` | **Wrong token.** The route accepts ingest-token auth and rejected this secret. Stop retrying; surface a config error. |
| `401` + `X-Ingest-Token-Scope: accepted` + no `code` | The route accepts ingest-token auth but **saw no token header** — the request went out without it, or something on the path stripped it. |
| `401` + no `X-Ingest-Token-Scope` header | **Not authorized for this route.** Either the path is not in the token's scope, or this server predates the scope change. Do not retry with the same credential. |
| `403 {"error":"Cross-origin request rejected"}` | The request carried an `Origin` **and** a session cookie. A sidecar should send neither. |

Note the useful deployment signal in row four: an older server that has not been
upgraded answers every one of these routes with a bare `401 {"error":"Authentication
required"}` and no scope header, which is exactly how the client detects "this server
does not have the scoped-token feature".

### 6.3 Why case (a) keeps the existing body, and case (b) does not

The external requirement is that a token-auth failure be distinguishable from any other
401 without out-of-band knowledge. Cases (a) and (b) are distinguishable — from each
other and from (c) — via `code` and `X-Ingest-Token-Scope`. But case (a)'s **body** is
deliberately left byte-identical to today's, because a browser produces case (a) too:
a web-client session that has expired while the page is open answers a `GET /api/status`
poll with exactly this 401, and `client/src/utils/api.ts` builds its `UnauthorizedError`
message from `body.error`. Changing that body would put "Invalid or missing ingest
token" in front of an operator whose session simply timed out. The distinguishing signal
for case (a) is therefore carried in a response header, which no browser code reads, and
in the *absence* of `code`.

Case (b) cannot be produced by the web client at all — the browser never sends
`x-ingest-token` — so its body is free to be specific, and it reuses the existing ingest
wording verbatim.

### 6.4 Why `code` is added here but not to `/api/ingest/*`

`{"error":"Invalid or missing ingest token"}` is reused verbatim from `src/ingest.ts`,
plus a `code` field. `code` is the convention the ACARS, ground-session and settings
routes already use (`INVALID_ID`, `FLIGHT_NOT_FOUND`, `NO_DISPATCH_DATA`, …), so this is
extending an existing convention, not inventing an envelope.

The ingest router's own 401 is left exactly as it is, with **no** `code`:
`src/inspect-traffic.ts` rows S29/S30 assert that body, `tests/ingestCors.test.ts`
asserts it, and the agent is a deployed binary on another machine. Two callers, two
bodies, one comparison function — documented rather than unified, because changing the
agent's contract is not in this run's scope.

### 6.5 A token request never sets a session cookie — traced and verified

Required by the external client, and confirmed three ways.

**By construction.** No code on the token path touches `req.session`. The gate reads
`req.session.user` and never assigns; `requireAuth` reads and never assigns; the ten
handlers never touch `req.session` (none of them references it at all). The only writers
of `req.session.user` in the server are the login and logout handlers in
`src/auth/routes.ts`, which are not on the list.

**By express-session's own rules** (`node_modules/express-session/index.js`, v1.19.0).
The session middleware is mounted app-wide, so it does run for a token request and does
create an in-memory session object. Whether anything is emitted is decided by:

```js
function shouldSetCookie(req) {
  if (typeof req.sessionID !== 'string') return false;
  return cookieId !== req.sessionID
    ? saveUninitializedSession || isModified(req.session)
    : rollingSessions || req.session.cookie.expires != null && isModified(req.session);
}
```

For a cookie-less token request, `cookieId` is `undefined` and `req.sessionID` is a
freshly generated string, so the first branch applies:
`saveUninitialized` is `false` in this server's config and `isModified` is false because
nothing wrote to the session → **no `Set-Cookie`**. `shouldSave` takes the same
`cookieId !== req.sessionID` branch and returns `isModified(req.session)` → `false`, so
**no row is written to `auth_session`**. `rolling: true` only matters on the second
branch, which needs an incoming cookie.

**By measurement** (§10.1, §10.2): across every token request in the prototype matrix —
success, 404, 401 and 403 alike — zero `Set-Cookie` headers were returned, and after the
whole matrix the scratch database's `auth_session` table held exactly one row, the one
created by the deliberate `POST /api/auth/login` used to test the cookie path.

---

## 7. Interaction with `requireSameOrigin`

### 7.1 What the CSRF check does today

`requireSameOrigin` runs for every request and lets one through when: the method is
`GET`/`HEAD`/`OPTIONS` (step 1); the path is not `/api/*` (step 2); the path is
`/api/ingest/*` (step 3 — "the agent is not a browser, has no cookie, and is
authenticated by token instead"); there is no `Origin` header at all (step 4 — a curl or
the agent); or `Origin` equals `protocol://host` (step 5). Otherwise `403
{"error":"Cross-origin request rejected"}`.

### 7.2 The change, and its precondition

A new **step 3b**, immediately after the `/api/ingest/` exemption and with the same
reasoning (§3.5): let the request through when it is marked `'valid'` **and** carries no
`msfslogger.sid` cookie at all.

Both halves are load-bearing:

- The mark is only set after a successful constant-time token comparison, so this
  exempts only requests that already proved they hold the shared secret. A browser
  cannot be made to send a custom `x-ingest-token` header cross-origin without a CORS
  preflight, and this server sends `Access-Control-Allow-Headers` for nothing but the
  in-sim `coui://html_ui` origin on `/api/ingest/*`. The exemption is therefore no
  weaker than the `/api/ingest/*` one that has shipped since the auth work.
- The no-cookie precondition is what keeps the CSRF check at **full strength for the
  same route hit with a cookie and an Origin**, which is the explicit requirement. A
  request that carries a session cookie is a browser, and a browser proves same-origin.
  A request that carries a *valid* session is never even marked (§3.2 step 3), and a
  request carrying a stale or forged cookie plus a valid token is marked but not exempt,
  so it still takes the Origin check.

Measured (§10.2): token + hostile `Origin` + no cookie → passes (`404` from the handler,
i.e. auth and CSRF both cleared); cookie + valid token + hostile `Origin` → `403`; stale
cookie + valid token + hostile `Origin` → `403`; stale cookie + valid token + **no**
`Origin` → passes, via step 4, exactly as today.

### 7.3 Why the `403` still wins over the `401`

Because the gate never responds (§3.3), a wrong-token cross-origin POST reaches
`requireSameOrigin` before `requireAuth` and gets `403`, the same precedence a
cookie-less browser request gets today. No information is disclosed by that ordering:
`403` here says nothing about whether the token was right.

### 7.4 GET routes need none of this

Six of the ten scoped routes are GETs and return at step 1, before any of the above. The
step 3b exemption exists for the four POSTs, and only matters if a client sends an
`Origin`; a plain sidecar HTTP client sends none and would already pass at step 4.
Step 3b is defence for the case where the client *is* embedded in something browser-like
that stamps an `Origin` on its requests.

---

## 8. Token verification: one implementation, one home

Frozen, and an explicit acceptance criterion: **the comparison is not reimplemented.**
The SHA-256 + `crypto.timingSafeEqual` pattern that `src/ingest.ts` uses today at lines
116–120 and 167–178 moves, unchanged in behaviour, into `src/auth/ingestToken.ts`
(§3.1). `src/ingest.ts` imports it and deletes its private `sha256` and its inline
comparison (§3.6); `src/auth/ingestScope.ts` imports the same two functions. After this
change, `grep -rn "timingSafeEqual" src/` returns exactly one file.

The token value comes from `config.ingest.token` (`AppConfig`, `src/config.ts`) in both
places. Neither module reads `process.env` — `src/config.ts` remains the only module
that reads the environment for security-relevant settings, and it has already refused to
start unless a token is set or `ALLOW_UNAUTHENTICATED_INGEST` opted out of it.

The digest is computed **once**, at construction: `createIngestRouter` already does this,
and `createIngestTokenScopeGate` does the same. Per-request work is one SHA-256 of the
header value, on `/api/*` requests that match the allowlist and have no session.

---

## 9. Configuration and deployment

### 9.1 `ALLOW_UNAUTHENTICATED_INGEST` disables the scope entirely

When `config.ingest.token` is `null` — only reachable through the explicit
`ALLOW_UNAUTHENTICATED_INGEST=1` opt-out — `createIngestTokenScopeGate` returns
immediately for every request and **no route is token-scoped**. Status, ACARS and
ground-session reads stay cookie-only.

This is deliberate and is the opposite of what `src/ingest.ts`'s `checkAuth` does (it
returns `true` and lets unauthenticated ingest through). The opt-out was a decision to
accept unauthenticated *telemetry ingest* on a trusted LAN; silently reading it as
"and also publish the ACARS and status API to anyone who can reach the port" would widen
a security decision the operator never made. Fail closed.

### 9.2 No new environment variable, no new secret, no deploy step

`INGEST_TOKEN` already exists and is already deployed to the agent and to the sidecar's
`config.json`. Nothing to rotate, nothing to add. This run has no DevOps phase.

### 9.3 Transport

The token is a bearer credential with a wider blast radius than before. `src/config.ts`
already refuses to start on a non-loopback bind without TLS unless
`ALLOW_PLAINTEXT_HTTP=1`, and already warns that "the session cookie and the ingest
token cross the network unencrypted" when it is set. That warning text remains accurate
and does not need changing.

---

## 10. Prototype evidence

Everything below was run today, 2026-09-16, against a **patched copy of the tree** in
the session scratchpad (this task's only writable path in the repo is this file), on
`PORT=3100`, `BIND_HOST=127.0.0.1`, with `FLIGHTS_DB_PATH` pointing at a freshly
initialised scratch database and `INGEST_TOKEN=proto-secret-token-123456`. The live
server on port 3000 and the live `flights.db` were never touched; the scratch server was
stopped by tracked PID. `git status --porcelain src/ client/ tests/` was empty
afterwards.

The patch applied in the scratch copy is exactly the design in §3 — the same file
layout, the same function names, the same five edits. It compiled clean under
`npx tsc` on Node 20.

### 10.1 All ten scoped routes, token only, no cookie

`curl -X <method> http://127.0.0.1:3100<path> -H 'x-ingest-token: proto-secret-token-123456'`:

| Route | Result |
|-------|--------|
| `GET /api/status` | `200`, full status body |
| `GET /api/acars/canned-messages` | `200`, `{"messages":[{"id":"wx-request",…}]}` |
| `GET /api/flights/1/acars-messages` | `404 {"error":"Flight 1 not found","code":"FLIGHT_NOT_FOUND"}` — the handler ran |
| `POST /api/flights/1/acars-messages` | `404 FLIGHT_NOT_FOUND` — the handler ran |
| `POST /api/flights/1/acars-messages/wx` | `404 FLIGHT_NOT_FOUND` — the handler ran |
| `GET /api/planned-legs/1/acars-messages` | `200 {"planned_leg_id":1,"messages":[…]}` once leg 1 existed |
| `POST /api/planned-legs/1/acars-messages` | `201` with the stored message (`{"id":1,…,"label":"GATE REQUEST"}`); a bad `canned_id` gave the normal `400 UNKNOWN_CANNED_MESSAGE` |
| `POST /api/planned-legs/1/acars-messages/wx` | reached the handler (`404` before the leg existed) |
| `POST /api/planned-legs/1/acars-messages/loadsheet` | `409 {"error":"NO DISPATCH DATA ON FILE","code":"NO_DISPATCH_DATA"}` — the handler ran, no release on file |
| `GET /api/ground-sessions/current` | `200 {"session":{…,"planned_leg_id":1,…}}` |

Zero `Set-Cookie` headers across all of them.

### 10.2 The negative matrix

| Probe | Result |
|-------|--------|
| valid token → `GET /api/flights`, `/api/flights/1`, `/api/trips`, `/api/active-trip`, `/api/planned-legs/1`, `/api/settings/simbrief`, `POST /api/ground-sessions`, `DELETE /api/ground-sessions/current`, `GET /api/nonexistent` | all `401 {"error":"Authentication required"}`, **no** `X-Ingest-Token-Scope` header, no `Set-Cookie` |
| valid token → `GET /api/status/` (trailing slash), `GET /api/STATUS` (case), `HEAD /api/status`, `OPTIONS /api/status` | all `401 {"error":"Authentication required"}` |
| wrong token → `GET /api/status` | `401 {"error":"Invalid or missing ingest token","code":"INVALID_INGEST_TOKEN"}` + `X-Ingest-Token-Scope: accepted` |
| wrong token → `POST /api/flights/1/acars-messages` | same `401` + header |
| empty `x-ingest-token:` → `GET /api/status` | `401 {"error":"Authentication required"}` + header (classified `absent`) |
| no credential → `GET /api/status`, `GET /api/ground-sessions/current` | `401 {"error":"Authentication required"}` + header |
| wrong token → `GET /api/flights` (off-list) | `401 {"error":"Authentication required"}`, no header |
| token + `Origin: http://evil.example`, no cookie → `POST /api/flights/1/acars-messages` | `404 FLIGHT_NOT_FOUND` — CSRF exemption fired |
| token + evil `Origin` → `POST /api/ground-sessions` (off-list) | `403 {"error":"Cross-origin request rejected"}` |
| wrong token + evil `Origin` → scoped POST | `403` (CSRF precedence, §7.3) |
| cookie + evil `Origin` → scoped POST | `403` — unchanged |
| cookie + valid token + evil `Origin` → scoped POST | `403` — the exemption does **not** fire for a browser |
| stale cookie + valid token + evil `Origin` → scoped POST | `403` |
| stale cookie + valid token, no `Origin` → scoped POST | `404` — passes via the existing no-Origin step |
| cookie + same-origin `Origin` → scoped POST | `404` — unchanged |
| `POST /api/ingest/frame` + token | `204` — unchanged |
| `POST /api/ingest/frame` + wrong token | `401 {"error":"Invalid or missing ingest token"}` — unchanged, no `code` |

`auth_session` row count after the entire matrix: **1**, from the single deliberate
login.

### 10.3 Token and cookie responses to `GET /api/status` are byte-identical

Six parked frames at EGLL were posted through `/api/ingest/frame` to drive the state
machine to `GROUND` with an auto-linked planned leg, then:

```
curl -s /api/status -H 'x-ingest-token: …' -o status.token.json
curl -s /api/status -b cookies.txt          -o status.cookie.json
cmp -s status.token.json status.cookie.json   → identical
```

Keys observed: `connected, flightState, currentFlightId, paused, pauseFlags, simRunning,
onGround, aircraft, frame, groundSession` — with `groundSession.plannedLegId = 1` and
`groundSession.tripId = 1`. Body quoted in §5.4.

### 10.4 Matching-rule probes

`GET /api/status?t=123` → `200` (query string ignored, as designed). `HEAD /api/status`
→ `401`. `OPTIONS /api/status` → `401`. `GET /api/status%20` → `401`.

### 10.5 The existing test suite passes against the patch

`npx vitest run` in the patched scratch tree: **36 files, 694 tests, all passing**,
including `tests/ingest.test.ts` and `tests/ingestCors.test.ts` — i.e. extracting the
comparison out of `src/ingest.ts` did not change ingest behaviour.

---

## 11. Alternatives considered

**11.1 Move `GET /api/status` and the ACARS/ground-session routers above the blanket
`requireAuth` and guard each route inside.** Rejected. `src/server.ts` states that
"anything registered after `app.use('/api', requireAuth)` is gated by default, including
routes added later", and that default is the property that has kept this server safe.
Moving `createGroundSessionsRouter` above the gate would put `POST /ground-sessions` and
`DELETE /ground-sessions/current` in front of it too, protected only by whatever
per-route decoration someone remembers to add — and a route added to that router later
would be **public**. The chosen design never moves a mount and keeps default-deny.

**11.2 Replace line 81 with `app.use('/api', requireAuthOrIngestToken)`.** Rejected, and
also proscribed by the task. It is behaviourally equivalent to what is designed here,
but it removes the name `requireAuth` from the one line every reviewer reads first, and it
makes "what gates `/api`" a different function from the one the tests and the existing
design docs name. Keeping the mount line untouched means the diff a reviewer must trust
is three small edits inside two functions.

**11.3 A string flag (`req.ingestTokenAuth = true`) instead of a `Symbol`.** Rejected;
see §3.3. A string property is reachable by prototype pollution and by any careless
copy of user input onto `req`, and it would be a *global* auth bypass, not a scoped one.

**11.4 Give the off-list 401 its own code (e.g. `ROUTE_NOT_TOKEN_SCOPED`).** Rejected.
It would require running the token comparison on **every** `/api` request just to
discover whether the caller's token was valid on a route where the header is meaningless
— widening where the secret is compared, turning the header into an oracle on
unrelated routes, and changing the off-list 401 body that acceptance criterion 3 of the
intake pins down. The client gets the same discrimination for free from the presence or
absence of `X-Ingest-Token-Scope` (§6.2).

**11.5 Change the no-token 401 body on scoped routes to something token-flavoured.**
Rejected; see §6.3 — a browser with an expired session produces that exact response, and
the web client renders `body.error`.

**11.6 A `/api/datalink/*` prefix with its own router mounted above the gate.**
Rejected. It would mean either duplicating nine handlers or aliasing paths, and it
changes the URL contract the web client already uses. The intake also froze "keep the
enumeration explicit […] not a prefix/wildcard match".

**11.7 Let `ALLOW_UNAUTHENTICATED_INGEST` open the scoped routes too.** Rejected; §9.1.

**11.8 Exempt token requests from `requireSameOrigin` on the strength of the mark
alone, without the no-cookie precondition.** Rejected: a browser holding both a cookie
and (somehow) the token would skip the CSRF check, which is precisely the loosening the
task forbids. The precondition costs one call to an existing helper.

---

## 12. Must-not-change list

Each item is independently checkable, and §10 names the probe that checks it.

1. **`app.use('/api', requireAuth)` stays at its position** in `src/server.ts`, in that
   exact form. No `/api` router mount moves, and no route is registered ahead of it.
2. **Every `/api` route not in §2.1 behaves exactly as today** for every credential
   combination — in particular, a valid `x-ingest-token` with no cookie still gets
   `401 {"error":"Authentication required"}` from the unchanged final line of
   `requireAuth` (§4.3).
3. **The browser/session flow is unchanged on every route, scoped or not**: same status,
   same body, same `Set-Cookie` behaviour under `rolling: true`, same CSRF outcome for a
   cookie-bearing request with an `Origin`.
4. **`{"error":"Authentication required"}` is still the exact body** of the session 401,
   on every route, scoped or not. Only response *headers* differ on scoped routes, and
   only on failures.
5. **`/api/ingest/frame|event|traffic` is unchanged**: same auth rule, same
   `401 {"error":"Invalid or missing ingest token"}` with no `code`, same
   `coui://html_ui` CORS behaviour. `tests/ingest.test.ts`,
   `tests/ingestCors.test.ts` and `src/inspect-traffic.ts` rows S29/S30 must still pass
   untouched.
6. **No handler learns how the request was authenticated.** No route body gains an
   auth-mode branch; `GET /api/status` returns the same bytes either way.
7. **No token-authenticated request mutates `req.session`, writes an `auth_session` row,
   or emits `Set-Cookie`** (§6.5).
8. **No schema change, no migration, no new environment variable, no new secret.**
9. **The ten routes' own response shapes, status codes and side effects are unchanged**
   — including the loadsheet route's idempotency and the two message POSTs' deliberate
   lack of deduplication.
10. **`npm test` stays green** without modifying an existing test's expectations
    (§10.5). New tests may be added; existing assertions may not be relaxed.

---

## 13. Risks

1. **The token's blast radius is now larger than "telemetry".** A leaked `INGEST_TOKEN`
   lets the holder read live position and aircraft, read and file ACARS messages, pull
   METAR/TAF and generate load sheets. The user accepted this explicitly when choosing
   to widen the existing token. Falsified by: any report that the token is stored
   somewhere less protected than the sidecar's `config.json`.
2. **The allowlist can drift from the route table.** If someone renames
   `/api/ground-sessions/current` or adds `/api/flights/:id/acars-messages/pdc`, the
   allowlist does not follow automatically. Mitigation: a test that asserts every
   `INGEST_SCOPED_ROUTES` entry matches a real route in the express route table (§14.2)
   — `src/inspect-routes.ts` already walks that table.
3. **Fail-closed matching surprises a client.** Trailing slash, wrong case, `HEAD`, or a
   future path-normalising proxy produces a `401` that looks like an auth failure but is
   a URL problem. Mitigated by §5.2 and by the `X-Ingest-Token-Scope` header, which is
   absent in exactly this case.
4. **A reverse proxy that strips unknown request headers** would break the sidecar
   silently. The `absent` classification plus the scope header make this diagnosable
   (§6.2, row three) rather than mysterious.
5. **`GET /api/status` is a chattier endpoint than the sidecar needs** — it carries the
   traffic array when the agent is uploading traffic. Not a correctness risk; a
   bandwidth note for a polling client on a LAN.
6. **The design rests on express's `req.path` being the full path for a prefix-less
   `app.use`, and on express-session not emitting a cookie for an untouched session.**
   Both were measured, not assumed (§10.1–10.4, §6.5). Falsified by an express or
   express-session major upgrade; a version bump on either should re-run §10.2.

---

## 14. Verification plan for the implementer and the Reviewer

### 14.1 Live checks (the Reviewer re-runs these, per the intake)

Reproduce §10.1–§10.4 against a scratch server on a non-3000 port with a scratch
database. The three that must not be skipped:

- every route in §2.1 answers non-401 with the token and no cookie;
- `GET /api/flights` with a **valid** token answers `401 {"error":"Authentication
  required"}` with no `X-Ingest-Token-Scope` header (the skeleton-key check);
- no response on the token path carries `Set-Cookie`, and `select count(*) from
  auth_session` does not grow.

### 14.2 Unit tests to add

`tests/` conventions apply (hermetic, `./db` and `./airports` mocked, fake timers).
Suggested file `tests/ingestScope.test.ts`, covering:

- `isIngestScopedRoute` returns `true` for all ten method/path pairs, including a
  numeric and a non-numeric `:id`;
- it returns `false` for the off-list probes in §10.2, and for trailing slash, wrong
  case, `HEAD` and `OPTIONS`;
- the gate does not mark when `req.session.user` is set, when the configured token is
  `null`, or when the path is off-list — and in the off-list case does not read the
  header at all;
- `requireAuth` with no mark produces the exact legacy body, and with each mark value
  produces the §6.1 status/body/header;
- `requireSameOrigin` step 3b fires only for `'valid'` + no cookie.

Plus one assertion that every `INGEST_SCOPED_ROUTES` pattern matches a route express
actually has (risk 13.2).

### 14.3 Typecheck and suite

`npx tsc`, `npm run test:types`, `npm test` — all must be clean, with no existing
expectation modified.
