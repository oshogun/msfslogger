# Phase 4 review — ship readiness (T-011)

## Verdict: APPROVE

All six acceptance criteria verified independently by re-running the commands
myself (not by reading T-010's report body — only its `risks` list, which the
Orchestrator had already summarized in my envelope and which I cross-checked
against my own `npm audit` output below).

## Criteria, verified

**1. Re-ran the five checks; all pass.**

- `timeout 180 npm test` (Node 20.20.2): exit 0, real time 1.4s.
  ```
  Test Files  10 passed (10)
       Tests  202 passed (202)
  ```
- `npx tsc --noEmit`: exit 0, no output.
- `npm run test:types` (`tsc -p tsconfig.test.json`): exit 0, no output.
- `npm run build`: exit 0. Client (`vite build`) + `build:server` (`tsc`) both
  succeeded. `find dist -iname '*test*'` → empty.
- Docker server-stage simulation, scratch dir with exactly `package.json`,
  `package-lock.json`, `tsconfig.json`, `src/` copied in (the Dockerfile's own
  file list): `npm ci` → 320 packages, `npm run build:server` → exit 0,
  `find dist -iname '*test*'` → empty.
- `npm ci --omit=dev` in a separate scratch dir: 235 packages installed. No
  `vitest` binary in `node_modules/.bin`. An empty `node_modules/@vitest/`
  directory is present (npm creates the scope folder before pruning its
  contents under `--omit=dev`) — confirmed empty, no package.json inside, no
  bin — benign, not a finding.

**2. `git diff --stat` shows exactly one non-test `src/` file.**

```
git diff HEAD --name-only -- src/
src/airports.ts
```
Diff matches design §7.3 exactly: `Airport` interface exported (no field
change), `parseCSVLine` and `parseCSV` exported (bodies unchanged), new
`setAirports()` (4 lines) placed above `initAirports()`, and all three bare
`airports = …` assignments inside `initAirports()` replaced with
`setAirports(…)` calls. No new parameter, no DI, no `AIRPORTS_PATH` override,
no export of the array itself — all correctly absent, per §7.3's "nothing
else" list.

**3. README's new paragraph — every command actually run.**

`npm test`, `npm run test:watch`, `npm run test:types` all ran (above) and
match the paragraph's claims. Text checked against actual behaviour:
"runs the whole suite once, non-interactively" (true, 202/202, exit 0);
"typechecks tests/" (true — `tsconfig.test.json` includes `tests/**/*`,
`npx tsc`/`build` do not, since `tsconfig.json`'s include is `src/**/*` only,
unchanged).

**4. `npm test` non-interactive; `test:watch` is a separate script.**

`package.json`: `"test": "vitest run"`, `"test:watch": "vitest"` — two
distinct scripts. `npm test` under `timeout 180` exited 0 on its own (not
124). Ran `timeout 8 npm run test:watch < /dev/null`: exited 0 with the full
202-test summary printed and no lingering process (`ps aux | grep vitest`
empty afterward) — vitest detects the non-TTY stdin and runs once rather than
staying resident, which is expected vitest behaviour, not a project-added
workaround. The criterion — that watch mode is not conflated with `npm test`
— holds regardless of how vitest itself behaves under a piped stdin.

**5. No `flights.db`, no network, no writes outside tmp; md5 unchanged.**

- `grep -rn "flights.db" tests/` → no match.
- `grep -rn "http://\|https://\|fetch(\|axios" tests/` → no match.
- `tests/helpers/index.ts` mocks `../src/db` entirely (`vi.mock('../src/db', …)`
  with a full `dbMock` of all ten functions `flightManager.ts` imports) — no
  real sqlite ever opens.
- The only `fs.readFileSync` calls in `tests/` are in `lnmpln.test.ts`,
  reading committed fixtures under `samples/lnmpln/` by explicit filename —
  no globbing, no write, no cwd-dependent path (resolved via `__dirname`).
  `flightPlans.test.ts` tests `flightPlanPath()`, a pure path-join function —
  the file does not import `fs` at all (confirmed by reading it).
- `md5sum flights.db` before this review and after: both
  `7a6651ecfa30fab34ce52340b7f7f5cb`. Live server (`curl localhost:3000/`)
  still answers `200` at the end. No scratch server was started against a
  port other than 3000 was needed for this review — all checks were static,
  build, or scratch npm-install work; nothing started an HTTP listener.

**6. CLAUDE.md / ENVIRONMENT.md now false — flagged, not fixed.**

Confirmed: `CLAUDE.md:104` reads "There is no test framework and the project
does not want one," and `.claude/ENVIRONMENT.md`'s "Verification without a
test framework" section (lines 73–79) makes the same claim and omits `npm
test`/vitest entirely. Both are now inaccurate given this run shipped Vitest.
Both files are outside every task's `allowed_paths` in this run by design —
this is **the Orchestrator's job to fix post-run**, not mine or any
dispatcher's. Not treated as a blocking finding; flagged in `risks` below.

## Full-tree diff scan (not just T-010's slice)

`git status --porcelain` / `git diff --stat HEAD` against the whole working
tree matches the expected file set exactly:
`README.md`, `package.json`, `package-lock.json`, `src/airports.ts` (modified)
+ `tests/*` (10 test files + `helpers/index.ts` + `setup.ts`),
`tsconfig.test.json`, `vitest.config.ts` (untracked, new). No stray file, no
source change outside `src/airports.ts`, no leftover scratch artifact
(`coverage/`, `.vitest/`) in the tree. `package-lock.json`'s diff is pure
lockfile reshuffling from the new `vitest` devDependency tree (a few
transitive packages like `finalhandler`/`file-uri-to-path` move position in
the file — normal npm lockfile behaviour, not a manual edit) — `npm ci`
against it succeeded twice in this review (once for the server-build
simulation, once for the production `--omit=dev` simulation), so the lockfile
is valid.

Two untracked run directories (`2026-09-07-gpx-import`,
`2026-09-08-docker-pdf-export`) are pre-existing artifacts from earlier,
unrelated runs — not part of this diff, not this review's concern.

## Housekeeping notes (confirmed, not re-flagged)

1. `plan.json`'s `amendments` array confirms `tests/setup.ts` was retroactively
   added to T-001's `allowed_paths`, reviewed and accepted by T-003. Matches
   the file's actual origin (`vitest.config.ts`'s `setupFiles` needs it to
   exist).
2. design.md §6.4's `restoreMocks` correction (2026-09-09) not independently
   re-derived — out of this task's scope, noted as expected per envelope.

## Findings

None blocking. None non-blocking beyond the risks below.

## Scratch cleanup

Both scratch directories used for the Docker-stage and `--omit=dev`
simulations were removed at the end of this review; no server was started, so
none needed stopping. `git status --porcelain` at review end matches the state
at review start (no files touched by the reviewer).
