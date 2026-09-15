# Design — 2026-09-15-vitest-coverage-expansion

Freezes the four things `plan.json` says block phases 2 and 3: the
`require.main === module` guard set, the database-path seam, the real
(temp-file) sqlite test harness, and the `src/pdfExport.ts` scope. Everything
else this run does reuses conventions already frozen by
`2026-09-09-vitest-unit-tests` — see §12 for the exact slices to pull instead of
re-deciding.

Sections are numbered and the numbers are stable. Implementers are handed
slices: `.claude/tools/ctx.sh design 2026-09-15-vitest-coverage-expansion 5 7`.
Cross-references are by number.

## Amendments

None yet. When reality contradicts a frozen section after this point, edit that
section in place, keep its number, and add a row here with the evidence that
forced the change.

| Date | Section | Change | Evidence |
|---|---|---|---|
| — | — | — | — |

---

## 1. What was prototyped before freezing

Every number below was measured on this machine under Node 20.20.2
(`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20`), vitest 4.1.11,
with the prototypes in
`.claude/runs/2026-09-15-vitest-coverage-expansion/prototypes/` run through a
throwaway config in the session scratchpad:

```
npx vitest run --root /home/guilherme/msfslogger \
  --config <scratchpad>/vitest.proto.config.ts --reporter=verbose
```

The prototypes are **not** part of `npm test`: `vitest.config.ts`'s `include` is
`tests/**/*.test.ts` and `tsconfig.test.json`'s `include` is `src/**`,
`tests/**`, `vitest.config.ts`. Confirmed after the prototypes existed —
`npm test` → 23 files / 493 tests passed, `npm run test:types` → clean.

### 1.1 `require.main === module` under Vitest (`prototypes/guard.test.ts`)

The guard is the whole plan for the four CLI scripts, and Vitest transforms TS
to ESM, where `module` may not exist at all. Measured inside a Vitest test file
importing a guarded module:

```
typeof require = function | typeof module = object | require.main = undefined
```

`require.main` is `undefined`, so `require.main === module` is **false** and
`main()` does not run. No `ReferenceError`. Both assertions in the prototype
passed: the side-effect array was empty after import, and the module's exported
helper was still callable.

The compiled CommonJS half, with this project's exact compiler options
(`--target ES2022 --module commonjs --strict --esModuleInterop`):

```
--- emitted guard ---        if (require.main === module) { main(); }
--- node out/guarded-cli.js (direct)  --> MAIN_RAN guarded-cli.js
--- node out/importer.js (requires it) --> importer: SIDE_EFFECTS = [] | fmt(65) = 1m 05s
```

`tsc` accepts it, direct execution still runs `main()`, and a `require()` of the
same file does not. That is the behaviour-preservation claim in §4, measured
rather than asserted.

### 1.2 A real sqlite file under Vitest (`prototypes/scratchdb.test.ts`)

`better-sqlite3` (a native addon) loads inside a Vitest worker on Node 20, and
the **real** `applySchema()` from `src/db/schema.ts` runs against a temp file.
Measured post-conditions of one `createScratchDb()`-shaped sequence:

```
tables: acars_messages, app_secret, app_setting, auth_session, auth_user,
        flight_points, flights, planned_alternates, planned_legs,
        planned_waypoints, sqlite_sequence, trips
siblings after write: flights.db, flights.db-shm, flights.db-wal
siblings after close: flights.db
journal_mode = wal   foreign_keys = 1
applySchema() applied a second time: no throw, row count unchanged (idempotent)
```

`db.close()` checkpoints and removes the `-wal`/`-shm` siblings, but a worker
killed mid-test leaves them, which is why teardown removes the **directory**
(§7.4) and not just the file. `db.backup()` into a second temp directory worked
and the copy passed `PRAGMA integrity_check` — that is `src/backup.ts`'s own
mechanism, proven reachable from a test.

### 1.3 The cost of a scratch database, and where it comes from

This is the finding that shaped §7.3. A naive "fresh temp db per test" under
`os.tmpdir()` on this box costs **~400 ms per test** — not per file, per test.
Per-phase profile, average of 10 cycles (`<scratchpad>/profile.js`,
`profile2.js`):

| Scratch root / journal mode | open | pragmas | applySchema | close | total |
|---|---|---|---|---|---|
| `/tmp` (ext4), WAL, default `synchronous` — the production sequence | 0.5 | 194.0 | 65.1 | 147.5 | **407.0 ms** |
| `/tmp`, WAL, `synchronous = OFF` | 0.1 | 148.7 | 3.5 | 0.4 | 152.8 ms |
| `/tmp`, journal_mode DELETE, default `synchronous` | 0.2 | 0.0 | 4674.0 | 0.2 | **4674.4 ms** |
| `/tmp`, journal MEMORY + `synchronous = OFF` | 0.1 | 0.1 | 3.0 | 0.0 | 3.2 ms |
| `/dev/shm` (tmpfs), **production sequence unchanged** | — | — | — | — | **3.5 ms** |
| `:memory:` (for reference — not usable, see §7.2) | — | — | — | — | 1.9 ms |

It is fsync, not SQLite. Putting the scratch file on a tmpfs buys the whole
100× **without touching a single pragma**, so the harness runs the production
`initDb()` sequence verbatim and still costs 3.5 ms. Hence §7.3.

Reset-in-place, for the fallback in §7.6: `DELETE FROM` every table plus
`sqlite_sequence`, inside one transaction, averaged **0.33 ms** over 50 cycles.

Also measured: `df -T` reports `/` as ext4 with 4.0 GB free (90 % used) and
`/dev/shm` as tmpfs with 8.2 GB free. The scratch databases are ~200–400 KB.

### 1.4 The seam, and its precedence (`prototypes/seam.test.ts`, since removed)

The §5 body, copied verbatim into a prototype, was run against: env unset
(default is `path.join(process.cwd(), 'flights.db')` — unchanged), env set to
the empty string (falls back to the default, because the operator is `||` and
not `??`), and env changed **after** the module was loaded, then `initDb()`
called twice — the second call opened the second file and saw zero rows. Per-call
reading works; a module-level `const` would not have.

### 1.5 Vitest's isolation model (`prototypes/pool.test.ts`, since removed)

Two test files reported **different pids** with `isMainThread = true`: vitest
4.1.11's default pool here is `forks`, one child process per test file, so
`process.env` mutation in one test file cannot be seen by another. `isolate:
true` (sibling §3.1) already gave module-graph isolation; this adds that the env
seam is safe. §7.5 still restores the variable, because the guarantee is a
default we do not control, not a contract.

### 1.6 Import ordering and the safety net (`prototypes/importorder.test.ts`)

A module imported with `await import(...)` **inside** a test sees an env var set
in `beforeAll`; a statically imported module sees whatever the process had at
file-load time. That asymmetry is why §8.2 requires dynamic import in the four
CLI-script test files: if a guard ever regressed, a static import would run
`main()` against `process.cwd()/flights.db` — the user's real logbook.

### 1.7 `src/pdfExport.ts` without a browser (`prototypes/pdfexport.test.ts`)

Importing `src/pdfExport.ts` inside Vitest launches nothing (`puppeteer` is
imported at module scope but `puppeteer.launch()` only runs inside
`getBrowser()`). Measured, all green:

- `closeBrowser()` with no browser ever launched resolves to `undefined`.
- `appendPdfs(base, ['/nope/missing.pdf'])` returns **the same Buffer object**
  (`toBe`, not `toEqual`).
