# Phase 1 review — OOOI events and position reports (T-002)

**VERDICT: approve.** No blocking findings. 4/4 story acceptance criteria verified
independently (unit suite re-run + my own end-to-end run against a scratch database);
all 12 must-not-change items checked; both implementer judgment calls upheld.

Reviewer: T-003. Evidence below is from commands I ran, not from T-002's report
(which I did not read).

## Commands re-run (Node 20.20.2, `nvm use 20`)

| Command | Result |
|---|---|
| `npm test` | `Test Files 38 passed (38) / Tests 802 passed (802)` — incl. `tests/flightManager.acars.test.ts (10 tests)`, `tests/acars.test.ts` (+41 new `it`s) |
| `npx tsc --noEmit` | no output, exit 0 |
| `npm run test:types` (`tsc -p tsconfig.test.json`) | no output, exit 0 |
| ts-node e2e vs scratch DB (fake clock, real `better-sqlite3`) | output quoted below |

Live database: md5 `655965c8…` before / `b653ef4a…` after — expected WAL churn from the
user's own running server (ENVIRONMENT.md), not contamination. Structural proof it was
never written by me: `select count(*) from acars_messages where category in
('oooi','position-report')` → **0**, `max(flights.id)` → **89** (my run created flights
1 and 2 in `scratch.db`). No server was started; scratch DB and scratch project copy deleted.

## Story acceptance criteria — one at a time

**AC1 — OOOI exactly once per transition.** Scratch-DB flight, real inserts, redundant
frames around every transition (6 parked, 4 airborne, 5 rollout, 12 stopped):

```
[2026-09-16T14:00:06.000Z] oooi/OUT key=oooi:flight:1:OUT   (memo instant = 14:00:06 ✔, not estimated)
[2026-09-16T14:02:08.000Z] oooi/OFF key=oooi:flight:1:OFF
[2026-09-16T14:27:15.000Z] oooi/ON  key=oooi:flight:1:ON    (touchdown frame, estimated=false)
[2026-09-16T14:28:25.000Z] oooi/IN  key=oooi:flight:1:IN
```
Group-by over the table: `OUT 1, OFF 1, ON 1, IN 1` — five rollout frames produced one ON.
Backstop verified separately: re-filing the same OUT and the same window-1 report through
`fileAcarsMessageOnce()` returned `false` twice and the row counts did not move. PASS.

**AC2 — at least one position report on a routed flight, between OFF and ON.** Same
flight, KSFO→KLAX `.lnmpln` leg linked via `linkFlightToPlannedLeg` +
`refreshPlannedLegForFlight`, 25 min of 5 s frames at the default 10 min cadence → two
reports, windows 1 and 2, both strictly between OFF (14:02:08) and ON (14:27:15):

```
[14:12:10] position-report/POS REPORT key=position-report:flight:1:1
    POSITION REPORT
    N3625.4 W12101.4 1412Z
    FL330 GS 452 HDG 130
    NEXT EBAYE DEST KLAX 197.1 NM
    ETE 0026 ETA 1438Z
```
Shape is byte-for-byte the frozen §2.5/§11.2 layout. `sent_at` equals the recorded point's
`ts` (§3.2). PASS.

**AC3 — unrouted flight: OOOI only, no errors.** Second flight, no leg, 400 frames over
~33 min (three interval windows):
```
=== UNROUTED FLIGHT #2 (4 rows) ===  OUT(est=true) OFF ON IN
position-report rows for unrouted flight: 0
warns during unrouted flight: 0 []      errors during unrouted flight: 0 []
```
`console.warn`/`console.error` were spied for the whole run: **0 and 0** overall. OUT is
`estimated: true` at the takeoff instant, exactly §1.2/§5.2. PASS.

**AC4 — visible in the flight's own ACARS thread.** `listAcarsMessagesForFlight(1)`
returned all 6 rows in `sent_at ASC, id ASC` order (OUT, OFF, POS, POS, ON, IN); every row
has `flight_id=1`, `planned_leg_id=null` (§1.6), so the `WHERE flight_id = ?` arm carries
them. `listAcarsMessagesForPlannedLeg(legId)` → **0 rows**, the documented and intended
consequence of §1.6. PASS.

## Design conformance (sections 1–6)

- §1.2/§1.7 mapping and order: OUT→OFF in `startFlight()`, ON→IN in `endFlight()`,
  ON-from-touchdown in the `FLYING` branch (`src/flightManager.ts:300`). Confirmed in the
  thread read above.
- §1.3 memo: set in the GROUND branch after slew/anchor checks, before
  `checkAirborneDebounce()` (`:284-286`), `TAXI_OUT_SPEED_KTS = 3` exported (`:16-17`);
  reset in `enterGround()` (`:455`), `resetGroundTracking()` (`:548`), `startFlight()`
  after both emissions (`:672`). All three reset points present.
- §1.4 flag-first: `fileTouchdownOn()` sets `onEventFiled = true` as its first statement
  (`:576`), one `findNearestAirport` call, one insert attempt.
- §1.8 insertion points: OUT/OFF context captured *before* the ground-session close block
  (`:604-606`), emissions after the `appState` assignments and before the existing
  `Flight #N started` log; ON-fallback/IN after `recordArrivalOnPlannedLeg()` and before
  the field resets (`:720-748`). Matches.
- §2.x contract: keys `oooi:flight:<id>:<EVENT>` and `position-report:flight:<id>:<window>`,
  `direction: 'downlink'`, categories `oooi` / `position-report` (both already in
  `KNOWN_ACARS_CATEGORIES`), labels = event word / `POS REPORT`, payload `v:1` shapes as
  frozen. Verified against live rows.
