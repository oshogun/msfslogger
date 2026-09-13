# Review — atlas-countries-progress-fix — implement

**Verdict: approve**

## Task verdict

Single task (src/journey.ts + tests, single seam) — **approve**.

## Criteria verified independently

1. **U*-prefix airport resolves to Russia.** Verified via direct call:
   `countryForIcao('UHPP')` → `{ name: 'Russia', flag: '🇷🇺' }`. Also built a fresh
   `buildJourney` fixture (UHPP↔UUEE) not taken from the test file: `countries` →
   `[{ name: 'Russia', flag: '🇷🇺', airports: 2 }]`. **Pass.**
2. **Mixed-status legs reflect only flown+diverted share.** Independent fixture: legs
   flown(300)/skipped(200)/planned(500), one flight with raw `distance_nm: 5000`
   (far exceeding the 1000 nm plan total — would have clamped to 100 under the old
   formula). Got `plannedRouteProgressPct: 30` (= 300/1000), `totalDistanceNm: 5000`
   unchanged. **Pass.**
3. **Zero planned legs → key absent.** `'plannedRouteProgressPct' in j2` → `false` on
   a fixture built independently of the test file. Test suite also covers the
   degenerate-0nm-total case and the empty-trip case. **Pass.**
4. **`npm test` green, new coverage added.** Ran myself under Node 20.20.2:
   `Test Files 15 passed (15)`, `Tests 278 passed (278)`. `tests/journey.test.ts`
   is new, 12 tests, covering both fixes plus edges (skipped-never-100, rounding,
   degenerate 0nm, no-legs, empty trip, mixed countries). **Pass.**
5. **`npm run test:types` and `npm run build` clean.** Ran both myself: `tsc -p
   tsconfig.test.json` produced no output/errors; `build:client` (tsc + vite) and
   `build:server` (tsc) both completed with no errors. **Pass.**

## Regression check (did not take the report's number on faith)

Stashed only `src/journey.ts` (kept the new test file) and reran
`npx vitest run tests/journey.test.ts`: **7 of 12 fail** against the pre-fix code,
including the exact assertion the fix targets:
```
FAIL  ... > rounds to one decimal place
AssertionError: expected 100 to be 33.3
- Expected: 33.3
+ Received: 100
```
Popped the stash back; `git diff -- src/journey.ts` after restore is byte-identical
(same md5) to the pre-stash diff. Matches the implementer's claim exactly, confirmed
independently rather than trusted.

## Design/spec conformance

- **Russia & CIS block**: all 18 entries present, correct names/flags, in the exact
  order/values specified (UA Kazakhstan, UB Azerbaijan, UC Kyrgyzstan, UD Armenia,
  UE/UH/UI/UL/UN/UO/UR/US/UU/UW Russia, UG Georgia, UK Ukraine, UM Belarus, UT
  Uzbekistan). Placed as a new block appended to `ICAO_COUNTRIES`, after `FA` —
  no reordering of existing entries. `SINGLE_LETTER_COUNTRIES` untouched (`git diff`
  shows no hunk touching it). Directly confirmed `countryForIcao('UMKK')` returns
  Belarus — the known/accepted imprecision called out in the intake, not silently
  fixed or hidden.
- **`journey.airports` (unfiltered list) untouched**: the countries rollup (lines
  ~229-235) iterates a separate `Map` built independently of `airports`; confirmed
  by reading the surrounding code and by the new test's explicit assertion that
  `journey.airports` still lists both ICAOs regardless of country resolution.
- **Progress fix**: numerator changed to `completedPlannedDistanceNm` (sum over
  `status === 'flown' || 'diverted'`); denominator (`totalPlannedDistanceNm`, all
  legs regardless of status), the `Math.min(100, …)` clamp, and the
  `totalPlannedDistanceNm > 0` presence guard are byte-for-byte unchanged in the
  diff — only the dividend was swapped. Skipped legs correctly stay in the
  denominator and never contribute to the numerator (verified: 2 flown/1 skipped
  → 80%, not 100%, both in the test suite and my own independent fixture).
- **Doc comments**: both the file-level note above the `Journey` interface and the
  per-field comment on `plannedRouteProgressPct` were amended in place (not
  deleted/replaced with something contradicting current behavior) and accurately
  describe the corrected numerator. No run-id/task-id/`§`/phase-file citations in
  either the doc comments or the new inline code comments in `journey.ts` — checked
  by reading every added comment line in the diff.
- **phase5.md**: `git diff --numstat` shows `6 0` — pure addition, no lines removed
  or altered. The 6 lines are inserted immediately before the `### T-021` header,
  inside the T-020 section as instructed, and don't renumber or rewrite anything
  above them. This file is itself a run-artifact review, where citing a run id is
  the normal/expected convention (unlike source comments), so the citation inside
  it is not a violation of the "no run citations in comments" rule.

## Scope

`git status --porcelain` shows only `src/journey.ts` and
`.claude/runs/2026-09-04-lnmpln-trip-planner/reviews/phase5.md` modified, plus new
`tests/journey.test.ts` — all within `allowed_paths`. No other files touched
(dist/, client build output, etc. not present in git status).

## Non-negotiables

No database or server work in this task; `flights.db` was never opened by the
implementer or by this review. md5 spot-checked at review time:
`bc10edc791ce85680caca6e9351381d8` (informational only — no before/after delta to
report since nothing in this run touches it).

## Findings

None blocking. None non-blocking beyond what's already flagged and accepted in
the intake (the UMKK/Kaliningrad heuristic imprecision, explicitly frozen as
acceptable).

## Follow-ups (non-blocking)

- The Russia/CIS block, like the existing Brazil S-block, will misattribute a
  handful of border-adjacent ICAO codes (e.g. UMKK → Belarus instead of Russia).
  Already known and accepted per the intake; worth a per-airport override table
  only if it becomes a recurring user complaint.
