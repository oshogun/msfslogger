# Ship report — T-010: wire client unit tests + Playwright e2e into CI

Run: `2026-09-17-frontend-integration-tests`. Scope: `.github/workflows/ci.yml`, `package.json` only.

## Live-resource safety

Never ran a build/server/test against this checkout. All verification ran in a
scratch clone (`rsync -a` of the working tree, `.git` included, minus
`node_modules`/`dist`/`client/dist`/`flights.db*`/`backups`/`certs`, so
untracked files like `client/e2e/**` and `src/testSeed.ts` came along —
`git status --short client/e2e src/testSeed.ts` in the real tree confirms
these are still uncommitted, per the background note). Live-checkout md5,
before and after all work:

```
d7b2a00eb72f9354dce759c3ccac9a3f  flights.db
2bc39f5beda19389908e20ffbf12415c  client/dist/index.html
```
Unchanged across the whole session (also `stat` mtime on `client/dist/index.html`
unchanged).

## Changes

1. **`.github/workflows/ci.yml`** — appended two steps to the existing
   `build-and-test` job (`Typecheck client tests`: `cd client && npm run
   test:types`; `Client component tests`: `cd client && npm test`), then added
   one new job `e2e` (`needs: build-and-test`) with checkout, setup-node,
   `npm ci` (root + client), `npx playwright install --with-deps chromium`,
   `cd client && npm run test:e2e` (env `MSFSLOGGER_E2E_SCRATCH:
   ${{ runner.temp }}/msfslogger-e2e`), and two `upload-artifact@v4` steps
   (`playwright-report` on `!cancelled()`, `playwright-test-results` on
   `failure()`). Text matches design §5.1/§5.2 verbatim. No second workflow
   file — one diff, one existing file. Parsed with Python `yaml.safe_load`:
   two jobs, step names in the exact frozen order.
2. **`package.json`** (root) — added exactly two lines per F-2:
   `"test:client": "cd client && npm test"`,
   `"test:e2e": "cd client && npm run test:e2e"`. The existing `"test":
   "vitest run"` line is untouched (diff shows only the two additions).

## Evidence per acceptance criterion

All commands run in the scratch clone
(`/tmp/.../scratchpad/ci-verify`), Node 20.20.2 (`nvm use 20`).

- **Client unit-test script** (`npm run test:client` = `cd client && npm
  test`): `Test Files 5 passed (5)`, `Tests 14 passed (14)`.
- **Typecheck client tests** (`cd client && npm run test:types`): exit 0, no
  output (clean `tsc -p tsconfig.test.json`).
- **Full seed+start+playwright+teardown** (`npm run test:e2e` = `cd client &&
  npm run test:e2e`, which drives `scratch-server.sh`: copy via `git
  ls-files --cached --others --exclude-standard`, `npm run build`, seed via
  `testSeed.js`, `exec node dist/index.js`): server log shows `No TLS
  configured — serving plaintext HTTP on loopback only`, `[DB] Database
  ready`, `[Airports] Loaded 29549 airports from cache`, `[Auth] Login OK for
  "e2e"`; Playwright: `18 passed (26.9s)` across all 4 specs (auth,
  data-viz, error-states, smoke). Reports produced:
  `client/playwright-report/index.html`, `client/test-results/junit.xml`
  (reporter config `[list, html{open:never}, junit]` already frozen in
  `playwright.config.ts` from an earlier phase — confirmed by reading it,
  not modified this task).
- **Workflow diff shape** — only `.github/workflows/ci.yml` touched, one
  file, jobs `[build-and-test, e2e]` per YAML parse; step lists match §5.1/§5.2
  exactly.
- **Failure fails the job** — reverted-before-commit, scratch clone only:
  - Vitest: broke one assertion in `client/src/pages/Home.test.tsx` →
    `npm run test:client` → `Test Files 1 failed | 4 passed (5)`, `exit=1`.
    Reverted; re-run: `14 passed (14)`. Byte-diff against the real checkout's
    (still-uncommitted) copy confirms a clean revert.
  - Playwright: broke one assertion in `client/e2e/specs/smoke.spec.ts` (added
    a doomed `expect(...).toBeVisible()` on a nonexistent selector) →
    `npm run test:e2e` → `1 failed`, `17 passed`, `exit=1`. Reverted; byte-diff
    against the real checkout's copy confirms a clean revert. Nothing from
    either break was committed.
- **package.json script wording and untouched `test`** — verified by reading
  the file: `"test": "vitest run"` unchanged; `"test:client"` and
  `"test:e2e"` present verbatim as specified in F-2, at their exact frozen
  text.

## One self-inflicted, non-shipping wrinkle

My first e2e verification attempt symlinked `client/node_modules` in the
scratch clone (for speed, to skip a fresh `npm ci`). `.gitignore`'s
`client/node_modules/` pattern is directory-only and doesn't match a symlink,
so `git ls-files --others --exclude-standard` (used internally by
`scratch-server.sh`, unmodified, from an earlier phase) picked up the
symlink and the script's own `ln -s` collided with it. This is an artifact of
my local-verification shortcut, not a defect in `scratch-server.sh` or this
task's diff — real CI runs `npm ci` there, producing a real directory that
the same gitignore pattern correctly excludes. Fixed locally by hardlinking
(`cp -al`) instead of symlinking; re-ran clean. No code changed as a result.

## Risks

- Did not re-run the full existing `build-and-test` job's original five steps
  end-to-end in this session (build, `test:types`, `npm test`) — out of this
  task's changed surface, and T-009's own verification already covers them;
  only the two new steps and the new job were exercised here.
- `needs: build-and-test` means a red `build-and-test` skips `e2e` entirely —
  expected per design, not a bug, but means an e2e-only regression is never
  the *first* signal if both are broken simultaneously.
- Playwright browser install (`--with-deps chromium`) was not exercised fresh
  in this session (chromium was already present in this machine's cache) —
  the install command itself wasn't run against a bare cache, so a first-run
  CI failure mode (network, package availability) is unverified, as it is on
  every fresh runner regardless.
