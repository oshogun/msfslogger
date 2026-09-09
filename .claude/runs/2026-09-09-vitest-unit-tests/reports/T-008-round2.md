# T-008 round 2 — pin ARRIVAL_RADIUS_NM's value

## Reviewer finding addressed

> Setting ARRIVAL_RADIUS_NM to 5 or to 20 in legMatcher.ts:111 leaves the full
> 200-test suite green, because the only arrival tests sit at 3.5 nm and
> 25.9 nm.

## Change

Added two tests to the existing `FlightManager — arrival on the planned leg`
group in `tests/flightManager.test.ts` (the file that already held the
3.5 nm/25.9 nm arrival tests — confirmed via `grep -n "PLANNED LEG\|ARRIVAL_RADIUS"`
across the three candidate files, only `flightManager.test.ts` matched):

- `"landing just inside ARRIVAL_RADIUS_NM (~9.9 nm) still records 'flown'"`
- `"landing just outside ARRIVAL_RADIUS_NM (~10.1 nm) records 'diverted'"`

Both use `northOfNm(KMRY, 9.9|10.1)` then `haversineNm(...)` to *measure* the
actual distance (not derive it on paper), same pattern as the existing 3.46/
25.87 nm tests. Each test asserts `toBeCloseTo(target, 1)` on the measured
distance, a guard (`toBeLessThan`/`toBeGreaterThan(ARRIVAL_RADIUS_NM)`) tying
the test's premise to the live constant, and the mock call with the
dynamically-rounded expected distance (`Math.round(measuredNm * 10) / 10`) —
no hardcoded literal for the third arg, so nothing is "derived on paper."
Not touching the exact 10.0 boundary, per the accepted out-of-scope gap.

No `src/` file was touched.

## Verification

**1. New tests pass in the real repo (ARRIVAL_RADIUS_NM = 10):**
```
$ npx vitest run tests/flightManager*.test.ts
 ✓ tests/flightManager.state.test.ts (20 tests)
 ✓ tests/flightManager.duration.test.ts (17 tests)
 ✓ tests/flightManager.test.ts (22 tests)   # was 20, +2 new
 Test Files  3 passed (3)  |  Tests  59 passed (59)
```

**2. Mutation-kill proof** — scratch copy at
`$SCRATCH/msfslogger-mutant` (`node_modules` symlinked, never mutated in
the real repo):

- `ARRIVAL_RADIUS_NM = 5`:
  ```
  × landing just inside ARRIVAL_RADIUS_NM (~9.9 nm) still records 'flown'
    AssertionError: expected 9.900000000000114 to be less than 5
  Test Files  1 failed (1)  |  1 failed | 3 passed | 18 skipped
  ```
- `ARRIVAL_RADIUS_NM = 20`:
  ```
  × landing just outside ARRIVAL_RADIUS_NM (~10.1 nm) records 'diverted'
    AssertionError: expected 10.099999999999918 to be greater than 20
  Test Files  1 failed (1)  |  1 failed | 3 passed | 18 skipped
  ```
  Each mutant is caught by (at least) one of the two new tests, confirming
  the value 10 is now pinned.

**3. Full suite still green:**
```
$ npm test
 Test Files  10 passed (10)  |  Tests  202 passed (202)   # was 200, +2
```

**4. Typecheck:**
```
$ npx tsc --noEmit
(no output, exit 0)
```

**5. src/ untouched:**
```
$ git diff --stat src/flightManager.ts
(empty)
$ git diff --stat src/legMatcher.ts
(empty)
```

All commands run under Node 20 via `nvm use 20`, per `.claude/ENVIRONMENT.md`.
The scratch mutant directory was removed after the proof.
