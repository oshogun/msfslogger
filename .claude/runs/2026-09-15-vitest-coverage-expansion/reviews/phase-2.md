# Phase 2 review — T-006 (DB_PATH seam + scratch-sqlite harness)

## Verdict: request_changes

One blocking finding: the frozen `SeedAcarsMessage.correlation_id` type
(`string | null`) contradicts the real schema and the app's own type for the
same column. T-006 implemented the frozen contract faithfully — this is a
design defect it inherited, not an implementation mistake — but it must be
corrected in `tests/helpers/db.ts` (and the contract file) before T-010 builds
on it. Everything else T-006 shipped is correct and independently verified.

## Criteria verified independently (not from the implementer's report)

1. **`FLIGHTS_DB_PATH=/nonexistent-directory/flights.db npm test`** — ran it:
   `Test Files 25 passed (25)` / `Tests 506 passed (506)`, exit 0. This, not a
   live-db md5 diff, is the evidence design.md §3.3 requires.
2. **`grep -rn "flights\.db" tests/`** — only scratch-path literals in
   `tests/db/*.ts` and `tests/helpers/db.ts`. **`grep -rn "process.cwd()" tests/`**
   — 3 matches, all in `tests/flightPlans.test.ts` (`flightPlanPath()`
   assertions), added in commit `35e16707` (2026-09-09), six days before this
   run and outside T-006's `allowed_paths`. Confirmed pre-existing/unrelated via
   `git log --follow -p -- tests/flightPlans.test.ts`, not taken on the
   implementer's word.
3. **Diff of `src/db/connection.ts`** (`git diff -- src/db/connection.ts`):
   `DB_PATH` constant deleted; `resolveDbPath()` reads
   `process.env.FLIGHTS_DB_PATH || path.join(process.cwd(), DEFAULT_DB_FILENAME)`
   per call; `initDb(dbPath: string = resolveDbPath())`. For a caller passing
   nothing / setting nothing, this resolves to the same value the old
   module-level constant did — default behavior unchanged. `closeDb()`/`getDb()`
   untouched (not in the diff at all).
4. **Scratch-harness leak check, my own script** (not T-006's test files): wrote
   `tests/db/__reviewer_scratch_leak_check.test.ts` calling
   `createScratchDb()` → insert a row (forces a `-wal` file) → `destroyScratchDb()`,
   asserting `fs.existsSync` on dir/file/`-wal`/`-shm`. `1 test passed`; all four
   `existsSync` checks `false` after teardown. Deleted the scratch file
   afterward — `ls tests/db/` shows only `connection.test.ts`, `schema.test.ts`.
5. **`npx vitest run tests/db/connection.test.ts tests/db/schema.test.ts`** —
   `Test Files 2 passed (2)`, `Tests 13 passed (13)`, exit 0.
6. **`npm run test:types`, `npx tsc --noEmit`, `npm run build`** — all exit 0.
   `flights.db` md5 `1a945a18cd3286788c2421689c462038` identical before/after
   (recorded per convention; not treated as proof of anything per §3.3).
7. **Read `tests/db/schema.test.ts` and `tests/db/connection.test.ts` in
   full**: idempotency asserted (apply twice, same table list, row count
   unchanged); two ALTER-TABLE branches exercised (hand-built pre-migration
   `flights` missing `trip_id`/`planned_leg_id`/etc., and `trips` missing
   `is_active`) — matches the acceptance criterion exactly. `connection.test.ts`
   proves argument > env > default precedence and that an explicit path wins
   even when `FLIGHTS_DB_PATH` points elsewhere (decoy file never created).

All six T-006 acceptance criteria and both of T-007's re-check items verified
against the diff and live output — not the report.

## Blocking finding

**`SeedAcarsMessage.correlation_id: string | null`** in
`contracts/db-harness.d.ts` and `tests/helpers/db.ts:305-325` does not match:

- `src/db/schema.ts:241`: `correlation_id INTEGER REFERENCES acars_messages(id) ON DELETE SET NULL`
  — a self-referential FK to another message's integer row id.
- `src/types.ts:358,378`: `correlation_id: number | null` — the app's own type
  for the identical column.
- The real writer, `src/routes/acars.ts:201/210/221/281`:
  `correlation_id: requestMessage.id` (a number).

Empirically checked with better-sqlite3 under Node 20 (`node -e` against a
throwaway table with the same DDL): a numeric-string value (`String(id)`) is
silently coerced to INTEGER by column affinity and passes the FK check; a
non-numeric string is rejected with `FOREIGN KEY constraint failed`. So the
seeder "works" only by an affinity accident for the one caller pattern that
happens to pass a stringified id — every other use of the `string`-typed field
(the natural reading, given `dedup_key` next to it is a genuinely free-form
string) is a footgun.

Nothing calls `seedAcarsMessage` with a non-null `correlation_id` yet (T-006's
own tests don't touch it; default is `null`, which is valid under either type)
— so this is inert today. It is not inert for T-010 (`tests/db/acarsMessages.ts`
coverage), which is next in line to seed exactly this reply-threading column;
the schema comment ("The request this row replies to") makes it near-certain
T-010 needs a non-null value. Shipping the mistyped contract forward means
T-010 either fights spurious FK errors or silently relies on affinity coercion
nobody asked for.

**Disposition:** route back to T-006 (backend_sr, same file owner — `tests/helpers/db.ts`
and the contract file). Fix: `correlation_id: number | null` in
`SeedAcarsMessage` (both the `.d.ts` contract and the implementation), default
stays `null`. This is a one-line-type design amendment, not new scope.

## Scope

Diff limited to `allowed_paths`: `src/db/connection.ts` (modified),
`tests/helpers/db.ts` (new), `tests/db/connection.test.ts` (new),
`tests/db/schema.test.ts` (new). `tests/helpers/index.ts` untouched (per
must-not-change §7). `src/db/schema.ts` untouched (§14.4).

## Non-blocking observations (do not block this task)

- The working tree has unrelated, uncommitted modifications to `src/acars.ts`,
  `src/routes/acars.ts`, `src/server.ts`, `src/types.ts` (~198 lines) that
  predate this run and are outside every task's `allowed_paths` — WIP on top of
  the already-committed `8ab0cac` ACARS dispatch feature. Not T-006's doing; a
  broad `git add`/commit on this run should not sweep it in.
- No stale-comment or run-citation issues found in the new files.

## Must-not-change (§14), spot-checked

Items 2, 3, 4, 7, 11 checked directly above. Items 1, 9, 10 are T-012/13/14
territory (untouched by T-006, confirmed by `allowed_paths`); not re-verified
here as none of those files are in this diff.
