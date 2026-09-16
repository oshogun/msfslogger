# Intake — 2026-09-16-mcdu-simbrief-prefile

## Source

User request: coordinate with the `mcdu-tauri-client` session (separate repo,
`oshogun/msfslogger_mcdu`, per [[mcdu_client_coordination]] memory) to add an
option to prefile the SimBrief flight plan straight from the MCDU.

## What already exists

`POST /api/planned-legs/simbrief` (`src/routes/plannedLegs.ts:430`) already
does exactly this on the server side: it reads the saved
`SIMBRIEF_USER_ID_SETTING`, fetches the pilot's latest OFP from SimBrief,
parses it, de-dupes against an existing import (`sourceSha256`), creates a
trip-less planned leg (`tripId: null` — this *is* the "loose prefile" from
`prefile_for_flights_nontrip.md`), and best-effort files an ACARS dispatch
release for it. No request body is required (`allow_duplicates` is the only
optional field). It is the exact "Import from SimBrief" action the web client
already exposes with no trip open.

**The gap:** this route sits behind `requireAuth`
(`src/auth/middleware.ts`), which only accepts a session cookie. The MCDU's
sidecar (Node process on the Windows box, `msfslogger_mcdu`) holds no session
— by design, only `x-ingest-token` — the same mechanism
`2026-09-16-ingest-token-acars-scope` widened for the ACARS/status/ground-session
routes it already uses (`src/auth/ingestScope.ts`
`INGEST_SCOPED_ROUTES`). `POST /api/planned-legs/simbrief` is not on that
list today, so the sidecar cannot call it.

`GET /api/settings/simbrief` (`src/routes/settings.ts:17`) is the read-only
counterpart — always 200, `{ simbrief_user_id: string | null }` — that lets a
caller tell "no SimBrief Pilot ID saved yet" apart from "saved but the fetch
will fail for another reason" before offering the action. It has the same gap.

## Why this is tier 2, not tier 3

This reuses the ingest-token-scope mechanism the prior run
(`2026-09-16-ingest-token-acars-scope`) already designed and froze; it does
not introduce a new contract. The change is two entries added to the existing
`INGEST_SCOPED_ROUTES` array (`src/auth/ingestScope.ts`) — one module, single
seam. No Planner, no Designer. `intake.md` is the only artifact; one
implementer (Jr — mechanical, pattern-matched edit) + one Reviewer (kept at
default `opus`, not downgraded, because this is still an auth-surface edit:
the Reviewer must independently verify AC3 below against a live scratch
request, not just read the diff).

## Goal

Let a request carrying a valid `x-ingest-token` header, no session cookie,
reach:

- `GET /api/settings/simbrief`
- `POST /api/planned-legs/simbrief`

exactly as a session would today, while every other route — including
`POST /api/trips/:id/planned-legs/simbrief` (the trip-scoped sibling, out of
scope: the MCDU's own trip concept, if any, is undetermined until it
responds) and `PUT /api/settings/simbrief` (a write to a shared setting the
sidecar has no business making) — stays cookie-only exactly as today.

## Acceptance criteria

1. `curl -H "x-ingest-token: $INGEST_TOKEN"` with no cookie against
   `GET /api/settings/simbrief` returns the same 200 body a session gets.
2. Same header against `POST /api/planned-legs/simbrief` returns the same
   201/`imported`/`duplicate`/error-code behavior a session gets, unchanged
   from today's code in `plannedLegs.ts`.
3. The same request with no token and no cookie still gets 401
   (`{ error: 'Authentication required' }`).
4. A valid token against `PUT /api/settings/simbrief` or
   `POST /api/trips/:id/planned-legs/simbrief` still gets 401 — the token
   does not widen past the two routes named above.
5. `requireSameOrigin` does not reject the cookie-less, `Origin`-less,
   token-bearing request on either newly-scoped route (same treatment
   `/api/ingest/*` and the prior scoped routes already get — this falls out
   of the existing `ingestScopeOf(req) === 'valid' && !sessionCookieFrom(req)`
   branch with no further change needed, but the Reviewer confirms it live).
6. The web client's existing cookie-based flow is byte-for-byte unchanged.
7. `npm test` and `npm run test:types` still pass.

## Non-negotiables specific to this run

- Verify against a scratch server/port/db copy per `.claude/ENVIRONMENT.md` —
  never the live server or `flights.db`.
- `POST /api/planned-legs/simbrief` has a side effect (writes a planned leg
  and an ACARS dispatch message) — the Reviewer's live verification of AC1–2
  must run against the scratch DB, not the live one.

## MCDU-side coordination

Once the server-side widening lands and passes review, the Orchestrator
messages `mcdu-tauri-client` (session name confirmed via `ListAgents`, not
`windows-client` — see [[mcdu_client_coordination]]) with the frozen route
contract verbatim: method, path, headers, request/response JSON samples for
all four outcomes (`imported`, `duplicate`, `NO_USER_ID`, SimBrief
fetch/parse failure codes), and the existing `GET /api/settings/simbrief`
shape — so that session can design its own "PREFILE SIMBRIEF" MCDU action
against real contract text, not paraphrase. That message also asks the open
questions this session cannot answer alone: does the MCDU want this as a
single no-trip action only (matching what's being scoped here), or does it
also need the trip-scoped variant; and where in the CDU page flow it should
live (datalink page, alongside the existing ACARS actions, given
[[mcdu_oooi_position_status]] already established how that session's paging
works).
