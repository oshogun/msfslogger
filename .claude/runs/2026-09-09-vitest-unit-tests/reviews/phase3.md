# Review — phase 3 (T-008, flight manager suite) — **request_changes**

Reviewer: T-009. All evidence below was produced by re-running commands, not read
from `T-008.md`. Mutations were applied to a `cp -r` copy of `src/` + `tests/` in
the session scratchpad (`node_modules` symlinked, source never edited in place);
the copy was diffed against the repo (`SCRATCH SRC IDENTICAL TO REPO`) and deleted.

**Verdict: `request_changes` — one blocking finding (F-1), narrowly scoped.**
7 of the 8 mandated mutations are killed. MUTATION 6 survives, as flagged. My
judgment on it is in § MUTATION 6 below: the *exact tie* is genuinely untestable
under the freeze and I accept it — but I found independently that the underlying
constant is not pinned at all, which is fixable in two assertions without any
source seam. That is F-1.

## Baseline (repo, Node 20.20.2)

| Check | Result |
|---|---|
| `npm test` | `Test Files 10 passed (10) / Tests 200 passed (200)`, exit 0 |
| wall clock | `real 0m1.394s` (suite `Duration 853ms`) — **well under the 10 s claimed** |
| flightManager files | 20 + 20 + 17 = **57 tests**, as reported |
| `npx tsc --noEmit` | `tsc exit=0` |
| `npm run build` | `✓ built in 2.02s` … `build exit=0` |

## The eight mandated mutations

Each applied alone to the scratch copy, then reverted. Command per mutant:
`npx vitest run tests/flightManager.test.ts tests/flightManager.state.test.ts tests/flightManager.duration.test.ts`

| # | Mutation | Result | Test named as killer (first of N) |
|---|---|---|---|
| 1 | `AIRBORNE_DEBOUNCE_FRAMES` 3→2 (`:16`) | **killed**, 3 failed | `needs exactly AIRBORNE_DEBOUNCE_FRAMES consecutive qualifying frames to start a flight` |
| 2 | `LANDED_DEBOUNCE_FRAMES` 10→9 (`:17`) | **killed**, 7 failed | `needs exactly LANDED_DEBOUNCE_FRAMES consecutive landed frames to end a flight` |
| 3 | `MAX_COUNTED_GAP_MS` 60_000→600_000 (`:15`) | **killed**, 4 failed | `a gap of MAX_COUNTED_GAP_MS + 1 is not counted` |
| 4 | drop `!this.interrupted &&` at `:493` (writePoint gap) | **killed**, 3 failed | `worked flight (b): a 35 s pause leaves duration_sec = 15 on a 50 s flight` (also `a 10 s pause is excluded…`, `slew (simRunning === 3)…`) |
| 5 | drop `!this.interrupted &&` at `:276` (endFlight tail) | **killed**, 1 failed | `an interrupted tail is excluded even though it fits the budget` |
| 6 | `deviationNm <= ARRIVAL_RADIUS_NM` → `<` (`:462`) | **SURVIVED** | — `Tests 57 passed (57)`; re-run against the **full** suite: `Tests 200 passed (200)` |
| 7 | `RECORD_INTERVAL_MS` 5000→1000 (`:11`) | **killed**, 9 failed | `records at most one point per RECORD_INTERVAL_MS` |
| 8 | `lonDeltaDeg(aLon, bLon)`/`lonDeltaDeg(aLon, lon)` → raw subtraction (`:62-63`) | **killed**, 1 failed | `picks the right segment across the antimeridian rather than the ~360°-wide one` |

Mutation 4 is the one the task called decisive: it fails three PAUSE/slew tests
including design §5.4(b)'s worked flight, so pause exclusion is covered genuinely,
not incidentally. Mutation 5 fails exactly the one DURATION test written for it.

## MUTATION 6 — the judgment call

**I reproduced the survival independently** (green at 57/57 and at 200/200) and I
**accept the exact-tie gap**, for these reasons:

- The tie can only be reached by making `haversineNm(frame, dest)` return the
  double `10.0` exactly. Distance runs through `sin/cos/atan2`, so it is not
  linear in the coordinate a test controls; near 10 nm, one ulp of longitude
  moves the result ~8.5e-13 nm while an ulp of the result is ~1.8e-15 nm, so
  consecutive constructible values straddle `10.0` roughly 470 ulps apart. Hitting
  it would mean ulp-hunting a magic coordinate — machine-fragile and unreadable.
- Design **§10.5 forbids exactly that**: "Radius boundaries are never constructed
  from coordinates … even an exactly-computed 10 nm offset measures
  10.000000000000002."
- §4.6's escape hatch ("measure the distance, then set `radiusNm` to it") is
  unavailable here: `radiusNm` overrides `DEPARTURE_RADIUS_NM` only
  (`src/legMatcher.ts:62,183`). `ARRIVAL_RADIUS_NM` (`:111`) is consumed as a bare
  constant at `src/flightManager.ts:462` with no per-call override, and design §7
  forbids editing `flightManager.ts` to add one.
