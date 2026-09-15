# T-006 review — round 2 (targeted re-check)

**Verdict: approve**

Scope: re-verify the single blocking finding from round 1
(`reviews/phase-2.md`) — `SeedAcarsMessage.correlation_id` typed
`string | null` instead of `number | null`. Full phase-2 evidence pass not
redone; nothing in this fix touches it.

## Diff read directly (not from the report)

Both files under review are untracked (new files), so there is no git diff to
show; read in full instead:

- `.claude/runs/2026-09-15-vitest-coverage-expansion/contracts/db-harness.d.ts`
  line 144: `correlation_id: number | null;` in `SeedAcarsMessage`. Confirmed.
- `tests/helpers/db.ts` line 313: same field, same type, in the local
  `SeedAcarsMessage` interface; line 324, default value `correlation_id: null`
  (compatible with either type, not diagnostic on its own).

Checked for string-typed residue in both files: no template-string
interpolation of `correlation_id`, no `.toString()`, no comparison against a
string literal. `seedAcarsMessage`'s insert goes through better-sqlite3's
`@correlation_id` named parameter binding (`stmt.run(row as unknown as
Record<string, unknown>)`), which accepts the JS value as-is — a `number |
null` field binds as SQLite INTEGER/NULL, matching the real column.

Cross-checked against the rest of the tree (`grep -rn correlation_id
src/ tests/`): `src/types.ts:358` and `:378` (`number | null` /
`number | null | undefined`-ish), `src/db/schema.ts:241`
(`INTEGER REFERENCES acars_messages(id)`), `src/routes/acars.ts` (assigns
`requestMessage.id` / `requestResult.message.id`, both numeric row ids),
`src/db/acarsMessages.ts` (passes `msg.correlation_id` straight through as a
bound param). All consistent with `number | null`. No test in
`tests/db/connection.test.ts` or `tests/db/schema.test.ts` passes a string for
this field — grep confirms no other reference to `correlation_id` in either
test file, so the fix required no test edits, matching the report.

## Commands re-run independently

- `npx vitest run tests/db/connection.test.ts tests/db/schema.test.ts` →
  `Test Files  2 passed (2)` / `Tests  13 passed (13)`.
- `npm run test:types` → exit 0 (`tsc -p tsconfig.test.json`, no output).
- `npx tsc --noEmit` → exit 0.
- `npm test` (full suite, sanity per instructions) →
  `Test Files  25 passed (25)` / `Tests  506 passed (506)`.

All under Node 20 (`nvm use 20`), per `.claude/ENVIRONMENT.md`.

## Live database

`md5sum flights.db` before: `1a945a18cd3286788c2421689c462038`.
After the full run: `1a945a18cd3286788c2421689c462038`. Unchanged — the
Vitest suite is hermetic as documented, confirmed rather than assumed.

## Disposition

The single round-1 blocking finding is fixed and independently confirmed.
No new findings. T-006 approved.
