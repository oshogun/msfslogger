# Review — phase 5 (amendment): T-012, MCDU ingest-token scope

**Verdict: approve.** No blocking findings. 3 non-blocking follow-ups.

Scope of this review: the ingest-token allow-list change only
(`src/auth/ingestScope.ts`, `tests/ingestScope.test.ts`) against the amended
freeze (amendment row #3, §13). Everything was re-derived here; the
implementer's report was not read beyond its `risks` list.

| Verified independently | 8 of 8 checks in the task envelope |
| Could not verify | per-task diff isolation (see follow-up 3) |

## Evidence

**1. Diff is exactly the type widening + 6 appended entries.**
`git diff src/auth/ingestScope.ts` shows one changed line (the `method` union
`'GET' | 'POST'` → `'GET' | 'POST' | 'DELETE'`) and 6 added lines. Entries
1–13 are untouched, in order. The 6 new entries are **byte-identical to the
design block**:

    diff <(ctx.sh design … 13 | grep '^{ method' | sed 's/,$//') \
         <(grep sayintentions src/auth/ingestScope.ts | sed 's/^  //; s/,$//')
    → no output  (ENTRIES BYTE-IDENTICAL TO DESIGN)

**2. R2 is not on the list, and cannot be.** `grep -n "PUT" src/auth/ingestScope.ts`
→ no match anywhere in the file (the only `PUT`-adjacent hit is the widened
union, which does not contain it). Live: `PUT /api/settings/sayintentions`
with a valid `x-ingest-token` and no cookie →
`401 {"error":"Authentication required"}`. The gate also proves it
structurally: the allow-list vs. real-route-table test enumerates
`PUT /api/settings/sayintentions` from the real settings router and asserts
`isIngestScopedRoute(...) === false`.

**3/4. Test coverage, and the cross-check block is real.**
`tests/ingestScope.test.ts` adds 6 in-scope cases, 4 wrong-method-same-path
neighbours (`PUT` settings, `PATCH` link — one neighbour covers all three
link entries since they share a path, `GET` import, `GET` clearance), the
unlisted-`DELETE` guard (`DELETE /api/flights/1` → false), and bumps the
length assertion 13 → 19. The cross-check block at
`tests/ingestScope.test.ts:393` genuinely wires the new router in:
`routesOf(createSayIntentionsRouter())` is spread into `allRoutes`, the 6
paths are added to `EXPECTED_SCOPED`, and the existing
`'%s is scoped iff it is on the finalized list'` case then runs over every
real route the router exposes — so a future route added to
`src/routes/sayIntentions.ts` and not to the allow-list (or vice versa)
fails the suite. Confirmed the router's 5 real routes (link GET/POST/DELETE,
import, clearance) and both settings routes are in that table.

**5. Independent reachability against a scratch server.** Scratch copy of the
tree (`node_modules` symlinked, `client/dist`/`flights.db*` excluded), built
there with `npx tsc -p tsconfig.json`, run on **port 3101** with
`FLIGHTS_DB_PATH` pointed at a fresh scratch db, `BIND_HOST=127.0.0.1`. I
seeded a real `flights` row (id 1) and a real `planned_legs` row (id 1), so
these are handler-depth responses, not 404s:

    GET    /api/settings/sayintentions          -> 200 {"sayintentions_api_key_set":false,…}
    GET    /api/flights/1/sayintentions/link    -> 200 {"flight_id":1,"linked":false,…}
    POST   /api/flights/1/sayintentions/link    -> 409 NO_API_KEY
    DELETE /api/flights/1/sayintentions/link    -> 200 {"flight_id":1,"unlinked":false}
    POST   /api/flights/1/sayintentions/import  -> 409 NO_API_KEY
    POST   /api/planned-legs/1/sayintentions/clearance -> 409 NO_API_KEY
    PUT    /api/settings/sayintentions          -> 401 Authentication required

All with `x-ingest-token` only, no session cookie. The 409s are the design's
own sample responses, so this supersedes the report's 404-based evidence — the
substitution was sufficient in principle (it reached the handler's own
validation) but this is the stronger form and it agrees.

