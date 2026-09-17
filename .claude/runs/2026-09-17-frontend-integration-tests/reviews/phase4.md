# Phase 4 review — T-010 (CI wiring)

**Verdict: approve.** This is the last review in the run — the run is cleared
for Ship/Report.

## T-010 verdict: approve

All 5 of T-010's own acceptance criteria verified independently (not from its
report — the report was not opened). Verification ran in a scratch clone at
`/tmp/.../T011-verify` (rsync of the working tree, including `.git` so the
in-script `git ls-files` guard resolves, excluding `node_modules`/`dist`/
`flights.db*`/`backups`/`certs`/`start.sh`/`server.log`), Node 20.20.2, never
this checkout's server or `flights.db`.

1. **Commands run by hand, scratch clone, succeed.**
   - `npm run build` (root): exit 0, emitted `index-BI1xHYYp.css` /
     `index-BV756Q20.js` — same hashes as the must-not-change §1 evidence.
   - `npm run test:types && npm test` (root): `Test Files 38 passed (38) /
     Tests 850 passed (850)`.
   - `cd client && npm run test:types`: exit 0, no output (clean).
   - `cd client && npm test`: `Test Files 5 passed (5) / Tests 14 passed (14)`.
   - `npx playwright install chromium` (no `--with-deps`; this sandbox has no
     root/sudo, unlike a GitHub runner) then `npm run test:e2e`
     (`MSFSLOGGER_E2E_SCRATCH` set to a scratch temp dir): webServer log shows
     `No TLS configured — serving plaintext HTTP on loopback only.` /
     `[HTTP] Server running at http://127.0.0.1:3210`, DB path
     `.../T011-e2e-scratch/e2e.db` — **`18 passed (42.1s)`**.
2. **Diff shape.** `.github/workflows/ci.yml` diff (`git diff`) is a pure
   append: two named steps on `build-and-test` after the existing `Run tests`,
   then one new `e2e` job — byte-for-byte the block frozen in design §5.1/§5.2.
   `ls .github/workflows/` → `ci.yml` only, no second file.
3. **Reporter + artifact.** `playwright.config.ts` (already-frozen, from an
   earlier phase, re-checked here) configures `html`/`junit`. After the run,
   `client/playwright-report/index.html` (533 KB) and
   `client/test-results/junit.xml` exist on disk at exactly the paths the two
   `upload-artifact@v4` steps reference.
4. **A failure fails the job.** Edited one assertion in
   `e2e/specs/smoke.spec.ts` (wrong heading text) in the scratch clone, ran
   `npx playwright test e2e/specs/smoke.spec.ts` → `1 failed`, `EXIT=1`.
   Reverted via a kept backup, `diff` confirmed clean revert. Not committed.
   Neither `run:` step in the diff carries `continue-on-error`/`|| true`, so
   this exit code fails the job as-is.
5. **`package.json`.** `git diff package.json` — exactly two added lines,
   `"test:client": "cd client && npm test"` and `"test:e2e": "cd client && npm
   run test:e2e"`, matching design §1.5 verbatim; `"test": "vitest run"`
   unchanged (present unmodified in the diff context, not touched).

## Design conformance (§4, §5)

- **Step ordering, `build-and-test`**: all 7 existing steps unchanged and in
  order (checked against must-not-change item 10); the 2 new steps
  (`Typecheck client tests`, `Client component tests`) appended after `Run
  tests`, matching §5.1 exactly (`git diff` above).
- **`e2e` job shape**: `runs-on: ubuntu-latest`, `needs: build-and-test`, then
  checkout → setup-node(`.nvmrc`) → `Install root dependencies` (`npm ci`) →
  `Install client dependencies` (`cd client && npm ci`) → `Install Playwright
  browser` (`npx playwright install --with-deps chromium`) → `Run end-to-end
  tests` (`cd client && npm run test:e2e`) → two conditional uploads — step
  names, order and commands are identical to design §5.2's code block, checked
  line by line against `.github/workflows/ci.yml` on disk.
