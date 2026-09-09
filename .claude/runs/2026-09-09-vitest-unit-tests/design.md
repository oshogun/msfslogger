# design.md — 2026-09-09-vitest-unit-tests

The frozen test-infrastructure contract for this project's first unit test
suite. Every task in `plan.json` cites these sections by number; the numbering
is part of the contract and does not change.

Read a slice, not the file:
`.claude/tools/ctx.sh design 2026-09-09-vitest-unit-tests 4 6`.

## Amendments

| # | Date | Section | Change | Evidence that forced it |
|---|------|---------|--------|-------------------------|
| — | —    | —       | none yet | — |

## What was prototyped before freezing

Nothing below is asserted from memory. Everything load-bearing was run against a
scratch copy of this repo (`src/`, `samples/`, `package*.json`, `tsconfig.json`,
`node_modules/`) under Node 20.20.2, and the surviving scripts are in
`.claude/runs/2026-09-09-vitest-unit-tests/prototypes/`:

| Prototype | Proved |
|---|---|
| `npm install --save-dev --save-exact vitest@4.1.11` in the scratch copy | 41 packages, 15 s, `better_sqlite3.node` md5 **unchanged** (`99e7d4e42e6c8284f929c1c9d0bfbe3b`), `require('better-sqlite3')` still loads — §1 |
| `vitest.config.ts` in four forms | only the CommonJS form runs without a Vite config-loader warning — §3.2 |
| `tsconfig.test.json` | typechecks `tests/**` + `src/**`, catches a planted `string`→`number` error (exit 2), leaves `npx tsc` and `dist/` untouched — §2.4 |
| `proto-clock.test.ts` | `vi.useFakeTimers()` fakes `Date.now()` **and** `new Date().toISOString()` together — §5 |
| `proto-flightManager.test.ts` | the `vi.mock` + dynamic-import factory shape drives the real `FlightManager` with zero I/O; produced the worked duration numbers in §5.4 — §6 |
| `proto-airports.test.ts` | the §7 export seam makes `parseCSV` / `parseCSVLine` / `findNearestAirport` reachable with no fs and no network; 17 assertions pass — §7 |
| `proto-lnmpln.test.ts` (output captured into `contracts/lnmpln-fixtures.json`) | measured every committed `samples/lnmpln` fixture's parse result and every `chainOrderForBatch` verdict — §8.2 |
| full scratch run | 3 files, 25 tests, **1.17 s wall**; `npx tsc` exit 0; `ls dist/*.test.js` finds nothing |

---

## 1. Runner and version

### 1.1 The pin

**`vitest@4.1.11`, exact, in `devDependencies`.** No caret. Add with:

```
npm install --save-dev --save-exact vitest@4.1.11
```

Nothing else is installed. No `@vitest/coverage-*`, no `@vitest/ui`, no
`happy-dom`, no `jsdom`, no `ts-node` change, no `typescript` change.

### 1.2 Why 4.1.11 and not `latest`

`vitest@5.0.0` is the current `latest` tag and declares
`engines.node: "^22.12.0 || ^24.0.0 || >=26.0.0"`. **This project runs on Node
20** (`.nvmrc`, `.claude/ENVIRONMENT.md`, `node:20-alpine` in all three
Dockerfile stages). Vitest 5 is therefore not installable here without moving
the whole project's Node version, which is out of scope and would break
`better-sqlite3`.

`vitest@4.1.11` declares `engines.node: "^20.0.0 || ^22.0.0 || >=24.0.0"` and
was verified running on this box:

```
$ npx vitest --version
vitest/4.1.11 linux-x64 node-v20.20.2
```

Vitest 3.2.7 would also work (`^18 || ^20 || >=22`), but 4.x is the newest line
that supports Node 20 and it is what the Docker `node:20-alpine` stage will get
too. Choose 4.

Pin exactly rather than `^4.1.11`: this project has no lockfile-refresh habit
and no CI, and a silent minor bump in a test runner is a class of Monday-morning
mystery nobody here wants to debug. `package-lock.json` is committed alongside.

### 1.3 The install procedure

