# Phase 2 review — seed script and test-tooling scaffolding (T-003, T-004)

# Round 2 — 2026-09-17

**Verdict: approve.** T-003 was approved in round 1 and is unchanged. T-004's
four blocking findings (B1–B4) are all fixed, each re-verified here by running
the thing myself rather than reading the fix. Phase 2 ships: a scratch server can
be built, seeded and started on its own port, a Vitest/RTL component test runs,
and a Playwright spec logs in for real against that server and passes.

Criteria re-verified independently in this round: 6 of 6 the Orchestrator named,
plus T-004's own four acceptance criteria (all now met) and the must-not-change
list. Nothing taken from the implementer's report.

**B1 fixed.** `client/playwright.config.ts` exists and is §2.2's frozen content
verbatim — `testDir: './e2e/specs'` (:7), `globalSetup:
'./e2e/support/global-setup.ts'` (:8), `['html', { open: 'never' }]` (:15),
`junit → 'test-results/junit.xml'` (:16), `storageState:
'./e2e/.auth/operator.json'` (:20), `command: './e2e/scratch-server.sh'` (:26),
no `outputDir` override. `client/e2e/playwright.config.ts` is gone (`ls` → No
such file). The concrete failure mode from round 1 is gone with it:

```
$ cd client && npx playwright test --list
Listing tests:
  [chromium] › smoke.spec.ts:9:1 › a logged-in visitor lands on the flight log, not the login form
Total: 1 test in 1 file
```

One `.spec.ts`, no Vitest cross-collection error. `client/package.json` now
carries §1.5's five scripts exactly, with `"test:e2e": "playwright test"` — the
`--config` flag is gone.

**B2 fixed.** `client/e2e/scratch-server.sh` exists, mode `-rwxr-xr-x`, and
`scratch-server.sh:6` resolves `REPO_ROOT` with two `../` hops
(`dirname "${BASH_SOURCE[0]}"/../..`) with the comment updated to match. All five
guards, the `--cached --others --exclude-standard` copy, the symlinks and the
`exec` are unchanged from the version I read in round 1.

Full pipeline re-run against my own scratch root, port 3210:

```
$ MSFSLOGGER_E2E_SCRATCH=…/r2-scratch npm run test:e2e
[WebServer] {"db":"…/r2-scratch/e2e.db","tripId":1,"flightIds":[1,2],"plannedLegIds":[1,2]}
[WebServer] No TLS configured — serving plaintext HTTP on loopback only.
[WebServer] [HTTP] Server running at http://127.0.0.1:3210
[WebServer] [Auth] Login OK for "e2e" from 127.0.0.1
  ✓  1 [chromium] › e2e/specs/smoke.spec.ts:9:1 › a logged-in visitor lands on the flight log … (907ms)
  1 passed (15.7s)
```

The report artifacts now land at the frozen default locations —
`client/playwright-report/index.html` and `client/test-results/junit.xml` — with
no `../` escape, both gitignored.

**B3 fixed.** `client/src/pages/Login.test.tsx` exists beside `Login.tsx` and
imports `./Login` (:5); `client/src/test/smoke.test.tsx` is gone. `client/src/test/`
now holds `setup.ts` only, which is what §1.1 says it is for (and leaves T-008's
granted paths free). Vitest collects it at the new path:

```
$ cd client && npm test
 ✓ src/pages/Login.test.tsx (1 test) 243ms
 Test Files  1 passed (1) / Tests  1 passed (1)
```

**B4 fixed.** `client/tsconfig.test.json` is §1.4 verbatim and the script exists:

```
$ cd client && npm run test:types
> tsc -p tsconfig.test.json
exit=0
```

Exit 0, no output — so the config, both e2e support files, the spec, the setup
file and the colocated component test are all typechecked now, and §5.1's CI step
will pass when T-010 appends it.

