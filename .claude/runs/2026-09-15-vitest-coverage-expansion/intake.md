# Intake — 2026-09-15-vitest-coverage-expansion

## Source

User request: "Set up vitest for everything that doesn't have it yet."

CLAUDE.md's documented backlog: `src/trafficStore.ts`, `src/db/` and
`src/ingest.ts` "have no unit coverage yet — good candidates for a follow-up
run, deliberately out of scope for the first pass" (`2026-09-09-vitest-unit-tests`).
`src/weatherClient.ts` (added in `2026-09-14-acars-weather-request`) is the
same kind of gap, flagged by that run's Reviewer.

Asked the user to scope "everything" given the size spread (4 focused modules
vs. every `src/*.ts` file including routes and CLI scripts). Chosen scope:
**the documented backlog + weatherClient.ts + the remaining plain-logic
files** — not routes, not `server.ts`/`index.ts`, not the `inspect-*.ts`
CLI tools, not `types.ts`.

## Exact file list this run covers

| File | Current state | Testing shape |
|---|---|---|
| `src/trafficStore.ts` | none | pure functions + an in-memory class — fits the existing pure-module pattern directly |
| `src/weatherClient.ts` | none | injectable `fetchImpl` already built in (this session) — mirrors `tests/simbriefClient.test.ts` almost exactly |
| `src/geo.ts` | `haversineNm` has 2 assertions in `tests/smoke.test.ts` only; `bearingDeg` untested | pure math, trivial |
| `src/ingest.ts` | CORS-only, via `tests/ingestCors.test.ts` | extend the same mocked-router pattern: frame validation, batch limits, traffic integration, stale timeout |
| `src/db/connection.ts` | none | **blocked on a new test seam — see below** |
| `src/db/flights.ts` | none | same |
| `src/db/trips.ts` | none | same |
| `src/db/plannedLegs.ts` | none | same |
| `src/db/settings.ts` | none | same |
| `src/db/acarsMessages.ts` | none | same |
| `src/db/schema.ts` | none | same |
| `src/backup.ts` | none | real `better-sqlite3` `.backup()` + fs — needs a path-override seam, see below |
| `src/pdfExport.ts` | none | drives headless Chromium via `puppeteer` against a running server — **Designer must decide what subset, if any, is hermetically testable**; full render testing is likely out of reach for this suite (no network/browser in CI per the frozen `vitest.config.ts`) |
| `src/setPassword.ts` | none | CLI script — **structurally blocked, see below** |
| `src/backfill-durations.ts` | none | CLI script — **structurally blocked, see below** |
| `src/backfill-icao.ts` | none | CLI script — **structurally blocked, see below** |

## Two structural findings that make this more than "just add tests"

**1. Three files run `main()` unconditionally at import time, against the
live `flights.db` path.** `src/backfill-durations.ts:84`, `src/backfill-icao.ts`
and `src/setPassword.ts` all end with a bare `main()` / `main().catch(...)`
call at module scope, and `main()` calls `initDb()` (or the db barrel)
immediately. **Importing any of these three files from a test file today
would open and write to the user's real `flights.db`** — a direct violation
of the project's non-negotiable ("never touch the user's running server or
live flights.db"). Before any of the three can be imported by a test, each
needs the standard, behavior-preserving Node guard:

```ts
if (require.main === module) { main().catch(...); }
```

This changes nothing about how `node dist/backfill-icao.js` (etc.) behaves
when run directly — `require.main === module` is true in exactly that case —
it only stops the call from firing on `import`/`require`. Frozen as a
required, low-risk edit; the Designer states exactly which three files and
confirms the idiom in TypeScript/CommonJS context matches the rest of this
codebase's module style (check `tsconfig.json`'s `module`/`esModuleInterop`
settings).

**2. `src/db/connection.ts` hardcodes the live db path with no override.**

```ts
const DB_PATH = path.join(process.cwd(), 'flights.db');
```