Every command in this run is prefixed, per `.claude/ENVIRONMENT.md`:

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
```

`nvm use` does not survive between Bash calls. Repeat it in the same command as
the work. Verify before starting: `node -v` must print `v20.x`, not `v26.x`.

### 1.4 The `better-sqlite3` rule (hard)

**The install must not rebuild `better-sqlite3`.** The default `node` on this
machine is v26.3.1, which has no prebuilt binary for `better-sqlite3@9.6.0`'s
ABI. An `npm install` run under the default node can trigger a source rebuild
against the wrong ABI, and the user's live server on port 3000 loads that binary
on its next restart. That is the one way this run can break the user's logbook.

The rule, and the evidence it works:

- Run the install under Node 20 only.
- Before and after, run `node -e "require('better-sqlite3')"` and record the
  exit status.
- Before and after, record
  `md5sum node_modules/better-sqlite3/build/Release/better_sqlite3.node`.

Measured in the scratch copy: md5 `99e7d4e42e6c8284f929c1c9d0bfbe3b` before and
after; `npm ls better-sqlite3` reports `9.6.0` both times; 41 packages added,
none of them native. `npm install` of a pure-JS devDependency does not re-run
`better-sqlite3`'s install script, and this was observed rather than assumed.

If a rebuild ever does happen, the recovery is `npm rebuild better-sqlite3`
under Node 20 — not an upgrade, not a version bump.

### 1.5 What must still be true afterwards

`npm run build`, `npm run build:server`, `npm start`, `npm run backup` and every
`src/inspect-*.ts` keep working, unchanged, under Node 20. See §8.4.

---

## 2. File layout and naming

### 2.1 Layout (frozen)

```
tests/
  setup.ts                 §3.3 — the one setup file
  helpers/
    index.ts               §4, §5, §6 — the single shared harness (T-002)
  smoke.test.ts            T-001
  legMatcher.test.ts       T-004
  plannedLegClose.test.ts  T-004
  flightPlans.test.ts      T-004
  airports.test.ts         T-005
  lnmpln.test.ts           T-006
  flightManager.test.ts    T-008  (may split per T-008's allowed_paths)
vitest.config.ts           §3
tsconfig.test.json         §2.4
```

**Test files live in `tests/` at the repo root. Never in `src/`.** Every task's
`allowed_paths` in `plan.json` offers both a `tests/X.test.ts` and a
`src/X.test.ts` spelling; `tests/` is the one that is chosen, and the `src/`
spelling must not be used by any task.

Naming: `tests/<moduleBasename>.test.ts`, matching the source file's basename
exactly (`legMatcher.test.ts` for `src/legMatcher.ts`). Helpers are not tests and
must not match `*.test.ts`.

### 2.2 The glob

`vitest.config.ts` sets `include: ['tests/**/*.test.ts']` (§3.1). Nothing under
`src/`, `client/`, `agent/` or `dist/` is ever collected, whatever it is named.

### 2.3 Why `tests/` and not colocation — the Docker constraint

The Dockerfile's server-build stage copies an explicit, closed file list:

```dockerfile
# Dockerfile lines 13-19, verbatim
FROM node:20-alpine AS server-builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build:server
```

Only `package*.json`, `tsconfig.json` and `src/` enter that stage. Two
consequences, both binding:

1. **`tsconfig.json` must stay self-contained.** It must not gain an `extends`,
   a `references`, or a `files`/`include` entry naming anything outside
   `package*.json`, `tsconfig.json` and `src/`. A `"extends": "./tsconfig.base.json"`
   would make `npm run build:server` fail inside the image with
   `File './tsconfig.base.json' not found` while working perfectly on this
   machine — the exact failure mode that is invisible until a deploy.

2. **Colocating tests in `src/` would put them in the image.** They would be
   copied, then compiled into `dist/` unless `tsconfig.json` grew an `exclude`
   for them — a change to the one file the Docker stage depends on, for no gain.

Putting tests in `tests/` means **`tsconfig.json` is not edited at all in this
run**, which is the strongest possible form of "it stayed self-contained".

Verified: `npx tsc` in the scratch copy exits 0 and `ls dist/*.test.js
dist/**/*.test.js` finds nothing, because `tsconfig.json`'s
`include: ["src/**/*"]` never saw the `tests/` directory.

T-001 still proves the Docker file set independently, per its acceptance
criteria: copy exactly `package.json`, `package-lock.json`, `tsconfig.json`,
`src/` into a scratch dir, `npm ci`, `npm run build:server`, expect exit 0.

### 2.4 Are test files typechecked? Yes — by a second tsconfig

Vitest transpiles TypeScript with esbuild and **does not typecheck**. A test
file with a type error runs happily. That is unacceptable here, because T-002's
whole point is that `makeFrame()` returns something assignable to `SimFrame` —
an assertion only the compiler can make.

So: a second, **standalone** config, `tsconfig.test.json` at the repo root:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*", "vitest.config.ts"]
}
```

Notes, each of which was needed to make it work:

- `rootDir: "."` — inherited `rootDir: "./src"` errors with
  `'tests/x.test.ts' is not under rootDir` the moment `tests/` is included.
- `noEmit: true` — it must never write to `dist/`.
- `include` re-lists `src/**/*` because `include` replaces, not merges.
- **The extends direction is the safe one.** `tsconfig.test.json` extends
  `tsconfig.json`; `tsconfig.json` knows nothing about `tsconfig.test.json`.
  Docker copies `tsconfig.json` and not `tsconfig.test.json`, and nothing in the
  image ever looks for the file that is missing. Reversing this — having
  `tsconfig.json` extend or reference a test config — is forbidden by §2.3.
- `types: ["node"]` and **`globals: false`** in §3.1 together mean no
  `vitest/globals` type entry is needed. Tests import `describe`, `it`,
  `expect`, `vi`, `beforeEach`, `afterEach` explicitly from `'vitest'`.

Verified: `npx tsc -p tsconfig.test.json` exits 0 on a clean tree, and exits 2
with `error TS2322: Type 'string' is not assignable to type 'number'` when a
type error is planted in a test file.

### 2.5 `.gitignore`

Add nothing. §3.5 configures no coverage and no HTML report, so no
`coverage/`, `.vitest/`, `html/` or `test-results/` directory is ever created.
If a task finds one, the task did something §3 did not authorise. `dist/` and
`node_modules/` are already ignored.

---

## 3. `vitest.config.ts`

### 3.1 The frozen config

```ts
// vitest.config.ts — CommonJS on purpose; see §3.2.
const config: import('vitest/config').ViteUserConfig = {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'client/**', 'agent/**'],
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 5000,
    hookTimeout: 5000,
    reporters: ['default'],
    isolate: true,
  },
};

module.exports = config;
```

Field by field:

- **`environment: 'node'`** — everything under test is server-side. No DOM, no
  `jsdom`/`happy-dom` dependency. `client/` is not in scope for this run.
- **`include`** — §2.2.
- **`exclude`** — belt and braces; `client/` has its own toolchain and
  `agent/` is plain JS for a different machine.
- **`setupFiles`** — §3.3.
- **`globals: false`** — explicit imports from `'vitest'`. Keeps
  `tsconfig.test.json` free of a `vitest/globals` types entry (§2.4) and keeps
  the test files honest about where `expect` comes from.
- **`restoreMocks: true`** — every mock is restored after each test, so nothing
  leaks between tests in one file. **This has a sharp edge, frozen in §6.4:** it
  also strips `vi.fn()` implementations, so the harness's `resetMocks()` must
  re-install the defaults and must be called in `beforeEach`.
- **`testTimeout` / `hookTimeout: 5000`** — everything in this suite is pure
  arithmetic, in-memory fakes, or reading a ≤50 KB fixture. The whole scratch
  suite ran in 1.17 s. A test that takes five seconds has hung on real I/O or a
  real timer, and 5000 ms turns that into a fast, clear failure instead of the
  30 s default.
- **`reporters: ['default']`** — no JSON, no JUnit, no HTML. There is no CI to
  feed. See §3.5.
- **`isolate: true`** (the default, stated because it is load-bearing) — each
  test file gets a fresh module registry. This is what makes the module-level
  mutable state in `src/airports.ts` (`let airports`) and in the harness
  (`nextFlightId`) safe: `tests/airports.test.ts` cannot contaminate
  `tests/flightManager.test.ts`. Do not set `isolate: false` or
  `fileParallelism: false` to chase speed; the suite is already fast.
- **`pool`** — left at the vitest 4 default (`forks`). Not pinned in the config,
  but two things depend on it and are recorded here: `process.chdir()` works
  (verified — it throws under `pool: 'threads'`), and native modules stay out of
  worker threads. If a future change sets `pool: 'threads'`, re-check both.

### 3.2 Why the config is CommonJS

`package.json` has no `"type": "module"` and `tsconfig.json` sets
`"module": "commonjs"` — this is a CommonJS project and must stay one, because
`dist/index.js` is loaded by `node dist/index.js` on the user's live server.

With an ESM-style `vitest.config.ts` (`import { defineConfig } from
'vitest/config'; export default defineConfig({...})`), **every** `npm test` run
prints:

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`,
which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1).
```

Three shapes were tried in the scratch copy:

| Shape | Warning? | Notes |
|---|---|---|
| `import` + `export default defineConfig(...)` in `vitest.config.ts` | **yes** | fully typed |
| `vitest.config.mts` with the same ESM body | no | but the filename is not in T-001's `allowed_paths` |
| `const config: import('vitest/config').ViteUserConfig = {...}; module.exports = config;` | **no** | chosen |

The chosen shape keeps the frozen filename, keeps the project CommonJS, and runs
clean. Its cost: because `tsconfig.json` uses Node10 module resolution, the
`ViteUserConfig` annotation resolves but checks the `test` block only loosely —
a misspelled `test` key will not be caught by `tsc`. That is an accepted, stated
trade; the config is nine lines and is read by a human every time it changes.

Do **not** "fix" this by adding `"type": "module"` to `package.json`. That breaks
`dist/`.

### 3.3 `tests/setup.ts`

```ts
import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
```

That is the whole file. It exists for one reason: `src/flightManager.ts` writes
six or more `console.log`/`console.warn` lines per simulated flight
(`[FlightManager] Flight #1 started …`), and an unsilenced suite buries its own
results. Verified: with this file, the scratch run's output is three green lines
and nothing else.

Because the spies are installed as spies, a test that *wants* to assert on a log
line still can — `vi.mocked(console.log).mock.calls` — which §6.5 relies on for
the auto-link refusal messages. `restoreMocks: true` un-silences the console
after each test; the `beforeEach` re-installs it. Setup-file hooks are
registered before the test file's own, so console is silenced before any
`beforeEach` in a test file runs.

Nothing else goes in this file. In particular no global fake-timer setup: fake
timers are opt-in per file (§5.2), because the pure modules do not need them and
a global fake clock is the kind of action-at-a-distance that makes a suite
unreadable.

### 3.4 Where the config is not
No `alias`, no `resolve`, no `define`, no `plugins`, no `globalSetup`,
no `env`, no `sequence`, no `retry`, no `bail`. A test that needs one of these
is a test that has grown a dependency this design says it must not have.

### 3.5 No coverage tooling — deliberately

`CLAUDE.md` records that this project has no test framework and does not want
one; this run overrides that for a runner, per `plan.json`'s frozen decisions,
and for nothing else. Coverage is a second tool, a second install
(`@vitest/coverage-v8` plus V8 instrumentation), a second output directory, a
second `.gitignore` entry and — the real cost — a number that invites people to
chase it. This run's success is measured by T-009's mutation checks (does the
suite *fail* when a guard or constant is changed?), which is a stronger
statement than a line percentage and needs no tooling at all.

Revisit in a later run, if and only if someone can name the decision the number
would change.

---

## 4. Test-helpers module

### 4.1 Path and ownership

**`tests/helpers/index.ts`.** One file, one owner: **T-002 writes it and no
other task edits it.** T-004, T-005, T-006 and T-008 import from it read-only.
A task that needs a different value passes an override at the call site.

Imported as `import { makeFrame } from './helpers'` from `tests/*.test.ts`.

The frozen export signatures are in
`.claude/runs/2026-09-09-vitest-unit-tests/contracts/test-helpers.d.ts`.

### 4.2 `makeFrame(over?: Partial<SimFrame>): SimFrame`

Returns a `SimFrame` (`src/types.ts:1-12`) — all ten fields, spread-overridable.
Defaults, frozen:

| Field | Default | Why |
|---|---|---|
| `lat` | `34.426201` | KSBA, from the real `VFR … (KSBA) to … (KMRY).lnmpln` first `<Pos>` |
| `lon` | `-119.841507` | same |
| `altitudeFt` | `1500` | airborne, below any cruise altitude in the fixtures |
| `airspeedKnots` | `110` | **> 30**, so the default frame trips `FlightManager`'s airborne test (`src/flightManager.ts:195`) |
| `groundSpeedKnots` | `105` | **≥ 5**, so the default frame never trips the landed test (`:213`) |
| `headingDeg` | `270` | inert |
| `verticalSpeedFpm` | `500` | inert |
| `onGround` | `false` | **the default frame is a flying frame** |
| `simRunning` | `1` | 1 = running. `0` ends a flight (`:186`), `3` is slew (`:191`) |
| `aircraft` | `'Cessna 172'` | matches the fixtures' `C172` performance profile |

The defaults are chosen so that **three bare `makeFrame()` calls start a flight**
and **`makeFrame({ onGround: true, groundSpeedKnots: 2 })` is a landed frame**.
That is the single most-used pair in the suite; it was verified end to end in the
prototype.

### 4.3 `makeCandidate(over?: Partial<LegMatchCandidate>): LegMatchCandidate`

Returns a `LegMatchCandidate` (`src/types.ts:269-282`). Defaults:

| Field | Default |
|---|---|
| `plannedLegId` | `11` |
| `tripId` | `1` |
| `seq` | `1` |
| `departureIdent` | `'KSBA'` |
| `departureIsAirport` | `true` |
| `departureLat` | `34.426201` |
| `departureLon` | `-119.841507` |
| `status` | `'planned'` |
| `linkedFlightId` | `null` |
| `aircraftType` | `'C172'` |

The default candidate is **eligible** — `refusalFor()` (`src/legMatcher.ts:126`)
returns `null` for it. Every refusal test is then one override away
(`makeCandidate({ status: 'flown' })`), which is what keeps the leg-matcher
tests readable.

The departure coordinates equal `makeFrame()`'s position exactly, so
`matchPlannedLeg` on a default frame against a default candidate measures 0 nm
and returns `MATCHED`.

### 4.4 `makeHandCloseFlight` / `makeHandCloseLeg`

Structural subsets declared in `src/plannedLegClose.ts:47-66` — not `src/types.ts`.
Import the types from `'../src/plannedLegClose'`.

`makeHandCloseFlight(over?: Partial<HandCloseFlight>): HandCloseFlight`:

| Field | Default | Why |
|---|---|---|
| `id` | `900` | the id `src/inspect-manual-mark.ts:128` uses, so its frozen message strings transcribe verbatim |
| `end_time` | `'2026-09-07T17:06:00.726Z'` | the flight has ended — same literal as `inspect-manual-mark.ts:134` |
| `planned_leg_id` | `500` | `inspect-manual-mark.ts:129` |
| `planned_leg_link_source` | `'manual'` | the only source the gate allows |
| `arrival_lat` | `34.426201` | KSBA |
| `arrival_lon` | `-119.841507` | KSBA |

`makeHandCloseLeg(over?: Partial<HandCloseLeg>): HandCloseLeg`:

| Field | Default |
|---|---|
| `id` | `500` |
| `status` | `'planned'` |
| `destination_lat` | `36.586952` (KMRY) |
| `destination_lon` | `-121.843079` (KMRY) |

Defaults form **row 1 of the 24-row gate table** (`inspect-manual-mark.ts:100`):
manual link, ended, leg `planned` → `decideHandClose('flown', …)` is allowed and
`decideHandClose('planned', …)` refuses `LEG_NOT_FLOWN`.

### 4.5 `makePlannedLegWithChildren(over?: Partial<PlannedLegWithChildren>)`

`PlannedLegWithChildren` (`src/types.ts:238-242`) is a wide row type — 40-odd
fields — and `FlightManager` reads exactly six of them (`id`, `trip_id`,
`departure_ident`, `destination_ident`, `destination_lat`, `destination_lon`)
plus `waypoints[]`. The builder must nonetheless return a **complete, type-valid**
object, so `tsc -p tsconfig.test.json` proves it and a later reader cannot be
misled about what the DB actually returns.

Frozen defaults for the fields anything reads:

| Field | Default |
|---|---|
| `id` | `11` |
| `trip_id` | `1` |
| `seq` | `1` |
| `status` | `'planned'` |
| `departure_ident` | `'KSBA'` |
| `departure_name` | `'Santa Barbara Muni'` |
| `departure_lat` / `departure_lon` | `34.426201` / `-119.841507` |
| `departure_is_airport` | `1` |
| `destination_ident` | `'KMRY'` |
| `destination_name` | `'Monterey Rgnl'` |
| `destination_lat` / `destination_lon` | `36.586952` / `-121.843079` |
| `destination_is_airport` | `1` |
| `is_snippet` | `0` |
| `cruise_alt_ft` | `7500` |
| `flightplan_type` | `'VFR'` |
| `aircraft_type` | `'C172'` |
| `waypoint_count` | `2` |
| `alternate_count` | `0` |
| `approx_distance_nm` | `162.5` |
| `arrival_deviation_nm` | `null` |
| `source_filename` | `'VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln'` |
| `source_sha256` | `'0'.repeat(64)` |
| `source_program` | `'Little Navmap 3.0.18'` |
| `imported_at` | `'2026-09-09T12:00:00.000Z'` |
| `plan_created_at` | `'2026-09-04T21:08:44.000Z'` |
| `linked_flight_id` | `null` |
| `alternates` | `[]` |
| `waypoints` | the two-element chain below |

Every remaining field — all `departure_start*`, `departure_pos_*`, `sid_*`,
`star_*`, `approach_*`, `remarks` — defaults to **`null`**. That is honest: those
columns are `NULL` in four of the five real imports.

Default `waypoints` (a `PlannedWaypoint[]`, `src/types.ts:199-219`):

```
[ { id: 1, planned_leg_id: 11, seq: 1, ident: 'KSBA', name: 'Santa Barbara Muni',
    region: null, airway: null, track: null, type: 'AIRPORT', comment: null,
    lat: 34.426201, lon: -119.841507, alt_ft: null },
  { id: 2, planned_leg_id: 11, seq: 2, ident: 'KMRY', name: 'Monterey Rgnl',
    region: null, airway: null, track: null, type: 'AIRPORT', comment: null,
    lat: 36.586952, lon: -121.843079, alt_ft: null } ]
```

Departure first, destination last — the order `buildPlannedLegCache()`
(`src/flightManager.ts:118`) depends on. With this default,
`getPlannedLegStatus(34.426201, -119.841507)` returns
`nextWaypointIdent: 'KMRY'` and `remainingDistanceNm: 162.5` (measured in the
prototype).

### 4.6 Geometry helpers

```
NM_PER_DEG = 60.04046120432669      // Math.PI * 3440.065 / 180
DEG_PER_NM = 0.016655435148240015   // 1 / NM_PER_DEG
northOfNm(pos, nm) => ({ lat: pos.lat + nm * DEG_PER_NM, lon: pos.lon })
```

**One arc-minute is not one nautical mile in this codebase.** `src/geo.ts` uses
`R = 3440.065`, giving 60.0405 nm per degree, so `lat + 10/60` is **10.0067 nm**
away, not 10. `src/inspect-legmatch.ts:66`'s `northOf` uses `/60` and is fine
only because its assertions are inclusive windows (`[7.9, 8.1]`).

Consequence, frozen as a rule in §10.5: **never assert an exact radius boundary
by constructing coordinates.** Even `northOfNm(p, 10)` measures
`10.000000000000002` nm, which is `> 10` and fails `d <= radius`. For a boundary
test, measure first and set the radius:

```ts
const d = haversineNm(lat, lon, c.departureLat, c.departureLon);
matchPlannedLeg({ ...input, radiusNm: d });        // inclusive edge -> MATCHED
matchPlannedLeg({ ...input, radiusNm: d - 1e-9 }); // just outside  -> NO_LEG_IN_RADIUS
```

That is how T-004's "a candidate at exactly `DEPARTURE_RADIUS_NM` matches"
criterion is satisfied, and it is exact rather than approximately exact.

### 4.7 Named real positions

Exported as plain constants, taken from the real `.lnmpln` files' own `<Pos>`
elements (measured, see `contracts/lnmpln-fixtures.json`):

```
KSBA 34.426201, -119.841507      KSFO 37.618023, -122.375519
KMRY 36.586952, -121.843079      KLAX 33.942474, -118.409332
KSTS 38.509693, -122.812897
KACV 40.977814, -124.108475
```

Note `src/inspect-legmatch.ts` uses two slightly different KMRY longitudes
(`KMRY_A` / `KMRY_B`) because the same airport appears with different precision
in two files. When porting those scenarios (§8.1), carry the inspector's own
constants rather than substituting these; the distances asserted there depend on
which one was used.

---

## 5. Faking time

### 5.1 Why it has to cover two APIs

`src/flightManager.ts` reads the clock two different ways and both must move
together:

- `Date.now()` — `:256`, `:257`, `:276`, `:280`, `:475`, `:482`. This is what
  drives `RECORD_INTERVAL_MS` (5000), `MAX_COUNTED_GAP_MS` (60 000), the
  accumulated `activeMs`, and `excludedSec`.
- `new Date().toISOString()` — `:238` (flight `start_time`), `:273` (`end_time`),
  and `new Date(now).toISOString()` at `:483` (each point's `ts`).

A fake that moves only `Date.now()` would produce a flight whose `duration_sec`
is 20 and whose `start_time`/`end_time` are the real wall clock — a suite that
looks green and asserts nothing about the thing under test.

### 5.2 The setup (frozen)

```ts
import { afterEach, beforeEach, vi } from 'vitest';
import { T0, useFakeClock, useRealClock } from './helpers';

beforeEach(() => {
  resetMocks();          // §6.4 — must come with the clock, not instead of it
  useFakeClock();        // vi.useFakeTimers(); vi.setSystemTime(new Date(T0));
});
afterEach(() => useRealClock());   // vi.useRealTimers();
```

`T0 = '2026-09-09T12:00:00.000Z'`.

Verified in `prototypes/proto-clock.test.ts`: after
`vi.useFakeTimers()` + `vi.setSystemTime(new Date(T0))`,

```
Date.now()                      === Date.parse('2026-09-09T12:00:00.000Z')
new Date().toISOString()        === '2026-09-09T12:00:00.000Z'
new Date(Date.now()).toISOString() === '2026-09-09T12:00:00.000Z'
```

and after `vi.advanceTimersByTime(5000)` all three read `12:00:05.000Z`. Vitest's
default `toFake` set includes `Date`, so **no `toFake` option is needed** and
none is set.

Opt in per file. Do not put `useFakeTimers()` in `tests/setup.ts` (§3.3): the
pure modules (`legMatcher`, `plannedLegClose`, `lnmpln`, `flightPlans`,
`airports`) read no clock at all and must not acquire a hidden dependency on one.

### 5.3 The advance-then-feed pattern

`FlightManager` has no timers of its own — it is driven entirely by
`onFrame()` calls and reads `Date.now()` when they arrive. So the pattern is:

```ts
vi.advanceTimersByTime(1000);   // move the clock first
fm.onFrame(makeFrame());        // then deliver the frame that sees it
```

**Never the reverse**, and never `await` anything between them. One
`advanceTimersByTime(1000)` + one `onFrame()` is one second of a 1 Hz agent feed
— the same rate `agent/agent.js` sends at, which is what makes
`AIRBORNE_DEBOUNCE_FRAMES = 3` mean "three seconds" and
`LANDED_DEBOUNCE_FRAMES = 10` mean "ten seconds".

Startup is the one exception: the three frames that trip the airborne debounce
are delivered at t=0 with no advance between them, because `startFlight()` reads
`Date.now()` once and sets both `flightStartMs` and `lastPointTime` from it. If
you advance between them the arithmetic still works; the worked numbers in §5.4
assume you did not.

### 5.4 Two worked flights (measured, not derived on paper)

Both were run against the real `FlightManager` in
`prototypes/proto-flightManager.test.ts`. A Dispatcher can use these as
expectations directly.

**(a) Clean 20-second flight, no pause.**
Three `makeFrame()` at t=0 → takeoff. Then ten `advance(1000); onFrame(makeFrame())`
(t=1..10). Then ten `advance(1000); onFrame(makeFrame({ onGround: true,
groundSpeedKnots: 2, airspeedKnots: 0 }))` (t=11..20) → landing on the tenth.

```
insertFlight('Cessna 172', 34.426201, -119.841507, '2026-09-09T12:00:00.000Z', null, null) -> 1
insertPoint  at t = 0, 5, 10, 15, 20            (5 calls)
closeFlight(1, '2026-09-09T12:00:20.000Z', lat, lon, 20, 0, 1500, 110, 5, null, null)
                                    ^duration_sec = 20   ^distance ^maxAlt ^maxKts ^points
appState.flightState === 'IDLE'
```

`duration_sec = 20` is four 5-second point gaps; the tail is 0 because the
landing frame is itself a point.

**(b) Same flight with a 35-second pause.**
Takeoff at t=0; `advance(5000); onFrame()` → point 2 at t=5; `setPaused(true, 4)`;
thirty `advance(1000); onFrame()` (t=6..35, all suppressed);
`setPaused(false)`; `advance(5000); onFrame()` → point 3 at t=40; then the ten
landing frames (t=41..50).

```
insertPoint at t = 0, 5, 40, 45, 50             (5 calls; nothing t=6..35)
closeFlight(1, '2026-09-09T12:00:50.000Z', …, 15, 0, 1500, 110, 5, null, null)
                                               ^duration_sec = 15
appState.paused / pauseFlags follow setPaused()
```

`duration_sec = 15` = 5 (t=0→5) + 5 (t=40→45) + 5 (t=45→50). The 35-second gap
is dropped by the `this.interrupted` flag (`src/flightManager.ts:493`), **not** by
`MAX_COUNTED_GAP_MS` — 35 000 is well under 60 000. That distinction is exactly
what T-008's mutation check should exercise: deleting `!this.interrupted` from
the guard must turn this 15 into 50.

`excludedSec` (logged, not stored) is `50 - 15 = 35`.

### 5.5 The rule

**No test in this suite may depend on real wall-clock time.** No
`await new Promise(r => setTimeout(r, …))`, no `Date.now()` read outside the fake
clock as an expectation, no `expect(…).toBeGreaterThan(someRealTimestamp)`, no
snapshot containing a real date. Every ISO string a test asserts is derived from
`T0` plus a number of milliseconds the test itself advanced.

---

## 6. Faking module boundaries

### 6.1 The `vi.mock` shape (frozen, and it is not the obvious one)

`FlightManager` imports from `'./db'` and `'./airports'` at module scope, so the
mock must be in place before `src/flightManager.ts` is imported. `vi.mock` calls
are hoisted above the imports, which means **a factory may not close over a
top-level `const` in the test file** — the naive shape fails at runtime with:

```
Error: [vitest] There was an error when mocking a module. …
Caused by: ReferenceError: Cannot access 'db' before initialization
```

(observed, first prototype run). The shape that works, and that lets the mocks
live in the shared harness:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dbMock, airportsMock, resetMocks, makeFrame } from './helpers';

vi.mock('../src/db',       async () => (await import('./helpers')).dbMock);
vi.mock('../src/airports', async () => (await import('./helpers')).airportsMock);

import { FlightManager } from '../src/flightManager';
```

Why it works: the factory is hoisted but self-contained — it resolves the harness
itself, at call time, through vitest's module graph. Because the graph is cached
per test file, the `dbMock` the factory returns is **the same object** the test
file imported at the top, so `expect(dbMock.insertFlight).toHaveBeenCalledWith(…)`
inspects the very stub `FlightManager` called. `isolate: true` (§3.1) gives each
test file its own copy, so there is no cross-file leakage.

The mock path is written **relative to the test file** (`'../src/db'`), not as
`'./db'`. Vitest resolves it to the same module id `src/flightManager.ts`'s
`'./db'` resolves to, which is what makes the substitution take effect.

`vi.mock('../src/db')` with **no factory** is forbidden: automocking imports the
real module first to enumerate its exports, which loads `better-sqlite3` and
violates §10.

### 6.2 The `./db` stub

`src/flightManager.ts:2-6` imports exactly ten names. **All ten must be present
on the mock object** or vitest throws `No "<name>" export is defined on the mock`
at import time. Defaults:

| Function | Real signature (`src/db.ts`) | Default stub behaviour |
|---|---|---|
| `insertFlight` | `:313` `(aircraft, lat, lon, startTime, departureIcao=null, departureName=null) => number` | returns `nextFlightId++`, starting at **1** |
| `insertPoint` | `:371` `(flightId, ts, lat, lon, altFt, airspeed, groundSpeed, heading, vs, onGround) => void` | records the call, returns `undefined` |
| `closeFlight` | `:321` `(id, endTime, lat, lon, durationSec, distanceNm, maxAlt, maxKts, pointCount, arrivalIcao, arrivalName) => void` | records the call |
| `getFlightPlannedLegId` | `:1175` `(flightId) => number \| null` | `null` |
| `getActiveTripId` | `:1056` `() => number \| null` | `null` |
| `getPlannedLegCandidatesForActiveTrip` | `:1124` `() => LegMatchCandidate[]` | `[]` |
| `getPlannedLegById` | `:931` `(legId) => PlannedLegWithChildren \| null` | `null` |
| `linkFlightToPlannedLeg` | `:1207` `(flightId, legId, source) => void` | records the call |
| `recordPlannedLegArrival` | `:1318` `(legId, status, deviationNm) => void` | records the call |
| `getTripName` | `:486` `(tripId) => string \| null` | `'Test Trip'` |

The defaults describe **"a logger with no active trip"**: `getActiveTripId()`
returns `null`, so `matchPlannedLeg` refuses `NO_ACTIVE_TRIP`,
`linkFlightToPlannedLeg` is never called, and `getPlannedLegStatus()` returns
`null`. Every planned-leg test opts in explicitly by overriding
`getActiveTripId`, `getPlannedLegCandidatesForActiveTrip` and
`getPlannedLegById` — which is the right default, because it is the shape of a
user who has never used the trip planner.

`insertFlight` issuing ids: a module-level counter in the harness, `1, 2, 3, …`,
reset to 1 by `resetMocks()` (§6.4). Ids must be issued rather than fixed at 1 so
a two-flight test can tell the flights apart, and must be deterministic so
`expect(linkFlightToPlannedLeg).toHaveBeenCalledWith(1, 11, 'auto')` is a real
assertion. `nextFlightId()` is exported for tests that want to state the next id
without calling.

**Making one throw:**
`dbMock.getActiveTripId.mockImplementation(() => { throw new Error('db down'); })`.
`autoLinkPlannedLeg` (`:384-430`) and `recordArrivalOnPlannedLeg` (`:450-472`)
each wrap everything in `try/catch` on purpose — a failed link must never cost
the flight row. Verified in the prototype: with `getActiveTripId` throwing, the
flight still reaches `FLYING`, `insertFlight` was still called once, and
`linkFlightToPlannedLeg` was not called. `insertFlight` itself is *not* wrapped,
so `dbMock.insertFlight.mockImplementation(() => { throw … })` propagates out of
`onFrame` — that asymmetry is the design and is worth a test.

### 6.3 The `./airports` stub

`src/flightManager.ts:7` imports only `findNearestAirport`. `initAirports` is
included on the mock anyway so the object is a faithful stand-in for the module
and a future importer does not trip over a missing export.

| Function | Real signature | Default stub |
|---|---|---|
| `findNearestAirport` | `src/airports.ts:102` `(lat, lon, maxNm = 10) => { icao, name } \| null` | `null` |
| `initAirports` | `src/airports.ts:79` `() => Promise<void>` | resolves |

`null` is the right default: it is what the real function returns when the
airport table is empty or nothing is within 10 nm, and it makes the frozen
`insertFlight(…, null, null)` / `closeFlight(…, null, null)` argument shape the
default expectation. A test that wants an airport says so:

```ts
airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });
```

Note `findNearestAirport` is called **exactly twice per flight** —
`startFlight` (`:239`) and `endFlight` (`:282`) — never on the frame path. That
call count is itself worth asserting (`toHaveBeenCalledTimes(2)`); a regression
that moved it into `recordPoint` would be a real performance defect and this is
the cheapest place to catch it.

### 6.4 `resetMocks()` — do not rely on `restoreMocks` for these mocks

**Amended 2026-09-09** (T-002/T-003 finding — the paragraph below is corrected;
the original claimed `restoreMocks: true` strips a bare `vi.fn()`'s
implementation. It does not. Verified by both T-002 and, independently, T-003
by reading `node_modules/@vitest/spy/dist/index.js` (vitest 4.1.11):
`restoreAllMocks()` only walks the set `vi.spyOn()` populates — `vi.fn()` never
registers a restore callback and is untouched by `restoreMocks: true`. Also
confirmed at runtime by a probe in `tests/helpers.test.ts:210-220`. The
mechanism below was wrong; the requirement it was protecting was not.)

`dbMock` and `airportsMock` are plain `vi.fn()` objects, so `restoreMocks: true`
(§3.1) does nothing to them between tests — their implementations and call
history persist across tests by default unless something resets them. Without
an explicit reset, a test that overrides `dbMock.getActiveTripId` for one
scenario would leak that override into the next test, which is a failure whose
message points nowhere near the cause.

Therefore `resetMocks()` **re-installs every default implementation in §6.2 and
§6.3 and clears call history** (`.mockReset().mockImplementation(default)` for
each stub, not `.mockClear()`), and **must be the first statement of every
`beforeEach` in every file that uses these mocks.** This was verified: the
prototype's five FlightManager tests pass in sequence only because `resetMocks()`
re-installs the implementations.

`resetMocks()` also resets the flight-id counter to 1.

### 6.5 What is *not* mocked

`src/legMatcher.ts`, `src/geo.ts`, `src/plannedLegClose.ts`, `src/lnmpln.ts` and
`src/types.ts` are **never mocked**, by any test. They are pure, they are the
logic under test, and stubbing them would test the stub. In particular
`tests/flightManager.test.ts` exercises the *real* matcher through the real
`autoLinkPlannedLeg` — the candidates come from `dbMock`, the decision does not.

`console` is spied globally (§3.3), which is how a test asserts a refusal was
logged:

```ts
expect(vi.mocked(console.log).mock.calls.flat().join('\n'))
  .toContain('not linked — AMBIGUOUS');
