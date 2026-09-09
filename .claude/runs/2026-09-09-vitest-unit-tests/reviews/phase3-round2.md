# Review — phase 3 round 2 (T-008 fix, flight manager suite) — **approve**

Reviewer: T-009, round 2. Verdict covers **the whole of phase 3 in its current
state**, not just the delta since round 1, since this gates phase 4 (Ship).

**Verdict: `approve`.** Round-1's single blocking finding (F-1,
`ARRIVAL_RADIUS_NM`'s value unpinned) is **closed**, verified by re-running the
mutation myself. No new findings. The one accepted gap (MUTATION 6, the exact
tie) is unchanged and still accepted, for the reasons recorded in round 1.

All evidence below was produced by re-running commands. The implementer's report
was not read beyond its `risks` list. Mutations were applied to a fresh `cp -r`
copy in the session scratchpad (`node_modules` and `samples` symlinked, source
never edited in place); the copy was re-diffed against the repo between rounds
and deleted at the end.

## Baseline (repo, Node 20.20.2)

| Check | Result |
|---|---|
| `npm test` | `Test Files 10 passed (10) / Tests 202 passed (202)`, exit 0 |
| suite duration | `Duration 875ms` |
| `npx tsc --noEmit` | exit 0, no output |
| `npx tsc -p tsconfig.test.json --noEmit` | exit 0, no output |
| `npm run build` | exit 0 |

202 tests vs. round 1's 200 — exactly the two added; `flightManager.test.ts`
goes 20 → 22. No test was removed or weakened (`.state`/`.duration` mtimes
unchanged at 13:28/13:35; only `flightManager.test.ts` is newer, 13:46).

## 1. The two new tests exist and assert what was claimed

Read directly at `tests/flightManager.test.ts:315-347`. Both build the position
with `northOfNm(KMRY, …)`, **measure** it with `haversineNm` into `measuredNm`,
and assert on the measured value — nothing hardcoded, per design §4.6/§10.5:

- `:315` "~9.9 nm still records 'flown'" — `toBeCloseTo(9.9, 1)`,
  `toBeLessThan(ARRIVAL_RADIUS_NM)`, then
  `recordPlannedLegArrival(11, 'flown', Math.round(measuredNm*10)/10)`.
- `:332` "~10.1 nm records 'diverted'" — `toBeCloseTo(10.1, 1)`,
  `toBeGreaterThan(ARRIVAL_RADIUS_NM)`, then the same call with `'diverted'`.

Together they pin `9.9 < ARRIVAL_RADIUS_NM < 10.1`, which is the ±0.1 nm F-1
asked for. `:309-313` carries a comment stating exactly why they exist. Conforms
to §10.5's "`toBeCloseTo` / an inclusive window" allowance; no source seam added.

## 2. Mutation-kill proof, reproduced independently

Scratch copy, full suite (`npx vitest run`) per mutant, unmutated baseline first.

```
ARRIVAL_RADIUS_NM = 10 (baseline) -> Test Files 10 passed (10) / Tests 202 passed (202)

ARRIVAL_RADIUS_NM = 5  -> Tests 1 failed | 201 passed (202)
  FAIL tests/flightManager.test.ts > FlightManager — arrival on the planned leg
       > landing just inside ARRIVAL_RADIUS_NM (~9.9 nm) still records 'flown'
  AssertionError: expected 9.900000000000114 to be less than 5

ARRIVAL_RADIUS_NM = 20 -> Tests 1 failed | 201 passed (202)
  FAIL tests/flightManager.test.ts > FlightManager — arrival on the planned leg
       > landing just outside ARRIVAL_RADIUS_NM (~10.1 nm) records 'diverted'
  AssertionError: expected 10.099999999999918 to be greater than 20
```

Killed in **both** directions, one test each, exactly the intended one. Compare
round 1, where both values left the full suite green at 200/200.

**Extra rigor — the kill is behavioural, not just a guard.** The failures above
fire on the guard assertion, because vitest stops at the first failing `expect`.
A guard-only kill would be weak evidence. I stripped *only* the two guard lines
in the scratch copy and re-ran both mutants:

