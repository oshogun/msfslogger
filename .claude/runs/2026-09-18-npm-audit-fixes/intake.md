# Intake — 2026-09-18-npm-audit-fixes

## Goal

`npm install` reports critical/high severity vulnerabilities in both the root
(server) package and `client/`. Fix all critical and high findings; pick up
moderate/low ones opportunistically where they resolve as a side effect, but
don't chase them at the cost of extra breaking bumps.

## Tier

Two tier-2 tracks (single seam each, no new contract): a dependency version
bump plus lockfile regeneration in each of two disjoint trees. No Planner, no
Designer — `intake.md` is the only pre-implementation artifact. No DevOps —
this run doesn't touch build/packaging/deploy pipeline config, only dependency
versions.

## Investigation already done (paste into task envelopes, don't re-derive)

Ran `npm audit --json` at root and in `client/` under Node 20 initially, cross
checked with `npm view <pkg> versions/dependencies/peerDependencies` under
Node 24. Full JSON saved at
`/tmp/claude-1000/-home-guilherme-msfslogger/8eb588a6-aa2f-4ef7-96da-0a3135f401cc/scratchpad/{root,client}-audit.json`
(scratch, not durable — task envelopes get the conclusions directly).

**Root** (1 critical, 6 high, 2 moderate):
- `shell-quote` (critical, GHSA-w7jw-789q-3m8p + GHSA-395f-4hp3-45gv) — transitive
  via `concurrently@8.2.2`, which already declares `shell-quote: ^1.8.1`. The
  installed 1.8.3 is vulnerable but 1.10.0 (latest, still satisfies `^1.8.1`)
  is fixed. **No package.json change needed** — a lockfile refresh
  (`npm audit fix`, no `--force`) picks it up.
- `multer` (high, direct dep `^2.2.0`) — 4 DoS advisories, all fixed by
  `2.4.0`, which satisfies the existing `^2.2.0` range. `npm audit fix` (no
  force) handles it.
- `body-parser` + `qs` (moderate) — come from `express@4.22.1`'s bundled
  `body-parser@1.20.5`/`qs@6.15.1`. `express@4.22.3` (latest 4.x, still
  satisfies direct dep `^4.18.3`) declares `body-parser: ~1.20.5` and
  `qs: ~6.16.0`, both of which resolve to fixed versions. No major bump, no
  package.json edit needed — `npm audit fix` (no force) should do it by
  re-resolving express within its existing caret range.
- `puppeteer` + `puppeteer-core` + `@puppeteer/browsers` + `extract-zip` (high)
  and `js-yaml` (high, via `puppeteer→cosmiconfig`) — every version allowed by
  the direct dep's current range (`^24.43.1`) is vulnerable; the fix requires
  bumping the direct dependency itself to `^25.11.0` (latest, semver-major).
  Puppeteer 25 drops `cosmiconfig`/`js-yaml` for `lilconfig`, which also
  clears the `js-yaml` finding transitively. **This needs an explicit
  `package.json` edit** (`npm audit fix --force` would also work but do it as
  an explicit version bump, not a blind `--force`).
  - `package.json` also has `"allowScripts": {"puppeteer@24.43.1": true, ...}`
    — this pins the postinstall-script allowlist to the *exact* old version
    string. It must be updated to `"puppeteer@25.11.0": true` (keep the
    `better-sqlite3` entry as-is) or the Chrome-for-Testing postinstall
    download will be silently blocked after the bump.
  - Puppeteer usage is confined to `src/pdfExport.ts`: `puppeteer.launch()`
    with `acceptInsecureCerts` + sandbox-disabling `args`, then
    `newPage/setViewport/emulateMediaType/setUserAgent/setCookie/goto/
    waitForFunction/evaluate/page.pdf()/page.close()`. All stable APIs, no
    `page.waitFor`-style calls that were removed. Puppeteer 24→25 is a
    low-risk bump for this codebase — the version-pin bump is the only real
    hazard, not the API surface.

**Client** (0 critical, 4 high, 7 moderate, 1 low):
- `react-router-dom` (direct, `^6.24.1`) + `react-router` + `@remix-run/router`
  (moderate, open-redirect advisories) — all fixed within the 6.x line
  (`6.30.6` latest, satisfies the existing `^6.24.1` caret). `npm audit fix`
  (no force) handles it, no package.json edit needed.
- `vite` (direct, `^5.3.4`) + `esbuild` (high — path traversal / dev-server
  request forgery) — fixed at `vite@6.4.3` (the vulnerable range is `<=6.4.2`;
  do **not** follow npm's own `fixAvailable` suggestion of jumping to
  `vite@8.3.0` — that's npm's fix-picker grabbing latest-overall instead of
  the minimal fix, and 8.x pulls in the new Rolldown-based toolchain, a much
  bigger, unnecessary jump). Bump the direct dep to `^6.4.3`. This is still a
  semver-major edit (5→6) and needs `package.json` touched directly.
  - `@vitejs/plugin-react` stays at its existing range `^4.3.1` — do not
    bump it to "latest" (`6.x`/`5.x`), which now requires
    `vite: ^8.0.0` (Rolldown-based rewrite) and is a different, much bigger
    migration. The current range's newest release, `4.7.0`, already declares
    `peerDependencies.vite: "^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0"` — i.e. it
    already supports vite 6, and `npm install` will pick it up on its own
    once the lockfile is regenerated.