- `appendPdfs(base, [good, corrupt])` produced a 2-page document: base page +
  the good attachment, the corrupt one skipped with a warning.
- `loadConfig({ INGEST_TOKEN: 'x'.repeat(20), BIND_HOST: '127.0.0.1' })` then
  `getConfig()` gives `tls.enabled === false`, so `baseUrl()`'s scheme branch is
  reachable with no server and no TLS material. Derived default:
  `http://127.0.0.1:3000`.

**The trap, found the hard way.** The first run of the append test failed on
`expect(doc.getProducer()).toBe('msfslogger')`, reporting
`pdf-lib (https://github.com/Hopding/pdf-lib)`. `src/pdfExport.ts` is not wrong:
`PDFDocument.load()` defaults to `updateMetadata: true` and rewrites Producer
and ModDate **on load**, so it was the test's own read-back that clobbered the
value. The assertion passes with
`PDFDocument.load(out, { updateMetadata: false })`. Frozen in §11.3 — an
implementer who hits this must not "fix" `src/pdfExport.ts`.

---

## 2. Data model

**This run adds no table, no column, no index and no persisted field.** The
freeze below is about what the test harness materialises and what it seeds, not
about new state.

### 2.1 What owns the database path

| Fact | Owner | Type | Nullability |
|---|---|---|---|
| The resolved path of the operational database | `src/db/connection.ts` — `resolveDbPath()` (§5.2) | `string` | never null; always an absolute-or-cwd-relative path |
| The override for it | environment, `FLIGHTS_DB_PATH` (§5.1) | `string \| undefined` | unset and empty string both mean "use the default" |
| The open handle | `src/db/connection.ts` — module-level `let db` | `Database.Database` | `undefined` until `initDb()` has run; `getDb()` keeps returning a closed handle after `closeDb()` |
| The path used by a test | the argument passed to `initDb(dbPath)` (§5.3), or `FLIGHTS_DB_PATH` for the CLI-script tests (§8.2) | `string` | — |

### 2.2 Tables a scratch database holds after `applySchema()`

Measured (§1.2), and the harness asserts it once in its own test:

```
flights, flight_points, trips, planned_legs, planned_waypoints,
planned_alternates, acars_messages, auth_user, auth_session,
app_secret, app_setting            (+ sqlite_sequence, created by AUTOINCREMENT)
```

No rows. `applySchema()` seeds nothing; there is no operator account, no active
trip and no session until a test makes one.

### 2.3 Required columns, per table, for the seed helpers

`NOT NULL` with no default — measured with `PRAGMA table_info` against a fresh
scratch database. A seeder that omits one of these fails with
`SQLITE_CONSTRAINT`, so §7.5's defaults must cover every one:

| Table | Required columns |
|---|---|
| `flights` | `start_time TEXT` |
| `flight_points` | `flight_id, ts, lat, lon, altitude_ft, airspeed_kts, ground_speed_kts, heading_deg, vertical_speed_fpm, on_ground` |
| `trips` | `name TEXT`, `created_at TEXT` |
| `planned_legs` | `trip_id, seq, departure_ident, departure_lat, departure_lon, destination_ident, destination_lat, destination_lon, source_filename, source_sha256, imported_at` |
| `planned_waypoints` | `planned_leg_id, seq, ident, type, lat, lon` |
| `planned_alternates` | `planned_leg_id, seq, ident` |
| `acars_messages` | `direction, category, body, sent_at` |

`planned_legs.status` and `trips.is_active` have defaults (`'planned'`, `0`) and
are therefore optional in a seed.

---

## 3. Persistence and migration safety

### 3.1 There is no migration in this run

No DDL changes. `src/db/schema.ts` is not edited by any task. The only thing
that changes about persistence is **which file** `initDb()` opens, and the
default answer to that question is byte-for-byte what it is today:
`path.join(process.cwd(), 'flights.db')` (§1.4, measured).

Consequences for the user's live database, which the running server holds open
in WAL mode:

- With `FLIGHTS_DB_PATH` unset — the overwhelmingly common case, including the
  user's running server and `docker-compose.yml`'s
  `./flights.db:/app/flights.db` mount — behaviour is identical. The variable is
  read, found unset, and the same default is computed.
- The change is additive and idempotent by construction: nothing is dropped,
  renamed or repurposed, and re-running the server against the same file is what
  it already does.
- No task in this run may run `applySchema()` against the user's `flights.db`,
  and no task opens it read-write. Only scratch files (§7) are opened at all.

### 3.2 `src/backup.ts` must follow the same answer

`npm run backup` is the project's supported way to snapshot the live database
(`.claude/ENVIRONMENT.md`). If an operator ever sets `FLIGHTS_DB_PATH` and the
backup script kept its own `process.cwd()`-derived constant, `npm run backup`
would silently snapshot a *different*, possibly non-existent database and report
success on an empty file. That is the one way this run could cost the user data,
so §6.2 makes `src/backup.ts` resolve its source through the very same
`resolveDbPath()` — one seam, one answer, no second copy of the rule.

### 3.3 Evidence the suite never touches the live database

`md5sum flights.db` before and after a task is **not sufficient evidence here**
and the Reviewer must not treat a difference as proof of a violation: the user's
server is live and writing. Observed during this design session, with no test
running in between, the live file went from `41403c9b154c8662fd33c17c3d2f65bf`
to `a3406666b961833fb47130da5e3b9576` — the server, not us. (Within a single
prototype run, before/after md5 were identical every time.)

The falsifiable check, which every task in phases 2 and 3 reports:

```
FLIGHTS_DB_PATH=/nonexistent-directory/flights.db npm test
```

The whole suite must still pass. Every db-touching test either passes an
explicit path to `initDb()` (§7) or sets the variable itself (§8.2), so nothing
may depend on the default resolving to anything real. Plus the two greps:
`grep -rn "flights\.db" tests/` shows only scratch paths, and
`grep -rn "process.cwd()" tests/` shows none.

---

## 4. The `require.main === module` guard — four files

### 4.1 The four files, and the exact edit

The intake's table named three. There is a fourth: `src/backup.ts` ends in the
same unconditional `main().catch(...)`. All four, with the anchor to edit:

| File | Today, at EOF | Line | Replace with |
|---|---|---|---|
| `src/backfill-durations.ts` | `main();` | `:84` | `if (require.main === module) {`<br>`  main();`<br>`}` |
| `src/backfill-icao.ts` | `main().catch(err => { console.error(err); process.exit(1); });` | `:71` | `if (require.main === module) {`<br>`  main().catch(err => { console.error(err); process.exit(1); });`<br>`}` |
| `src/setPassword.ts` | `main().catch(err => { … process.exit(1); });` | `:120-123` | same wrapping, body unchanged |
| `src/backup.ts` | `main().catch(err => { … process.exit(1); });` | `:79-82` | same wrapping, body unchanged |

**The body of the call — including the `.catch` handler, its message text and
its exit code — is copied through unchanged.** The edit adds two lines and one
level of indentation, nothing else. `src/backup.ts`'s `main()` is additionally
restructured by §6, and that task performs both edits together.

### 4.2 Why this idiom, in this codebase

`tsconfig.json` sets `"module": "commonjs"` and `"esModuleInterop": true`, and
`"target": "ES2022"`. Under `module: commonjs`, `tsc` emits the guard verbatim
(§1.1) and `require`/`module` are the real CommonJS bindings, typed by
`@types/node` — no `import.meta`, no `declare`, no `// @ts-ignore`. The four
files are shipped as `dist/*.js` and invoked as
`node dist/backfill-icao.js`, `npm run backup`, `npm run set-password`; in every
one of those cases `require.main === module` is true and `main()` runs exactly
as it does today (§1.1, measured against a compiled file).

