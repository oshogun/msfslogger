# Implement report — 2026-09-13-atlas-countries-progress-fix

**Status:** done · **Role:** backend_sr · Both bugs fixed in `src/journey.ts`, tests added.

## Artifacts

- `src/journey.ts` — modified
- `tests/journey.test.ts` — new (12 tests)
- `.claude/runs/2026-09-04-lnmpln-trip-planner/reviews/phase5.md` — amendment appended under T-020

## What changed

**Bug 1 — countries.** Added an 18-entry `// Russia & CIS` block to `ICAO_COUNTRIES`
(UA…UW, exactly the mapping in the spec, flags included), placed after the
"Elsewhere, by first letter" block. `SINGLE_LETTER_COUNTRIES` untouched. The block
header notes the shared-prefix approximation (UMKK reads as Belarus) in plain
language, pointing at the Brazil S-block precedent already in the file.

**Bug 2 — progress numerator.** New `completedPlannedDistanceNm` sums
`approx_distance_nm` over legs whose `status` is `'flown'` or `'diverted'` and
replaces `totalDistanceNm` as the numerator. Denominator, `Math.min(100, …)`, the
`totalPlannedDistanceNm > 0` presence guard and the one-decimal rounding are byte-for-byte
unchanged. The block comment above `Journey` was amended in place (nothing deleted) and
the `plannedRouteProgressPct` field jsdoc now describes the completed-legs numerator.

## Acceptance criteria

| # | Criterion | Command | Result |
|---|---|---|---|
| 1a | `UHPP` appears in `countries` as Russia 🇷🇺 | `npx vitest run tests/journey.test.ts` | pass — `journey.countries` `[{ name: 'Russia', flag: '🇷🇺', airports: 2 }]` for a UHPP→UHMM leg; `journey.airports` still complete |
| 1b | Mixed-status legs → only flown+diverted share | same | pass — legs 100 flown / 50 diverted / 200 planned / 50 skipped with **1000 nm raw flown** gives `plannedRouteProgressPct === 37.5`, asserted `not.toBe(100)` |
| 1c | No planned legs → key absent, not falsy | same | pass — `'plannedRouteProgressPct' in journey === false`, plus a JSON round-trip `not.toHaveProperty` check |
| 2 | `npm test` green | `npm test` | `Test Files 15 passed (15) / Tests 278 passed (278)` |
| 3 | `npm run test:types` clean | `npm run test:types` | `tsc -p tsconfig.test.json` — no output, exit 0 |
| 4 | `npm run build` clean | `npm run build` | `✓ built in 2.46s` then `tsc`; `build exit=0` |
| — | `npx tsc --noEmit` | `npx tsc --noEmit` | no output, `exit=0` |
| 5 | Live server / `flights.db` untouched | `git status --porcelain` | only the three allowed paths + this report dir; nothing opened a database, no server started, no port bound |

All commands run under Node 20 (`nvm use 20` → `v20.20.2`) per `.claude/ENVIRONMENT.md`.

## The tests actually catch the bugs

Swapped `git show HEAD:src/journey.ts` in, ran the new file, swapped the fixed version
back (verified `IDENTICAL` by `diff -q` in the same command, tree never left mid-edit):

```
Tests  7 failed | 5 passed (12)
× resolves a U* airport instead of returning null
× includes a U* airport as Russia with its flag rather than dropping it
× counts distinct airports per country across a mixed-country trip
× counts only flown and diverted legs, not raw trip distance
× reads 0 when nothing is flown yet, however far the trip has flown
× reads 100 only when every planned leg is flown or diverted
× rounds to one decimal place
```

The 5 that pass both before and after are the deliberately-unchanged-contract cases
(key absent with no planned legs / degenerate 0 nm total / empty trip, and the
pre-existing K/C/S prefixes still resolving).

## Amendment note

Appended 6 lines at the end of the `### T-020` section of
`.claude/runs/2026-09-04-lnmpln-trip-planner/reviews/phase5.md`, immediately before
`### T-021`. Append-only confirmed: `git diff --numstat` reports `6  0` (six insertions,
zero deletions) and `git diff -U0 | grep -c "^-[^-]"` is `0`.

## Test conventions followed

`tests/journey.test.ts` mocks nothing — `src/journey.ts` imports only types, so there is
no `./db` or `./airports` seam to mock and no clock to fake. Planned-leg fixtures come
from `makePlannedLegWithChildren()` in `tests/helpers/index.ts` with only `id`, `seq`,
`status` and `approx_distance_nm` overridden at the call site; `tests/helpers/index.ts`
was not edited. The `Flight & { points }` factory is local to the test file, matching
`tests/kmlExport.test.ts`'s local `flight()` — no shared flight factory exists in helpers.
