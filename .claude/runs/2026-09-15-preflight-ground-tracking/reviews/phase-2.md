# approve

Phase 2 (T-005, T-006, T-007) — **round 2**. Both blocking findings from round 1
are fixed and independently re-verified against the current code, including the
browser click-through that round 1 could not reach. **29 of 29 acceptance
criteria now verified independently**, none failed. Four non-blocking follow-ups
below, one of them new.

Round 1's verdict was `request_changes` on B1 (the `/api/status` ground-session
cache was never refreshed after a REST write) and B2 (the crash/disconnect close
path gated on that stale cache and so closed the operator's `'manual'` row).
Both repros were re-run from scratch; both now behave as §5.5/§7.4 freeze them.

Evidence for both rounds was run under Node 20 against `npm run backup`
snapshots, on port 3100, loopback-bound, with `FLIGHTS_DB_PATH` exported to a
scratch copy. Teardown confirmed each round: scratch dirs removed, servers
killed by tracked pid on the scratch ports only, the user's server (pid 889188,
port 3000) never touched.

**Live database.** `flights.db`'s md5 drifts between rounds
(`86aba142…` → `37d9cd7d…` → `95843d90…`) because the user's server holds it
open in WAL mode and checkpoints continuously — it is not a stable identity
while that process runs, so md5 alone cannot prove much here. The positive
check does: the live file has **no `ground_sessions` table at all**
(`select count(*) from sqlite_master where name='ground_sessions'` → 0) and its
latest flight is still `id=86, 2026-09-14T21:21:36.195Z`, while every scenario
below created that table and reached flight `id=87` in the scratch copy. Nothing
from this run's verification reached the live logbook. `client/dist/index.html`
is also untouched (mtime `18:35:07`, unchanged across both rounds) — see
"Browser verification" for why that mattered.

## Round-2 re-verification of the two blocking findings

### B1 — `/api/status.groundSession` freshness — **fixed**

`refreshGroundSession()` now exists (`src/flightManager.ts:350`), re-reads
`getOpenGroundSession()`, rebuilds the cache, and drops to `IDLE` via
`resetGroundTracking()` only when no row is open *and* the machine was `GROUND`.
`src/routes/groundSessions.ts` calls it after both writes (`:95` POST, `:118`
DELETE). Original repro, re-run with frames flowing throughout:

    step 0  auto session entered    status: GROUND, {id:1, auto, EGLL, stand:None, leg:None}
    step 1  POST {"icao":"EGLL","parking_position":"Stand 512"}      -> HTTP 200
            row: id=1 source=auto stand='Stand 512' stand_src=manual
    step 2  GET /api/status         -> {id:1, auto, EGLL, stand:'Stand 512', leg:None}   <-- was stale
    step 3  POST {"icao":"EGLL","planned_leg_id":4}                  -> HTTP 200
    step 4  GET /api/status         -> {id:1, auto, EGLL, stand:'Stand 512', leg:4}

The leg enrichment travels with it, which is what T-007 AC#2's link label needs:

    {"groundSessionId":1,"source":"auto","airportIcao":"EGLL","airportName":"London Heathrow Airport",
     "parkingPosition":"Stand 512","parkingPositionSource":"manual","plannedLegId":4,
     "plannedLegLinkSource":"manual","tripId":1,"tripName":"Circumnavegação",
     "departureIdent":"KMRY","destinationIdent":"KSFO","startedAt":"2026-09-15T18:59:13.923Z"}

The §7.3 correction path, which in round 1 left status advertising a *closed*
row at the *wrong* airport, now follows the row:

    POST {"icao":"EGKK","parking_position":"Pier 5"}  -> HTTP 201, new row id=2 manual EGKK
    GET /api/status          -> GROUND, {id:2, manual, EGKK, stand:'Pier 5'}
    GET /ground-sessions/current -> id=2 source=manual icao=EGKK ended=None

### B2 — a `'manual'` session survives agent disconnect — **fixed**