No other file in `src/` gets a guard. `src/index.ts` is the server entry point
and is *supposed* to run on import; the `src/inspect-*.ts` tools are manual-use
and out of scope for this run.

### 4.3 What the guard is worth, and the regression test for it

Today, `import '../src/backfill-durations'` from a test file would run `main()`,
which calls `initDb()`, which opens and migrates the user's real
`flights.db`. That is the blocker. Each of the four files gets one test that
pins the guard:

```
after importing the module (with FLIGHTS_DB_PATH pointed at a scratch file),
getDb() from '../src/db' is undefined — main() did not run
```

`getDb()` returning `undefined` is the cheap, honest witness: the connection
module's handle only exists after `initDb()`. Combined with §8.2's dynamic
import, a regression is caught *and* is harmless when it happens.

### 4.4 Must not change

Exit codes, stdout/stderr text, argv handling, and the fact that
`node dist/<file>.js` runs `main()`. See §14.

---

## 5. The database-path seam

One convention, one reader, reused everywhere. Do not add a second one.

### 5.1 The environment variable

**`FLIGHTS_DB_PATH`**, default `path.join(process.cwd(), 'flights.db')`.

Read **per call**, inside `resolveDbPath()` — never captured in a module-level
`const`. This is the established pattern in this codebase:
`src/simbriefClient.ts:84` (`SIMBRIEF_API_BASE_URL`) and
`src/weatherClient.ts:110` (`WEATHER_API_BASE_URL`) both read `process.env` in a
function body for exactly this reason.

`src/config.ts` was read first, per the task: it has **no** seam for the database
path, and deliberately scopes itself to "security-relevant settings"
(`src/config.ts:1-5`), listing the vars it owns in `ENV_VARS` while naming
`PORT`, `EXPORT_BASE_URL`, `TRAFFIC_ENABLED` and `SIMCONNECT_*` as variables that
"keep their existing readers — untouched". `FLIGHTS_DB_PATH` is in that second
category: **it is not added to `ENV_VARS`, `AppConfig`, or `loadConfig()`**, and
`src/db/connection.ts` does not import `src/config.ts`. A database path is not a
security setting, `loadConfig()` runs *after* some callers would need the path
(`src/inspect-*.ts`, the CLI scripts, `npm run backup` never call it at all), and
routing it through `getConfig()` would make every CLI script depend on a valid
`INGEST_TOKEN`.

Why that name and not bare `DB_PATH`: `DB_PATH` is generic enough to already
exist in a shared shell, a `.env` file or another container in the same compose
project, and a stray value would silently point the logbook at a foreign
database — which `initDb()` would then run `CREATE TABLE IF NOT EXISTS` against.
`FLIGHTS_DB_PATH` names the file it overrides (`flights.db`) and matches the
codebase's existing "name the thing" style (`TLS_CERT_FILE`, `EXPORT_BASE_URL`,
`INGEST_TOKEN`). See §13.1.

Empty string means "unset": the operator is `||`, not `??` (§1.4, measured).
An operator who exports `FLIGHTS_DB_PATH=` gets the default, not a crash on `''`.

### 5.2 `src/db/connection.ts` — the frozen shape

Replace the module-level constant at `src/db/connection.ts:11` and give
`initDb()` an optional parameter. Full text of the changed region:

```ts
const DEFAULT_DB_FILENAME = 'flights.db';

/**
 * The operational database file. FLIGHTS_DB_PATH overrides it; unset and empty
 * both mean the default. Read on every call rather than captured at module
 * load, so a caller that changes the environment or the working directory
 * before opening the database gets the path it expects.
 */
export function resolveDbPath(): string {
  return process.env.FLIGHTS_DB_PATH || path.join(process.cwd(), DEFAULT_DB_FILENAME);
}

let db: Database.Database;

export function initDb(dbPath: string = resolveDbPath()): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applySchema(db);

  return db;
}
```

`closeDb()` and `getDb()` are **unchanged**, bodies and comments. The
`const DB_PATH` line is deleted, not kept as an alias — a stale second answer to
"which file" is the failure mode this section exists to prevent.

Exactly two new exported names come out of this file: `resolveDbPath` and the
optional parameter on `initDb`. Nothing else. `src/db.ts` re-exports
`./db/connection` wholesale, so `resolveDbPath` is reachable as
`import { resolveDbPath } from './db'` with no edit to the barrel.

### 5.3 Precedence, stated once

**explicit argument to `initDb(dbPath)` > `FLIGHTS_DB_PATH` > `path.join(process.cwd(), 'flights.db')`.**

- Production (`src/index.ts:31`) calls `initDb()` with no argument → env, then
  default. Unchanged behaviour.
- The test harness (§7) passes the scratch path **explicitly**, so db tests
  mutate no global state at all.
- The four CLI scripts call `initDb()` with no argument and cannot be given one
  without changing their `main()` signature, so their tests use the env
  (§8.2) — which is precisely what the env layer is for.

### 5.4 What this seam fixes for free

`src/inspect-kml.ts:18-22`, `src/inspect-acars.ts:17-20` and
`src/inspect-legmatch.ts` (~`:404-423`) all work around the old module-load
freeze by `process.chdir()`-ing to the `--db` directory and then `require()`-ing
`./db` late, with comments saying "`src/db/connection.ts` freezes DB_PATH at
module load, so a `--db` flag alone does nothing". After §5.2 that workaround
**still works identically** (cwd is read at `initDb()` time, after the chdir) but
is no longer necessary, and those comments become stale.

