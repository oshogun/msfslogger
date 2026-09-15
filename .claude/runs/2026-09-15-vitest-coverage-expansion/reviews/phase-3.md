# Review — phase 3 (T-008 through T-014), closing gate for the run

## Verdict: APPROVE

All 668 tests (35 files) pass; `test:types`, `tsc`, `build` exit 0; the
falsifiable live-db check passes; every acceptance criterion on T-008–T-014
verified independently against the diff and live command output, not the
implementer reports (unread, per standing rule — only `risks` sections would
have been read, but none of these tasks' reports were opened at all; findings
below come entirely from diffs and executed commands).

## Commands run and results

- `npm test` → `Test Files 35 passed (35)`, `Tests 668 passed (668)`.
- `npm run test:types` (`tsc -p tsconfig.test.json`) → exit 0, no output.
- `npx tsc --noEmit` → exit 0.
- `npm run build` (client tsc+vite, server tsc) → exit 0, both stages clean.
- `FLIGHTS_DB_PATH=/nonexistent-directory/flights.db npm test` → same
  `Test Files 35 passed (35)`, `Tests 668 passed (668)` — the design §3.3
  falsifiable check, used as the evidence of no live-db dependency (not md5).
- `grep -rn "flights\.db" tests/` → only scratch paths (`tests/helpers/db.ts`,
  `tests/db/connection.test.ts`, `tests/db/schema.test.ts`, `tests/backup.test.ts`,
  a comment in `tests/setPassword.test.ts`/`tests/kmlExport.test.ts`). No hit
  resolves to the repo root.
- `grep -rn "process.cwd()" tests/` → only `tests/flightPlans.test.ts` (a
  pre-existing, unrelated file asserting a path string, never opening a db) and
  a comment in `tests/db/flights.test.ts`.
- Live `flights.db` md5: `1a945a18cd3286788c2421689c462038` before, during, and
  after this entire review session (checked three times) — unchanged. Per
  design §3.3 this is secondary evidence only; the falsifiable check above is
  the real proof.
- Directly ran `FLIGHTS_DB_PATH=<scratch>/flights.db node dist/backfill-durations.js`
  → `No flight durations need correcting.`, exit 0 — confirms `require.main
  === module` still fires `main()` on a direct invocation post-build.
- Directly ran `FLIGHTS_DB_PATH=<scratch>/flights.db node dist/backup.js
  <scratch>/backupout` → printed the three unchanged-format lines, exit 0;
  destination held `flights.db`, `flights.db-wal/-shm`, and a copy of the
  repo's real `flight_plans/` (27 files, 12.0 MB — `plansDir` is intentionally
  still `process.cwd()`-derived per design §6.2, not part of the seam). Read-only
  copy, nothing in the live tree touched.

## Per-task verdicts

**T-008 (`tests/db/flights.test.ts`)** — pass. All 5 criteria verified by
reading the file: insertFlight/closeFlight/insertPoint incl. default-null
params; updateFlight/setFlightPlanName/clearFlightPlanName/getFlights/
getFlightById(+points)/getFlightPointCount/deleteFlight(+cascade, asserted via
`rawPointCount`); combineFlights success + null-for-invalid. `src/flightPlans`
is `vi.mock`'d (`copyFlightPlanFile`, `deleteFlightPlanFile`) — confirmed the
mock is real (`vi.fn()`, asserted with `toHaveBeenCalledWith`) and no test in
this file touches `process.cwd()/flight_plans` for real.

**T-009 (`trips.test.ts`, `settings.test.ts`)** — pass. trips: createTrip,
getTrips (aggregation, zero-flight case, ordering), getTripById (+points,
+planned_legs, ordering), getTripName, updateTrip (partial/none/missing),
deleteTrip (+dangling trip_id, +planned-leg-link restore), assignFlightToTrip
(+cross-trip unlink, +same-trip no-op), removeFlightFromTrip. settings: auth
user insert/update-preserves-created_at, app secret miss/hit (generator
invoked once), getSetting/setSetting incl. null-as-delete and empty-string
also deletes, full session CRUD + sweep (count, boundary `<=`).