- `vitest` (direct, `^3.2.7`) + `@vitest/mocker` (moderate — path traversal /
  arbitrary file read via mock redirect) — fix is `vitest@4.1.11` (already
  the exact pin used in the **root** package's `devDependencies`, for the
  same reason). No fixed version exists in the 3.x line, so this is a
  semver-major edit (3→4), `package.json` touched directly. `vitest@4.1.11`
  peers on `vite: ^6.0.0 || ^7.0.0 || ^8.0.0` — compatible with the vite 6.4.3
  bump above, not before it.
- `browserslist`, `baseline-browser-mapping`, `postcss`, `nanoid`, `@babel/core`
  (moderate/high/low) are all transitive under vite/vitest/babel's own tree —
  expected to clear once vite and vitest are bumped and the lockfile is
  regenerated; if any survive, `npm audit fix` (no force) for the remainder.
- `vite.config.ts` and `vitest.config.ts` are both minimal (plugin list +
  server proxy; `environment/include/exclude/setupFiles/globals/
  restoreMocks/testTimeout/hookTimeout/css/reporters`) — nothing in either
  file touches an option renamed or removed between vite 5→6 or vitest 3→4,
  so no config migration is expected, just verify by actually running the
  suite.

## Standing environment facts for both tasks (from `.claude/ENVIRONMENT.md`)

- **`.nvmrc` was bumped to `24` in the immediately preceding commit**
  (`5eb3571`, "...upgrade to Node 24..."). `ENVIRONMENT.md`'s "use Node 20"
  guidance predates that and is now stale for this repo — verified
  `better-sqlite3` loads fine under Node 24
  (`nvm use 24 && node -e "require('better-sqlite3')"` opened an in-memory db
  cleanly). **Use `nvm use 24` for this run**, not 20. (Flagging the stale doc
  in the final report, not fixing it here — out of scope, `/update-docs`'s
  job.)
- **Never run `npm run build` / `vite build` / `tsc` (non-`--noEmit`) in this
  checkout.** It overwrites `dist/` and `client/dist/`, which the user's live
  server on port 3000 serves from disk on every request, no restart needed.
  `npm install`, `npm audit`, `npx tsc --noEmit`, `npm run test:types`, and
  `npm test` (vitest) are all safe in place — they never write `dist/`. Any
  build-output verification (a scratch `vite build`, an end-to-end puppeteer
  smoke test that needs a running server) must happen against a **copy of the
  tree in scratch**, on another port, against a copy of `flights.db` if a
  server is needed at all — never in this checkout.
- Never touch the live server or `flights.db`. Read-only `curl` against
  `localhost:3000` is fine; nothing else against the live instance.

## Success criteria

- `npm audit` (root) and `npm audit` (in `client/`) report **zero critical and
  zero high** severity findings. Moderate/low left over only if fixing them
  would require a bump beyond what's scoped above — name any such leftover
  explicitly in the report, don't silently drop it.
- `npx tsc --noEmit` (root) and `npm run test:types` (client) pass.
- `npm test` (root Vitest suite) passes unchanged.
- `npm test` (client Vitest suite, under vitest 4) passes unchanged — this is
  the real regression check for the vitest 3→4 bump.
- A scratch build of `client/` (`vite build` against a copy of the tree, not
  this checkout) succeeds under vite 6.4.3.
- A standalone smoke test of `puppeteer.launch()` + `page.pdf()` (the same
  launch args as `src/pdfExport.ts`, run as a throwaway script, not through
  the live server) succeeds under puppeteer 25.11.0 — this is the real
  regression check for the puppeteer major bump, since the existing unit test
  (`tests/pdfExport.test.ts`) explicitly covers only the no-browser subset.
- No edit to `dist/`, `client/dist/`, or `flights.db`. No restart of the live
  server.

## Tasks

**Task A — backend_sr — root package**
- `allowed_paths`: `package.json`, `package-lock.json`
- Bump `puppeteer` to `^25.11.0`; update the `allowScripts` key from
  `"puppeteer@24.43.1"` to `"puppeteer@25.11.0"`. Run `npm install`, then
  `npm audit fix` (no `--force`) to pick up `multer`, `express`
  (→ fixed `body-parser`/`qs`), and `concurrently`'s already-compatible
  `shell-quote` bump. Confirm `npm audit` is clean of high/critical.
  Verify per the "Success criteria" above (tsc --noEmit, npm test, and the
  standalone puppeteer smoke test — write it as a scratch script under
  `/tmp` or the session scratchpad, not committed).

**Task B — frontend_sr — client package**
- `allowed_paths`: `client/package.json`, `client/package-lock.json`
- Bump `vite` to `^6.4.3` and `vitest` to `^4.1.11` in `client/package.json`.
  Run `npm install` (in `client/`), then `npm audit fix` (no `--force`) to
  pick up `react-router-dom`'s in-range bump and any remaining transitive
  findings. Confirm `npm audit` is clean of high/critical. Verify per the
  "Success criteria" above (`npm run test:types`, `npm test`, and a scratch
  `vite build` against a copy of `client/`, not this checkout).

Both tasks are independent and their `allowed_paths` are disjoint — run in
parallel.

## Review

Every task's diff + evidence goes to `reviewer` before either is considered
done. `request_changes` sends it back to the same implementer; escalate to
the user after 3 failed rounds.