Those three files are out of scope for this run and **no task edits them**. The
stale comments are recorded as a follow-up in §15.5. (`process.chdir()` is also
unavailable inside worker threads, which is a second reason the tests use the
env and the argument rather than copying the inspectors' idiom.)

---

## 6. `src/backup.ts` — one shared seam, two parameters

### 6.1 The problem with the three constants

`src/backup.ts:14-16` freezes `DB_FILE`, `PLANS_DIR` and `BACKUP_ROOT` from
`process.cwd()` at module load, and `main()` reads `process.argv` and calls
`process.exit`. A test can neither point it at a scratch database nor read what
it did.

### 6.2 The freeze: one environment variable, not three

**`FLIGHTS_DB_PATH` is the only environment override `src/backup.ts` gets**, and
it gets it by calling §5.2's `resolveDbPath()` — not by reading `process.env`
itself. The other two paths become **parameters**, because inventing
`FLIGHT_PLANS_DIR` and `BACKUP_ROOT` env vars here would be worse than useless:
`src/flightPlans.ts` owns `flight_plans/` with its own `process.cwd()`
derivation and is out of scope for this run, so a `FLIGHT_PLANS_DIR` that only
`backup.ts` honoured would let an operator set it and get backups of a directory
the server does not use. One seam, no half-wired second one. See §13.2.

New shape of `src/backup.ts` (types in
`contracts/source-seams.d.ts`):

```ts
export interface BackupOptions {
  /** Source database. Defaults to resolveDbPath() in main(), never here. */
  dbFile: string;
  /** Directory of attached flight plans. Missing directory is not an error. */
  plansDir: string;
  /** Destination directory. Created recursively if absent. */
  destDir: string;
}

export interface BackupResult {
  destDir: string;
  dbBytes: number;
  flights: number;
  points: number;
  trips: number;
  planCount: number;
  planBytes: number;
}

/** Everything the backup does. No argv, no process.exit, no console output
 *  beyond what main() prints from the returned result. */
export async function runBackup(opts: BackupOptions): Promise<BackupResult>;

/** Unchanged bodies, exported for direct testing. */
export function human(bytes: number): string;
export function stamp(): string;
```

`main()` keeps everything user-facing and gains nothing new:

```ts
async function main(): Promise<void> {
  const dbFile = resolveDbPath();
  if (!fs.existsSync(dbFile)) {
    console.error(`No database at ${dbFile} — nothing to back up.`);
    process.exit(1);
  }
  const destDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(process.cwd(), 'backups', stamp());
  const r = await runBackup({ dbFile, plansDir: path.join(process.cwd(), 'flight_plans'), destDir });
  console.log(`database    ${human(r.dbBytes)}  ${r.flights} flights, ${r.points} points, ${r.trips} trips`);
  console.log(`flight plans ${human(r.planBytes)}  ${r.planCount} file(s)`);
  console.log(`\nBacked up to ${r.destDir}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Backup failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
```

Frozen details, because they are observable behaviour today and must survive:

- The three `console.log` lines keep their exact format, including the two
  spaces after `database` and the single space after `flight plans`.
- The missing-database check stays in `main()` and still exits 1 before anything
  is created. `runBackup()` given a missing `dbFile` throws — it does not exit.
- `runBackup()` still: `mkdirSync(destDir, { recursive: true })`; opens the
  source `{ readonly: true }`; `await source.backup(dest/flights.db)`; closes it
  in a `finally`; re-opens the copy read-only; counts `flights`, `flight_points`
  and `trips`; runs `PRAGMA integrity_check`; closes in a `finally`; copies each
  **file** (not directory entry) from `plansDir` into `dest/flight_plans`,
  counting files and bytes. Same order, same `try/finally` placement.
- `BACKUP_ROOT`'s meaning survives as `path.join(process.cwd(), 'backups')`
  computed inside `main()`; the positional `argv[2]` override still wins and is
  still `path.resolve`d.
- `stamp()` reads the **local-time** wall clock; it is unchanged, and its test
  uses fake timers (sibling §5).

### 6.3 What a `src/backup.ts` test may do

Uses the §7 harness for the source database, plus two more temp directories
(plans, destination). It may call `runBackup()` for real — the prototype proved
`db.backup()` + `integrity_check` work on a scratch file in 439 ms (§1.2) — and
must assert at minimum: the copy exists and opens; the counts in `BackupResult`
match the seeded rows; a corrupt/absent `plansDir` yields `planCount: 0` rather
than a throw; a sub-directory inside `plansDir` is skipped; `human()` at the
1024 and 1024² boundaries. It must not call `main()` (it exits the worker) and
must not touch `process.cwd()`.

---

## 7. The scratch-sqlite harness

### 7.1 Where it lives, and why not in `tests/helpers/index.ts`

**`tests/helpers/db.ts`.** New file. **T-006 writes it and owns it; no other
task edits it** — the same "one file, one owner" rule as sibling §4.1.

It is deliberately *not* added to `tests/helpers/index.ts`, and `index.ts` must
never import it:

1. `index.ts` is what the `vi.mock('../src/db', async () => (await import('./helpers')).dbMock)`
   factory resolves (sibling §6.1). If `index.ts` pulled in `tests/helpers/db.ts`,
   which imports the **real** `../../src/db`, then the module used as the fake
   database would drag the real one — and `better-sqlite3` — into every mocked
   test file. That is the exact hazard sibling §10.2 forbids.
2. Twenty-odd existing test files import `./helpers`; making them all load a
   native addon to get `makeFrame()` costs the suite its start-up time for
   nothing.
3. Parallel tasks: T-006 owns `db.ts` outright while `index.ts` stays frozen.

Direction of dependency, frozen: **`tests/helpers/db.ts` may import from
`./index`** (for `T0`, `KSBA`, `KMRY`, and the geometry constants) — `index.ts`
has no native dependency, so that direction is safe. The reverse is forbidden.

Import it as `import { createScratchDb } from './helpers/db'` from
`tests/*.test.ts`.

### 7.2 A real file, not `:memory:`

`:memory:` is 1.9 ms and tempting (§1.3) and is **rejected**:
`src/backup.ts` calls `db.backup()` and re-opens the result, which needs a real
path; WAL mode — which production sets and which `closeDb()`'s
`wal_checkpoint(TRUNCATE)` depends on — does not exist for an in-memory
database; and `src/db/connection.ts`'s own behaviour (WAL siblings appearing,
checkpoint on close) is part of what this run is meant to cover. One harness for
all db tests beats two.

### 7.3 Where the scratch file goes

```ts
/** '/dev/shm' when it exists and is writable, else os.tmpdir(). Computed once. */
export function scratchDbRoot(): string;
```

On this machine that is `/dev/shm` (tmpfs), which makes the production
`initDb()` sequence cost **3.5 ms instead of 407 ms** with no pragma changes
(§1.3) — the single most valuable measurement in this design. On a machine
without `/dev/shm` (macOS, Windows) it falls back to `os.tmpdir()` and everything
still works, just slower; §7.6 is the escape hatch if that ever hurts.

Detection is a `try { fs.accessSync('/dev/shm', fs.constants.W_OK); … }` around a
`statSync().isDirectory()` check, evaluated once and memoised in a module-level
variable. No environment variable controls it.

Directory naming: `fs.mkdtempSync(path.join(scratchDbRoot(), 'msfslogger-test-'))`
— the same prefix sibling §10.3 already mandates for test temp directories.
`mkdtemp` guarantees uniqueness, so nothing needs the pid.

### 7.4 Exported functions — frozen signatures

Full declarations in
`.claude/runs/2026-09-15-vitest-coverage-expansion/contracts/db-harness.d.ts`.

```ts
import type Database from 'better-sqlite3';

export interface ScratchDb {
  /** The open handle — the same object src/db/connection.ts's getDb() returns. */
  db: Database.Database;
  /** Absolute path of the database file, i.e. <dir>/flights.db. */
  file: string;
  /** The temp directory holding it; removed whole by destroyScratchDb(). */
  dir: string;
}

/**
 * Makes a temp directory, calls the REAL initDb(file) from '../../src/db' so
 * the connection module's handle is set and every db module can find it, and
 * returns the handle. Runs applySchema() by way of initDb() — the production
 * path, not a copy of it. Sets no environment variable.
 */
export function createScratchDb(): ScratchDb;

/**
 * Calls the REAL closeDb() (checkpointing WAL, as production does) and removes
 * the temp directory with { recursive: true, force: true }. Safe to call twice
 * and safe to call when the database is already closed.
 */
export function destroyScratchDb(h: ScratchDb): void;

/** '/dev/shm' when usable, else os.tmpdir(). Memoised. */
export function scratchDbRoot(): string;

/**
 * Points FLIGHTS_DB_PATH at `file` and returns a restore function that puts the
 * previous value back (deleting the key if it was unset). Only the four
 * CLI-script test files need this — see §8.2.
 */
export function useScratchDbEnv(file: string): () => void;

/**
 * DELETE FROM every application table plus sqlite_sequence, in one transaction,
 * with foreign_keys off for the duration. ~0.33 ms. Only for the per-file
 * pattern in §7.6.
 */
export function resetScratchDb(h: ScratchDb): void;
```

### 7.5 Seed helpers — frozen signatures and defaults

Five seeders, no more. They insert with raw SQL (never through the module under
test) and return the new row id.

```ts
export interface SeedFlight {
  aircraft: string | null; start_time: string; end_time: string | null;
  departure_lat: number | null; departure_lon: number | null;
  arrival_lat: number | null;   arrival_lon: number | null;
  departure_icao: string | null; departure_name: string | null;
  arrival_icao: string | null;   arrival_name: string | null;
  duration_sec: number | null; distance_nm: number | null;
  max_altitude_ft: number | null; max_airspeed_kts: number | null;
  point_count: number | null; notes: string | null;
  trip_id: number | null; flight_plan_name: string | null;
  planned_leg_id: number | null;
  planned_leg_link_source: 'auto' | 'manual' | null;
  planned_leg_prev_trip_id: number | null;
}
export function seedFlight(db: Database.Database, over?: Partial<SeedFlight>): number;

export interface SeedPoint {
  ts: string; lat: number; lon: number; altitude_ft: number;
  airspeed_kts: number; ground_speed_kts: number; heading_deg: number;
  vertical_speed_fpm: number; on_ground: 0 | 1;
}
export function seedPoints(db: Database.Database, flightId: number, points: Array<Partial<SeedPoint> & { ts: string }>): void;

export interface SeedTrip { name: string; notes: string | null; created_at: string; is_active: 0 | 1; }
export function seedTrip(db: Database.Database, over?: Partial<SeedTrip>): number;

export interface SeedPlannedLeg {
  trip_id: number; seq: number; status: 'planned' | 'flown' | 'diverted' | 'skipped';
  departure_ident: string; departure_lat: number; departure_lon: number; departure_is_airport: 0 | 1;
  destination_ident: string; destination_lat: number; destination_lon: number; destination_is_airport: 0 | 1;
  source_filename: string; source_sha256: string; imported_at: string;
}
export function seedPlannedLeg(db: Database.Database, over: Partial<SeedPlannedLeg> & { trip_id: number }): number;

export interface SeedAcarsMessage {
  flight_id: number | null; planned_leg_id: number | null;
  direction: 'in' | 'out'; category: string; body: string;
  sent_at: string; dedup_key: string | null; correlation_id: string | null;
}
export function seedAcarsMessage(db: Database.Database, over?: Partial<SeedAcarsMessage>): number;
```

Defaults, frozen — chosen so a bare `seedFlight(db)` is a **complete, ended
KSBA→KMRY flight in a C172**, which is the shape most read-path tests want:

| Seeder | Defaults |
|---|---|
| `seedFlight` | `aircraft 'Cessna 172'`, `start_time T0`, `end_time` T0 + 1 h (`'2026-09-09T13:00:00.000Z'`), departure `KSBA` lat/lon + `'KSBA'` / `'Santa Barbara Muni'`, arrival `KMRY` lat/lon + `'KMRY'` / `'Monterey Rgnl'`, `duration_sec 3600`, `distance_nm 162.5`, `max_altitude_ft 7500`, `max_airspeed_kts 120`, `point_count 2`; every other field `null` |
| `seedPoints` | per point: `lat`/`lon` = `KSBA`, `altitude_ft 1500`, `airspeed_kts 110`, `ground_speed_kts 105`, `heading_deg 270`, `vertical_speed_fpm 0`, `on_ground 0`. `ts` is always explicit — the gap between points is the thing under test in `src/backfill-durations.ts` |
| `seedTrip` | `name 'Test Trip'`, `notes null`, `created_at T0`, `is_active 0` |
| `seedPlannedLeg` | `seq 1`, `status 'planned'`, `KSBA`→`KMRY` idents and coordinates, both `is_airport 1`, `source_filename 'VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln'`, `source_sha256 '0'.repeat(64)`, `imported_at T0`. `trip_id` is required from the caller — a leg with no trip is not a state the app can reach |
| `seedAcarsMessage` | `flight_id null`, `planned_leg_id null`, `direction 'in'`, `category 'freetext'`, `body 'TEST MESSAGE'`, `sent_at T0`, `dedup_key null`, `correlation_id null` |

`T0`, `KSBA` and `KMRY` are **imported from `./index`** (sibling §4.6, §4.7), not
re-declared. One set of coordinates in the suite.

Anything not covered by these five — `planned_waypoints`, `planned_alternates`,
`auth_user`, `auth_session`, `app_secret`, `app_setting` — is inserted with
inline SQL in the one test file that needs it. Do not grow `tests/helpers/db.ts`
for a single caller; it has one owner and edits to it serialise the run.

**The seed-vs-writer rule.** Seed with these helpers when the function under
test is a *read*. Use the module's own writer when the function under test is a
*write* (`insertFlight`, `closeFlight`, `createTrip`, …) — that is the thing
being tested, and round-tripping a write through its own reader is a weaker
assertion than checking the row with raw SQL. Read the row back with raw SQL
when asserting what a writer wrote.

### 7.6 Lifecycle, frozen

Default pattern — **one fresh database per test**:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScratchDb, destroyScratchDb, seedFlight, type ScratchDb } from './helpers/db';
import { getFlight } from '../src/db';

let scratch: ScratchDb;
beforeEach(() => { scratch = createScratchDb(); });
afterEach(() => { destroyScratchDb(scratch); });
```

3.5 ms per test where `/dev/shm` exists. `afterEach` teardown is **mandatory** —
a leaked temp directory on a tmpfs is leaked RAM.

The **only** permitted variant: a file may create once in `beforeAll` and call
`resetScratchDb()` in `beforeEach` (0.33 ms), tearing down in `afterAll`. It may
do so only if that file's tests otherwise exceed ~2 s, and the file must carry a
comment saying which of the two patterns it uses and why. Two patterns is the
ceiling; a third is a blocked-task conversation, not a local decision.

---

## 8. Rules for db-touching test files

### 8.1 Real database and mocked database never mix in one file

A file that calls `createScratchDb()` **must not** `vi.mock('../src/db', …)`.
The mock replaces the module whose `getDb()` the harness just populated, and the
result is a test that proves nothing. The two harnesses are per-file exclusive;
sibling §6.1's mock shape still governs every file that does *not* use a real
database.

`src/airports` is different and may be mocked in the same file as a real
database — and **must** be, for `src/backfill-icao.ts` (§10.2), whose `main()`
calls `initAirports()`, which downloads
`https://davidmegginson.github.io/ourairports-data/airports.csv`. Sibling §6.3's
`airportsMock` is reused as-is.

### 8.2 The four CLI-script test files import dynamically

Static `import` runs at file-load time, before any hook — so a static import of a
script module whose guard regressed would run `main()` against
`process.cwd()/flights.db`, the user's real logbook. Frozen pattern (proven in
§1.6):