```
guards stripped, ARRIVAL_RADIUS_NM = 5  -> Tests 1 failed | 21 passed (22)
  AssertionError: expected "vi.fn()" to be called with arguments: [ 11, 'flown', 9.9 ]
guards stripped, ARRIVAL_RADIUS_NM = 20 -> Tests 1 failed | 21 passed (22)
  AssertionError: expected "vi.fn()" to be called with arguments: [ 11, 'diverted', 10.1 ]
```

The user-visible outcome (the flown/diverted label written to the planned leg)
is independently sensitive to the constant. F-1 is closed on the merits.

*Method note:* my first scratch copy omitted `samples/`, which made 28
`lnmpln.test.ts` tests fail identically under both mutants. That was my setup
error, not a regression — proven by re-baselining with `samples` symlinked
(202/202 green) before recording any result above.

## 3. Phase-3 regression spot-check (whole-phase approval)

Round 2 only added tests, so round 1's 7 kills cannot have weakened — but since
this gates Ship I re-verified the two that matter most, on a freshly re-synced
scratch copy (`RE-SYNCED CLEAN`, `diff -r` against repo empty):

| Mutation | Result |
|---|---|
| `AIRBORNE_DEBOUNCE_FRAMES` 3→2 (`flightManager.ts:16`) | **killed**, `Tests 3 failed \| 199 passed` |
| drop `!this.interrupted &&` at `:493` | **killed**, `Tests 3 failed \| 199 passed`, incl. `worked flight (b): a 35 s pause leaves duration_sec = 15 on a 50 s flight` |

Round 1's other five kills stand as recorded. MUTATION 6 (`<=`→`<`) remains a
documented, accepted gap; F-2 (the second `onCrash` survivor) remains equivalent.

## 4. Scope, conformance and safety

- `git diff --stat src/flightManager.ts` — **empty**. `git diff --stat
  src/legMatcher.ts` — **empty**. Task was test-only, as required; the design §7
  ban on editing `flightManager.ts` held.
- `git diff --stat -- src/` shows only `src/airports.ts` (10+/6-), the phase 1/2
  export seam already approved in T-007. Nothing else under `src/`.
- `git status --porcelain` is byte-identical to the pre-review snapshot: the only
  entries are `package.json`, `package-lock.json`, `src/airports.ts`, `tests/`,
  `tsconfig.test.json`, `vitest.config.ts` and the run directories. Everything
  round 2 touched is inside T-008's `allowed_paths`
  (`tests/flightManager*.test.ts`).
- §10.3 — no test wrote into the repo; status unchanged after `npm test`.
- **`md5sum flights.db` before `7a6651ecfa30fab34ce52340b7f7f5cb`, after
  `7a6651ecfa30fab34ce52340b7f7f5cb`** — unchanged.
- The user's server on port 3000 was never stopped, restarted or reconfigured.
  Still serving after the review: `curl -s -o /dev/null -w '%{http_code}'
  http://localhost:3000/api/flights?limit=1` → `200`.
- `npm run build` was run once on the unmutated tree and exited 0; `dist/` is
  left shippable. My scratch directory has been deleted.

## Follow-ups (non-blocking, carried forward)

1. Round 1's follow-up stands and is now more valuable: add a comment at
   `src/legMatcher.ts:111` pointing at `tests/flightManager.test.ts:315,332`, so
   anyone tuning `ARRIVAL_RADIUS_NM` knows two tests pin it to ±0.1 nm.
2. A per-call arrival-radius override (mirroring `radiusNm` for departure) is
   still the only way to close the MUTATION 6 exact-tie gap. Source change, out
   of scope for this run.
3. `.claude/ENVIRONMENT.md:73-79` still says "This project has no test runner and
   does not want one." That is now false. Phase 4 (T-010) should update it
   alongside the README, or the next agent will read stale standing facts.
4. Stale scratch dirs from earlier phase-3 rounds remain in the shared session
   scratchpad (`mut/`, `proto/`, `probe.test.ts`). Outside the repo and harmless;
   noted only so they are not mistaken for run artifacts.