```

---

## 7. Testability seams in source

### 7.1 The hard rule

**`src/airports.ts` is the only file under `src/` that changes in this run.**
Not `src/flightManager.ts`, not `src/legMatcher.ts`, not `src/lnmpln.ts`, not
`src/db.ts`, not `src/server.ts`, not `src/types.ts`, not any `src/inspect-*.ts`.
Every other module is already reachable at its own boundary through §6's mocks
and the committed fixtures. A task that believes it needs another source change
returns `blocked` and says why; it does not make the change.

### 7.2 Why `src/airports.ts` needs one at all

The functions the user asked to cover are unreachable today:

- `parseCSVLine` (`:29`) and `parseCSV` (`:59`) are module-private.
- `findNearestAirport` (`:102`) reads a module-level `let airports: Airport[]`
  (`:17`) which **only `initAirports()` fills** — and `initAirports()` either
  reads `process.cwd()/airports.json` from disk or downloads
  `https://davidmegginson.github.io/ourairports-data/airports.csv` over the
  network (`:79-100`). Both are forbidden by §10.
- `interface Airport` (`:6`) is private, so a test cannot even name the type it
  seeds with.

### 7.3 The seam (exactly four new exports, nothing else)

Full signatures in
`.claude/runs/2026-09-09-vitest-unit-tests/contracts/airports-seam.d.ts`;
the verified diff is in `prototypes/airports-seam.diff`.