read once at module load, with no test seam — unlike `src/simbriefClient.ts`
(`SIMBRIEF_API_BASE_URL`, read per-call) and `src/weatherClient.ts`
(`WEATHER_API_BASE_URL`, same pattern). **No test of any `src/db/*.ts`
module, `src/backfill-*.ts` script, or `src/setPassword.ts` can run against
anything but the live database until this has a seam.** `src/backup.ts` has
the same problem three times over (`DB_FILE`, `PLANS_DIR`, `BACKUP_ROOT`, all
`process.cwd()`-derived module consts).

The Designer decides and freezes **one** convention, reused everywhere this
applies (do not bespoke it five ways): most likely an env-var override read
per-call (the established pattern), e.g. `DB_PATH` (or reusing/extending an
existing `src/config.ts` seam if one already exists for this — the Designer
checks `src/config.ts` first), plus how a real (temp-file, not `:memory:`,
since `better-sqlite3`'s WAL mode and `db.backup()` need a real file for
`src/backup.ts`'s own test) per-test database gets created, has
`applySchema()` run against it, is seeded with fixtures, and is torn down —
this is the same shape of decision the frozen `2026-09-09-vitest-unit-tests`
design made for mocking `./db` as a *consumer*, but this run tests `./db`
*itself*, which cannot be mocked away.

## Explicitly out of scope, and why

- Routes (`src/routes/*.ts`), `src/server.ts`, `src/index.ts`, the
  `src/inspect-*.ts` CLI tools, `src/types.ts` — per the scope the user chose.
  Routes are integration-shaped (real Express + real/mocked db), a different
  harness than this suite's pure/near-pure/mocked style; `inspect-*.ts` tools
  are manual-use scripts by their own naming convention, matching how this
  project already treats `src/inspect-simbrief.ts`/`src/inspect-weather.ts`
  (never given Vitest coverage even by the runs that added the modules they
  inspect).
- Full-render coverage of `src/pdfExport.ts` (spinning up headless Chromium)
  — no network/browser dependency exists anywhere else in this suite and the
  frozen `vitest.config.ts` doesn't provision one; the Designer may still
  find a hermetically-testable subset (see table above) but a browser-driven
  PDF snapshot test is not in scope.

## Success criteria

- Every file in the table above except `pdfExport.ts` (subset per Designer)
  has real Vitest coverage exercising its actual logic — not a smoke-only
  import check.
- `npm test`, `npm run test:types`, `npx tsc`, `npm run build`, and the
  Docker server build stage (per the original suite's own ship criteria)
  all still pass.
- No test run ever opens the live `flights.db` — every db-touching test
  runs against a temp-file database the test creates and deletes.
- The `require.main === module` guard on the three CLI scripts is the only
  behavior-preserving structural change; nothing else about how those
  scripts run from `node dist/...` changes.

## Steps this run takes, and what it skips

- **Plan** — yes, `planner`.
- **Design** — yes, `designer`. Freezes: the db test-seam convention (§ above),
  the real-sqlite test harness (creation/schema/fixtures/teardown), the
  `require.main` guard locations, and the `pdfExport.ts` scope decision.
  Everything else (trafficStore's pure functions, weatherClient's injectable
  fetch, geo's pure math, ingest's router-mock extension) reuses conventions
  already frozen by `2026-09-09-vitest-unit-tests` — cite by section, don't
  re-freeze.
- **Implement** — `backend_jr`/`backend_sr` per module, batched by which ones
  share the new db-harness dependency vs. which are independent pure-module
  work; Planner decides the split.
- **Review** — every implementer result, per the standing rule.
- **Ship (DevOps)** — only if the Designer's db-seam decision touches
  `npm test`/CI wiring beyond adding test files (e.g. a new env var default
  needed in `vitest.config.ts` or `tests/setup.ts`); otherwise skipped, and
  that call is made explicit in `plan.json` rather than assumed.