**Safety, re-checked after this round's runs.** Live `flights.db` md5
`d7b2a00eb72f9354dce759c3ccac9a3f`, `max(id)=89`, `count=56`, no `e2e_seed` row,
`auth_user` still `operator` — identical to my round-1 baseline. Live
`client/dist/index.html` md5 `2bc39f5beda19389908e20ffbf12415c`, mtime
`2026-09-17 12:32:35` — identical. Root `npm test` → `850 passed`.
`client/vite.config.ts`, `.github/`, `Dockerfile` untouched (root
`vitest.config.ts` still carries only the comment-only A7 edit cleared in round
1). No run citations in any new or edited file (grep for `.claude/runs`,
`design.md`, `plan.json`, `T-NNN`, `§`, `phase N`, `Amendment` → none). My
scratch tree removed; port 3210 free; the user's port-3000 server never touched.

**Carried forward, non-blocking** (unchanged from round 1, neither is T-004's to
fix): root `package.json` still lacks §1.5's `test:client` / `test:e2e`, which no
phase-2 grant owned; and T-003's AC2 wording about a "relative `flights.db`"
describes a path-shape rule §3.2 does not contain — the content guard covers the
case that matters, proven in round 1 against a copy of the real logbook. Design
§2.3 could also record A7's ordering question as answered (round 1 observed
`webServer` starting before `globalSetup`), though the readiness poll makes it
moot.

---

# Round 1 — 2026-09-17

**Verdict: request_changes.** The pipeline genuinely works end to end — I built,
seeded and served a scratch server and both smoke tests passed on my own run —
but four frozen-design deliverables are missing or misplaced, one of them with a
demonstrated failure (bare `npx playwright test` collects the *Vitest* suite),
and one of them (`tsconfig.test.json`) means nothing typechecks any of the five
new TS files and the CI step §5.1 freezes would fail.

Per-task: **T-003 approve** (4/4 criteria verified independently).
**T-004 request_changes** (2/4 verified; AC1 and AC2 pass, AC3 passes, AC4 not
met in substance — see B4).