1. `export interface Airport { icao: string; name: string; lat: number; lon: number; }`
   — add `export` to the existing declaration at `:6`. No field change.
2. `export function parseCSVLine(line: string): string[]` — add `export` at `:29`.
   **Body unchanged.**
3. `export function parseCSV(csv: string): Airport[]` — add `export` at `:59`.
   **Body unchanged.**
4. `export function setAirports(list: Airport[]): void { airports = list; }` —
   new, four lines, placed immediately above `initAirports()`.

And one refactor with no behaviour change: the three bare assignments to the
module-level array inside `initAirports()` become calls to `setAirports()`:

| Line | Before | After |
|---|---|---|
| `:82` | `airports = JSON.parse(fs.readFileSync(AIRPORTS_PATH, 'utf8')) as Airport[];` | `setAirports(JSON.parse(fs.readFileSync(AIRPORTS_PATH, 'utf8')) as Airport[]);` |
| `:94` | `airports = parseCSV(csv);` | `setAirports(parseCSV(csv));` |
| `:98` | `airports = [];` | `setAirports([]);` |

That last part matters: it puts the seam **on the production path** rather than
beside it. `setAirports` is not a test-only backdoor that could rot — it is the
one way this module's state is written, used by the only writer there is.

Nothing else: no new parameter on `initAirports`, no dependency injection, no
`AIRPORTS_PATH` override, no export of the `airports` array itself (a test could
mutate it), no `getAirports()`, no `airportCount()`. `findNearestAirport`'s
signature and its `maxNm = 10` default are untouched.