```ts
let scratch: ScratchDb;
let restoreEnv: () => void;

beforeEach(() => {
  scratch = createScratchDb();
  restoreEnv = useScratchDbEnv(scratch.file);   // the script calls initDb() with no argument
  vi.resetModules();                            // each test gets a fresh module instance
});
afterEach(() => { restoreEnv(); destroyScratchDb(scratch); });

it('recomputes a duration from the track', async () => {
  const mod = await import('../src/backfill-durations');   // dynamic: after the env is set
  …
});
```

Note the ordering constraint this creates: `createScratchDb()` opens the scratch
file through `initDb(file)`, and the script's own `main()` will call `initDb()`
again (no argument → the env path → the same file). That is fine and intended —
the second `initDb()` replaces the module handle with a second connection to the
same file. `destroyScratchDb()` closes whichever handle is current and removes
the directory either way.

### 8.3 The suite-wide safety net

`tests/setup.ts` gains **one** top-level statement, before its existing
`beforeEach`:

```ts
// Nothing in the suite may resolve to the repository's real flights.db. Tests
// that need a database create their own scratch file and point this at it; this
// default only has to be somewhere harmless.
process.env.FLIGHTS_DB_PATH ??= path.join(os.tmpdir(), `msfslogger-test-fallback-${process.pid}.db`);
```