Criteria verified independently: 8 of 8 across both tasks (I re-ran every one;
two of T-004's fail). Nothing below is taken from either implementer's report.

## Evidence I re-derived

Everything under Node 20.20.2 (`nvm use 20`), scratch root
`…/scratchpad/e2e-scratch`, port 3210, live server left alone.

```
$ cd client && npm test
 ✓ src/test/smoke.test.tsx (1 test) 238ms
 Test Files  1 passed (1) / Tests  1 passed (1)

$ MSFSLOGGER_E2E_SCRATCH=…/e2e-scratch npm run test:e2e
[WebServer] dist/assets/index-BI1xHYYp.css  … dist/assets/index-BV756Q20.js
[WebServer] {"db":"…/e2e-scratch/e2e.db","tripId":1,"flightIds":[1,2],"plannedLegIds":[1,2]}
[WebServer] No TLS configured — serving plaintext HTTP on loopback only.
[WebServer] [HTTP] Server running at http://127.0.0.1:3210
[WebServer] [Auth] Login OK for "e2e" from 127.0.0.1
  ✓  1 [chromium] › e2e/specs/smoke.spec.ts:9:1 › a logged-in visitor lands on the flight log … (1.4s)
  1 passed (14.8s)
```

Seed guards (`node $SCRATCH/dist/testSeed.js`, compiled by the scratch build):

| case | result |
| --- | --- |
| fresh absent path | exit 0, JSON line per §3.6 |
| second run, same file | exit 0, ids 1/1,2/1,2 again — rows byte-compared `IDENTICAL` for flights, trips, planned_legs, planned_waypoints, flight_points against the independent e2e.db |
| `FLIGHTS_DB_PATH` unset / empty | exit 1, `testSeed: FLIGHTS_DB_PATH is not set — refusing to guess a database path.` |
| relative `flights.db` in a cwd holding a **copy of the live logbook** | exit 1, `refusing to seed flights.db — it already holds data (flights=56, trips=1, planned_legs=23, ground_sessions=6, acars_messages=8, auth_user=1) and carries no e2e marker.`; copy's md5 `d7b2a00e…` unchanged after the refusal |
| `--help` / `--db /x` | exit 0 usage / exit 1 `Unrecognised argument "--db".` |

Fixture rows queried out of the seeded DB match §3.4 exactly: `auth_user` `e2e`;
trip 1 `E2E Baltic Hop` `created_at 2026-02-20T09:00:00.000Z` `is_active 0`;
flights 1/2 with the exact aircraft, ICAOs, times, 4320/3900 s, 152.4/96.1 nm,
36000/8500 ft, 451/122 kts, point_count 3/2, trip_id 1/null; 3+2 `flight_points`
in-window with 2 on-ground each; planned legs 1 (trip 1) and 2 (loose), both
`seq 1`, `status planned`, 34000/32000 ft, 212.0/210.0 nm, pinned `imported_at`,
64-char `e2e…0001`/`0002`, all procedure fields null; 0 alternates, 0
ground_sessions, 0 acars_messages; `app_setting e2e_seed = 1`.

**Must-not-change list, item by item.** 1 ✓ `client/dist/index.html` md5
`2bc39f5beda19389908e20ffbf12415c` and mtime `12:32:35` identical before and
after all of the above (the emitted scratch bundle hashes `index-BI1xHYYp.css` /
`index-BV756Q20.js` also match item 6). 2 ✓ live `flights.db` md5
`d7b2a00eb72f9354dce759c3ccac9a3f` unchanged, `max(id)=89`, `count=56`, no
`e2e_seed` row, `auth_user` still `operator`. 3/4 ✓ root `npm test` → `38
passed / 850 passed`; root `vitest.config.ts` diff is comment-only (`git diff |
grep -v '^[+-]\s*//'` → empty). 5 ✓ `client/vite.config.ts` unmodified. 7 ✓ no
`data-testid` anywhere in `client/src`; `client/src/pages/Home.tsx` and
`index.css` are modified but mtime 2026-09-16, pre-dating this run. 9 ✓ marker is
an `app_setting` row. 10/11 ✓ `.github/` and `Dockerfile` untouched. 12 ✓ no
pattern-kill anywhere; port 3210 free after the run, 3000 still the user's.

Amendment A7's open question, answered: `[WebServer]` build/seed/listen output
and `[Auth] Login OK` all precede `Running 1 test`, so `webServer` did start
before `globalSetup` here — but the readiness poll makes the ordering moot, which
is the right place to leave it.

## Blocking findings (all fixed in round 2)

**B1 — `client/e2e/playwright.config.ts` is not at the frozen path, and the
consequence is real, not paper.** §1.1 and §2.2 freeze
`client/playwright.config.ts`. Because nothing is there, Playwright falls back to
its defaults (testDir = cwd, default `testMatch` covering `*.test.tsx`) and
collects the **Vitest** suite:

```
$ cd client && npx playwright test --list
Error: Vitest failed to access its internal state.
- "vitest" is imported directly without running "vitest" command
```

That is precisely the cross-collection §1.1 says can never happen. It also
forces `--config e2e/playwright.config.ts` onto `client/package.json:11-12`,
against §1.5's frozen `"test:e2e": "playwright test"`, and forces four derived
divergences from the §2.2 freeze: `testDir: './specs'` (config:8),
`globalSetup: './support/global-setup.ts'` (:9), `outputFolder:
'../playwright-report'` / `outputFile: '../test-results/junit.xml'` /
`outputDir: '../test-results'` (:16,17,25). **Move to
`client/playwright.config.ts` and restore the §2.2 values.** `paths.ts` needs no
change; `use.storageState` may stay the absolute `STORAGE_STATE` (equivalent to
the frozen relative literal, and better).

**B2 — `client/e2e/support/scratch-server.sh` is not at the frozen path.**
§1.1/§4 freeze `client/e2e/scratch-server.sh`; §2.2 freezes `command:
'./e2e/scratch-server.sh'`. The script is correct as written (guards 1–5 all
present and correctly implemented, `exec`, `--cached --others
--exclude-standard`, three `../` hops at `scratch-server.sh:6`). **Move it up one
level and change line 6 to two hops**; `REPO_ROOT` is the only line affected.

**B3 — `client/src/test/smoke.test.tsx` is not colocated.** §1.1: component
tests live beside the component, and `client/src/test/` is declared support-only
("never imported by app code"), not a home for specs. The file tests `Login`
(`smoke.test.tsx:5`), so its frozen home is `client/src/pages/Login.test.tsx` —
which is also the exact path T-008 has now been granted, so leaving it here
guarantees a collision or a duplicate. **Rename it to
`client/src/pages/Login.test.tsx`** (imports become `./Login`,
`../hooks/useSession`, `../utils/format`) and let T-008 extend it. Nothing else
about the file violates §1: suffix is `.test.tsx`, no import from backend `src/`
(grep: none), no app-code import of test code, `getByLabelText`/`getByRole`
locators per §1.8 rule 3, no `data-testid`, no wall-clock assertion, no run
citation in any comment.

**On the adjudication the Orchestrator asked for:** B1–B3 must be moved, not
ratified by amendment. The mismatch came from a stale `allowed_paths`, not from
anything learned while implementing — the frozen tree is still the better tree
(B1 proves it defends a property the design explicitly claims), the Orchestrator
has already corrected T-008's grant *towards* the design rather than the reverse,
and the whole fix is three `git mv`s plus six line edits. Amending §1.1 to record
an accident would leave T-006/T-007/T-010 reading a path convention chosen by a
typo. No design amendment is needed if the files move; if a later round decides
otherwise, §1.1, §2.2 and §4's opening line all have to be amended together.

**B4 — `client/tsconfig.test.json` and the `test:types` script were never
created (§1.4, §1.5).** Consequence: nothing typechecks
`vitest.config.ts`, `src/test/setup.ts`, the smoke test, `e2e/support/paths.ts`,
`e2e/support/global-setup.ts`, `playwright.config.ts` or `specs/smoke.spec.ts` —
`client/tsconfig.json`'s new `exclude` removes the first three from the build and
`include: ["src"]` never covered `e2e/`. T-004's AC4 ("typecheck passes with the
new config/test files included") is therefore not met in substance.

```
$ cd client && npm run test:types
npm error Missing script: "test:types"
```

CI as frozen in §5.1 appends exactly this command, so T-010 would land a red
step. I wrote the §1.4 file verbatim **into the scratch copy** and ran it:
`npx tsc -p tsconfig.test.json` → exit 0, no output. So this is purely
undelivered, with no type errors hiding behind it — a two-file fix.
(`@types/node` is already installed in `client/node_modules`.)

## Non-blocking follow-ups

1. **Root `package.json` never got §1.5's `test:client` / `test:e2e`.** Neither
   task owned it (T-003's grant included it, but §3.1 says no root script wraps
   the seed). Route it to a later task; `npm run test:e2e` from the repo root
   does not exist today.
2. **T-003's AC2 wording vs. §3.2.** "pointed at a relative `flights.db` refuses"
   is not a rule the design contains — there is no path-shape check, and a
   relative path in an empty scratch cwd seeds happily (verified: exit 0, file
   created). The content guard covers the case that matters, proven above
   against a copy of the real logbook. The implementation follows the design;
   the criterion's wording is what was loose. No change requested.
3. `client/e2e/.auth/operator.json` and `client/playwright-report/` /
   `client/test-results/` are present in the working tree from runs; all three
   are correctly gitignored (`git check-ignore -v` confirms each).

## Housekeeping

Scratch tree, seeded DBs and the logbook copy I made were all removed
(`e2e-scratch`, `seedtest`, `livecopy`, `relcwd`). No server of mine is left
running; port 3210 is free and the user's port-3000 process was never touched.