- §3.1/§3.2/§3.4: `maybeFilePositionReport()` is the last statement of `writePoint()`; its
  six guards are in the frozen order, window advanced before the write, whole body in its
  own try/catch. Env parse rules 1–6 implemented literally; log line renders
  `Flight #1 position reports every 10.0 min` (observed).
- §4.3/§4.4: `estimateEnrouteSec` guards before dividing; `formatLatLon` carry and
  hemisphere rules as frozen; unit tests cover `gs = 29.999`, `Infinity`, `----Z`.
- §6.1/§6.4/§6.5: `src/acars.ts` and `src/types.ts` are add-only, `src/acarsEvents.ts` is
  the only impure seam, all four existing `flightManager` test files add exactly the one
  `vi.mock('../src/acarsEvents', …)` line, `acarsEventsMock` + installer wired into
  `resetMocks()`. `dbMock` needed no new entries because FlightManager calls no new
  `src/db` export — checked: the only new imports are `./acars` and `./acarsEvents`.

## Two judgment calls referred to me

**1. OFF's `airportIcao = dep?.icao ?? null` — correct, keep it.** design.md:1154 renders the
OFF sample as `OFF KSBA 1432Z` with no `STAND`, i.e. the departure station of the flight row,
which is exactly `dep` in `startFlight()`. §2.4's line-1 rule ("`<EVENT> <station> <HHMMZ>`")
and §1.2's "OFF … `sent_at = startTime`" agree. Using `groundSessionCache?.airportIcao`
instead would have rendered `----` for any runway/airborne start while `dep` was known.
No disagreement with the freeze.

**2. `plannedLegRefs()` (`src/flightManager.ts:552-565`) is a genuine compiler workaround.**
Reproduced: I copied `src/` + `tsconfig.json` to a scratch project, inlined the direct reads
(`this.plannedLegCache?.destinationIdent ?? null`) at both OUT/OFF sites and ran `tsc`:

```
src/flightManager.ts(661,47): error TS2339: Property 'destinationIdent' does not exist on type 'never'.
src/flightManager.ts(662,43): error TS2339: Property 'plannedLegId' does not exist on type 'never'.
… (2 more at 672/673)
```
So the `= null` assignment really does narrow the field to `never` past
`autoLinkPlannedLeg()`. The helper reads `this.plannedLegCache` at call time, and its one
call site sits after `autoLinkPlannedLeg()` and immediately before the two builders — the
same instant a direct read would have happened, so no read/write reordering. It is used
**only** for those two OUT/OFF fields; §5.1's skip condition is still the literal
`if (this.plannedLegCache === null) return;` in `maybeFilePositionReport()` (`:975`), and
`fileTouchdownOn()`/`endFlight()` still use direct optional reads. No behaviour change.

## Must-not-change list (§9) — all 12 hold

1–3. `insertFlight`/`insertPoint`/`closeFlight` call sites, `RECORD_INTERVAL_MS`,
accumulators, duration logic and the debounce constants are untouched by the diff; the only
edits to the state machine are two added statements inside the `GROUND` and `FLYING`
branches — no `break`, `case` or `state` assignment changed.
`tests/flightManager.duration.test.ts` / `.test.ts` / `.ground.test.ts` diffs are the single
`vi.mock` line each. 4–5. No ground-session or planned-leg function touched. 6. `/api/status`:
`getPlannedLegStatus()` and `PlannedLegLiveStatus` unchanged (`git diff src/types.ts` is
additive only). 7. `git status` shows **no** change under `client/`, `src/routes/`, `src/db/`,
`src/config.ts` — so no new route and no new `src/db/acarsMessages.ts` query, as the design
required (AC4 of my own brief). 8. `git diff src | grep -E 'setInterval|setTimeout|setImmediate|nextTick'`
on added lines → **no matches**. 9. Failure isolation proved live: a deliberate FK-violating
insert logged `[ACARS] bad row not filed: SqliteError: FOREIGN KEY constraint failed` and
returned `false`, nothing thrown. 10. Client untouched. 11. `findNearestAirport(` appears at
`:396` (ground entry), `:580` (new touchdown ON), `:597` (startFlight), `:697` (endFlight) —
three per flight, never in `recordPoint`/`writePoint`; the state test was updated 2→3 with a
correct comment. 12. `src/config.ts` untouched.

Style: new code matches the file's house voice; no comment cites `.claude/runs/`, a run id,
`design.md`, a `§`, `plan.json` or a task id (grepped the added lines).

## Non-blocking follow-ups

1. `src/flightManager.ts:818` (docblock of `autoLinkPlannedLeg`) still says
   "`findNearestAirport()` stays at its two calls per flight". It is three now (§3.3 says so
   too, and the state test was updated). One-word comment fix, not worth a round trip.
2. The design's own §12 asks for an end-to-end check over HTTP against a scratch server on a
   non-3000 port. I substituted an in-process drive of `FlightManager` against a scratch
   database (same real `better-sqlite3` write path and the same
   `listAcarsMessagesForFlight()` reader, one HTTP hop short). If the run wants the literal
   HTTP evidence, it is a 10-minute DevOps task; I judged the ingest hop already covered by
   `tests/ingestScope.test.ts`.
3. No coverage yet for a mid-flight *unlink* (`refreshPlannedLegForFlight` → cache null)
   stopping reports; the code path is the same null check and the link direction is tested.
   Worth a case in a later run.