`??=` so an operator running `FLIGHTS_DB_PATH=… npm test` (the §3.3 check) still
wins. `setupFiles` run before the test file is imported, so this is in place even
for a static import of a module whose guard regressed. `tests/` is not compiled
into `dist/` and not copied into the Docker image, so this never reaches
production.

This **amends sibling §10.6** ("No environment variables. Nothing reads
`process.env` and no script sets one") for this run and this variable only. The
rationale there was reproducibility — a suite that behaves differently under
`CI=true`. This sets a deterministic per-process value with no branch on it, and
buys a hard guarantee about the user's logbook. Every other part of §10.6 stands:
no test branches on an environment variable, and `npm test` takes no arguments.
The sibling design's §10.6 should get a pointer to this section in a follow-up
(§15.5).

### 8.4 Still in force from the sibling design

No network (sibling §10.1), no writes inside the repository (§10.3 — scratch
files live under `scratchDbRoot()`), fixtures read read-only by explicit filename
(§10.4), fake timers for anything clock-reading (§5), no ordering dependence
(§10.5), the user's server untouched (§10.8). A db test is not an exemption from
any of them; it is an exemption from §10.2's "no `better-sqlite3`" only, and
only for a scratch file.

---

## 9. `src/setPassword.ts` — the seam, and what stays uncovered

### 9.1 The seam: one `export` keyword

```ts
export function parseUsername(argv: string[]): string   // src/setPassword.ts:31 — body unchanged
```

That is the entire change to this file besides §4's guard. `fail`,
`promptHidden`, `readFirstLine`, `main` and `USAGE` stay private, and no body is
touched.

### 9.2 Why nothing is extracted from `main()`

`main()`'s inline checks — username length, `PASSWORD_MIN_LENGTH`,
`PASSWORD_MAX_LENGTH`, blank password, confirmation mismatch — are **not**
extracted into testable functions. The intake froze: "The `require.main ===
module` guard on the three CLI scripts is the only behavior-preserving
structural change; nothing else about how those scripts run from `node dist/...`
changes." Extracting and re-wiring validation is a structural change to a file
whose failure mode is "the operator cannot log in", and the value on offer is
low: the constants and the hash format are already covered by
`tests/password.test.ts`, and the checks are five one-line comparisons with no
branching interaction. Pulling them out would also need `main()` to keep the
exact message strings, which is where the real risk lives.

Accepted coverage gap, recorded in §15.3. If a later run wants it, the move is a
`validatePassword(password: string): string | null` returning the message —
deliberately not made now.

### 9.3 What the test may do

`tests/setPassword.test.ts` covers `parseUsername` directly, plus §4.3's guard
witness. `parseUsername` calls `process.exit` through `fail()`, which would kill
the Vitest worker, so each failure-path test stubs it **in that file** (no shared
helper — one caller):

```ts
const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  throw new Error(`process.exit(${code})`);
}) as never);
```

`console.error`/`console.log` are already stubbed by `tests/setup.ts`.
Behaviours to pin: the default `'operator'`; `--username x` and `--username=x`;
the `.trim()` on the result; `--username` with no value → exit 1;
`--password` / `--password=…` → exit 1 with the "never takes a password as an
argument" message; `--help` / `-h` → prints `USAGE` and exit 0; an unrecognised
argument → exit 1. No test touches stdin, `promptHidden`, `readFirstLine`,
`hashPassword`'s cost, or the `auth_user` table through this module.

---

## 10. The two `src/backfill-*.ts` scripts

### 10.1 `src/backfill-durations.ts`

Seam — two `export` keywords and §4's guard, no body changes:

```ts
export const MIN_DIFF_SEC = 120;          // :18
export function fmt(sec: number): string  // :20
export function main(): void              // :28
```

`main()` is exported because the decision this script makes — recompute from the
track, drop any gap longer than `MAX_COUNTED_GAP_MS`, skip when the difference is
within `MIN_DIFF_SEC`, write only under `--apply` — lives entirely inside it and
is worth a test. The test drives it through §8.2's dynamic-import pattern, with
`process.argv` stubbed for the `--apply` branch, against a scratch database
seeded with `seedFlight` + `seedPoints`.

Behaviours to pin: a flight whose points contain a gap longer than
`MAX_COUNTED_GAP_MS` has that gap excluded; a flight with fewer than two points
or a `NULL` `duration_sec` is skipped; a difference `<= MIN_DIFF_SEC` is left
alone; **without `--apply` the rows are unchanged** (the dry run is the
load-bearing safety property); with `--apply` exactly the listed rows change and
nothing else does; `fmt()` at `< 1 h` and `>= 1 h`.

`MAX_COUNTED_GAP_MS` is imported from `src/flightManager.ts` and is **not**
redefined in the test — read it from the module, so a change to the constant
moves the test with it.

### 10.2 `src/backfill-icao.ts`

Seam — one `export` keyword and §4's guard:

```ts
export async function main(): Promise<void>   // :14
```

This file's test is the one place a real scratch database and a mocked module
coexist (§8.1): `main()` calls `await initAirports()`, which reads
`airports.json` from the working directory or **downloads 2.4 MB over the
network**. The test mocks `../src/airports` with sibling §6.1's factory shape and
sibling §6.3's `airportsMock`, setting `findNearestAirport` per test. It does
**not** mock `../src/db`.

Behaviours to pin, against a seeded scratch database: a flight with departure
coordinates and no `departure_icao` gets both icao and name; a flight that
already has an icao but no name gets **only** the name updated (the
`updateNameDep`/`updateNameArr` branch — an existing icao is never overwritten);
a flight with no coordinates is not selected at all; `findNearestAirport`
returning `null` leaves the row untouched; the "All flights already have ICAO
codes" early return runs on an empty selection. Assert on the rows with raw SQL,
not on the console output.

---

## 11. `src/pdfExport.ts` — the scope decision

### 11.1 In scope

Three things, all proven reachable with no browser and no network (§1.7):

1. **`appendPdfs(base, attachmentPaths)`** — already exported; uses only `fs` and
   `pdf-lib`. This is the most valuable test in the file: the rule "one bad
   attachment must degrade to 'plan omitted', never fail the export"
   (`src/pdfExport.ts:184-187`) is a real product promise with a `catch` that
   nothing currently checks.
2. **`baseUrl()`** — becomes `export function baseUrl(): string`
   (`src/pdfExport.ts:22`), **body unchanged**. One new export, nothing else in
   the module changes. Its three-way derivation — `EXPORT_BASE_URL` wins;
   otherwise scheme from `getConfig().tls.enabled`; otherwise
   `http://127.0.0.1:${PORT ?? '3000'}` — is exactly the kind of precedence rule
   that breaks silently, and `loadConfig()` is callable in a test
   (§1.7, measured).
3. **`closeBrowser()` when no browser was ever launched** — resolves, launches
   nothing, clears no timer. One test, pins the early return at `:76`.

