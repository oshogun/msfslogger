# Review — Phase 2 (T-004 legMatcher/plannedLegClose/flightPlans, T-005 airports, T-006 lnmpln)

## Verdict: approve

One real gap found by mutation (radius-constant regression is not pinned), but
it is non-blocking: no acceptance criterion of T-004/T-005/T-006 required a
default-radius mutation test, and none of the design's must-not-change or
failure-path guarantees are violated. Recorded as a follow-up.

## Commands re-run myself

- `npm test` → **143 passed (143), 7 files**, suite duration **650ms**, wall
  clock (`time npm test`) **1.178s**. Exit 0.
- `npx tsc` → exit 0, 2.547s.
- `npm run build` → exit 0, 8.759s (client `tsc && vite build` + server `tsc`).
- `md5sum flights.db`: `7a6651ecfa30fab34ce52340b7f7f5cb` before and after all
  work below. Unchanged.
- `git status --porcelain`: only `package.json`/`package-lock.json` (phase 1,
  already approved), `src/airports.ts` (T-005), new `tests/`,
  `tsconfig.test.json`, `vitest.config.ts` (phase 1 + this phase). No file
  outside T-004/T-005/T-006 `allowed_paths` plus already-approved phase-1
  files. No writes under `samples/`.

## src/airports.ts vs design §7

`git diff HEAD -- src/airports.ts` shows exactly: `export` added to `Airport`,
`parseCSVLine`, `parseCSV`; new 3-line `setAirports()`; the three
`airports = …` assignments in `initAirports()` replaced with
`setAirports(…)` calls. `findNearestAirport` does not appear in the diff at
all — confirmed byte-for-byte unchanged by reading it directly
(`src/airports.ts:106-115`, `maxNm = 10` default, same loop/haversine body).
`initAirports()`'s cache-read/download/write control flow is unchanged, only
the three assignments were swapped for the setter. Matches §7.3 exactly —
nothing outside its scope.

## Mutation spot-checks (scratch copy, `cp -r` to scratchpad, never in place)

**1. `DEPARTURE_RADIUS_NM` 10 → 40** (`src/legMatcher.ts:103`): ran
`npx vitest run tests/legMatcher.test.ts` — **28/28 still pass, 0 failures.**
This is a real gap: no test asserts `NO_LEG_IN_RADIUS` at a distance between
10 and 40 nm using the *default* radius (no `radiusNm` override). The closest
candidate, `'takeoff 40 nm away'` (ported from the inspector table), survives
by luck — its `northOf(KSBA, 40)` helper (design §4.6: the inspector's
imprecise `/60` version) measures ≈40.03 nm, just outside even the mutated
40 nm radius, so it stays `NO_LEG_IN_RADIUS` regardless. The `radiusNm: 0`
test's "control" case (5 nm away) is also silently immune (5 < 40). **No
acceptance criterion in T-004 required this specific mutation to fail** —
its radius-boundary criterion is deliberately satisfied via measure-then-set
(§4.6/§10.5), which is generic to any radius value by design. Flagging as a
non-blocking follow-up: one fixed-distance test without a `radiusNm` override
(e.g. 15 nm away, default radius, expect `NO_LEG_IN_RADIUS`) would catch a
future accidental change to the constant.