- The behavioural consequence is measure-zero: a landing at exactly 10.000000 nm.
  Both branches record the same `arrival_deviation_nm`; only the label differs.

I therefore do **not** require an exact-tie test and do **not** require a new
source seam. Contrast MUTATION 3, which *is* killed at its exact boundary —
correctly, because there the input domain is integer milliseconds the test sets
directly. That is the right line, and the suite is on the right side of it.

**But the mutant's survival pointed at a bigger, cheaper gap (F-1).** The two
existing arrival tests assert 3.5 nm → `'flown'` and 25.9 nm → `'diverted'`
(`tests/flightManager.test.ts:279,295`), which pins the threshold only to the
open interval (3.5, 25.9]. I probed the constant itself:

```
# src/legMatcher.ts:111, scratch copy, full suite each time
ARRIVAL_RADIUS_NM = 5   -> Test Files 10 passed (10) / Tests 200 passed (200)
ARRIVAL_RADIUS_NM = 20  -> Test Files 10 passed (10) / Tests 200 passed (200)
```

The flown/diverted threshold can move 2× in either direction with the suite green.
That is not an untestable boundary — it needs no seam, no exact double, and it is
explicitly permitted by §10.5, which allows "`toBeCloseTo` / an inclusive window".

## Findings

**F-1 — blocking.** `tests/flightManager.test.ts:279-305` — the arrival
threshold's *value* is unasserted; `ARRIVAL_RADIUS_NM` survives being changed to
5 or to 20 (reproduction above, full suite green both times). MUTATION 6's stated
purpose is to prove the arrival threshold is genuinely covered, and it is not
covered even loosely. **Fix:** add two near-boundary cases to the planned-leg
block — a landing measured at ~9.9 nm asserting `'flown'` and one at ~10.1 nm
asserting `'diverted'`, each with the measured distance asserted via
`expect(haversineNm(...)).toBeCloseTo(...)` as the existing tests already do with
`toBeLessThan`/`toBeGreaterThan`. This pins the constant to ±0.1 nm and kills any
mutation of it that has user-visible consequence. It does **not** require killing
the `<=`→`<` tie mutant, which stays a documented gap.

**F-2 — non-blocking, agreed with T-008.** Dropping `this.state === 'FLYING'`
from `onCrash`'s guard (`src/flightManager.ts:226`) is a genuinely **equivalent**
mutant, so its survival is not a coverage defect. Verified by reading the
lifecycle rather than by trusting the report: `this.state` is assigned only
`'FLYING'` (`:247`) and `'IDLE'` (`:308`) — `'ENDED'` from `FlightState` is never
used here — and `currentFlightId` is set non-null and null on the same two lines
(`:246`, `:306`). So `state === 'FLYING'` ⟺ `currentFlightId !== null`, and
`endFlight`'s `if (this.currentFlightId === null) return` (`:271`) already covers
it. No test can distinguish the two. No action.

## Conformance, scope and hermeticism

- **Design §6.1 mock shape** — `vi.mock('../src/db', async () => (await import('./helpers')).dbMock)` used verbatim in all three files, with `import { FlightManager }` after. Conforms.
- **Design §5 clock** — `useFakeClock()`/`useRealClock()` in `beforeEach`/`afterEach`; advance-then-feed used throughout; §5.4's two worked flights reproduced as named tests. Conforms.
- **§10.1/§10.2/§10.5/§10.6** — `grep -rn "better-sqlite3\|flights\.db\|initAirports\|fetch(\|http://\|https://"` over the three files: no match. `grep -rn "setTimeout\|Math.random\|process.env\|hrtime\|new Date()"`: no match.
- **§10.3** — `git status --porcelain` after `npm test` is byte-identical to the pre-review snapshot. No test wrote into the repo.
- **Scope** — phase 3 touched only `tests/flightManager.test.ts`, `.state.test.ts`, `.duration.test.ts` (mtimes 13:28/13:35; `tests/helpers/index.ts` is 13:03, phase 1/2). `git diff src/flightManager.ts` is **empty**. `src/airports.ts` is modified but is the earlier phase's export seam, not this phase's.
- **Style** — file-header comments name the source lines under test, expected durations are hand-computed literals with the arithmetic in the comment. Reads like the rest of the suite.

## Safety

- `md5sum flights.db` **before `7a6651ecfa30fab34ce52340b7f7f5cb`, after `7a6651ecfa30fab34ce52340b7f7f5cb`** — unchanged.
- The user's server on port 3000 was never stopped, restarted or reconfigured. Confirmed still serving after the review: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/flights?limit=1` → `200`.
- `npm run build` was run once, to completion, on an unmutated tree; `dist/` is left shippable. All mutations were confined to the scratch copy, which has been deleted.

## Follow-ups (non-blocking)

1. If `ARRIVAL_RADIUS_NM` is ever tuned, the arrival tests must be retuned with it — worth a comment at `src/legMatcher.ts:111` pointing at the tests that pin it.
2. A per-call arrival radius override (mirroring `radiusNm` for departure) would make the exact tie testable and is the only way to close the MUTATION 6 gap. It is a source change, out of scope for this run; record it, do not do it here.