`closeAutoGroundSessionAndReturnToIdle()` (`src/flightManager.ts:506`) now calls
`getOpenGroundSession()` and gates on `open?.source === 'auto'`. Continuing the
correction scenario above, frame loop stopped so the watchdog fires:

    [Ingest] No data received recently — marking disconnected
    /api/status -> flightState=IDLE, connected=False, groundSession present=False
    db:  id=1 auto   EGLL 'Stand 512' ended_reason='corrected'
         id=2 manual EGKK 'Pier 5'    ended_reason=NULL  ended_at=NULL     <-- survives
    GET /ground-sessions/current -> {id:2, manual, EGKK, 'Pier 5', ended_at:None}

Exactly §7.4: the machine returns to `IDLE`, the operator's row stays open, and
the client still reaches it through the `GET /current` fallback (§7.5). The fix
does not over-correct — counter-cases, same server:

    auto session #4, frames stopped  -> ended_reason='sim-exit'   (still closed, §7.4)
    DELETE /current while GROUND (#3) -> HTTP 200, ended_reason='manual',
                                         status flips to IDLE immediately, no frame needed (§5.4/§1.5)
    DELETE /current with none open    -> HTTP 404 {"error":"No ground session is open",
                                                   "code":"NO_OPEN_GROUND_SESSION"}

`DELETE` matches §5.4 as written. `PATCH /api/ground-sessions/current` is still
absent (`HTTP 404`, express's HTML default) — follow-up 3, not a blocker.

### Regression and suites, re-run

`tests/flightManager.state.test.ts` is still byte-identical to `HEAD`:
`git diff --stat` empty, md5 `690060d082b46dea2bb424d8f7a293df` on both sides,
and it passes unmodified — `✓ tests/flightManager.state.test.ts (20 tests) 40ms`.
Full suite `Test Files 36 passed (36) / Tests 694 passed (694)` (688 in round 1;
6 new cases, including `${ending}() reads the row that is actually open now, not
a stale cached source` at `tests/flightManager.ground.test.ts:427`).
`npx tsc`, `npm run test:types` and `client/ npx tsc` all exit 0 with no output.

### Browser verification (round 1 could not do this; round 2 did)

Serving the real built client from the same origin as the API was the obstacle:
the repo's `client/dist` is what the user's **running** server serves via
`express.static`, so rebuilding it in place would have changed their live app,
and a Vite dev-server proxy is cross-origin, which `requireSameOrigin` correctly
rejects (`403 {"error":"Cross-origin request rejected"}` — the CSRF control
working, not a defect). Resolved by copying the client tree to scratch, building
it to a scratch `client/dist`, and running the scratch server with `cwd` set
there. Repo `client/dist` mtime unchanged. Puppeteer, real login through the UI:

    AC#1 initial card:  DETECTED | EGLL — London Heathrow Airport | Stand not set | Since Sep 15, 2026, 7:07 PM
    in-page refine POST (real cookie + Origin) -> HTTP 200
    AC#1 after refine, no reload, 2.5 s later:
                        DETECTED | EGLL — London Heathrow Airport | Stand 512 | KMRY → KSFO | Since …
    AC#2 link in card:  href=/planned-leg/4/acars  text="KMRY → KSFO"
    AC#2 after click:   url=http://localhost:3100/planned-leg/4/acars
    AC#2 thread body:   "ACARS Messages — Planned leg #4 · 0 messages · SEND / WX REQUEST /
                         GATE REQUEST / REQUEST PUSHBACK / REQUEST LOADSHEET · KMRY KSFO"

That is the feature's whole point demonstrated end to end: parked at a gate, no
user action, the card appears, the operator names the stand, and the pre-flight
ACARS actions are reachable before any `flights` row exists.

## T-005 — agent telemetry (5/5 pass, unchanged from round 1)

| # | Criterion | Verdict |
|---|---|---|
| 1 | Six SimVars appended after `TITLE`, §2.1 order | **pass** — `agent/agent.js:202-207`, names/units/types match the §2.1 table row for row (`BRAKE PARKING INDICATOR`/bool, `NUMBER OF ENGINES`/number, `GENERAL ENG COMBUSTION:1..4`/bool, all INT32) |
| 2 | Reads in the same order, three keys appended | **pass** — `:253-266` is byte-equivalent to §2.2's frozen block including the `remaining() >= 24` guard and all three derivations; `:281-285` appends only `parkingBrake`/`engineCount`/`enginesRunning`, only when `hasGroundVars` |
| 3 | `DEF_TRAFFIC`, sweep, event handlers untouched | **pass** — `git diff -U0 -- agent/agent.js \| grep -c '^-'` → `0`; the diff is purely additive |
| 4 | `node --check` | **pass** — `node --check agent/agent.js: EXIT 0` |
| 5 | Diffed against §2, not SimConnect | **pass** — verified by table comparison; no live sim in this environment |

## T-006 — ground-state machine (7/7 pass)

| # | Criterion | Verdict |
|---|---|---|
| 1 | `SimFrame` fields + `isValidFrame()` per §2.4 | **pass** — live matrix: old-agent frame (fields omitted) `204`; `parkingBrake:1` `400`; `engineCount:"2"` `400`; `enginesRunning:null` `400`; full valid frame `204`; malformed-frame body still `{"error":"Invalid frame payload"}` |
| 2 | `FlightState` + every §1 transition incl. crash/disconnect | **pass** — `'IDLE' \| 'GROUND' \| 'FLYING' \| 'ENDED'`; all seven §1.5 exits present and exercised; see N1 on two of them |
| 3 | `src/groundState.ts` pure; inspector shows §4 scenarios | **pass** — only imports are `./geo` and `type SimFrame`; `npx ts-node src/inspect-groundstate.ts` → `14 scenarios, 0 failures`, incl. `IDLE -> FLYING airborne debounce unaffected without-fields=frame 3 with-fields=frame 3 ✓` |
| 4 | Entry calls `findNearestAirport`/`matchPlannedLeg`, writes a row; adopt fills gaps only; airport_name travels with icao | **pass** — live entry logged `Ground session #1 — EGLL (London Heathrow Airport)` and `not linked to a planned leg — NO_LEG_IN_RADIUS (nearest planned departure 3841.9 nm away)`; `fillOpenGroundSessionGaps` (`src/db/groundSessions.ts:132`) skips any non-NULL column and never touches `source`; the icao/name agreement gate passes both as `null` on disagreement. `src/legMatcher.ts`/`src/airports.ts` unmodified (`git status`) |
| 5 | `/api/status` key per §5.5 | **pass (was fail)** — presence rule right (absent in IDLE: `{"connected":false,…,"frame":null}`; appears on the entry frame; gone once `FLYING`), and the value now tracks the row through refine, leg-link and correction — B1 above |
| 6 | `tests/flightManager.ground.test.ts` coverage | **pass (caveat cleared)** — 26 tests; round 1's caveat was that the manual-survival case held only against a consistent cache. The live path now matches: B2 above |
| 7 | `npm run test:types`, `npx tsc` clean | **pass** — both exit 0, no output |

**Regression, T-008 AC#3.** Covered above: `tests/flightManager.state.test.ts`
byte-identical to `HEAD` and passing in both rounds; 694/694 overall. Live
confirmation of must-not-change #1: 5 parked frames → `GROUND`, then 2 airborne
frames → still `GROUND`, 3rd → `FLYING currentFlightId=87`, ground session closed
`ended_reason='flight-started' flight_id=87`. The `IDLE` airborne block was
extracted to `checkAirborneDebounce()` — permitted by §1.7's "shared helper or
duplicated verbatim", and the body is logically identical.

## T-007 — client (7/7 pass)

| # | Criterion | Verdict |
|---|---|---|
| 1 | Card shows airport, source, stand | **pass (was partial)** — rendered at `Home.tsx:211-227`; confirmed in a real browser, updating live from `Stand not set` to `Stand 512` with no reload |
| 2 | Links to the leg-scoped ACARS thread | **pass (was partial)** — `href=/planned-leg/4/acars`, label `KMRY → KSFO`, clicked through to a thread that renders `ACARS Messages — Planned leg #4` with the pre-flight actions |
| 3 | Fallback wording per §7.6 | **pass** — grep finds all three frozen strings verbatim: `Manual entry (fallback)` (:235), `msfslogger detects your airport and stand automatically. Use this only when detection could not resolve your position.` (:237), `Set ground position` (:282); the form stays rendered alongside the card |
| 4 | `client/src/types.ts` mirrors the server shape | **pass** — `diff` of the two `GroundSessionLiveStatus` bodies (comments stripped): identical |
| 5 | Client typecheck | **pass** — `client/ npx tsc --noEmit` exit 0, no output |
| 6 | Scratch-server click-through | **pass** — API level: 4 parked frames → `IDLE`, no `groundSession`; 5th → `GROUND` with the full payload on a plain authenticated poll. Browser level: see above, card appears and refreshes without reload |
| 7 | Untouched fields omitted from the POST body | **pass** — `Home.tsx:171-172` sends `parking_position`/`planned_leg_id` only when the matching `*Touched` flag is set. Against an **auto** EGLL session: stand-only refine → `200 id=1 source=auto stand='Stand 512'`; then leg-only refine → `200 id=1 source=auto stand='Stand 512' leg=4` — the stand survives. Explicit `"parking_position":null` still clears it |

## Scope and hygiene

- Every changed file is inside its task's `allowed_paths`, except
  `src/db/groundSessions.ts` and `src/routes/groundSessions.ts`, which the
  Orchestrator folded into T-006 for the follow-up rounds. Not a finding.
- **New, non-blocking:** two comments now cite a design section by number —
  `src/flightManager.ts:501` ("a §7.3 correction") and
  `tests/flightManager.ground.test.ts:429` ("A correction (§7.3) can"). A reader
  of `src/` has no way to resolve `§7.3`; both comments explain themselves
  perfectly well without it. Follow-up 5.
- No other run citation: the same grep for `.claude/runs`, `design.md`,
  `plan.json`, `T-NNN`, `phase[0-9]` over the diff and the four new files is
  clean.
- Style matches the surrounding code (comment voice, `try/catch`-and-log
  mirroring `autoLinkPlannedLeg()`, cache idiom mirroring `buildPlannedLegCache`).

## Non-blocking follow-ups

1. **§1.5 and §7.4 contradict each other** on who closes a manual session.
   §7.4's table says slew and sim-exit close an `'auto'` session only; §1.5's
   exit table carries the `source='auto'` qualifier on the `onCrash()` and
   `onSimDisconnect()` rows but *not* on the slew or `simRunning === 0` rows.
   The implementation follows §1.5 (`closeGroundSessionAndReturnToIdle` closes
   any source on both paths, with a deliberate comment at `flightManager.ts:239`).
   Defensible, but the freeze should be amended to say which reading wins.
2. **§4.6 scenario 8 is mis-worded** — "entry slips by exactly one frame"
   contradicts normative §1.3 ("resets the counter to 0… not decremented").
   The inspector implements §1.3 and labels the row accordingly (expects frame
   10, not 6). Fix the design text, not the code.
3. **`PATCH /api/ground-sessions/current` (§5.4) is still absent** — `DELETE`
   landed in round 2 and matches §5.4, so the operator can now close a session;
   `PATCH` (refinement-only, always stamping `parking_position_source='manual'`)
   remains unimplemented and answers with express's HTML 404 rather than the
   `NO_OPEN_GROUND_SESSION` JSON shape. Carried from the Phase 1 review.
4. **Stale comment**, `src/routes/groundSessions.ts` — the header still says
   the router "takes flightManager for one reason: … `aircraft` comes from the
   last telemetry frame". It now also drives `refreshGroundSession()`; the
   sentence at `:18` was updated but the "one reason" framing above it wasn't.
5. **Two `§`-numbered design citations in comments** (see Scope and hygiene).
   Worth stripping next time either file is touched.

Approved for merge. No further round needed.