**2. `refusalFor()` check order** (`src/legMatcher.ts:126-131`): the task's
literal wording ("LEG_ALREADY_FLOWN / LEG_SKIPPED order") is a no-op mutation
— `status` is a single-valued field, so a candidate can never be both
`'flown'` and `'skipped'` and no test could ever observe this swap regardless
of coverage quality; ran it to confirm: 28/28 still pass. The design-normative
precedence that's actually observable is FLOWN vs. LINKED (two independent
fields, both can be true on one candidate) — design.md and the module header
call this out explicitly ("a leg that is both flown and linked reports
LEG_ALREADY_FLOWN"). Swapped `LEG_ALREADY_LINKED` ahead of `LEG_ALREADY_FLOWN`
instead: **1 test failed** —
`matchPlannedLeg — 24 scenarios … [REAL] precedence: flown AND linked reports
FLOWN — the per-leg order in §13.2 step 5, not whichever check runs first`
(`tests/legMatcher.test.ts:357`), `expected "LEG_ALREADY_FLOWN" received
"LEG_ALREADY_LINKED"`. The precedence design.md actually freezes is genuinely
pinned.

**3. `handCloseDeviationNm`: `Math.round(x*10)/10` → `Number(x.toFixed(1))`**
(`src/plannedLegClose.ts:174-178`): ran
`npx vitest run tests/plannedLegClose.test.ts` — **1 test failed** (33/34
passed): `handCloseDeviationNm > uses Math.round(x*10)/10, not toFixed(1) —
the x.x5 rounding-boundary case from src/inspect-manual-mark.ts:429-487`
(`tests/plannedLegClose.test.ts:261`), `expected 0.1 to be 0.2`. Exactly the
test named to catch this, by design.

All mutations reverted (`git checkout --` inside the scratch copy); scratch
copy removed after use.

## Reason-code grep (not trusted from the report)

`grep -c "'<CODE>'" tests/legMatcher.test.ts` for all ten `LegMatchReason`
values: `MATCHED`(9) `NO_ACTIVE_TRIP`(1) `NO_PLANNED_LEGS`(2)
`NO_LEG_IN_RADIUS`(6) `AMBIGUOUS`(2) `LEG_ALREADY_FLOWN`(4)
`LEG_ALREADY_LINKED`(3) `LEG_SKIPPED`(1) `SNIPPET_NO_DEPARTURE_AIRPORT`(1)
`FLIGHT_ALREADY_LINKED`(1) — all present, all reached through
`expect(r.reason).toBe(...)` or the scenario-table loop's
`expect(r.reason).toBe(s.reason)`.

`HandCloseRefusal` in `src/plannedLegClose.ts:34-39` is actually
`NOT_LINKED | LINK_NOT_MANUAL | FLIGHT_NOT_ENDED | LEG_NOT_PLANNED |
LEG_NOT_FLOWN` (note: **not** `LEG_ALREADY_CLOSED`, which does not exist in
the codebase — checked the real union before grepping). All five present in
`tests/plannedLegClose.test.ts`: `NOT_LINKED`(4) `LINK_NOT_MANUAL`(18)
`FLIGHT_NOT_ENDED`(5) `LEG_NOT_PLANNED`(4) `LEG_NOT_FLOWN`(4).

## Two flagged risk areas

**BROKEN_CHAIN in-memory stub** (`tests/lnmpln.test.ts:317-325`): traced
`chainOrderForBatch` (`src/lnmpln.ts:940-982`) by hand against
`[fakePlan('KAAA','KAAA'), fakePlan('KCCC','KDDD')]`. Both plans have
`isAirport: true` so `SNIPPET_IN_BATCH` is not hit; `destIdents = {KAAA,
KDDD}`; `heads` filters to indices whose `deps[i]` is not a destination —
`KAAA` is excluded (it's its own destination), `KCCC` survives → `heads =
[1]`, satisfying the unique-head gate genuinely (not coincidentally). Walking
the chain from index 1 (`KCCC→KDDD`), the next-successor search looks for
`deps[i] === 'KDDD'`, finds none → `next.length === 0` → real `BROKEN_CHAIN`
branch at `src/lnmpln.ts:976`, matching the test's expectation exactly. The
function only reads `.departure`/`.destination` `.ident`/`.isAirport`
(confirmed by reading the full function body, lines 940-982 — no other field
is touched), so `fakePlan`'s null-filled remainder is inert filler needed
only to satisfy `ParsedFlightPlan`'s type under `tsc`, and it does not assume
anything about real parser output that isn't true — the self-loop and the
disjoint pair are both legitimate inputs to this pure, structural algorithm
regardless of whether a real `.lnmpln` export could produce them. Confirmed
real, not coincidental.

**`SNIPPET_NO_DEPARTURE_AIRPORT` reading** (`tests/lnmpln.test.ts:145-152`):
T-006 asserts `plan.departure.isAirport === false` on the real
`snippet-non-airport-endpoints.lnmpln` fixture — it does not call into
`src/legMatcher.ts`. Separately, `tests/legMatcher.test.ts:261-269` (T-004,
ported inspector scenario) asserts `departureIsAirport: false` on a
`LegMatchCandidate` produces `reason: 'SNIPPET_NO_DEPARTURE_AIRPORT'`. My
call: **this reading satisfies the criterion's intent and needs no blocking
fix.** The design explicitly scopes T-006 to the parser's own output
(§8.4: "the route-matching surface... not every warning code"), and
discourages cross-module coupling in a unit-test file. Between the two files,
every fact needed to trust the pipeline is independently pinned. What is
genuinely *not* tested by any task in this run is the glue code that copies
`ParsedFlightPlan.departure.isAirport` into a stored `departure_is_airport`
column / `LegMatchCandidate.departureIsAirport` at import time (wherever that
conversion lives — outside `src/lnmpln.ts` and `src/legMatcher.ts`, so outside
every allowed_paths in this run). That's a real, if narrow, integration gap —
recording as a non-blocking follow-up, not a defect in T-006's reasoning.

## Findings

None blocking.

**Non-blocking follow-ups:**
1. `legMatcher.test.ts` has no test that pins the numeric value of
   `DEPARTURE_RADIUS_NM` against a widening mutation without an explicit
   `radiusNm` override — see mutation 1 above. A single added case (candidate
   ~15 nm out, default radius, expect `NO_LEG_IN_RADIUS`) would close it.
2. The mapping from `ParsedFlightPlan.departure.isAirport` (src/lnmpln.ts) to
   whatever field ultimately becomes `LegMatchCandidate.departureIsAirport` is
   untested end-to-end by this run — both ends are pinned separately but not
   the wiring between them. Out of scope for T-004/T-005/T-006's
   `allowed_paths`; worth a future task if that conversion code changes.

## Not independently re-verified

Did not re-verify every one of the ~30 acceptance criteria across T-004/T-005
/T-006 line by line (e.g. antimeridian distance windows, all 48 gate-table
verdicts, all 22 `parseCSV`/`parseCSVLine` cases, the BOM/Buffer-vs-string
cases, the cwd-independence double-run). Spot-checked instead: full suite run
(143/143), `airports.ts` diff read in full, three targeted mutations, grep of
all fifteen reason/refusal codes, hand-trace of the `BROKEN_CHAIN` stub, and
the two flagged reasoning calls above — per the task's explicit request to
verify by mutation rather than by reading the dispatcher reports (which were
not opened).
