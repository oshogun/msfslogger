# Intake — 2026-09-16-ingest-token-acars-scope

## Source

Cross-session coordination with the `windows-client` session (owns
`oshogun/msfslogger_mcdu`, out of this tree). That session is building MCDU
pages for the ACARS features shipped in `2026-09-14-acars-message-center`,
`2026-09-14-acars-weather-request` and `2026-09-14-acars-dispatch-loadsheet`,
plus the ground-session tracking from `2026-09-14-` (commit 755bd72). It hit a
hard blocker: its sidecar only ever authenticates to this server with
`x-ingest-token` (the same shared secret the agent uses for
`/api/ingest/frame|event|traffic`); it has no session cookie and, by design,
the CDU webview never sees a credential at all — only the sidecar process
holds the token. None of the routes it needs — not even `GET /api/status` —
currently accept that token; they all sit behind `requireAuth`
(`src/auth/middleware.ts`), which checks `req.session.user` only.

Two decisions were put to the user and frozen, verbatim (`AskUserQuestion`):

> The MCDU client (via its sidecar) needs to reach the ACARS/status routes,
> but those currently require a browser session cookie — the sidecar only
> ever authenticates with the ingest token. How should it get access?
> **Chosen: "Extend ingest-token scope"** — Add a token-authorized path for
> GET /api/status, the ACARS read/write routes, and ground-session reads —
> same shared secret the agent already uses, no cookie, no login UI. Keeps
> the sidecar-owns-the-token boundary they already built. Requires a
> server-side change here (auth middleware) scoped carefully so the token
> can't do everything a session can.

> You chose to extend ingest-token auth to the ACARS/status routes. Should it
> be the same INGEST_TOKEN widened to cover these routes, or something
> narrower to limit blast radius if that token leaks?
> **Chosen: "Widen the existing INGEST_TOKEN"** — Simplest: one shared
> secret, already deployed to the agent and the sidecar's config.json. New
> server-side auth path checks the same token for GET /api/status, the ACARS
> read/write routes, and ground-session reads. A leak exposes telemetry
> ingest plus ACARS/loadsheet/WX access, but nothing session-only (flight
> history browsing, account settings, etc.).

The user explicitly did **not** choose a second/separate datalink token, and
did **not** choose a client-side login flow. Both alternatives are out of
scope for this run; do not reintroduce them without going back to the user.

## Goal