**T-010 (`acarsMessages.test.ts`)** — pass. insertAcarsMessage (+both scope
forms, +throw on neither), insertAcarsMessageOnce (+dedup no-second-row,
+throw on missing key), getAcarsMessageById, findAcarsMessageByDedupKey
(+miss), list* with ORDER BY (sent_at, id) incl. tie-break, correlation_id ON
DELETE SET NULL. `seedAcarsMessage`'s `correlation_id` is typed `number | null`
in `tests/helpers/db.ts:313` and used as a bare `requestId` (number) in the
test — consistent, per T-010's note.

**T-011 (`plannedLegs.test.ts`)** — pass, all 5 bullets. createPlannedLeg
(+seq assignment, +alternates, +rollback-on-child-failure), getPlannedLegsForTrip/
getPlannedLegById/findPlannedLegBySource, deletePlannedLeg (+cascade,
+flight restore), reorderPlannedLegs (dense/ordered, scoped), setActiveTrip/
getActiveTripId (idx_trips_active: second activation deactivates first,
count asserted =1), setPlannedLegStatus + candidates scoped to active trip,
getFlightPlannedLegId/linkFlightToPlannedLeg (+idx_flights_planned_leg UNIQUE
asserted at the SQL level)/unlink/clear, recordPlannedLegArrival +
setPlannedLegHandOutcome flown/diverted/reverse + all three conflict-error
paths.

**T-012 (`src/backup.ts`, `tests/backup.test.ts`)** — pass. `require.main`
guard present; import-safety test asserts `getDb()` stays `undefined` after
`import('../src/backup')`. One shared seam: `resolveDbPath()` from `./db`,
`plansDir`/`destDir` are parameters, not new env vars — matches design §6.2
verbatim (confirmed line-by-line against the diff, including the two-space/
one-space console.log formatting and the missing-plansDir "0 files" path).
Test drives `runBackup()` against a real scratch db + scratch flight_plans
dir: table counts (flights/points/trips), `PRAGMA integrity_check` = `'ok'`,
byte-identical copy asserted via `Buffer.equals`, non-file dir entries
skipped, missing-dbFile path rejects rather than exiting.

**T-013 (three CLI scripts)** — pass. All three files export their guard-seam
functions (`main`, `parseUsername`) and gate `main()`/`main().catch()` behind
`require.main === module` (confirmed in the diff for all three). Each test
file dynamically imports after `useScratchDbEnv()`, with an
"import doesn't call main()" test first in each file that checks
`getDb() === undefined`. backfillDurations: big-diff (425s > 120) vs
small-diff (75s ≤ 120) flights seeded with a real >MAX_COUNTED_GAP_MS gap;
dry run writes nothing, `--apply` updates only the big-diff row; also
`fmt()`/`MIN_DIFF_SEC` exports checked. backfillIcao: `../src/airports`
mocked, all four UPDATE branches (dep icao+name / dep name-only / arr
icao+name / arr name-only) plus no-match-untouched and the
nothing-selected/`findNearestAirport` never called path. setPassword:
`parseUsername` default/`--username <v>`/`--username=v`/trim/no-value-exit/
`--password` and `--password=` rejected without the value ever reaching a
log line (`console.error` not called with the secret string)/unrecognised
arg.