- **Env vars**: the `e2e` job sets exactly one env var,
  `MSFSLOGGER_E2E_SCRATCH: ${{ runner.temp }}/msfslogger-e2e`, matching §5.2 —
  `PORT`, `BIND_HOST`, `FLIGHTS_DB_PATH`, `TLS_CERT_FILE`/`TLS_KEY_FILE` are
  **not** set in the workflow; they're set inside `scratch-server.sh` (§4.2,
  unmodified in this diff, `PORT` from `MSFSLOGGER_E2E_PORT` only — never an
  inherited `PORT` — `BIND_HOST=127.0.0.1`, `FLIGHTS_DB_PATH=$SCRATCH/e2e.db`,
  TLS vars unset for the loopback-plaintext path per §4.3). This is what §5
  itself specifies — the workflow never needs those vars directly. Confirmed
  by the live run: the actual server process picked up port 3210 and
  `$SCRATCH/e2e.db`, never 3000/`flights.db`.
- **Reporting**: `if: ${{ !cancelled() }}` on the HTML report (visible on pass
  *and* fail, per §5.3's stated rationale) vs. `if: failure()` on the
  traces/JUnit artifact (fail-only, to keep green runs cheap) — both match
  §5.3 exactly; confirmed these are the literal conditions in the diff, not
  paraphrased.
- **No Dockerfile change**: `git status --short` shows `Dockerfile` untouched
  by this diff, matching §5.5 and must-not-change item 11.

## Must-not-change list — re-checked

1. Live server/`client/dist` untouched: `md5sum client/dist/index.html` after
   my full scratch e2e run (which itself rebuilds `client/dist` — but only
   inside the scratch copy) → `2bc39f5beda19389908e20ffbf12415c`, the exact
   value cited in the design's own evidence for this file, unchanged.
2. `flights.db` never opened for writing: `md5sum flights.db` →
   `d7b2a00eb72f9354dce759c3ccac9a3f`, one of the two values the design's own
   P6 evidence records as unchanged across full e2e runs (§4.4) — i.e. this is
   WAL-checkpoint noise already accounted for, not new contamination.
3. Root `npm test` stays the backend suite: confirmed, 38/38 files, 850/850
   tests, unchanged `vitest.config.ts`/`tsconfig.test.json` (not in this
   task's `allowed_paths`, not touched — `git status` shows no diff there from
   this task; any diff present pre-existed from an earlier phase).
10. `ci.yml`'s 7 existing steps, name and triggers: unchanged (see diff above).
11. `Dockerfile`: untouched.
12. No kill-by-pattern: nothing in this diff spawns or kills a process by
    name; Playwright owns webServer teardown (§4.5, unchanged).

## Scope

Both changed files (`.github/workflows/ci.yml`, `package.json`) are exactly
T-010's `allowed_paths`. `git status --short .github/workflows/ci.yml
package.json` shows only those two modified in this task's territory; other
working-tree modifications present (e.g. `client/package.json`,
`vitest.config.ts`) predate T-010 and belong to earlier, already-reviewed
phases — not this task's diff.

## Live-DB check (start/end of this review)

`md5sum flights.db` before this review's verification work and after: both
`d7b2a00eb72f9354dce759c3ccac9a3f` (unchanged; see must-not-change item 2
above — this is also the exact steady-state value the design's own P6
evidence records).

## Residual risk (non-blocking)

**Branch protection is not enabled by this diff and cannot be from a
workflow file.** The user still needs to, by hand, in the GitHub repo's
**Settings → Branches → Branch protection rules → (rule for `main`) → Require
status checks to pass before merging**, add `build-and-test` and `e2e` (and,
if wanted, the two new step names are not separately selectable — only job
names are offered as required checks) to the selected checks list. Until this
is done, a red `e2e` job is visible on the PR but does not block the merge
button.

## Scratch cleanup

Scratch clone (`.../scratchpad/T011-verify`) and e2e scratch dir
(`.../scratchpad/T011-e2e-scratch`) both removed after verification. No
process left listening on 3210 or 3100 (`lsof` checked, both free). The user's
`node dist/index.js` (pid 1143167) was never touched.