### 7.4 How `findNearestAirport` gets seeded

```ts
import { setAirports, findNearestAirport } from '../src/airports';

beforeEach(() => setAirports([]));           // mandatory: the array is module state

it('finds the nearest inside 10 nm', () => {
  setAirports([
    { icao: 'KSBA', name: 'Santa Barbara Muni', lat: 34.426201, lon: -119.841507 },
    { icao: 'KMRY', name: 'Monterey Rgnl',      lat: 36.586952, lon: -121.843079 },
  ]);
  expect(findNearestAirport(34.4262, -119.84)).toEqual({ icao: 'KSBA', name: 'Santa Barbara Muni' });
});
```

`setAirports([])` in `beforeEach` is not optional. The array is module-level
mutable state; `isolate: true` (§3.1) protects other *files* but not other
*tests* in the same file.

`initAirports()` is **never called from a test.** No test reads or writes
`airports.json`. No test makes a network request. (§10.)

### 7.5 CSV shape for the parse tests

Verified against the OurAirports data dictionary
(<https://ourairports.com/help/data-dictionary.html>, read 2026-09-09), which
gives `airports.csv`'s 19 columns in order: `id, ident, type, name,
latitude_deg, longitude_deg, elevation_ft, continent, iso_country, iso_region,
municipality, scheduled_service, gps_code, icao_code, iata_code, local_code,
home_link, wikipedia_link, keywords`. Zero-based, that confirms
`src/airports.ts:62`'s comment and the indices its body uses: `type = f[2]`,
`name = f[3]`, `lat = f[4]`, `lon = f[5]`, `gps_code = f[12]`, `ident = f[1]`.

Test CSV is **built inline in the test file**, 19 comma-separated fields per row.
Do not read `airports.json` (2.4 MB, 29 549 entries) and do not add a CSV
fixture file.

The behaviours to pin (all seventeen were run green in the prototype):

- `INCLUDE_TYPES` accepts `large_airport`, `medium_airport`, `small_airport`;
  rejects `heliport`, `closed`, `seaplane_base`, `balloonport`.
- `gps_code` (col 12) wins over `ident` (col 1); falls back to `ident` when col 12
  is empty; result is `.trim().toUpperCase()`.
- The ident must match `/^[A-Z0-9]{4}$/` **after** the case fold — `KSB`,
  `KSBAX` and `K-BA` are all dropped. `00AA` is kept (digits are legal), which is
  why the real cache holds 29 549 entries including non-ICAO US locals.
- A row whose lat or lon is `NaN` after `parseFloat` is dropped.
- `name` falls back to the icao when col 3 is empty.
- Line 0 (the header) is skipped unconditionally; blank and whitespace-only lines
  are skipped; each line is `.trim()`ed, so CRLF input parses.
- `parseCSVLine` keeps a quoted comma in one field and **consumes** the quote
  characters, so `1,"Foo, Bar",3` → `['1', 'Foo, Bar', '3']`.
- **Known limitations, asserted as current behaviour, not fixed here:** a doubled
  `""` is not un-doubled (`"He said ""hi"""` → `He said hi`), and a quoted field
  containing a newline breaks, because `parseCSV` splits on `\n` before parsing
  (`:60`). Pin them so a future fix is a deliberate, visible change.

---

## 8. Relationship to `src/inspect-*.ts`

### 8.1 The inspectors stay

`src/inspect-legmatch.ts`, `src/inspect-lnmpln.ts`, `src/inspect-manual-mark.ts`
and `src/inspect-traffic.ts` are **kept, unmodified, in `src/`.** They are not
deleted, not moved to `tests/`, not converted, not deprecated. `CLAUDE.md` and
`.claude/ENVIRONMENT.md` document them as part of this project's verification
story, and they do something Vitest does not: they print a readable narrative of
a decision, on demand, from the command line, with no runner. That is how the
leg-matcher radius was tuned and how it will be tuned again.

They also stay compiled: they live under `src/`, so `npx tsc` still typechecks
them and any change to a signature they call still breaks the build. That is
free regression pressure and this run keeps it.

Nothing in `tests/` imports from an `inspect-*.ts` file. Scenario data is
**transcribed** into the test file, with a comment naming the inspector and line
it came from.

### 8.2 Porting `src/inspect-legmatch.ts` (T-004)

The inspector already holds a `SCENARIOS: Scenario[]` table (`:143`) of 24 rows,
each with `name`, `input: LegMatchInput`, expected `reason`, `legId`,
`nearby: number[]` and an inclusive `distance: [number, number] | null` window.
That table is the specification. Port it; do not re-derive it.

The mechanical mapping:

| Inspector | Test |
|---|---|
| one `Scenario` row | one `it(<row.name>, …)` |
| `leg(...)` (`:73`) | `makeCandidate({ … })` (§4.3) |
| `takeoff(pos, candidates, over)` (`:111`) | inline `LegMatchInput` literal |
| `distance: [7.9, 8.1]` | `expect(r.distanceNm!).toBeGreaterThanOrEqual(7.9)` + `toBeLessThanOrEqual(8.1)` |
| `distance: null` | `expect(r.distanceNm).toBeNull()` |
| `nearby: [11, 12]` | `expect(r.nearbyLegIds).toEqual([11, 12])` |

Keep the inspector's coordinate constants (`KSBA`, `KMRY_A`, `KMRY_B`, `KSTS`,
`KACV`, `KSFO`, `KLAX` at `:55-62`) and its `northOf` (`:66`) **as the inspector
wrote them**, so the ported distance windows still hold. §4.6's `northOfNm` is
for *new* tests, not for re-basing the ported ones.

Keep the `real: boolean` / `note` metadata as a comment on the `it`. It records
which scenarios came from real coordinates and which are constructed, and that
is worth not losing.

Three of T-004's acceptance criteria are **not** in the inspector's 24 rows and
must be written fresh: the `radiusNm: 0` case (the `??`-vs-`||` distinction at
`src/legMatcher.ts:183`), the exact-radius boundary pair (use §4.6's
measure-then-set-radius technique), and `NO_PLANNED_LEGS` from an empty
candidate list.

### 8.3 Porting `src/inspect-manual-mark.ts` (T-004)

Three tables to port, all transcribed:

1. **`GATE_TABLE`** (`:99-124`) — 24 rows × 2 directions = 48 verdicts, the
   full cross product of `linkSource ∈ {manual, auto, null}` × `ended ∈ {t, f}` ×
   `legStatus ∈ {planned, flown, diverted, skipped}`. Port as a `it.each` over
   the same 24-row array with the same `row` numbers, asserting both
   `decideHandClose('flown', …)` and `decideHandClose('planned', …)`. Only rows
   1 and 2 allow.
2. **The frozen message strings** — `expectedMessage()` (`:152`) reproduces all
   five verbatim; the module itself has them at `plannedLegClose.ts:103, 112,
   121, 130, 139`. Assert with `toBe`, character for character, never
   `toContain`. Use flight id `900` and leg id `500`
   (`inspect-manual-mark.ts:128-129`) so the transcribed strings match without
   editing.
3. **The rounding-boundary row** (`:429-487`) — port the constant, not the
   binary search:

   ```ts
   const flight = makeHandCloseFlight({ arrival_lat: 0, arrival_lon: 0 });
   const leg    = makeHandCloseLeg({ destination_lat: 0.0024983152722295506,
                                     destination_lon: 0 });
   expect(handCloseDeviationNm(flight, leg)).toBe(0.2);   // Math.round(x*10)/10
   ```

   Re-measured on this box: the raw haversine is exactly `0.15`
   (`0.14999999999999999445…`), `Math.round(raw*10)/10` is **0.2** and
   `Number(raw.toFixed(1))` is **0.1**. Also assert the two disagree, exactly as
   the inspector does (`:481`) — if a future engine change makes them agree, the
   row has stopped proving anything and should say so loudly rather than pass
   quietly.

### 8.4 Porting the `.lnmpln` fixtures (T-006)

`src/inspect-lnmpln.ts` is a **reporter, not an assertion table** — it prints
each plan's fields and exits non-zero only if a file was rejected. So there is
nothing to transcribe from it directly. Instead:

- The expected values are **measured and committed** in
  `.claude/runs/2026-09-09-vitest-unit-tests/contracts/lnmpln-fixtures.json`,
  produced by running the real `parseLnmpln` / `chainOrderForBatch` over every
  committed fixture on 2026-09-09. T-006 asserts against that table.
- Cross-check against `samples/lnmpln/README.md`, which independently states the
  VFR trio's distances (201.2 / 140.0 / 191.1 nm), altitudes, the IFR plan's
  293.5-vs-293.2 nm procedure gap, and *why* the four-file VFR set must return
  `AMBIGUOUS_SUCCESSOR`. Where the README and the measurement agree, the value is
  safe to freeze.
- Reproduce at any time with
  `npx ts-node src/inspect-lnmpln.ts 'samples/lnmpln/*.lnmpln'`.

Two traps recorded from the measurement:

- **`samples/lnmpln/synthetic/bad-not-xml.lnmpln` rejects with `NO_FLIGHTPLAN`,
  not `NOT_XML`.** `fast-xml-parser` accepts the text and simply finds no
  `<LittleNavmap><Flightplan>`. `NOT_XML` comes from `bad-truncated-comment.lnmpln`.
  Do not infer a reject code from a filename.
- **`BROKEN_CHAIN` has no committed fixture pair.** Every synthetic chain fixture
  is a round trip (`NO_UNIQUE_HEAD`). Build the case in-test from two parsed
  plans with no shared ident, or leave it uncovered and say so in the report.
  Do not add a file to `samples/`.

And the standing rule from `samples/lnmpln/README.md`, which this design adopts:
**no test globs `samples/lnmpln/` for its inputs.** The chain-sort assertions
name their three files explicitly. A glob keeps passing while quietly asserting
something else the day a fixture is added.

---

## 9. npm scripts

### 9.1 What is added

```json
"test":       "vitest run",
"test:watch": "vitest",
"test:types": "tsc -p tsconfig.test.json"
```

- **`test`** — `vitest run`, not bare `vitest`. Bare `vitest` in a TTY starts
  **watch mode** and never exits, which would hang any agent, any script and any
  `npm test` in a hook. This is the single most important character in this
  section. T-001 proves it with `timeout 120 npm test` exiting 0, not 124.
- **`test:watch`** — **add it.** `plan.json`'s frozen decisions chose Vitest over
  `node:test` explicitly for the DX, and watch mode is most of that DX. It is a
  one-word script with no new dependency, no config and no output directory, so
  it does not violate this project's stance against tooling. T-010 confirms and
  restates this in its report.
- **`test:types`** — the typecheck of `tests/**` that `npx tsc` does not do
  (§2.4). One line, no dependency. Without it the type assertions T-002's
  builders exist for are never actually checked.

### 9.2 What is not added

No `pretest`, no `posttest`, no `test:ci`, no `coverage`, no `test:ui`, no
`lint`. No hook that chains `test` into `build` or `start` — the build must stay
exactly as fast and as dependency-free as it is.

### 9.3 What `npm run build` must still do, unchanged

Byte for byte the same as before this run:

```json
"build:client": "cd client && npm run build",
"build:server": "tsc",
"build":        "npm run build:client && npm run build:server"
```

and likewise `dev:server`, `dev:client`, `dev`, `start`, `backfill-icao`,
`backfill-durations`, `backup` — untouched.

`npm run build` still produces the same `dist/` it did before: `tsc` reads
`tsconfig.json`, whose `include` is `["src/**/*"]`, which never saw `tests/`. No
`*.test.js` may appear under `dist/`. The Docker server stage (§2.3) runs
`npm run build:server` on the same three inputs and must exit 0.

`vitest` sits in `devDependencies`, so the production image stage
(`npm ci --omit=dev`, Dockerfile line 26) does not install it and the shipped
image is byte-identical in its runtime dependency set.

---

## 10. Determinism and hermeticism rules

Every rule here is checkable by grep or by unplugging the network, and the
Reviewer checks them that way.

**10.1 No network.** No test may make an HTTP or HTTPS request, resolve a
hostname, or open a socket. In particular no test calls
`initAirports()` (`src/airports.ts:79`), which downloads
`https://davidmegginson.github.io/ourairports-data/airports.csv`. Check:
`grep -rn "http\|https\|fetch(\|initAirports" tests/` finds nothing but comments.
The suite must pass with the machine offline.

**10.2 No live database, ever.** No test opens `flights.db`, imports
`better-sqlite3`, or imports `src/db.ts` unmocked. `src/db.ts` is reached only
through §6.1's `vi.mock` factory, which prevents the real module — and therefore
the native addon — from loading at all. Check:
`grep -rn "better-sqlite3\|flights\.db" tests/` finds nothing;
`require.cache` contains no `better-sqlite3` entry after a run (asserted in the
prototype). Every task reports `md5sum flights.db` before and after its work, and
the two must match.

**10.3 No writes outside tmp.** No test writes anywhere in the repository. Not
`samples/`, not `airports.json`, not `flight_plans/`, not `dist/`, not
`tests/`. If a test genuinely needs a file on disk it uses
`fs.mkdtempSync(path.join(os.tmpdir(), 'msfslogger-test-'))` and removes it in
`afterEach`. In this run no test needs one: `src/flightPlans.ts`'s
fs-touching functions (`ensureFlightPlansDir`, `saveFlightPlanFile`,
`deleteFlightPlanFile`, `copyFlightPlanFile`) are **out of scope** — only the
two pure ones, `isPdfBuffer` (`:15`) and `flightPlanPath` (`:11`), are tested,
per T-004. Check: `git status --porcelain` after `npm test` is empty.

**10.4 Reading committed fixtures is fine and expected.** `samples/lnmpln/*.lnmpln`
and `samples/lnmpln/synthetic/*.lnmpln` are read **read-only**, by explicit
filename (§8.4 — never by glob), resolved from
`path.resolve(__dirname, '../samples/lnmpln')` so the suite does not depend on
the process's cwd. They are committed, small and stable; that is what a fixture
is for.

**10.5 No wall clock, no ambient randomness, no ordering luck.**
- Time: §5.5. Every clock-reading test runs under `vi.useFakeTimers()` from
  `T0 = '2026-09-09T12:00:00.000Z'`.
- `Math.random()`, `crypto.randomUUID()`, `process.hrtime()`: not used, anywhere.
- No test asserts on floating-point equality across a distance computation
  without either an exact expected value taken from a measurement, or
  `toBeCloseTo` / an inclusive window. **Radius boundaries are never constructed
  from coordinates** — 1 arc-minute is 1.0006742 nm under this codebase's
  `R = 3440.065`, and even an exactly-computed 10 nm offset measures
  `10.000000000000002`. Measure the distance, then set `radiusNm` to it (§4.6).
- No test depends on the order tests run in, or on state left by another test.
  `isolate: true` (§3.1) enforces this between files; `resetMocks()` and
  `setAirports([])` in `beforeEach` (§6.4, §7.4) enforce it within one.

**10.6 No environment variables.** Nothing reads `process.env` and no script sets
one. A suite that behaves differently under `CI=true` is a suite whose failures
cannot be reproduced.

**10.7 It must be fast.** The whole suite runs in one `npm test` in a couple of
seconds — 25 tests in 1.17 s wall in the prototype. `testTimeout: 5000` (§3.1)
means anything that reaches for real I/O fails quickly and loudly rather than
hanging a review.

**10.8 The user's server is never touched.** Nothing in this run stops, restarts,
rebuilds over or reconfigures the process on port 3000, and nothing writes to
`flights.db`. `npm run build` is safe to run and leaves the tree shippable
(`.claude/ENVIRONMENT.md`), but no task in this run needs to leave `dist/`
different from how it found it.

---

## Appendix A — Alternatives considered

**A.1 `node:test` instead of Vitest.** Zero new dependencies, ships with Node 20,
and this project's whole temperament argues for it. Rejected because
`plan.json`'s frozen decisions already chose Vitest — "chosen over node:test for
DX — watch mode, mocking, snapshots — despite adding a new dependency". Recorded
here because it is the strongest alternative and a future reader will ask. The
practical difference that matters most to *this* suite is `vi.mock`:
`FlightManager` imports `./db` at module scope, and `node:test`'s
`mock.module` is still experimental on Node 20, which would have forced a
constructor-injection refactor of `src/flightManager.ts` — precisely the source
change §7.1 forbids.

**A.2 `vitest@5` (the `latest` tag).** Rejected: `engines.node` is
`^22.12.0 || ^24.0.0 || >=26.0.0` and this project is pinned to Node 20 by
`.nvmrc`, by `.claude/ENVIRONMENT.md` and by three `node:20-alpine` stages in the
Dockerfile. Choosing it would force a Node upgrade, which would force a
`better-sqlite3` rebuild, which is the one thing §1.4 exists to prevent.
Reconsider when the project moves to Node 22+, and not before.

**A.3 Colocated `src/*.test.ts` instead of `tests/`.** Rejected on the Docker
constraint (§2.3): colocation puts test files inside the one directory the
server-build stage copies, and requires editing `tsconfig.json` — the one file
that stage depends on — to keep them out of `dist/`. `tests/` costs nothing and
lets `tsconfig.json` stay literally unmodified. The counter-argument (tests next
to the code they test are easier to find) is real but small in a 20-file `src/`.

**A.4 A single root `tsconfig.json` with `"exclude": ["**/*.test.ts"]`.**
Rejected for the same reason: it edits the Docker-critical file, and it leaves
tests untypechecked unless a second config appears anyway.

**A.5 `vitest.config.mts` to silence the Vite config-loader warning.** The
cleanest fix technically (verified: no warning, full typing), rejected only
because `vitest.config.ts` is the filename in T-001's `allowed_paths` and the
CommonJS form (§3.2) achieves the same silence at the same filename. If a future
Vite makes the CommonJS form the broken one, renaming to `.mts` is the amendment
to make — nothing else about §3 changes.

**A.6 `restoreMocks: false` with `clearMocks: true`.** Would remove the §6.4 trap
(implementations survive between tests, so `resetMocks()` could clear history
only). Rejected because leaving implementations installed between tests is the
subtler hazard: a `mockImplementation(() => { throw … })` set in one test would
silently poison the next. The explicit `resetMocks()` is one line in a
`beforeEach` and is proven to work.

**A.7 Coverage via `@vitest/coverage-v8`.** Rejected — §3.5.

**A.8 Injecting a clock into `FlightManager` instead of faking timers.**
Rejected: it is a source change to `src/flightManager.ts`, which §7.1 forbids,
and it would leave the shipped code carrying a seam that exists only for tests.
`vi.useFakeTimers()` covers both `Date.now()` and `new Date().toISOString()`
(proven, §5.2) and needs nothing from the source at all.

**A.9 Deleting the `src/inspect-*.ts` inspectors now that there are tests.**
Rejected — §8.1. They are documented in `CLAUDE.md`, they are how tuning is done,
and they are typechecked by `npx tsc` for free.

---

## Appendix B — Must-not-change list

The Reviewer checks these one by one. Each names the command that proves it.

| # | Guarantee | Proof |
|---|---|---|
| M-1 | `findNearestAirport`'s signature, body and `maxNm = 10` default are unchanged | `git diff src/airports.ts` shows no change below line 102 |
| M-2 | `parseCSV` / `parseCSVLine` bodies are unchanged — only `export` is prepended | `git diff src/airports.ts` shows exactly `+export ` on `:29` and `:59` |
| M-3 | `initAirports()`'s observable behaviour is unchanged (cache hit, download, download-failure) | the three `airports = X` lines became `setAirports(X)` and nothing else; `git diff` |
| M-4 | The `Airport` interface's fields are unchanged | `git diff src/airports.ts` line 6 shows only `+export ` |
| M-5 | **No other file under `src/` changes** | `git status --porcelain src/` lists only `src/airports.ts` |
| M-6 | `tsconfig.json` is byte-identical to its pre-run state | `git diff --stat tsconfig.json` is empty |
| M-7 | `npm run build` produces the same `dist/` contents as before, with no `*.test.js` | `npm run build` exit 0; `ls dist/*.test.js dist/**/*.test.js` finds nothing |
| M-8 | The Docker server stage still builds from `package*.json` + `tsconfig.json` + `src/` alone | scratch-dir `npm ci && npm run build:server` exit 0 |
| M-9 | `better-sqlite3` still loads under Node 20 and is still `9.6.0` | `node -e "require('better-sqlite3')"` exit 0; `npm ls better-sqlite3` |
| M-10 | `flights.db` is untouched | `md5sum flights.db` identical before and after every task |
| M-11 | The user's server on port 3000 is neither stopped nor restarted | no task issues a kill, restart or `npm start` |
| M-12 | All four `src/inspect-*.ts` still run | `npx ts-node src/inspect-legmatch.ts` and `src/inspect-manual-mark.ts` exit 0; `npx ts-node src/inspect-lnmpln.ts 'samples/lnmpln/*.lnmpln'` exits 0 |
| M-13 | `samples/` is unmodified — no fixture added, removed, renamed or edited | `git status --porcelain samples/` is empty |
| M-14 | `npm start`, `npm run dev`, `npm run backup`, both `backfill-*` scripts are unchanged | `git diff package.json` shows only the three added `test*` scripts and the `vitest` devDependency |
| M-15 | The shipped production image gains no runtime dependency | `vitest` is in `devDependencies`; Dockerfile line 26 is `npm ci --omit=dev` |

---

## Appendix C — Risks

**C.1 A new devDependency slows the Docker server-build stage.** Dockerfile line
15 is a plain `npm ci` (not `--omit=dev`), so the server-build stage installs
`vitest` and its 40 transitive packages — about 15 s and ~40 MB in that
intermediate layer. The final image is unaffected (line 26 is `npm ci --omit=dev`).
Accepted, and recorded so a slower build is not mistaken for a regression.
*Falsified by:* a Docker build that fails rather than slows — then the fix is
`npm ci --omit=dev` in the server stage plus an explicit `typescript` install,
which is a Dockerfile change and a separate run.

**C.2 The `vi.mock` + dynamic-import factory shape is subtle.** It exists to work
around hoisting (§6.1) and a Dispatcher who "simplifies" it to a closure will get
`ReferenceError: Cannot access 'dbMock' before initialization`. Mitigated by
freezing the exact shape and by the prototype at
`prototypes/proto-flightManager.test.ts`, which can be copied verbatim.
*Falsified by:* the same shape failing on a future vitest — the symptom is a
mock-factory error at import time, and the alternative is `vi.hoisted()` with the
mock objects defined inline (which then cannot come from the shared harness).

**C.3 `restoreMocks: true` strips `vi.fn()` implementations.** §6.4. A test that
forgets `resetMocks()` in its `beforeEach` fails with `currentFlightId` being
`undefined` and an error message that points at `FlightManager`, not at the
missing call. Mitigated by making it the first line of the frozen `beforeEach`
and by saying so twice. *Falsified by:* a green suite where a second test in a
file asserts on `insertFlight`'s return value — check that it really ran.

**C.4 Faked timers plus a future async path.** `FlightManager` is entirely
synchronous today, so `advanceTimersByTime` + `onFrame` is exact. If any of it
becomes `async`, fake timers and promise microtasks interleave and the worked
numbers in §5.4 stop holding. *Falsified by:* an `async` keyword appearing in
`src/flightManager.ts` — at which point §5.3's pattern needs
`await vi.advanceTimersByTimeAsync(…)`.

**C.5 The measured `.lnmpln` fixture table drifts.** `contracts/lnmpln-fixtures.json`
was measured on 2026-09-09 against `fast-xml-parser@5.11.1`. A parser upgrade
could shift a warning list or a rejection code. *Falsified by:* T-006 failing on
a value it did not change — re-run `npx ts-node src/inspect-lnmpln.ts
'samples/lnmpln/*.lnmpln'`, and if the parser genuinely changed, that is an
amendment to this document and not a test to loosen.

**C.6 `src/airports.ts`'s module-level array is shared state.** `setAirports` makes
it writable from tests, which is the point, but a test that forgets
`setAirports([])` in `beforeEach` inherits the previous test's table and can pass
for the wrong reason. `isolate: true` bounds the blast radius to one file.
*Falsified by:* an `airports.test.ts` assertion that passes when its own
`setAirports(...)` call is deleted.

**C.7 Type-checking of `vitest.config.ts` is weak.** §3.2 — Node10 module
resolution means the `ViteUserConfig` annotation does not catch a misspelled key
inside `test`. A typo like `inclde:` would silently collect zero tests. Mitigated
by `npm test` reporting the test-file count, and by T-001's smoke test, which
fails visibly if nothing is collected. *Falsified by:* `npm test` printing
`No test files found`.

**C.8 This run adds a framework to a project that said it did not want one.**
The cost is real: a devDependency, three scripts, a config file and a second
tsconfig, all of which someone must maintain. The frozen decision in `plan.json`
accepted that cost for the four named modules. The way this design keeps it
bounded is §3.5 (no coverage), §9.2 (no hooks, no CI wiring) and §7.1 (one source
file changes, by four exports). If a later run finds itself adding a fifth tool
to make the tests work, that is the signal to stop and reconsider, not to add it.
