# Review — Phase 1 (T-001, T-002) — run 2026-09-09-vitest-unit-tests

## Verdict: approve

All acceptance criteria for T-003 re-verified independently (commands re-run
by me, not taken from either report). No blocking findings. One scope
deviation (tests/setup.ts) accepted per explicit instruction in this task's
envelope; one design-text inaccuracy confirmed and recorded as a follow-up
only.

## Criteria verified

1. **`npm test`, `npx tsc`, `npm run build`, `require('better-sqlite3')` — all exit 0.**
   - `npm test` (under Node 20.20.2): `Test Files 2 passed (2)`, `Tests 24 passed (24)`, exit 0.
   - `npx tsc` exit 0. `npx tsc -p tsconfig.test.json` exit 0.
   - `npm run build`: client (`vite build` ✓) + server (`tsc` ✓), exit 0.
   - `node -e "require('better-sqlite3')"` → `OK`, exit 0. `npm ls better-sqlite3` → `better-sqlite3@9.6.0` (matches pre-existing `^9.4.3` install, not a new version).
   - `ls dist/*.test.js dist/**/*.test.js` → no match (expected — proves no test file compiled into `dist/`).

2. **Docker server-stage simulation re-run.** Copied exactly `package.json`, `package-lock.json`, `tsconfig.json`, `src/` into a scratch dir (`/tmp/.../docker-sim-*`), ran `npm ci` (320 packages, 22s) then `npm run build:server` → exit 0. `find dist -name '*.test.js'` → nothing. `node -e "require('better-sqlite3')"` in the scratch install → `OK scratch`. `md5sum node_modules/better-sqlite3/build/Release/better_sqlite3.node` → `99e7d4e42e6c8284f929c1c9d0bfbe3b`, matching the value T-001 reported. Scratch dir removed afterward.

3. **Helpers module defaults vs design §4, field by field.** Read `tests/helpers/index.ts` in full against `.claude/tools/ctx.sh design ... 4` tables:
   - `makeFrame` (§4.2): all 10 fields match (`lat 34.426201`, `lon -119.841507`, `altitudeFt 1500`, `airspeedKnots 110`, `groundSpeedKnots 105`, `headingDeg 270`, `verticalSpeedFpm 500`, `onGround false`, `simRunning 1`, `aircraft 'Cessna 172'`).
   - `makeCandidate` (§4.3): all 10 fields match, including `status: 'planned'`, `linkedFlightId: null`.
   - `makeHandCloseFlight` / `makeHandCloseLeg` (§4.4): all fields match (`id 900`/`500`, `end_time`, `planned_leg_id 500`, `planned_leg_link_source 'manual'`, arrival/destination coords).
   - `makePlannedLegWithChildren` (§4.5): all ~40 fields checked; the named-default subset matches the table exactly (id, trip_id, seq, status, departure_*, destination_*, is_snippet, cruise_alt_ft, flightplan_type, aircraft_type, waypoint_count, alternate_count, approx_distance_nm, arrival_deviation_nm, source_*, imported_at, plan_created_at, linked_flight_id, alternates); every field the design says defaults to `null` (departure_start*, departure_pos_*, sid_*, star_*, approach_*, remarks) is `null` in the code. `waypoints` two-element array matches the frozen literal exactly (KSBA seq 1, KMRY seq 2).
   - Geometry (§4.6): `NM_PER_DEG = Math.PI*3440.065/180`, `DEG_PER_NM = 1/NM_PER_DEG`, `northOfNm` formula — all match.
   - Named positions (§4.7): all six airports match coordinates exactly.
   - **No divergence found.** `npx tsc -p tsconfig.test.json` (exit 0, above) also confirms every builder's return type is structurally assignable to its real type.

4. **`git status --porcelain` scope + flights.db md5.**
   - `git status --porcelain` → `M package.json`, `M package-lock.json`, `?? tests/`, `?? tsconfig.test.json`, `?? vitest.config.ts` (plus unrelated pre-existing untracked run dirs from other sessions). Every changed/added path is inside T-001's or T-002's `allowed_paths` **except `tests/setup.ts`** — see Finding below (accepted, non-blocking per explicit instruction).
   - `md5sum flights.db` before my checks and after: **`7a6651ecfa30fab34ce52340b7f7f5cb`**, identical. File size (4812800 bytes) and mtime (Sep 9 02:11) unchanged by my session; `flights.db-wal`/`-shm` mtimes (02:35) predate my work and reflect the live server's own WAL activity, not anything this run touched.
   - `tsconfig.json`: `git diff tsconfig.json` empty, not in `git status --porcelain` → confirmed byte-unchanged.