Let a request carrying a valid `x-ingest-token` header reach a **named,
explicit list** of routes without a session cookie — the same routes the
MCDU sidecar needs to build its ACARS/datalink pages — while every other
`/api` route stays cookie-only exactly as today. This is a widened scope for
the *existing* `INGEST_TOKEN`, not a new secret and not a blanket `/api`
bypass: "widen the existing token" (the user's choice) is about reusing one
secret, not about how narrowly the routes it unlocks are enumerated in code —
keep the enumeration explicit, matching how `/api/ingest/*` is already
special-cased in `requireSameOrigin` today, not a prefix/wildcard match.

Candidate route list (Designer confirms/finalizes against actual sidecar
needs relayed from `windows-client`):

- `GET /api/status` — sidecar needs `currentFlightId`, `groundSession`,
  `plannedLeg` to pick flight- vs leg-scoped ACARS calls.
- `GET /api/acars/canned-messages` — read-only, no session data in it anyway.
- `GET /api/flights/:id/acars-messages`, `POST /api/flights/:id/acars-messages`,
  `POST /api/flights/:id/acars-messages/wx`
- `GET /api/planned-legs/:legId/acars-messages`,
  `POST /api/planned-legs/:legId/acars-messages`,
  `POST /api/planned-legs/:legId/acars-messages/wx`,
  `POST /api/planned-legs/:legId/acars-messages/loadsheet`
- `GET /api/ground-sessions/current` — read-only; the sidecar has no reason to
  create or close a ground session itself (that's agent-telemetry-driven or a
  manual web-app action), so ground-session **writes**
  (`POST /ground-sessions`, `DELETE /ground-sessions/current`) are
  deliberately left off this list unless Designer finds a concrete need.

## Why this needs a Design step

This changes the auth *contract* of the server, not just a route body:

1. **Mechanism** — how a route accepts "session OR token" without weakening
   `requireAuth` for every other route. Likely a new middleware
   (`requireAuthOrIngestToken` or similar) mounted only on the specific
   router paths above, not a change to the global `app.use('/api',
   requireAuth)` line. Must not create a path where a stolen token also
   grants session-only surface (flight history, trips, auth/account routes).
2. **Interaction with `requireSameOrigin`** — that middleware already treats
   `/api/ingest/*` as a token-authenticated exemption from the CSRF check
   (no `Origin` expected from a non-browser agent). The newly-scoped routes
   need the same treatment when hit with a token and no cookie, without
   loosening the CSRF check for a browser hitting the same route with a
   cookie.
3. **Token verification path** — reuse whatever constant-time compare
   `src/ingest.ts` already uses against `config.ingest` (check `INGEST_TOKEN`
   plumbing in `src/config.ts`) rather than a second implementation.
4. **Error contract** — what a request with a missing/wrong token on these
   routes returns (status + body shape), so the sidecar can distinguish "not
   reachable", "wrong token" and "not authorized for this route" the same way
   `src/inspect-traffic.ts`'s S29/S30 rows already assert for ingest.
5. **Route list is the actual deliverable** — `windows-client` is blocked on
   getting this frozen before it starts its own design; the finalized list
   and header contract need to go back to that session verbatim once this
   run's design is frozen (Orchestrator relays it, not `design.md` itself —
   that session cannot read this tree).

## Success criteria

1. Each route in the finalized list accepts `x-ingest-token: <INGEST_TOKEN>`
   with no session cookie and behaves exactly as it does today for an
   authenticated session (same response body/shape).
2. A request to one of those routes with no token and no cookie still gets
   401, same as today.
3. A request to any route **not** on the list, bearing a valid
   `x-ingest-token` but no cookie, still gets 401 — the token does not become
   a skeleton key for `/api`.
4. `requireSameOrigin`'s CSRF check does not reject a token-bearing,
   cookie-less, `Origin`-less request to a newly-scoped route (matches
   existing `/api/ingest/*` treatment).
5. The web client's existing cookie-based flow is unchanged — no behavior
   difference for a browser session on any route, scoped or not.
6. Existing `npm test` and the ingest inspector
   (`ts-node src/inspect-traffic.ts` or equivalent) still pass; a new
   inspector or test rows cover the token-path cases in AC1–AC4.

## Steps this run takes, and what it skips

- **Plan** — yes, `planner`.
- **Design** — yes, `designer` (opus; this is an auth-model change, the
  highest-consequence kind of contract this workflow freezes). Must read
  `src/auth/middleware.ts`, `src/ingest.ts`, `src/config.ts` in full (small
  files, not run artifacts) plus `ctx.sh design 2026-09-14-acars-message-center`
  for the route/response shapes being exposed.
- **Implement** — `backend_sr` (cross-cutting: touches middleware wiring
  shared by every router, not a single module).
- **Review** — mandatory, and for this run specifically the Reviewer's
  security read matters more than usual: confirm AC3 (no skeleton-key
  regression) with an actual request against a scratch server, not just a
  code read.
- **Ship (DevOps)** — skipped. No build/packaging/deploy/CI/secrets change —
  `INGEST_TOKEN` already exists as a deployed secret; this run only widens
  which routes check it.

## Non-negotiables specific to this run

- Never touch the user's live server or `flights.db` — verify against a
  scratch copy/port, per project standing rules.
- The route list above is a ceiling, not a target: if Designer cannot justify
  a route's inclusion against a concrete MCDU need already relayed from
  `windows-client`, drop it rather than include it "in case."