Negative probes, same server, valid token unless stated:

    GET    …/sayintentions/link   wrong token          -> 401
    PATCH  …/sayintentions/link   unlisted method      -> 401
    DELETE /api/flights/1         unlisted DELETE      -> 401
    DELETE /api/planned-legs/1    unlisted DELETE      -> 401
    GET    …/sayintentions/import wrong method         -> 401
    GET    …/sayintentions/link/  trailing slash       -> 401
    GET    /api/settings/sayintentions  no auth at all -> 401
    GET    /api/flights           (unscoped, token)    -> 401
    GET    /api/settings/acars    (unscoped, token)    -> 401

The widened union did not make `DELETE` generally eligible.

Regression on the pre-existing 13: `GET /api/status`, `/api/settings/simbrief`,
`/api/acars/canned-messages`, `/api/ground-sessions/current` all still `200`
with token only.

MCDU-shaped cross-origin (token + `Origin: https://mcdu.local`, no cookie):
`POST …/link` → 409, `DELETE …/link` → 200 — `requireSameOrigin`'s existing
token exemption covers the new routes, including `DELETE`, with no change
needed. Token + stale cookie on a scoped GET → 200 (existing behaviour,
`req.session.user` absent).

**6. `npm test`: `Test Files 40 passed (40) / Tests 1006 passed (1006)`** —
matches the claim; `tests/ingestScope.test.ts (96 tests)`.
**`npx tsc --noEmit`** clean; **`npm run test:types`** clean.

**7. No run citations.**
`grep -nE "\.claude/runs|design\.md|plan\.json|T-[0-9]{3}|§|Amendment|phase[0-9]|reviews/"`
over both touched files → no match. The one nearby phrase, `// Every route
this run's design put on the list.` (pre-existing, line 412), names no
document or id and is unchanged.

**8. Safety.** Live `flights.db` md5 `d7b2a00eb72f9354dce759c3ccac9a3f` before
and after, identical; `max(flights.id)` = 89 both times; the live db still has
0 `sayintentions%` tables (nothing from the scratch schema leaked in).
`dist/index.js` mtime `12:32:38` and `client/dist/index.html` mtime `18:46:43`
both unchanged — no build ran in this checkout. My scratch server (pid tracked
in `pid.txt`, port 3101) was killed by PID and the scratch tree removed; port
3101 free.

## Non-blocking follow-ups

1. **A stale scratch server from the implementation round is still listening
   on 127.0.0.1:3100** — pid `1271832`,
   `node node_modules/.bin/ts-node --transpile-only src/index.ts`, cwd
   `/home/guilherme/msfslogger`, `INGEST_TOKEN=scratchtoken1234567890`,
   `FLIGHTS_DB_PATH=…/scratchpad/si-push-verify/flights.db`, running since
   ~12:33. It is loopback-only and uses a scratch db, so it is not touching
   the live server or db, but it is an unterminated agent process holding
   port 3100 (it is why this review used 3101). Not mine to kill — suggest
   `kill 1271832` after confirming the pid still matches that cmdline.
2. **Malformed JSON on the newly MCDU-reachable POST routes returns
   `400 text/html`**, not the JSON envelope its ACARS siblings return:
   `POST /api/flights/1/sayintentions/link -d '{not json'` → `400
   text/html`, while the same body to `POST /api/flights/1/acars-messages` →
   `400 application/json {"error":"Invalid request body","code":"INVALID_BODY"}`.
   The SyntaxError path list in `src/server.ts:215-220` matches
   `/api/settings/`, `…/acars-messages`, `…/acars-messages/wx` and the
   ground-session paths only. Pre-existing, and the must-not-change list
   forbids editing that list in this run — but a client that `JSON.parse`s
   every response will choke on the HTML, so it is worth a follow-up now that
   the MCDU can reach these routes.
3. **The must-not-change list contradicts the amendment.** §18 item 8 still
   reads "`INGEST_SCOPED_ROUTES` — unchanged, entry for entry (§13)", which
   amendment #3 reversed; item 16's "(§13)" citation is likewise stale. The
   implementation is right and the list is out of date. An Orchestrator edit
   to §18, not implementer work.

Attribution note: the whole run is uncommitted, so `git diff` cannot isolate
T-012 from the four earlier phases. The two files in this task's scope were
verified directly; `src/server.ts`'s diff was checked and is still only the
one import + one mount (must-not-change item 9), but no per-file attribution
to T-012 was possible for the other 14 modified files.