5. **No file references flights.db / a network host / writes outside tmp.**
   - `grep -rn "http:\|https:\|fetch(\|initAirports(" tests/` → one hit, `tests/helpers.test.ts:242: airportsMock.initAirports()` — this calls the **mock** stub (`airportsMock.initAirports: vi.fn()`), not `src/airports.ts`'s real network-fetching `initAirports`. No real network call.
   - `grep -rn "better-sqlite3\|flights\.db" tests/` → no hits.
   - `grep -rn "writeFile\|fs\.\|mkdtemp" tests/` → no hits (no filesystem writes anywhere in this phase).
   - `grep -rn "process\.env" tests/` → no hits.

## Findings

### Finding 1 (non-blocking, accepted) — `tests/setup.ts` outside both tasks' allowed_paths
`tests/setup.ts` was created by T-001 but is not listed in T-001's `allowed_paths` (`tests/smoke.test.ts` / `src/smoke.test.ts` only) or T-002's (`tests/helpers/**`, `tests/helpers.test.ts`, plus the unused `src/test-helpers*` spellings). Content matches design §3.3 verbatim (verified: `Read tests/setup.ts` byte-for-byte equals the frozen listing — `beforeEach` spying on `console.log`/`warn`/`error`). `vitest.config.ts`'s `setupFiles: ['./tests/setup.ts']` (also frozen, §3.1) makes the file's existence a hard startup requirement — without it `npm test` fails before collecting any test file. No task in `plan.json` phase 1 or later owns this filename explicitly.

**My call: accept as in-scope.** The alternative — a config that references a nonexistent file — breaks the acceptance criterion "`npm test` … exits 0" for both T-001 and T-002, and the file's content is not a judgment call, it's a direct transcription of the frozen design text. This is a plan gap (no task's `allowed_paths` names `tests/setup.ts`), not a scope violation by either implementer. Recommend the Orchestrator amend `plan.json` to add `tests/setup.ts` to T-001's `allowed_paths` retroactively so future diffs don't need this same judgment call.

## Design-text inaccuracy (not a code defect — risk, not blocking)

**Confirmed independently:** design §6.4's stated premise — that `restoreMocks: true` "strips `vi.fn()` implementations" — is wrong for vitest 4.1.11. Read `node_modules/@vitest/spy/dist/index.js` myself:
- `restoreAllMocks()` (line 467) iterates only the `MOCK_RESTORE` set (line 4, 467-471).
- `spyOn()` (line 190) passes `restore` into `createMockInstance(...)`, which is what populates `MOCK_RESTORE` (line 11-13).
- `fn()` (line 179) — what `vi.fn()` calls — passes no `restore` option, only `mockImplementation`/`resetToMockImplementation` (lines 179-188), so plain `vi.fn()` objects (`dbMock.*`, `airportsMock.*`) are never added to `MOCK_RESTORE` and `vi.restoreAllMocks()` is a no-op on them.
- `tests/helpers.test.ts:210-220` independently probes this at runtime (`dbMock.getTripName.mockImplementation(...)`, then `vi.restoreAllMocks()`, then asserts the override survives) and passed in my `npm test` run above.

T-002's fix — `resetMocks()` explicitly calling `.mockReset().mockImplementation(default)` on every stub, called by the consuming test file's own `beforeEach` — is correct and sufficient regardless of `restoreMocks`'s actual behavior; the suite's determinism (design §10.5) does not depend on the wrong premise being true. **This is a documentation defect in design.md §6.4's stated reasoning, not a code defect.** Recommend the Orchestrator amend §6.4's text to state that `restoreMocks: true` restores `vi.spyOn()` spies only, and that `resetMocks()` is what actually guarantees clean `vi.fn()` state between tests — not blocking this review.

## Follow-ups (non-blocking)

- Amend `plan.json` T-001's `allowed_paths` to explicitly list `tests/setup.ts` (Finding 1).
- Amend `design.md` §6.4's prose to describe the correct mechanism (`vi.fn()` is never added to vitest's spy-restore set; `resetMocks()` is the only thing that resets it) rather than the current "restoreMocks strips vi.fn() implementations" claim.

## Environment integrity

- `flights.db` md5 unchanged: `7a6651ecfa30fab34ce52340b7f7f5cb` (before my review session and after).
- No server on port 3000 stopped, restarted or touched; all commands ran read-only against the live tree plus one disposable scratch dir (`/tmp/claude-1000/.../docker-sim-*`), removed after use.
- `git status --porcelain` at end of review: unchanged from start (no files added/removed by my checks).