### 11.2 Out of scope, and why

`renderPdf`, `renderOnce`, `getBrowser`, `touchIdleTimer` and the disconnect
handler. **No test may call `puppeteer.launch()`, start a browser, or make a
network request** — including a request to `127.0.0.1:3000`, which is the user's
live server (`.claude/ENVIRONMENT.md`) and therefore doubly forbidden.

A mocked-`puppeteer` test of `renderOnce()` (fake `launch`/`newPage`/`page.pdf`)
was considered and rejected — see §13.4.

### 11.3 The pdf-lib trap, frozen

`PDFDocument.load()` defaults to `updateMetadata: true` and **rewrites Producer
and ModDate on load**. A test that asserts `appendPdfs` set the producer must
read back with `PDFDocument.load(out, { updateMetadata: false })`, or it will see
`pdf-lib (https://github.com/Hopding/pdf-lib)` and blame `src/pdfExport.ts`
(§1.7 — this happened in the prototype). `src/pdfExport.ts:190`'s
`doc.setProducer('msfslogger')` is correct; do not change it.

Test inputs are built in-process with `PDFDocument.create()` — no PDF fixture
files are committed, and nothing reads the user's `flight_plans/`. Corrupt input
is `Buffer.from('not a pdf at all')`. Temp files go under the same
`msfslogger-test-` prefix and are removed in `afterEach` (sibling §10.3).

### 11.4 Environment hygiene

`baseUrl()` reads `EXPORT_BASE_URL` and `PORT`. A test that sets either must
restore the previous value in `afterEach`, and `loadConfig()` must be called with
an **explicit env object** — `loadConfig({ INGEST_TOKEN: 'x'.repeat(20),
BIND_HOST: '127.0.0.1' })` — never with `process.env`, so the configuration
cache is deterministic. `loadConfig()` caches into a module-level singleton that
`getConfig()` reads; a file that calls it must call it in `beforeEach`, not once
at module scope.

---

## 12. What this design does not re-decide

Pull these from the sibling run instead of inventing a second answer:

```
.claude/tools/ctx.sh design 2026-09-09-vitest-unit-tests 1 4 6 7 10
```

