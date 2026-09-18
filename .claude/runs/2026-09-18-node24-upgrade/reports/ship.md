# T-003 ship report — Node 24 bump (.nvmrc, engines, CI)

## Files changed (in allowed_paths)
- `.nvmrc`: `20` → `24`.
- `package.json`: added `"engines": { "node": ">=24 <25" }`. `@types/node`
  **left at `^20.11.20`** — see "Blocked" below.
- `client/package.json`: added `"engines": { "node": ">=24 <25" }`.
- `.github/workflows/ci.yml`: **unchanged**. `grep -n 'node-version-file'
  ci.yml` → both `build-and-test` and `e2e` read `node-version-file: .nvmrc`
  (lines 15, 46); bumping `.nvmrc` alone changes the Node version for both
  jobs. `git diff -- .github/workflows/ci.yml` is empty.

## Blocked: @types/node bump
Bumping `devDependencies["@types/node"]` to `^24.13.5` (latest 24.x on npm,
checked via `npm view @types/node versions`) makes `package.json` diverge
from `package-lock.json`, which still pins `@types/node@20.19.39` in its
`packages[""]` entry (lockfileVersion 3 embeds top-level dependency ranges).
Reproduced in the scratch clone: `npm ci` fails with `EUSAGE — Invalid: lock
file's @types/node@20.19.39 does not satisfy @types/node@24.13.5`.
`package-lock.json` is not in this task's `allowed_paths`, and shipping the
bump without regenerating the lockfile would break `npm ci` for everyone,
including CI, on the very next checkout. Per the task's own constraint ("if
@types/node bump requires touching other files... stop and report blocked
instead"), I reverted the `package.json` line and left `@types/node` at
`^20.11.20`. Recommend a follow-up task with `package-lock.json` (and
`client/package-lock.json`, same class of risk if its `@types/node` line is
ever bumped) added to `allowed_paths`. Confirmed the `engines` addition alone
does **not** trip the lockfile-sync check — `npm ci` succeeds with only that
edit (lockfile has no `engines` entry today, added or not).

## Scratch-clone dry run (Node 24.21.0, already installed by T-001)
Recipe from `/update-ci`: `git ls-files --cached --others --exclude-standard`
tarred into a scratch dir, then this task's three edited files copied over
(engines added, `@types/node` reverted). `nvm use 24` prefixed on every
command.

| Step | Result |
|---|---|
| root `npm ci` | exit 0 (only pre-existing `allowScripts` warnings for better-sqlite3/puppeteer, and `npm audit` noise) |
| `node -e "require('better-sqlite3')"` (`:memory:` db) | loads, query returns `{x:1}` — confirms T-001/T-002's finding still holds |
| `client && npm ci` | exit 0 |
| root `npm run build` | exit 0 — `tsc` (server) + client `tsc && vite build`; `dist/index.js` and `client/dist/index.html` produced in scratch |
| root `npm run test:types` | exit 0, no errors |
| root `npm test` | 42 files / 1071 tests passed |
| `client && npm run test:types` | exit 0, no errors |
| `client && npm test` | 7 files / 29 tests passed |

No TypeScript errors surfaced from Node 24's runtime/toolchain under the
still-`^20.11.20`-typed `@types/node` — build and both typecheck passes are
clean, so the pinned-old-types risk is currently latent, not active.

## Puppeteer cold-cache check (reviewer finding)
`XDG_CACHE_HOME=<empty scratch dir> node -e "puppeteer.launch(...)"` in the
scratch clone → **`LAUNCH FAILED: Failed to launch the browser process`**.
Confirms: npm 11's `allowScripts` gate blocks puppeteer's postinstall
Chromium download during `npm ci`, and a genuinely fresh cache (no
`~/.cache/puppeteer`, i.e. what a GitHub Actions runner has) leaves
`puppeteer.launch()` with no browser. `ci.yml` has an explicit browser-install
step (`npx playwright install --with-deps chromium`, e2e job line 55), but
that provisions **Playwright's** browser, not puppeteer's — they're
independent caches. Checked whether either CI job currently exercises the
puppeteer path: `tests/pdfExport.test.ts` deliberately mocks nothing and
never calls `renderPdf`/`getBrowser` ("out of scope — nothing here... calls
puppeteer beyond the module's own top-level import" per its own header), and
`client/e2e/specs/` has no PDF-export spec. So **today neither CI job would
fail** on this. It is a real, currently-dormant gap: the moment PDF export
gets a real test (unit or e2e), CI breaks on a fresh runner with no fix
inside `ci.yml` alone (would need an explicit puppeteer browser-install step
or `PUPPETEER_SKIP_DOWNLOAD`/system-Chromium wiring). Flagging, not fixing —
out of this task's scope per the envelope.

## Live server / untouched-checkout verification
- Live server: confirmed still up throughout, `https://localhost:3000/` → `200`
  (plain `http://` returns `000` because it serves TLS only, per
  `.claude/ENVIRONMENT.md`); pid 1377747 unchanged, start time predates this
  session.
- `flights.db` md5 before: `34de439bf4f7a44a307cbc11f4acda11`; after:
  `2cf8a8f149e3df0f25e5b304f01b0a7b`. Changed, but expected per
  `.claude/ENVIRONMENT.md`'s WAL-checkpointing caveat — nothing in this task
  ever opened the live file (no path in any command pointed at the repo root
  `flights.db`; every `npm ci`/build/test ran inside the scratch clone).
- `dist/index.js` and `client/dist/index.html` mtimes in this checkout:
  unchanged (`Sep 18 15:13`, pre-dating this session, verified before and
  after). No `npm run build`/`vite build` ran in this checkout at any point.
- No leftover listening ports from this task; scratch clone removed
  (`rm -rf` on the mktemp scratch dir, not the repo).

## Net status
`.nvmrc`, root `engines`, `client/package.json` `engines` all done and
verified end-to-end under Node 24 in a scratch clone. `ci.yml` correctly
needs no edit. `@types/node` bump is **not done** — blocked on
`package-lock.json` being outside `allowed_paths`; reported rather than
guessed at.