**T-014 (`src/pdfExport.ts`, `tests/pdfExport.test.ts`)** — pass. Checked
design §11.1 directly (not the task envelope's "most likely" hedge): the
scope is `appendPdfs`, `baseUrl()`, `closeBrowser()`'s no-launch path — all
three are covered, matching exactly. `appendPdfs`: empty list and
all-missing-paths both return the same `Buffer` object; good+corrupt mix
degrades (3 pages, producer preserved) with `updateMetadata: false` on
readback per the pdf-lib trap (§11.3) — confirmed the test uses it.
`baseUrl()`: `EXPORT_BASE_URL` override, http/https derivation from
`getConfig().tls.enabled`, default vs. explicit `PORT`, and per-call (not
cached) re-evaluation; `loadConfig()` always called with an explicit env
object, never `process.env`. `grep -n "puppeteer\|page.goto\|\.launch("
tests/pdfExport.test.ts` → only the header comment disclaiming it — no real
call.

## Cross-cutting design conformance

- All four `require.main === module` guards present exactly where design §4.1
  named them; `tsconfig.json`'s `"module": "commonjs"` makes the idiom valid,
  confirmed by a clean `tsc` and a direct `node dist/...` run for two of the
  four (backfill-durations, backup) post-build.
- `src/db/connection.ts`'s `resolveDbPath()`/`initDb(dbPath = resolveDbPath())`
  matches design §5.2 exactly; default-arg form preserves "no argument, no env
  var → same file, same pragma order, same `applySchema()` call" (must-not-change
  #2). `closeDb()`/`getDb()` byte-for-byte unchanged (#3).
- `tests/setup.ts`'s new line is `process.env.FLIGHTS_DB_PATH ??= path.join(os.tmpdir(), ...)`
  — uses `??=`, confirmed by re-running `FLIGHTS_DB_PATH=/nonexistent-directory/flights.db npm test`
  above and seeing the explicit value still win (suite ran against the
  nonexistent path's absence with no fallback override, all 668 passing).
- `tests/db/flights.test.ts` seed helper's `correlation_id`/other scratch-db
  helpers live only in `tests/helpers/db.ts`, never edited `tests/helpers/index.ts`
  (must-not-change #7) — confirmed via `git status` (not in the changed-file list).
- Must-not-change #5 (`server.ts`, `types.ts`, `routes/**`, `config.ts`,
  `inspect-*.ts` untouched **by this run**): see Finding below — these files
  *are* modified in the working tree right now, but the diff content
  (ACARS weather-request feature: `RequestWxRequest`, `WxWeatherPayload`,
  `/acars-messages/wx`) has nothing to do with T-008–T-014's allowed_paths or
  subject matter, and none of it appears in any of T-008–T-014's `allowed_paths`
  (checked via `ctx.sh task ... T-0XX` for all seven). Not attributable to
  this run.
- No run-citation grep hits (`.claude/runs/`, `design.md`, `§`, `Amendment`,
  `plan.json`, `T-NNN`, `phase*`) in any new/edited file for T-008–T-014.
- Scope: every file each task actually touched is exactly that task's
  `allowed_paths` (checked all seven via `ctx.sh task`).

## Finding (non-blocking, escalate to Orchestrator)

**Unrelated uncommitted work is mixed into the working tree.**
`client/src/pages/AcarsMessages.tsx`, `client/src/types.ts`, `src/acars.ts`,
`src/routes/acars.ts`, `src/server.ts`, `src/types.ts` carry uncommitted diffs
implementing an ACARS weather-request feature (`/api/flights/:id/acars-messages/wx`),
apparently left over from a different, already-partially-landed run
(commit history shows `acars-weather-request`/`acars-dispatch-loadsheet` work
already merged; these look like a further, uncommitted increment). This is
not part of this run's tasks or `allowed_paths`, doesn't touch anything this
review's acceptance criteria cover, and `npm test`/`tsc`/`build` all pass with
it present — but it means "the tree" and "this run's diff" are not the same
thing right now, and a `git commit` for this run must stage only the
vitest-coverage-expansion files, not sweep this in by accident.

## Run-level success criteria (intake.md)

- "Every file in the table except pdfExport.ts's out-of-scope portion has
  real (non-smoke) coverage" — met. All db modules, backup, both backfill
  scripts, setPassword, and pdfExport's in-scope subset all have
  logic-exercising tests, verified above by reading each file, not by count.
- "`npm test`, `test:types`, `tsc`, `build` ... all pass" — met (Docker stage
  not run; design §15.7 explicitly scoped DevOps out of this run since no
  CI/Dockerfile/vitest.config.ts wiring changed, and `npm run build`'s clean
  exit covers the same compile step the Docker build stage runs).
- "No test run ever opens the live flights.db" — met, via the falsifiable
  `FLIGHTS_DB_PATH=/nonexistent-directory/...` check plus both greps.
- "require.main guard is the only behavior-preserving structural change" —
  met for the three CLI scripts (`backfill-durations.ts`, `backfill-icao.ts`,
  `setPassword.ts`); `src/backup.ts`'s additional `runBackup()` extraction is
  outside that specific sentence's scope but was itself frozen in design §6.2
  as a deliberate, reviewed exception for this run.

## Risks / follow-ups (non-blocking)

- The uncommitted ACARS-weather diff above — flag to the Orchestrator before
  any commit for this run.
- design §15.1 (scratch root is machine-dependent, `/dev/shm` vs `os.tmpdir()`)
  and §15.4 (`FLIGHTS_DB_PATH` is a new user-facing env var with no in-tree
  doc) are pre-accepted risks, not re-litigated here.