| Topic | Where |
|---|---|
| Runner, the exact `vitest@4.1.11` pin, the install procedure, the hard `better-sqlite3` rebuild rule | sibling §1 (and §1.4 in particular) |
| File layout, `tests/**/*.test.ts`, why not colocated, `tsconfig.test.json` | sibling §2 |
| `vitest.config.ts` — frozen, **not edited by this run** | sibling §3 |
| `tests/helpers/index.ts` — builders, geometry constants, named airports, `T0` | sibling §4 |
| Fake timers and the advance-then-feed pattern | sibling §5 |
| The `vi.mock` factory shape (`async () => (await import('./helpers')).dbMock`) and why the naive form throws | sibling §6.1 |
| The `./db` stub's ten functions and their defaults | sibling §6.2 |
| The `./airports` stub | sibling §6.3 |
| `resetMocks()` and why `restoreMocks` is not enough | sibling §6.4 |
| The "source changes only where a seam is unavoidable" rule | sibling §7.1 |
| Determinism and hermeticism | sibling §10 — with the two exceptions this design names: §7/§8 (a real scratch database, amending §10.2's "no `better-sqlite3`") and §8.3 (`FLIGHTS_DB_PATH`, amending §10.6) |

Source seams this run adds, in full: `resolveDbPath` + `initDb`'s optional
parameter (§5.2), `runBackup`/`human`/`stamp` (§6.2), `parseUsername` (§9.1),
`MIN_DIFF_SEC`/`fmt`/`main` (§10.1), `main` (§10.2), `baseUrl` (§11.1), and the
four guards (§4.1). **Nothing else under `src/` changes.** A task that believes
it needs another source change returns `blocked` and says why.

---

## 13. Alternatives considered

### 13.1 The environment variable's name

| Option | Why not |
|---|---|
| `DB_PATH` (the intake's example) | Generic enough to already exist in a shared shell, a `.env` file or a sibling container in the same compose project. A stray value points the logbook at a foreign database that `initDb()` then runs `CREATE TABLE IF NOT EXISTS` against. The blast radius of a name collision here is the user's data. |
| `MSFSLOGGER_DB_PATH` | Safe, but no other variable in this codebase carries an app prefix (`INGEST_TOKEN`, `TLS_CERT_FILE`, `EXPORT_BASE_URL`, `SIMBRIEF_API_BASE_URL`), and one odd one out is how conventions rot. |
| **`FLIGHTS_DB_PATH`** (chosen) | Names the file it overrides, matches the existing "name the thing" style, and is specific enough that a collision is implausible. |

### 13.2 How `src/backup.ts` gets its three paths

| Option | Why not |
|---|---|
| Three environment variables (`FLIGHTS_DB_PATH`, `FLIGHT_PLANS_DIR`, `BACKUP_ROOT`) | `src/flightPlans.ts` owns `flight_plans/` and is out of scope, so a `FLIGHT_PLANS_DIR` only `backup.ts` honoured would let an operator back up a directory the server does not use — a silent, data-shaped failure. Half-wired configuration is worse than none. |
| One "data root" variable both the db and the plans hang off | Changes the meaning of the db path for every existing deployment, including the `./flights.db:/app/flights.db` bind mount in `docker-compose.yml`. Not additive. |
| **`resolveDbPath()` for the database + `runBackup(opts)` parameters for the other two** (chosen) | One environment seam in the whole run; the other two paths are testable without any new production surface; `main()` keeps computing today's defaults from `process.cwd()`. §6.2. |

### 13.3 Where the scratch-database harness lives

| Option | Why not |
|---|---|
| Extend `tests/helpers/index.ts` (sibling §4.1's "one file, one owner") | `index.ts` is what the `vi.mock('../src/db')` factory resolves. Importing the real `../../src/db` from it would drag `better-sqlite3` into every mocked test file and put the real database module inside the fake one. §7.1. |
| `:memory:` databases | No real path for `db.backup()`, no WAL, and `closeDb()`'s checkpoint becomes untestable. §7.2. |
| Keep a single database for the whole suite | Cross-file state, ordering dependence, and `isolate: true` already gives a process per file anyway. |
| **A new `tests/helpers/db.ts`, fresh database per test, on a tmpfs** (chosen) | 3.5 ms per test measured (§1.3), full isolation, and the real `initDb()` on the production path. |

### 13.4 A mocked-`puppeteer` test of `renderOnce()`

Rejected. It needs fakes for `launch`, `newPage`, `setViewport`,
`emulateMediaType`, `setUserAgent`, `setCookie`, `goto`, `waitForFunction`,
`evaluate`, `pdf`, `close` and the `disconnected` event — a dozen surfaces whose
fidelity nobody can check, testing a function whose interesting behaviour
(readiness polling, tile loading, page size) is precisely the part the fake
removes. The cookie-scoping logic at `:111-122` is the one piece worth pinning,
and it is not worth a dozen fakes to reach. Recorded as a possible later run with
a real browser behind a tagged, opt-in suite — not this one. §11.2.

### 13.5 `initDb()` — environment variable only, or a parameter too

Environment-only would have worked (vitest's default `forks` pool gives one
process per test file, §1.5), but it makes every db test mutate global state and
depend on a pool default this project does not set. The optional parameter costs
one token in the signature, keeps `src/index.ts` byte-identical in behaviour, and
lets the harness be completely side-effect-free. Both layers are the *same*
resolution rule, stated once in §5.3 — that is one convention, not two.

---

## 14. Must-not-change list

The Reviewer checks these one by one.

1. **`node dist/backfill-durations.js`, `node dist/backfill-icao.js`,
   `node dist/setPassword.js` and `npm run backup` still run `main()`**, with the
   same stdout/stderr text, the same exit codes, and the same argv handling
   (`--apply`, `--username`, `--password` rejection, `--help`, `backup`'s
   positional destination). §4.
2. **`initDb()` with no argument and no `FLIGHTS_DB_PATH` opens
   `path.join(process.cwd(), 'flights.db')`** — the same file, computed the same
   way, with the same `journal_mode = WAL` and `foreign_keys = ON` pragmas in the
   same order, followed by the same `applySchema()` call. §5.2.
3. **`closeDb()` and `getDb()` are untouched**, including the
   `wal_checkpoint(TRUNCATE)` best-effort and its comment. §5.2.
4. **`src/db/schema.ts` is not edited.** No DDL change anywhere in this run. §3.1.
5. **`src/index.ts`, `src/server.ts`, `src/routes/**`, `src/types.ts`,
   `src/config.ts` and every `src/inspect-*.ts` are not edited**, and the
   inspectors' `chdir`-then-`require('./db')` idiom keeps working. §5.4, §12.
6. **`vitest.config.ts` is not edited**, and `npm test` still takes no
   arguments. The only test-infrastructure change is one `??=` line in
   `tests/setup.ts` plus the new `tests/helpers/db.ts`. §8.3.
7. **`tests/helpers/index.ts` is not edited** and does not gain a dependency on
   `tests/helpers/db.ts` or on `better-sqlite3`. §7.1.
8. **The 493 tests that pass today still pass**, and `npm run test:types`,
   `npx tsc` and `npm run build` stay clean.
9. **`npm run backup`'s output format** — the three `console.log` lines,
   character for character — and its behaviour when the database is missing (exit
   1, nothing created) and when `flight_plans/` is absent (`0 file(s)`, no
   throw). §6.2.
10. **`src/pdfExport.ts`'s rendering path is untouched**: `renderPdf`'s
    serialising queue, `getBrowser`'s launch arguments, the idle shutdown, the
    readiness poll, the cookie jar. The only edit is `export` on `baseUrl`. §11.
11. **The user's `flights.db` is never opened by a test**, and no task opens it
    read-write. §3.3 names the check that proves it.
12. **The user's server on port 3000 is not stopped, restarted or rebuilt
    over.** `.claude/ENVIRONMENT.md`.

---

## 15. Risks

### 15.1 The scratch root is machine-dependent

`scratchDbRoot()` returns `/dev/shm` here and `os.tmpdir()` elsewhere — a 100×
difference in per-test cost (§1.3). On a machine without a tmpfs a 40-test db
suite costs ~16 s instead of ~0.2 s. That does not make it wrong, but it makes
"the suite is fast" a claim about this box. Falsified by: a contributor on macOS
reporting a slow suite. Mitigation already frozen: §7.6's per-file variant,
0.33 ms per reset.

Docker's default `/dev/shm` is 64 MB, which is ample for a ~400 KB schema-only
database, but a suite that ever leaks scratch directories would exhaust it. §7.6
makes teardown mandatory for that reason.

### 15.2 The guard is only as good as its test

If someone later deletes the guard from one of the four files, that file's tests
would run `main()` on import. §8.2's dynamic import plus §8.3's `tests/setup.ts`
default mean the damage lands on a temp file rather than the user's logbook, and
§4.3's `getDb() === undefined` test fails loudly. Three independent defences,
because the failure mode is "the agent's test suite wrote to the user's real
logbook".

### 15.3 Accepted coverage gaps

`src/setPassword.ts`'s `main()` (its validation messages and the
confirm-mismatch path), `promptHidden`, `readFirstLine`; `src/pdfExport.ts`'s
entire render path; `src/flightPlans.ts`'s fs-touching functions (already out of
scope in the sibling run). Each is a deliberate decision in §9.2, §11.2 and the
intake respectively — not an oversight. A later run that wants them should say so
explicitly rather than discover them missing.

### 15.4 `FLIGHTS_DB_PATH` is a new user-facing setting with no in-tree doc

`README.md:71-73` points at the GitHub wiki for "all environment variables",
which is outside this repository, so no in-tree documentation task exists and
none is created. The variable is documented by the doc comment on
`resolveDbPath()` (§5.2). The wiki page should gain a row —
`FLIGHTS_DB_PATH`, default `./flights.db`, "path to the logbook database;
`npm run backup` follows it" — and that is a report item for the Orchestrator,
not a task.

### 15.5 Stale comments this design leaves behind

Three inspectors state, in prose, that `src/db/connection.ts` "freezes DB_PATH at
module load" — `src/inspect-kml.ts:18-22`, `src/inspect-acars.ts:17-20`,
`src/inspect-legmatch.ts` (~`:404-423`). After §5.2 that sentence is false,
though the code it justifies still works. Those files are out of scope and **no
task in this run edits them**; a tier-1 comment-only fix afterwards is the right
shape. Likewise, sibling §10.2 and §10.6 now have documented exceptions (§7, §8.3)
that live only in *this* document.

### 15.6 Two connections to one scratch file

§8.2's CLI-script pattern deliberately has the harness and the script each call
`initDb()` against the same file. SQLite in WAL mode handles that, and the
prototype exercised the shape, but a test that asserts on rows *while* the
script's connection is open must read through the current handle (`getDb()`),
not through the one `createScratchDb()` returned, or it may read a stale
snapshot. Stated here so it is a known rule and not a two-hour debugging session.

### 15.7 No DevOps step is needed

The intake asked for this call explicitly. The seam adds no CI wiring, no new
npm script, no `vitest.config.ts` change and no new dependency: `better-sqlite3`
is already a production dependency, `pdf-lib` and `puppeteer` are already
installed, and `tests/` is excluded from `dist/` and from the Docker build
context already. **Ship/DevOps stays skipped for this run** unless a reviewer
finds otherwise. The one shared-infrastructure edit — `tests/setup.ts`'s `??=`
line — belongs to T-006 along with the harness.

---

## 16. Which section each task pulls

| Task | Slice |
|---|---|
| T-006 (seam + harness) | `ctx.sh design 2026-09-15-vitest-coverage-expansion 5 7 8` |
| T-008 – T-011 (`src/db/*.ts` tests) | `ctx.sh design 2026-09-15-vitest-coverage-expansion 2 7 8` |
| T-012 (`src/backup.ts`) | `ctx.sh design 2026-09-15-vitest-coverage-expansion 4 6 7` |
| T-013 (the three CLI scripts) | `ctx.sh design 2026-09-15-vitest-coverage-expansion 4 8 9 10` |
| T-014 (`src/pdfExport.ts`) | `ctx.sh design 2026-09-15-vitest-coverage-expansion 11` |
| T-007, T-015 (reviews) | `ctx.sh design 2026-09-15-vitest-coverage-expansion 3 14 15` plus the sections of the tasks under review |

Contracts: `.claude/runs/2026-09-15-vitest-coverage-expansion/contracts/db-harness.d.ts`
(§7.4, §7.5) and `contracts/source-seams.d.ts` (§5.2, §6.2, §9.1, §10, §11.1).
Prototypes, runnable as described in §1:
`.claude/runs/2026-09-15-vitest-coverage-expansion/prototypes/`.
