# design.md — 2026-09-17-frontend-integration-tests

Freezes the five things the intake left open: where frontend component tests and
Playwright specs live and how they are invoked (§1), how Playwright authenticates
(§2), the backend seed/reset script (§3), the scratch server + DB provisioning
recipe (§4), and the CI job shape (§5). Plus the unnumbered **Must-not-change
list** and **Risks** at the end.

Every section is written to be read alone. Pull one with
`.claude/tools/ctx.sh design 2026-09-17-frontend-integration-tests 3` (or `3.4`,
or `must-not-change`). Cross-references are by number only.

**Ownership at a glance** — so two implementer agents never open the same file:

| Paths | Owner role | Sections |
| --- | --- | --- |
| `client/vitest.config.ts`, `client/src/test/**`, `client/src/**/*.test.tsx`, `client/tsconfig.json`, `client/tsconfig.test.json`, `client/package.json` | frontend | §1 |
| `client/playwright.config.ts`, `client/e2e/**` (specs, support, `scratch-server.sh`) | frontend | §2, §4 |
| `src/testSeed.ts` | backend | §3 |
| `.github/workflows/ci.yml`, `.gitignore` | devops | §5, §1.6 |
| root `package.json` scripts (two additive lines only) | backend | §1.5 |

**Nothing in this document may be referenced from application source.** No `§`
number, no run id, no "design.md", no task id in a comment under `src/`,
`client/src/`, `client/e2e/` or `tests/`. Where a decision's reasoning belongs in
the code, the comment states the reasoning itself.

## Amendments

Initial freeze 2026-09-17. Section numbering is stable; the rows below are edits
made **in place** after the freeze.

| # | Date | Section | What changed | Evidence that forced it |
| --- | --- | --- | --- | --- |
| A1 | 2026-09-17 | §4.1 step 4 | The tree copy now lists paths with `git ls-files --cached --others --exclude-standard`, not bare `git ls-files`. | Review round 1, B1. Bare `git ls-files` lists **tracked** paths only, and `src/testSeed.ts` (§3.1) is created by a sub-agent that never commits — so at the moment phase 2 runs the suite the seed is untracked and would not be copied into `$SCRATCH`; step 7 would then fail as an opaque 180 s `webServer` timeout. Re-verified here in a throwaway repo (git 2.43.0): bare `git ls-files src client` → `src/tracked.ts` only; with the three flags → `src/testSeed.ts` *and* `src/tracked.ts`, while the ignored `client/dist/index.html` and `flights.db` stayed out. |
| A2 | 2026-09-17 | §4.4 guard 5 (new), §4.1 step 2, §4.6 | Added a Node-major guard: the script refuses to run unless the running `node` major equals `.nvmrc`. | Review round 1, N1. The machine's default `node` is v26.3.1, where `better-sqlite3` throws (`.claude/ENVIRONMENT.md`); without the guard the symptom is a silent 180 s `webServer` timeout, which none of the four original guards catch. |
| A3 | 2026-09-17 | §4.1 step 1 | `PORT` is derived from `MSFSLOGGER_E2E_PORT` only; an inherited `PORT` is ignored. | Review round 1, N2. Step 8 used `$PORT` with nothing assigning it, so an inherited `PORT` would put the server on a port `baseURL` never probes. |
| A4 | 2026-09-17 | §5 preamble, §5.1, must-not-change 10 | "five existing steps" → "two setup actions and five named steps". | Review round 1, N3. `grep -n 'uses:\|name:' .github/workflows/ci.yml` → two bare `uses:` (`actions/checkout@v4`, `actions/setup-node@v4`) plus five named steps = seven. |
| A5 | 2026-09-17 | §1.5 | "the existing four" client scripts → "the existing three (`dev`, `build`, `preview`)". | Review round 1, N4. `client/package.json` scripts block holds exactly three. |
| A6 | 2026-09-17 | §3.3 | "byte-identical fixture content" narrowed to equality of the rendered fixture rows; the two wall-clock-stamped tables are named explicitly. | Review round 1, N5. `src/db/settings.ts:30,57,83` stamp `new Date().toISOString()`, so `auth_user` and `app_setting` timestamps differ run to run. Neither is rendered by any page. |
| A7 | 2026-09-17 | §2.3, §2.2, must-not-change 4, Risks 9 (new) | `globalSetup` now polls `${baseURL}/login` for readiness before the login POST, so the design no longer depends on Playwright starting `webServer` before `globalSetup`; the ordering is recorded as an **unconfirmed assumption** for T-005 to check. Must-not-change 4 gains a carve-out for a comment-only cleanup of root `vitest.config.ts:1`. | Review round 1, "Verified independently vs. taken on trust" + N6. The ordering rests on P5/P6 alone, which the Reviewer could not reproduce (no Playwright installed); `playwright.dev/docs/test-webserver` and `/docs/test-global-setup-teardown` (fetched 2026-09-17) state no ordering either way. `vitest.config.ts:1` read `// vitest.config.ts — CommonJS on purpose; see design §3.2.` — a run citation in application source, which this document's own header forbids. |
| A8 | 2026-09-17 | §3.4 | "FlightDetail `/flight/1` — … and an unlinked planned-leg picker offering leg 1" → removed; FlightDetail renders aircraft, route, and the track on the map, nothing else. The manual-entry planned-leg picker exists only on Home (already listed above it) and the link-to-leg picker only on TripDetail (already listed below it). | Phase 3 review, F-1. `client/src/pages/FlightDetail.tsx` has no planned-leg picker of any kind — confirmed by grep and by the T-007/T-009 implementer and reviewer independently; the picker described here does not exist on this page. T-007's actual FlightDetail spec asserts only what the page renders. |

When reality contradicts a frozen section, edit that section **in place**, keep
its number, and add a row here: date, section, what changed, and the command
output that forced it.

## What was prototyped before freezing

Every claim below was produced on this machine on 2026-09-17, under Node 20.20.2
(`nvm use 20`), against a scratch tree and a scratch database. The user's live
server (pid 1143167, port 3000, cwd `/home/guilherme/msfslogger`) was never
stopped, rebuilt over, or written to.

| # | Question | Command | Result |
| --- | --- | --- | --- |
| P1 | Does the server start plaintext on loopback, and is the session cookie usable over HTTP? | `cd $SCRATCH && PORT=3210 BIND_HOST=127.0.0.1 FLIGHTS_DB_PATH=$SCRATCH/flights.db INGEST_TOKEN=… node $REPO/dist/index.js` | Starts: `No TLS configured — serving plaintext HTTP on loopback only.` / `[HTTP] Server running at http://127.0.0.1:3210`. `POST /api/auth/login` → `200` + `Set-Cookie: msfslogger.sid=…; Path=/; HttpOnly; SameSite=Lax` — **no `Secure` flag**, so a plain-HTTP browser keeps it. Unauthenticated `GET /api/flights` → `401`; with the cookie → the seeded rows. Wrong password → `401`. |
| P2 | Does a scratch-tree build leave the live checkout alone? | tarball of `git ls-files` into `$SCRATCH`, `node_modules` + `client/node_modules` symlinked, `npm run build` in `$SCRATCH` | Full build (client + server) in **10.2 s**. `client/dist/index.html` md5 in the real tree unchanged (`2bc39f5b…` before and after); `client/node_modules/.vite` mtime unchanged (`2026-09-16 19:33:38`). Vite 5.4.21 wrote only into the scratch tree. |
| P3 | Does the component-test stack actually run this client's code? | scratch copy of `client/`, `npm i -D vitest@3.2.7 jsdom@26.1.0 @testing-library/react@16.3.3 @testing-library/jest-dom@6.9.1 @testing-library/user-event@14.6.7`, then `npx vitest run` | `✓ src/pages/Login.test.tsx (1 test) 248ms` — the real `Login` page inside the real `SessionProvider`, `fetch` stubbed, `getByLabelText('Username')` and `findByRole('alert')` both resolve. No peer-dependency conflicts. |
| P4 | Does excluding the test files from `client/tsconfig.json` keep the production bundle identical? | `npx tsc -p tsconfig.json`, `npx tsc -p tsconfig.test.json`, `npm run build` in the scratch client | Both typechecks exit 0. Emitted assets `index-BI1xHYYp.css` / `index-BV756Q20.js` are **the same hashed names** as the build of the same tree with no test files present (P2) — the suites provably do not enter the bundle. |
| P5 | Does Playwright capture the `HttpOnly` session cookie into `storageState` and replay it? | `@playwright/test@1.63.0`, `npx playwright install chromium`, `globalSetup` doing one real `POST /api/auth/login` via `request.newContext()` | `e2e/.auth/operator.json` contains `{"name":"msfslogger.sid", …, "httpOnly": true, "secure": false, "sameSite": "Lax"}`. Four specs covering Home, AllFlights, FlightDetail and TripDetail passed against the seeded data. |
| P6 | Does the whole recipe work as one Playwright `webServer` command? | `npx playwright test` with `webServer.command` = the provisioning script | provision → build → seed → start → login → 4 specs, **15.9 s wall clock end to end**. Server torn down by Playwright (no `pkill`). Live `client/dist/index.html` and live `flights.db` md5s identical before and after. |
| P7 | Does the seed refuse to run against a real logbook? | `FLIGHTS_DB_PATH=$SCRATCH/live-copy.db node seed.js` on a **copy** of the live `flights.db` | Exit 1: `refusing to seed … it already holds data (flights=56, trips=1, planned_legs=23, ground_sessions=6, acars_messages=8, auth_user=1) and carries no e2e marker.` |
| P8 | Does adding Playwright to `client/package.json` break the Docker client stage? | `node -e` on the installed `playwright` / `@playwright/test` / `playwright-core` manifests | `playwright@1.63.0` has **no `scripts` field at all** — no `postinstall`, so `npm ci` in Dockerfile stage 1 downloads no browser binaries and cannot fail on alpine. |
| P9 | Version compatibility with the pinned toolchain | `npm view` for each candidate | `vitest@4` (the root's pin) requires `vite ^6 \|\| ^7 \|\| ^8`; the client is on `vite ^5.3.4`. `vitest@3.2.7` takes `vite ^5 \|\| ^6 \|\| ^7`. `jsdom@30`/`@testing-library/jest-dom@7` require Node ≥ 22; `.nvmrc` pins 20. Hence the pins in §1.7. |

Prototype transcripts were run in the session scratchpad, not committed — this
task's `allowed_paths` is `design.md` alone. Every command above is reproducible
verbatim from the text of §1–§5.

---

## 1. Directory & tooling layout

Two suites, two runners, one workspace (`client/`). The backend's Vitest setup
(root `vitest.config.ts`, root `tsconfig.test.json`, root `npm test`) is **not
touched** — see the Must-not-change list.

### 1.1 The tree (frozen)

```
client/
  vitest.config.ts              # component-test runner config (§1.2)
  playwright.config.ts          # e2e runner config (§2.2)
  tsconfig.json                 # EDITED: gains an `exclude` (§1.4)
  tsconfig.test.json            # NEW: typechecks tests + e2e (§1.4)
  package.json                  # EDITED: devDeps (§1.7) + scripts (§1.5)
  src/
    test/                       # component-test support, never imported by app code
      setup.ts                  # the one setupFiles entry (§1.3)
      renderWithProviders.tsx   # render() wrapped in MemoryRouter + SessionProvider
      mockFetch.ts              # fetch stub helper (§1.3)
      fixtures.ts               # typed Flight/Trip/PlannedLeg literals for unit tests
    pages/Login.test.tsx        # colocated, next to the component under test
    components/StatsGrid.test.tsx
    ...                         # <Name>.test.tsx beside <Name>.tsx
  e2e/
    specs/*.spec.ts             # Playwright specs — the ONLY place Playwright looks
    support/
      paths.ts                  # ESM-safe path helpers (§2.5)
      global-setup.ts           # the one real login (§2.3)
    scratch-server.sh           # provisioning + server, executable (§4)
    .auth/operator.json         # storageState, generated, gitignored (§1.6)
  playwright-report/            # HTML report, generated, gitignored
  test-results/                 # traces/screenshots/junit.xml, generated, gitignored
```

Rules that are not negotiable:

- Component tests are **colocated**: `client/src/<dir>/<Name>.test.tsx` beside
  `<Name>.tsx`. Suffix is `.test.tsx` (or `.test.ts` for a util).
- Playwright specs use the suffix `.spec.ts` and live **only** under
  `client/e2e/specs/`. The two suffixes never overlap, so neither runner can
  ever collect the other's files even if a glob is later loosened.
- Nothing under `client/src/test/` or `client/e2e/` may be imported by
  application code. The dependency arrow points one way.
- No test file, of either suite, may import from `src/` (the backend). The
  client tests talk to the app over `fetch`; the e2e tests talk to it over HTTP.

**Minimum initial suites** (a floor, not a ceiling — later tasks add more):
component tests for `Login`, `StatsGrid` and `PlannedLegRows`; specs
`auth.spec.ts`, `home.spec.ts`, `all-flights.spec.ts`, `flight-detail.spec.ts`,
`trip-detail.spec.ts`.

### 1.2 `client/vitest.config.ts`

A **separate file** from `client/vite.config.ts`, which is left untouched. When
`vitest.config.ts` exists, Vitest loads it instead of `vite.config.ts`
(confirmed in P3: the scratch client had both and the dev-server `proxy`/`port`
block was ignored). Frozen content:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,          // same as the backend suite: explicit imports
    restoreMocks: true,
    testTimeout: 5000,
    hookTimeout: 5000,
    css: false,              // class names are asserted, never computed styles
    reporters: ['default'],
  },
});
```

`globals: false` and `restoreMocks: true` are deliberately identical to the
root config, so a developer moving between the two suites never has to remember
which one auto-imports `describe`.

### 1.3 `client/src/test/setup.ts`

The single `setupFiles` entry. Frozen content:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // No test may reach the network. A component that fetches without the test
  // saying what the answer is fails loudly instead of hanging.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch not stubbed in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
```

Network access is stubbed at `globalThis.fetch`, because every client call goes
through `apiFetch`/`download` in `client/src/utils/api.ts`, and both call the
global `fetch` directly. `client/src/test/mockFetch.ts` exports one helper that
maps URL → `Response`, so specs declare routes rather than hand-rolling
`vi.fn()` bodies:

```ts
mockFetchRoutes({
  '/api/auth/session': [200, { authenticated: false, user: null }],
  '/api/auth/login':   [401, { error: 'Invalid username or password' }],
});
```

An unlisted URL rejects with `unexpected fetch <url>`.

**Alternatives considered.** MSW (`msw` + `setupServer`) was rejected: it adds a
service-worker/interceptor layer and ~40 packages to intercept exactly one
function (`fetch`), which `vi.stubGlobal` already replaces in one line. Revisit
only if a component starts using `XMLHttpRequest`, `EventSource` or streaming
responses — none exists today.

### 1.4 The tsconfig split

`client/tsconfig.json` has `include: ["src"]` and the client build is
`tsc && vite build`. Without a change, `npm run build` would typecheck every
test file and the production build would depend on the test devDependencies.
Therefore, mirroring the backend's existing `tsconfig.json` /
`tsconfig.test.json` split:

1. `client/tsconfig.json` gains **only** this key (nothing else changes):

   ```json
   "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**"]
   ```

2. `client/tsconfig.test.json` is new:

   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": { "types": ["node"], "noEmit": true },
     "include": ["src", "e2e"],
     "exclude": []
   }
   ```

`"types": ["node"]` is required because `client/e2e/support/paths.ts` imports
`node:path` / `node:url`; `@types/node` is therefore a client devDependency
(§1.7) — it is **not** present in the client tree today (verified: `require`
of `client/node_modules/@types/node` → absent).

P4 proves both configs typecheck clean and that the emitted bundle is
byte-for-byte the same hashed output as a tree with no tests in it.

### 1.5 npm scripts

`client/package.json` — add these five; do not reorder or rewrite the three that
are already there (`dev`, `build`, `preview`):

```json
"test": "vitest run",
"test:watch": "vitest",
"test:types": "tsc -p tsconfig.test.json",
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

Root `package.json` — add exactly two lines, and **leave `"test": "vitest run"`
exactly as it is** (it is the backend suite and must stay backend-only):

```json
"test:client": "cd client && npm test",
"test:e2e": "cd client && npm run test:e2e"
```

Invocation table (this is the whole public surface):

| Goal | Command | Needs a server? |
| --- | --- | --- |
| Backend unit tests (unchanged) | `npm test` | no |
| Client component tests | `npm run test:client` *or* `cd client && npm test` | no |
| Client + e2e typecheck | `cd client && npm run test:types` | no |
| End-to-end | `npm run test:e2e` *or* `cd client && npm run test:e2e` | yes — starts its own, §4 |

**Alternatives considered.** A root `"test": "npm run test:server && npm run
test:client"` aggregator was rejected: `npm test` is quoted in `CLAUDE.md`,
`README.md` and the ENVIRONMENT doc as the hermetic backend suite, and
redefining it would silently change what every existing instruction means.

### 1.6 `.gitignore`

Append (devops owns this file):

```
client/e2e/.auth/
client/playwright-report/
client/test-results/
```

`client/dist/` and `node_modules/` are already ignored. The scratch tree lives
outside the repo entirely (§4), so it needs no entry.

### 1.7 Dependency pins (client `devDependencies`)

| Package | Pin | Why this version |
| --- | --- | --- |
| `vitest` | `3.2.7` | `vitest@4` (the root's pin) declares `vite ^6 \|\| ^7 \|\| ^8`; this client is on `vite ^5.3.4`. `3.2.7` declares `vite ^5 \|\| ^6 \|\| ^7` and reuses the client's own Vite 5 — no second Vite major nested under `client/node_modules/vitest/`, and `@vitejs/plugin-react@4` stays on the Vite major it supports. |
| `jsdom` | `26.1.0` | `jsdom@27+` requires Node `^20.19 \|\| ^22.12 \|\| >=24`; `jsdom@30` requires Node ≥ 22. `.nvmrc` pins **20**, and `26.1.0` declares `node >=18`. |
| `@testing-library/react` | `16.3.3` | peers `react ^18 \|\| ^19`; client is React 18.3.1. |
| `@testing-library/jest-dom` | `6.9.1` | `7.x` and `6.10.0` require Node ≥ 22. `6.9.1` is the newest that declares `node >=14`. |
| `@testing-library/user-event` | `14.6.7` | current; no engine constraint conflict. |
| `@types/node` | `^20.11.20` | matches the root pin and the Node 20 line; needed by §1.4. |
| `@playwright/test` | `1.63.0` | current; `engines.node >= 20`. No `postinstall` (P8), so `npm ci` never downloads a browser — browsers are installed explicitly (§5.2). |

Two Vitest majors coexist in the repo (root 4.1.11, client 3.2.7). That is
accepted: they are separate workspaces, separate configs, separate scripts, and
neither resolves the other's `node_modules`. The alternative — upgrading the
client to Vite 7/8 so it could share Vitest 4 — would change the production
bundler of the app in a run whose subject is tests, and is explicitly rejected.

Install exactly once, in `client/`:

```
cd client && npm i -D vitest@3.2.7 jsdom@26.1.0 @testing-library/react@16.3.3 \
  @testing-library/jest-dom@6.9.1 @testing-library/user-event@14.6.7 \
  @types/node@^20.11.20 @playwright/test@1.63.0
```

(P3 ran this set against a copy of the real `client/node_modules`: "added 95
packages", no peer conflict, no native build.)

### 1.8 Locator conventions (both suites)

These are rules, not style preferences — each one is a bug found in P5/P6:

1. **Scope page-level assertions to `main`.** `page.getByRole('main')` first,
   then query inside it. The sidebar renders trip names too, so a bare
   `page.getByText('E2E Baltic Hop')` is a strict-mode violation ("resolved to 2
   elements": `span.sidebar-trip-name` and `div.trip-row-name`).
2. **Match decorated text with a substring/regex, not an exact string.**
   `AllFlights` renders `🚗 {trip.name}`, so `getByText('E2E Baltic Hop')`
   (exact by default) does not match the row; use
   `getByText('🚗 E2E Baltic Hop')` or `getByText(/E2E Baltic Hop/)`.
3. **Prefer role + accessible name** (`getByRole('heading', { name: 'Flight
   Log' })`, `getByRole('cell', { name: /Cessna 172/ })`) and, in component
   tests, `getByLabelText` — the `Login` inputs are nested inside their
   `<label>`, so label queries already work (P3). Adding `data-testid`
   attributes to application markup is a last resort, allowed only when no role
   or label can identify the node; each one added must be justified in the
   implementer's report.
4. **Never assert on a wall-clock-derived string** (a "2 hours ago", a rendered
   `created_at`). §3.3 pins every fixture timestamp so there is no need to.

---

## 2. Test-user identity & Playwright authentication

### 2.1 The identity (frozen)

| Thing | Value | Read by |
| --- | --- | --- |
| Username | `e2e` | §3 seed (writes `auth_user`), §2.3 global-setup (logs in) |
| Password | `e2e-password-123` | same two |
| Username override | `MSFSLOGGER_E2E_USERNAME` | both, same default |
| Password override | `MSFSLOGGER_E2E_PASSWORD` | both, same default |

Both sides read the same two variables with the same literal defaults, so the
pair can never drift. The password is 16 characters, above the app's
`PASSWORD_MIN_LENGTH = 12` (`src/auth/password.ts`), so it stays valid if the
seed is ever routed through a validating helper.

This credential is a **fixture, not a secret**: it is committed in plain text in
both files, it only ever exists in a throwaway database created by §3, and the
scratch server it logs into listens on loopback only (§4). It must never be
used by `npm run set-password` against a real database, and the seed's guards
(§3.2) make that mistake fail loudly.

### 2.2 `client/playwright.config.ts` (frozen)

```ts
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.MSFSLOGGER_E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e/specs',
  globalSetup: './e2e/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],                       // → client/playwright-report/
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL,
    storageState: './e2e/.auth/operator.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: './e2e/scratch-server.sh',
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
```

Frozen reasons for the non-obvious keys:

- `workers: 1` / `fullyParallel: false` — one server, one SQLite file, one
  operator account, and specs that mutate rows (creating a trip, linking a leg).
  Parallel workers would race on shared state. Speed is not the constraint: the
  whole run including provisioning was 15.9 s (P6).
- `reuseExistingServer: false`, always — including locally. A `true` here is how
  a suite ends up silently testing whatever is already listening, which on this
  machine could be the developer's own server.
- `webServer.url` is `/login`, which answers `200` with no session (P1), so the
  readiness probe never depends on auth. `globalSetup` polls the same path
  itself before logging in (§2.3) — the two are belt and braces, because
  whether Playwright starts `webServer` before `globalSetup` is an assumption
  this design deliberately no longer relies on (amendment A7).
- `webServer.timeout` of 180 s is generous because the command is not just a
  server start: it copies the tree, builds client + server (~10 s, P2) and seeds
  before it ever listens (§4.1). A timeout here is the failure mode every §4.4
  guard exists to turn into a readable error instead.
- `storageState` in `use` applies to every spec. A spec that tests the login
  form itself must opt out explicitly:
  `test.use({ storageState: { cookies: [], origins: [] } })`.
- `webServer.command` is relative; Playwright runs it with cwd = the config's
  directory (`client/`).

### 2.3 `client/e2e/support/global-setup.ts` (frozen)

One real login through the app's own route, once per run, after an explicit
readiness wait:

```ts
import { request, type APIRequestContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_STATE } from './paths';

const READY_TIMEOUT_MS = 180_000;   // matches webServer.timeout in the config
const READY_POLL_MS = 500;

/**
 * Waits for the scratch server to answer before anything else runs. Do not
 * remove this in the belief that the web server is always up by now: the login
 * below is the first request of the run, and if it is ever issued against a
 * port nothing is listening on, the whole suite fails with a connection error
 * that looks nothing like the real cause.
 */
async function waitForServer(ctx: APIRequestContext): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = '';
  for (;;) {
    try {
      const res = await ctx.get('/login', { timeout: 5_000 });
      if (res.ok()) return;
      last = `HTTP ${res.status()}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= deadline) {
      throw new Error(`e2e server not ready after ${READY_TIMEOUT_MS} ms: ${last}`);
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
}

export default async function globalSetup(): Promise<void> {
  const port = process.env.MSFSLOGGER_E2E_PORT ?? '3210';
  const baseURL = `http://127.0.0.1:${port}`;
  const username = process.env.MSFSLOGGER_E2E_USERNAME ?? 'e2e';
  const password = process.env.MSFSLOGGER_E2E_PASSWORD ?? 'e2e-password-123';

  const ctx = await request.newContext({ baseURL });
  await waitForServer(ctx);
  const res = await ctx.post('/api/auth/login', { data: { username, password } });
  if (res.status() !== 200) {
    throw new Error(`e2e login failed: ${res.status()} ${await res.text()}`);
  }
  await mkdir(path.dirname(STORAGE_STATE), { recursive: true });
  await ctx.storageState({ path: STORAGE_STATE });
  await ctx.dispose();
}
```

**Why the wait loop exists — an assumption T-005 must confirm** (amendment A7).
This design originally relied on Playwright starting `webServer` *before* it
runs `globalSetup`, so that the login POST would always find a live server. That
ordering held in the prototypes (P5, P6: `webServer` stdout appeared first and
the login succeeded), but it is **not stated on
`playwright.dev/docs/test-webserver` or `/docs/test-global-setup-teardown`**
(both fetched 2026-09-17), it is not something a reviewer without Playwright
installed can reproduce, and it is not a guarantee this design should rest a
whole suite on. `waitForServer` makes the setup correct under either ordering,
at the cost of one extra `GET /login` on the happy path.

T-005 — the first task that actually runs Playwright — **confirms the ordering
empirically and records it**: run `npm run test:e2e` and check whether the
`webServer` command's stdout precedes `globalSetup`'s first request in the
output. If it turns out `globalSetup` runs first, nothing needs redesigning (the
wait loop already covers it) but say so in the task report, and amend this
section. If the wait ever times out while the server *is* up, the cause is a
port mismatch (§4.1 step 1), not ordering.

It is a `POST /api/auth/login` with a JSON body, which is exactly what the
browser does — it goes through `LoginThrottle`, `getAuthUser()`,
`verifyPassword()`, `req.session.regenerate()` and the real
`express-session`/`SqliteSessionStore` write. A non-200 aborts the whole run
with the server's own body in the message.

P5 proves the resulting `e2e/.auth/operator.json` carries the real cookie:

```json
{"cookies":[{"name":"msfslogger.sid","value":"s%3AgfRfDgs8…","domain":"127.0.0.1",
  "path":"/","httpOnly":true,"secure":false,"sameSite":"Lax"}],"origins":[]}
```

`HttpOnly` is captured because `storageState()` reads the context's cookie jar,
not `document.cookie`. `"secure": false` is the direct consequence of the
plaintext-loopback choice in §4.3 — `src/server.ts` sets
`cookie.secure = config.tls.enabled`.

### 2.4 Why a real login, and what is forbidden

Forging the session is banned, in all its forms: no inserting an `auth_session`
row, no hand-signing a `msfslogger.sid` cookie with the app's secret, no
`REQUIRE_AUTH=0`-style bypass, no test-only route, no middleware stub. The auth
chain — throttle, scrypt verify, session regeneration, store write, cookie
attributes, `requireAuth`, `requireSameOrigin` — is behaviour this suite exists
to protect. A forged session would make the suite pass on a build where login
itself is broken, which is precisely the regression class that most warrants an
end-to-end test.

The cost of the real login is one scrypt derivation per run (~100 ms), paid once
in `globalSetup` and amortised over every spec via `storageState`.

### 2.5 The ESM trap (found in P5)

`client/package.json` declares `"type": "module"`, so Playwright loads
`playwright.config.ts` and everything under `e2e/` as ESM. `__dirname` does not
exist there — the first prototype died with `ReferenceError: __dirname is not
defined in ES module scope`. All path resolution goes through one file,
`client/e2e/support/paths.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// client/package.json declares "type": "module": Playwright loads these files
// as ESM, where __dirname does not exist.
const here = path.dirname(fileURLToPath(import.meta.url));

export const E2E_DIR = path.resolve(here, '..');
export const STORAGE_STATE = path.join(E2E_DIR, '.auth', 'operator.json');
```

No other file under `e2e/` computes a path from `__dirname` or from
`process.cwd()`.

### 2.6 Lifetime of `e2e/.auth/operator.json`

Rewritten by `globalSetup` on every run and never read across runs — the
scratch database (and therefore the session row) is recreated each time (§4).
It is gitignored (§1.6). If the file is stale or missing, the run regenerates
it; nothing reads it before `globalSetup` has written it.

---

## 3. Backend seed/reset script contract

### 3.1 Path, ownership, invocation

- Source: **`src/testSeed.ts`** (backend-owned). Compiled by the ordinary
  `tsc` build to `dist/testSeed.js`, like `src/setPassword.ts` — no separate
  build step, no `ts-node` requirement.
- Invocation, and the only supported one:

  ```sh
  export FLIGHTS_DB_PATH=/path/to/scratch/e2e.db
  node dist/testSeed.js
  ```

- Arguments: none. `--help` prints usage and exits 0. Any other argument is an
  error (exit 1) — there is no `--db` flag, deliberately: one way to name the
  database, and it is the same variable the server itself reads.
- It uses `src/db` only (`initDb`, `setAuthUser`, `createTrip`, `insertFlight`,
  `closeFlight`, `insertPoint`, `assignFlightToTrip`, `createPlannedLeg`,
  `setSetting`) plus a handful of statements on the handle `initDb()` returns
  for the reset and the timestamp pinning (§3.3). It does not re-declare any
  column list that `src/db/` already owns.
- `initDb()` applies the schema, so the target file may be a path that does not
  exist yet; the seed creates it.
- No root `package.json` script wraps it. §4's provisioning script is its only
  automated caller.

### 3.2 Refusal rules (the guards)

Evaluated in this order, before any write:

1. **`FLIGHTS_DB_PATH` unset or empty → exit 1**, message
   `testSeed: FLIGHTS_DB_PATH is not set — refusing to guess a database path.`
   There is no default and no fallback to `process.cwd()/flights.db`. This is
   the specific accident recorded in `.claude/ENVIRONMENT.md` (§ "Env-var
   prefixes do not scope across a pipe"), where a `FLIGHTS_DB_PATH=… printf |
   node …` pipeline let a tool fall back to the live file and overwrite the
   operator password.
2. The script **echoes the resolved path** (`process.env.FLIGHTS_DB_PATH`) as
   its first line of output, before opening anything, so a mis-scoped variable
   is visible in the log rather than inferred afterwards.
3. `initDb(FLIGHTS_DB_PATH)`, then read the marker
   `app_setting` row named **`e2e_seed`**:
   - **marker present** → this database was created by a previous seed run;
     proceed to §3.3.
   - **marker absent** → count rows in `flights`, `trips`, `planned_legs`,
     `ground_sessions`, `acars_messages`, `auth_user`. If **any** is non-zero,
     **exit 1** with every non-zero count named:
     `testSeed: refusing to seed <path> — it already holds data (flights=56,
     trips=1, …) and carries no e2e marker.`
     Otherwise (a brand-new, empty database) proceed.

Rule 3 is what makes a mistyped path harmless: the user's real logbook has rows
and no marker, so the seed stops (P7, run against a copy of the live file — 56
flights, guard fired, exit 1). It is a stronger guard than any path-pattern
check, because it tests the thing that actually matters (is there real data
here?) rather than the file's name.

`FLIGHTS_DB_PATH` must be **exported**, never prefixed onto the right-hand side
of a pipe. §4's script exports it.

### 3.3 Idempotency and determinism

The seed is **idempotent**: running it twice against the same database yields
the same fixture rows with the same ids, not duplicates. Order:

1. `DELETE FROM` the tables it owns, children first:
   `acars_messages`, `ground_sessions`, `flight_points`, `planned_waypoints`,
   `planned_alternates`, `planned_legs`, `flights`, `trips`, `auth_user`,
   `auth_session`.
2. `DELETE FROM sqlite_sequence WHERE name IN ('flights','trips','planned_legs',
   'flight_points','planned_waypoints','planned_alternates','ground_sessions',
   'acars_messages')` — without this, a second run would hand out ids 3, 4, …
   and every hard-coded URL in the specs (`/flight/1`, `/trip/1`) would break.
   **Row ids are part of the contract** (§3.4).
3. Insert the fixture through the `src/db` helpers.
4. Pin the two clock-derived columns the helpers fill from the wall clock:
   `UPDATE trips SET created_at = '2026-02-20T09:00:00.000Z' WHERE id = 1` and
   `UPDATE planned_legs SET imported_at = … WHERE id = ?` for each leg.

**How far the determinism claim goes** (narrowed by amendment A6 — the freeze
said "byte-identical", which is not true of the whole file):

- **Every row any page renders is identical between runs** — same ids, same
  column values. `flights` and `flight_points` take all their timestamps
  explicitly (`src/db/flights.ts:32,40,90`), no fixture column anywhere carries
  `DEFAULT CURRENT_TIMESTAMP` (`grep CURRENT_TIMESTAMP src/db/schema.ts` → no
  matches), and step 4 pins the only two the helpers would otherwise stamp. That
  is the property §1.8 rule 4 and every spec assertion depend on.
- **Two rows do differ, by design and harmlessly**: `auth_user` and
  `app_setting` carry `new Date().toISOString()` stamps written by
  `setAuthUser`/`setSetting` (`src/db/settings.ts:30,57,83`). Neither column is
  read by the API or rendered by any page — they are audit metadata. The
  password hash differs between runs too (scrypt salts per call), which is
  correct: §2.1's credentials are verified, never compared as a hash.
- So the file is **not** byte-identical run to run and no test may assert that
  it is. The contract is row-level equality of the fixture in §3.4.
5. `setSetting('e2e_seed', '1')` — the marker, written last, so a crash partway
   leaves an unmarked database that the guard will refuse rather than a marked
   half-seeded one. The value is a **fixture version**: bump it to `'2'` when
   the row set below changes, and say so in the amendment table.

`auth_session` is cleared with the rest, so a stale `storageState` from a
previous run can never authenticate against a freshly seeded database — the
run's own `globalSetup` login is the only session that exists.

### 3.4 Fixture rows (frozen)

Ids are fixed and are part of the contract; specs may address `/flight/1`,
`/flight/2`, `/trip/1`, `/planned-leg/2/acars` directly.

**`auth_user`** — one row: `username='e2e'`, `password_hash=hashPassword('e2e-password-123')`
(see §2.1). Written with `setAuthUser()`.

**`trips`** — one row:

| id | name | notes | created_at | is_active |
| --- | --- | --- | --- | --- |
| 1 | `E2E Baltic Hop` | `Seeded trip for end-to-end tests` | `2026-02-20T09:00:00.000Z` | 0 |

**`flights`** — two rows, both closed:

| id | aircraft | dep | arr | start_time | end_time | duration_sec | distance_nm | max_alt_ft | max_kts | points | trip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `Airbus A320neo` | `EFHK` Helsinki-Vantaa (60.3172, 24.9633) | `EETN` Tallinn Lennart Meri (59.4133, 24.8328) | `2026-03-01T08:00:00.000Z` | `2026-03-01T09:12:00.000Z` | 4320 | 152.4 | 36000 | 451 | 3 | 1 |
| 2 | `Cessna 172` | `EETN` Tallinn Lennart Meri (59.4133, 24.8328) | `EEPU` Parnu (58.3854, 24.3980) | `2026-03-02T10:00:00.000Z` | `2026-03-02T11:05:00.000Z` | 3900 | 96.1 | 8500 | 122 | 2 | none (ungrouped) |

`flight_points` for flight 1 (3 rows) and flight 2 (2 rows), all with explicit
`ts` values inside each flight's window, first and last `on_ground = 1`, so
`FlightDetail`'s map and altitude chart have a real, non-degenerate track.

**`planned_legs`** — two rows:

| id | trip_id | seq | status | route | cruise | waypoints | approx nm | imported_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 | `planned` | `EETN` Tallinn Lennart Meri → `ESSA` Stockholm Arlanda | 34000 | `EETN`, `ESSA` (both `AIRPORT`) | 212.0 | `2026-02-20T12:05:00.000Z` |
| 2 | `NULL` (loose) | 1 | `planned` | `ESSA` Stockholm Arlanda → `EFHK` Helsinki-Vantaa | 32000 | `ESSA`, `EFHK` (both `AIRPORT`) | 210.0 | `2026-02-21T08:05:00.000Z` |

Both created with `createPlannedLeg()`: `isSnippet: false`,
`flightplanType: 'IFR'`, `aircraftType: 'A20N'`, `sourceProgram:
'msfslogger-e2e-seed'`, `sourceFilename` `e2e-eetn-essa.lnmpln` /
`e2e-essa-efhk.lnmpln`, `sourceSha256` `e2e…0001` / `e2e…0002` (64 hex chars),
**every procedure field `null`**, no alternates. Leg 2's `seq` is 1 because the
loose pool is numbered independently of any trip — verified, not assumed
(`SELECT id,trip_id,seq FROM planned_legs` after the seed returns exactly the
table above).

What each page gets from this, deterministically and non-empty:

- **Home** — `StatsGrid` reads Total Flights 2, Total Trips 1, Total Duration
  8220 s, Total Distance 248.5 nm; "Recent flights" lists both flights
  (`Cessna 172 — EETN → EEPU` first, `Airbus A320neo — EFHK → EETN` second, the
  list is sorted by `start_time` descending); the ground card renders
  `Not on the ground.` (no `ground_sessions` rows — §3.5); the manual-entry
  planned-leg picker offers both legs, one labelled `E2E Baltic Hop · EETN →
  ESSA` and one `No trip · ESSA → EFHK`.
- **AllFlights** — a trip group `🚗 E2E Baltic Hop` with `1 leg`, containing
  flight 1; an `Ungrouped Flights` header; flight 2 beneath it. Five `row`
  elements in total (header row, trip row, one leg, ungrouped header, one
  flight) — asserted in P6 as `toHaveCount(5)`.
- **FlightDetail `/flight/1`** — aircraft, route `EFHK → EETN`, a 3-point track
  on the map. No "Planned Leg" section: that block only renders when
  `flight.planned_leg_id != null` (`client/src/pages/FlightDetail.tsx:289`),
  and flight 1 is deliberately unlinked — see A8. There is no control on this
  page for linking an unlinked flight to a leg.
- **TripDetail `/trip/1`** — the trip name, one flown leg, one planned leg
  `EETN → ESSA`, and the SimBrief panel in its empty state.

### 3.5 What the fixture deliberately omits

No `ground_sessions`, no `acars_messages`, no active trip (`is_active = 0`), no
open flight, no `flight_plan_name` attachment, no `app_setting` row for
SimBrief. Reasons: (a) each of those pages/panels then has a **deterministic
empty state** to assert (`Not on the ground.`), which is a stronger test than a
half-populated one; (b) an open ground session or an active trip changes how
`/api/status` and the leg matcher behave, and this suite is not the place to
pin that behaviour by accident. A later run that wants ACARS or ground-session
coverage extends this table and bumps the marker version (§3.3).

### 3.6 Output

One JSON line on stdout after a successful seed, for the CI log and for a human
debugging a failure:

```json
{"db":"/tmp/msfslogger-e2e/e2e.db","tripId":1,"flightIds":[1,2],"plannedLegIds":[1,2]}
```

Exit 0. Every failure path exits 1 with a message on stderr that names the
resolved database path.

### 3.7 Alternatives considered

- **Seeding over HTTP** (drive `POST /api/trips`, `/api/flights/...` from
  `globalSetup`) — rejected: there is no API to create a historical flight
  (flights are written by the ingest path at rotation/landing), so the fixture
  would be unreachable through the public surface.
- **Committing a prebuilt `e2e.db` binary fixture** — rejected: it would go
  stale the moment `applySchema` changes, and a binary blob in git is invisible
  to review. Building it from `src/db` helpers means the schema migration path
  is exercised on every run.
- **Raw `INSERT` statements with explicit ids instead of the helpers** —
  rejected: it duplicates column lists that `src/db/` owns (the `planned_legs`
  insert alone is 48 columns), and those lists would drift. Resetting
  `sqlite_sequence` (§3.3 step 2) buys the same determinism for three lines.
- **A `--force` flag to bypass the guard** — rejected outright. There is no
  legitimate use, and its existence is the failure mode.

---

## 4. Scratch server & DB provisioning recipe

One script does provisioning, seeding and serving: **`client/e2e/scratch-server.sh`**
(executable, `#!/usr/bin/env bash`, frontend-owned). Playwright runs it as its
`webServer.command` (§2.2); a human runs the identical command by hand. There is
no second recipe for CI — §5 calls the same script through the same npm script.

### 4.1 What it does, in order

1. Resolve `REPO_ROOT` from its own location
   (`cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd`), `SCRATCH` from
   `MSFSLOGGER_E2E_SCRATCH` (default `${TMPDIR:-/tmp}/msfslogger-e2e`), and the
   port:

   ```sh
   PORT="${MSFSLOGGER_E2E_PORT:-3210}"
   ```

   **`MSFSLOGGER_E2E_PORT` is the only input to `PORT`.** An inherited `PORT`
   from the caller's environment is ignored, deliberately: it is the same
   variable the real server reads, so honouring it would let a shell that once
   exported `PORT=3100` move the scratch server to a port Playwright's `baseURL`
   (§2.2, built from `MSFSLOGGER_E2E_PORT` alone) never probes — a 180 s
   readiness timeout with a healthy server running beside it. Guard 1 (§4.4)
   catches only the 3000 case; this line catches the rest.
2. **Guards (§4.4)** — refuse and exit 1 rather than proceed. Guard 5 is the
   Node-major check: this script builds and runs the server, and the default
   `node` on the developer's machine is a major where `better-sqlite3` cannot
   load at all.
3. `rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"` — every run starts from nothing.
4. Copy the tracked tree:

   ```sh
   git -C "$REPO_ROOT" ls-files --cached --others --exclude-standard \
       src client package.json package-lock.json tsconfig.json .nvmrc \
     | grep -v '^client/dist/' \
     | tar -C "$REPO_ROOT" -cf - -T - | tar -C "$SCRATCH" -xf -
   [ -f "$REPO_ROOT/airports.json" ] && cp "$REPO_ROOT/airports.json" "$SCRATCH/"
   ```

   **The three flags are load-bearing, not decoration** (amendment A1):

   - `--cached` — the tracked files, which is what bare `git ls-files` gives.
   - `--others` — the untracked ones. `src/testSeed.ts` (§3.1) is written by the
     implementer of the seed task and is **not committed at the time the suite
     first runs** (only the Orchestrator commits). With `--cached` alone the seed
     never lands in `$SCRATCH`, step 7 runs a `dist/testSeed.js` that was never
     compiled because its source was never copied, and the failure surfaces as an
     opaque 180 s `webServer` timeout (§2.2) instead of "no such file". The same
     applies to every new spec, support file and config in `client/e2e/` before
     the run's first commit.
   - `--exclude-standard` — makes `--others` honour `.gitignore`, which is what
     keeps the copy clean. Verified against the real `.gitignore`: it covers
     `node_modules/`, `dist/`, `client/node_modules/`, `client/dist/`,
     `flights.db`, `start.sh`, `server.log`, `backups/`, `certs/`.
     **Never drop this flag** — without it, `--others` sweeps the live
     `flights.db` and a stale `dist/` into the scratch tree.

   Evidence (throwaway repo, git 2.43.0, 2026-09-17): with one tracked
   `src/tracked.ts`, one untracked `src/testSeed.ts`, an ignored
   `client/dist/index.html` and an ignored `flights.db`, bare
   `git ls-files src client` printed `src/tracked.ts` only; the flagged form
   printed `src/testSeed.ts` and `src/tracked.ts` and nothing ignored.

   A file is listed once — a path is either cached or other, never both — so the
   tar file list carries no duplicates. The `grep -v '^client/dist/'` stays as
   belt-and-braces in case someone force-adds a built asset.

   Still `git ls-files`, not `cp -r`: the copy can never pick up `flights.db`,
   `flights.db-wal`, `backups/`, `certs/`, `start.sh`, `server.log` or a stale
   `dist/`. `airports.json` is copied because `src/airports.ts` resolves it from
   `process.cwd()` and would otherwise fetch 29 549 airports over the network on
   every run (with it: `[Airports] Loaded 29549 airports from cache`).

   **Rejected alternative:** a written rule that new files must be `git add`ed
   before the suite is run. It works, but it is a rule a human and an agent must
   remember at exactly the moment they are debugging something else, and its
   failure mode is the silent timeout above. The flags make the script correct
   with no precondition on the caller.
5. Link the dependency trees instead of reinstalling them:

   ```sh
   ln -s "$REPO_ROOT/node_modules" "$SCRATCH/node_modules"
   ln -s "$REPO_ROOT/client/node_modules" "$SCRATCH/client/node_modules"
   ```

   If either target does not exist, exit 1 telling the caller to run `npm ci`
   (root) / `cd client && npm ci` first. The build only **reads** these trees:
   P2 confirms `client/node_modules/.vite`'s mtime is unchanged after a full
   scratch build, and that no file in the real checkout is written.
6. `cd "$SCRATCH" && npm run build` — the client build writes
   `$SCRATCH/client/dist`, the server build writes `$SCRATCH/dist`. **This is
   the whole point of the copy**: `npm run build` in the real checkout would
   overwrite the `client/dist` the user's running server serves live, on the
   next request, with no restart (ENVIRONMENT.md § "Verifying a client-side
   change…"). Measured cost: 10.2 s (P2).
7. Seed:

   ```sh
   export FLIGHTS_DB_PATH="$SCRATCH/e2e.db"
   node "$SCRATCH/dist/testSeed.js"
   ```

   `export`, not a prefix — see §3.2 rule 1.
8. `exec` the server (so the process Playwright tracks *is* the server, and
   killing it kills the right thing):

   ```sh
   # PORT was set in step 1 from MSFSLOGGER_E2E_PORT; nothing else assigns it.
   exec env PORT="$PORT" BIND_HOST=127.0.0.1 \
       FLIGHTS_DB_PATH="$SCRATCH/e2e.db" \
       INGEST_TOKEN=e2e-ingest-token-not-a-secret \
       node dist/index.js
   ```

The script is a foreground process by design. It has no `start`/`stop`
subcommands and writes no PID file: its lifetime is its parent's.

### 4.2 Environment (frozen)

| Variable | Value | Why exactly this |
| --- | --- | --- |
| `PORT` | `3210`, from `MSFSLOGGER_E2E_PORT` only — an inherited `PORT` is ignored (§4.1 step 1) | Not 3000 (the user's live server), not 5173 (Vite dev), not 3100 (the port ad-hoc scratch servers in this repo have used). |
| `BIND_HOST` | `127.0.0.1` | Loopback, so `loadConfig()` allows plaintext (§4.3) and the scratch server is unreachable from the LAN. |
| `FLIGHTS_DB_PATH` | `$SCRATCH/e2e.db` | Exported before the seed and passed to the server. Never a path inside the repo. |
| `INGEST_TOKEN` | `e2e-ingest-token-not-a-secret` | **Required**: `loadConfig()` step 4 refuses to start without it unless `ALLOW_UNAUTHENTICATED_INGEST` is set. A token is preferred over the opt-out so the scratch server's middleware chain (`createIngestTokenScopeGate`) is configured the way production is. The literal is ≥ 16 chars, so no startup warning. |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | **unset** | §4.3 |
| `ALLOW_PLAINTEXT_HTTP` | **unset** | §4.3 |
| `SESSION_SECRET` | **unset** | The server generates one into the scratch database's `app_secret` table on first start, exercising the real path. |
| `MSFSLOGGER_E2E_SCRATCH` | default `${TMPDIR:-/tmp}/msfslogger-e2e` | CI sets `${{ runner.temp }}/msfslogger-e2e` (§5.2). |

### 4.3 Why plaintext on loopback, and not TLS

`src/config.ts` step 3 takes the **loopback branch before it looks at
`ALLOW_PLAINTEXT_HTTP`**: with `BIND_HOST` in `['127.0.0.1','::1','localhost']`
and no TLS pair, it logs `No TLS configured — serving plaintext HTTP on loopback
only.` and starts. `ALLOW_PLAINTEXT_HTTP` is therefore **not set** — it would be
dead weight, and setting it would suggest to a future reader that a non-loopback
bind is supported here. It is only needed when `BIND_HOST` is *not* loopback,
which this recipe never does.

TLS was the alternative and is rejected:

- It needs a certificate. Reusing the developer's `certs/` couples the suite to
  one machine; generating a self-signed cert per run adds an `openssl`
  dependency and ~1 s to every run.
- `ignoreHTTPSErrors: true` would have to be set in `playwright.config.ts`,
  which is exactly the switch that hides a real TLS regression.
- It changes the cookie: `src/server.ts` sets `cookie.secure =
  config.tls.enabled`, so under TLS the session cookie is `Secure` — fine over
  HTTPS, but one accidental `http://` in a spec then fails with a confusing
  "not logged in" instead of a connection error.

Loopback plaintext keeps the browser's cookie handling honest (`"secure": false`
in the captured `storageState`, P5) and needs zero external material. The
trade-off — TLS-specific behaviour is not covered end to end — is recorded in
Risks.

### 4.4 Guards: this never runs against the live checkout

Before touching anything, the script exits 1 if:

1. `PORT` is `3000` — `refusing to use port 3000 (the developer's live server)`.
2. `SCRATCH` is the repo root or lives under it (`case "$SCRATCH" in
   "$REPO_ROOT"|"$REPO_ROOT"/*)`) — the copy and the build must land outside the
   tree, or step 6 becomes exactly the live-build accident it exists to prevent.
3. `$REPO_ROOT/node_modules` or `$REPO_ROOT/client/node_modules` is missing.
4. `git` reports the repo root is not a git work tree (the `git ls-files` copy
   would silently produce an empty tree).
5. **The running `node` is not the major `.nvmrc` pins.**

   ```sh
   want="$(tr -dc '0-9' < "$REPO_ROOT/.nvmrc" | head -c 2)"   # "20"
   have="$(node -p 'process.versions.node.split(".")[0]')"
   [ "$have" = "$want" ] || {
     echo "refusing to run under Node $have; this repo needs Node $want" >&2
     echo "  export NVM_DIR=\"\$HOME/.nvm\"; . \"\$NVM_DIR/nvm.sh\"; nvm use $want" >&2
     exit 1
   }
   ```

   This is the guard the original freeze was missing (amendment A2). The
   developer's default `node` is v26.3.1, and `better-sqlite3` is a native addon
   with no prebuilt binary for that ABI — `require('better-sqlite3')` throws, so
   step 8's server dies on startup and the only symptom Playwright reports is a
   180 s readiness timeout on `${baseURL}/login`, with the real error buried in
   piped stdout. `.claude/ENVIRONMENT.md` states the rule for the whole repo; the
   script enforces it at the one point where a wrong Node is both fatal and
   invisible. Reading the major from `.nvmrc` rather than hard-coding `20` means
   the guard follows the pin when the repo moves to 22 (see Risks 3).

   The script does **not** source `nvm` itself and does not switch versions for
   the caller: it refuses and prints the command. A script that silently changed
   the interpreter under the caller would hide exactly the mismatch CI needs to
   fail on. In CI the guard is a no-op — `actions/setup-node` with
   `node-version-file: .nvmrc` (§5.2) already puts the right major on `PATH`.

Additionally: the script never writes **anything** inside `$REPO_ROOT`. It only
reads. The seed's own guard (§3.2) is the second line of defence on the database
side, and `rm -rf "$SCRATCH"` is only ever applied to a path that passed guard 2.

Verification a reviewer can re-run: record `md5sum client/dist/index.html
flights.db` in the real checkout before and after a full `npm run test:e2e`.
Both were unchanged across two full runs in P6 (`2bc39f5b…`, `d7b2a00e…`).
(Per ENVIRONMENT.md, treat an md5 change on `flights.db` as a prompt to look
closer, not as proof of contamination — the live server's own WAL checkpointing
rewrites those bytes on its own.)

### 4.5 Teardown

Playwright owns it: it kills the `webServer` process it spawned when the run
ends, on success, on failure and on `Ctrl-C`. Because step 8 uses `exec`, the
tracked PID is the server itself — there is no wrapper shell left holding the
port. **Nothing in this design kills by name or pattern**; there is no `pkill
-f node`, no `killall`, no port-scan-and-kill. If a run is killed hard enough to
leak the process, the operator kills that one PID (`lsof -ti :3210`).

The scratch directory is left on disk after the run, deliberately: `e2e.db`,
`build.log` and the server's stdout are what a failure investigation needs. The
next run deletes it (step 3). It lives under the system temp dir, so the OS
reclaims it eventually.

### 4.6 The same recipe, both places

| | Local | CI |
| --- | --- | --- |
| Command | `npm run test:e2e` | `cd client && npm run test:e2e` (§5.2) |
| Server | `scratch-server.sh` via `webServer` | same |
| Scratch root | `${TMPDIR:-/tmp}/msfslogger-e2e` | `${{ runner.temp }}/msfslogger-e2e` |
| Deps | symlinked from the developer's `node_modules` | symlinked from the runner's `npm ci` output |
| Browsers | `npx playwright install chromium`, once | `npx playwright install --with-deps chromium`, per job |
| Node 20 | caller runs `nvm use 20` first; guard 5 (§4.4) refuses otherwise | `actions/setup-node` with `node-version-file: .nvmrc` |

The only difference is the value of one environment variable. A CI failure is
reproducible locally by running the same npm script — under Node 20:

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
npm run test:e2e
```

`.nvmrc` reads `20`; `nvm use` does not persist across shells, so this prefix
belongs on the command, not in a setup step someone did yesterday.

---

## 5. CI job shape & reporting

All changes go into the **existing `.github/workflows/ci.yml`**. No new workflow
file. The current single job `build-and-test` keeps its name, its triggers
(`push`, `pull_request`) and all seven of its existing steps in order — **two
bare `uses:` setup actions** (`actions/checkout@v4`, `actions/setup-node@v4`
with `node-version-file: .nvmrc`) followed by **five named steps** (`Install
root dependencies`, `Install client dependencies`, `Build (client + server)`,
`Typecheck tests`, `Run tests`).

### 5.1 `build-and-test` — two steps appended

After the existing `Run tests` step (backend Vitest) — the last of the job's
seven existing steps, see the §5 preamble — append:

```yaml
      - name: Typecheck client tests
        run: cd client && npm run test:types

      - name: Client component tests
        run: cd client && npm test
```

Both run on the runner's checkout, need no server and no database, and take
seconds (the whole component suite ran in 1.35 s in P3). `Install client
dependencies` (`cd client && npm ci`) already exists earlier in the job and now
installs the §1.7 devDependencies too. The existing `Build (client + server)`
step is unaffected — P4 shows the emitted bundle is identical with the test
files present.

### 5.2 `e2e` — a second job

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: build-and-test
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc

      - name: Install root dependencies
        run: npm ci

      - name: Install client dependencies
        run: cd client && npm ci

      - name: Install Playwright browser
        run: cd client && npx playwright install --with-deps chromium

      - name: Run end-to-end tests
        run: cd client && npm run test:e2e
        env:
          MSFSLOGGER_E2E_SCRATCH: ${{ runner.temp }}/msfslogger-e2e

      - name: Upload Playwright HTML report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: client/playwright-report/
          retention-days: 7

      - name: Upload traces, screenshots and JUnit XML
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-test-results
          path: client/test-results/
          retention-days: 7
```

Frozen decisions inside that block:

- **`needs: build-and-test`.** The e2e job builds the app again (inside the
  scratch tree) and would fail slowly and confusingly on a tree that does not
  compile. Sequencing costs little here — the build is ~10 s — and a broken
  build burns no browser-install minutes.
- **One browser, chromium.** Firefox and WebKit triple the install time and the
  run time for an app the user runs in one browser. Adding a project later is a
  two-line change to §2.2.
- **`--with-deps`** installs the OS libraries the runner image lacks; the
  browsers themselves are cached in `~/.cache/ms-playwright` by the action
  runner image where available. No `actions/cache` step: the download is ~40 s
  and a cache key that goes stale silently costs more than it saves.
- **No separate build/seed/start/stop steps.** Provisioning, build, seed, start
  and teardown all happen inside `npm run test:e2e` via `webServer` (§4). A
  hand-rolled `node dist/index.js &` step plus a `kill` step is the shape that
  leaks processes and diverges from what a developer runs locally.
- **No service containers, no database service.** SQLite in the runner's temp
  dir.

### 5.3 Reporting

| Reporter | Where it lands | Visible as |
| --- | --- | --- |
| `list` | job log | inline pass/fail per spec, streamed |
| `html` (`open: 'never'`) | `client/playwright-report/` | `playwright-report` artifact on the Actions run page — download, open `index.html`; failure screenshots and traces are embedded in it |
| `junit` | `client/test-results/junit.xml` | inside the `playwright-test-results` artifact on failure; machine-readable for any future annotation step |

`trace: 'retain-on-failure'` and `screenshot: 'only-on-failure'` (§2.2) mean a
green run uploads a small report and a red one uploads everything needed to
replay the failure with `npx playwright show-trace`. The HTML report is uploaded
with `if: ${{ !cancelled() }}` — on failure *and* on success, because the
failure case is exactly when the artifact must exist. The traces/JUnit artifact
is `if: failure()` only, to keep green runs cheap.

The component suite reports through the job log only (`reporters: ['default']`);
no artifact. Its failures are readable as text and it has no screenshots.

### 5.4 A failing test fails the job

`playwright test` exits non-zero when any test fails — verified: a deliberately
failing assertion gave `playwright exit=1` with `1 failed` (P5 probe). `vitest
run` likewise. Neither step uses `continue-on-error`, `|| true`, or
`if: always()` on the test step itself (only the artifact uploads carry a
condition), so a red test is a red job and a red check on the PR.

`retries: 1` in CI (§2.2) covers a genuinely flaky first-paint race; a test that
fails both attempts still fails the job, and the HTML report marks it as flaky
if attempt 2 passes. A spec that becomes reliably flaky is a bug to fix, not a
retry count to raise.

### 5.5 Docker is unaffected

`Dockerfile` stage 1 runs `npm ci` in `client/` with dev dependencies, then
`COPY client/ ./` and `npm run build`. With §1.4's `exclude` the build does not
typecheck the test files, `e2e/` is outside `include: ["src"]`, and only
`client/dist` is copied into the production image — no test code ships.
`playwright@1.63.0` declares **no `scripts` at all** (P8), so `npm ci` in the
alpine builder downloads no browser binaries and cannot fail on musl. **No
Dockerfile change is required by this design**, and any implementer who thinks
one is needed should return `blocked` rather than edit it.

---

## Must-not-change list

The Reviewer checks these one by one. Each is a guarantee this design makes
about behaviour that exists today.

1. **The user's running server keeps serving.** Nothing in this run stops,
   restarts, rebuilds over or reconfigures the process on port 3000. No task
   runs `npm run build`, `npm run build:client` or `vite build` in
   `/home/guilherme/msfslogger`; every build happens in the scratch copy (§4).
   Evidence to re-run: `md5sum client/dist/index.html` before and after —
   `2bc39f5beda19389908e20ffbf12415c` across all prototypes.
2. **`flights.db` is never opened for writing by anything in this run.** The
   seed refuses it (§3.2, P7) and the scratch server points at `$SCRATCH/e2e.db`.
3. **`npm test` at the root stays the backend suite**, `vitest run` with the
   existing root `vitest.config.ts` — same include glob (`tests/**/*.test.ts`),
   same excludes (which already exclude `client/**`), same `tests/setup.ts`,
   same runtime. The client suites are reachable only through new script names.
4. **Root `vitest.config.ts` and root `tsconfig.test.json` keep their behaviour
   exactly.** One comment-only exception, applied in this run (amendment A7):
   `vitest.config.ts` line 1 carried a cross-run citation
   (`// vitest.config.ts — CommonJS on purpose; see design §3.2.`), which this
   document's own header forbids in application source. It now states the
   reason in full instead of pointing at a document. **No config key, value,
   glob or export shape changed** — the diff is the comment block at the top of
   the file and nothing else (`git diff --stat vitest.config.ts` → `5 insertions,
   1 deletion`; `git diff vitest.config.ts` shows only comment lines). Verified
   after the edit: `npm test` under Node 20.20.2 → `Test Files 38 passed (38) /
   Tests 850 passed (850)`, and no Vite `configLoader` warning
   (`npm test 2>&1 | grep -i 'warn\|unsupported'` → no output), so the CommonJS
   shape the comment describes is still in force. `tsconfig.test.json` is
   untouched entirely.
5. **`client/vite.config.ts` is not edited.** The dev server's port and `/api`
   proxy stay exactly as they are; Vitest gets its own config file (§1.2).
6. **The production client bundle is unchanged.** P4: the emitted asset hashes
   (`index-BI1xHYYp.css`, `index-BV756Q20.js`) are identical with and without
   the test files in `client/src`. The only edit to `client/tsconfig.json` is an
   added `exclude` key.
7. **No application source changes to make tests pass.** No test-only prop, no
   `NODE_ENV === 'test'` branch, no auth bypass, no test-only route or
   middleware. Adding a `data-testid` is the one allowed exception (§1.8 rule 3)
   and must be justified per instance.
8. **The auth contract is untouched**: `/api/auth/login` semantics, the
   throttle, `requireAuth`, `requireSameOrigin`, `SESSION_COOKIE_NAME`,
   `cookie.secure = config.tls.enabled`. The suite authenticates the way a
   browser does (§2.4).
9. **`src/db/schema.ts` gains nothing.** The e2e marker is a row in the existing
   `app_setting` table (`name='e2e_seed'`), not a new column or table. No
   migration, no DDL, nothing to apply to a database holding real rows.
10. **`.github/workflows/ci.yml` keeps its existing job, name, triggers and all
    seven of its existing steps in order** — two bare `uses:` setup actions
    (`actions/checkout@v4`, `actions/setup-node@v4`) plus five named steps
    (`Install root dependencies`, `Install client dependencies`, `Build (client
    + server)`, `Typecheck tests`, `Run tests`). The change is two steps
    appended after `Run tests`, plus one new job. Check with
    `grep -n 'uses:\|name:' .github/workflows/ci.yml`.
11. **The Dockerfile is not edited** (§5.5).
12. **No process is ever killed by name or pattern.** Teardown is Playwright
    killing the PID it spawned (§4.5).

## Risks

1. **The e2e suite pins the plaintext-loopback path only.** TLS-specific
   behaviour — the `Secure` cookie flag, HTTPS redirects, cert loading — is
   covered by unit-level reasoning and by the user's own deployment, not by this
   suite. *Falsified by*: a regression that only shows up when
   `config.tls.enabled` is true. *If it happens*: add a second Playwright
   project with a generated self-signed cert and `ignoreHTTPSErrors`, as a
   deliberate follow-up, not a default.
2. **Two Vitest majors in one repo** (root 4.1.11, client 3.2.7 — §1.7). A
   future contributor may "fix" the mismatch by bumping the client and break it,
   since Vitest 4 requires Vite ≥ 6 while the client is on Vite 5. *Mitigation*:
   §1.7 states the reason at the pin; the pin is exact, not a caret range.
3. **Node 20 is the ceiling for several test dependencies** (`jsdom` ≤ 26,
   `@testing-library/jest-dom` ≤ 6.9.1). When `.nvmrc` moves to 22, these pins
   should be revisited together; until then, `npm update` on the client can
   silently pull an incompatible major. *Mitigation*: exact pins, and CI runs on
   `node-version-file: .nvmrc`, so an incompatible install fails there first.
4. **The `node_modules` symlink assumes the build only reads it.** P2 shows Vite
   5 writes nothing (`client/node_modules/.vite` mtime unchanged across a full
   scratch build), but a future Vite/plugin version could populate a cache
   through the symlink and thereby write into the developer's checkout.
   *Falsified by*: that mtime changing after a scratch build. *If it happens*:
   switch step 5 to `cp -al` (hard-link copy, falling back to `cp -a`), which
   keeps the speed and redirects new files into the scratch tree.
5. **Fixture drift.** The specs assert on counts and on rendered strings derived
   from §3.4 ("1 leg", 5 table rows, `🚗 E2E Baltic Hop`). A change to either
   the fixture or the page's copy breaks them together. *Mitigation*: the
   fixture version marker (§3.3 step 5) and the rule that the fixture table is
   the single source of truth — specs never invent their own rows.
6. **`src/testSeed.ts` compiles into `dist/` and therefore into the production
   Docker image**, exactly as `setPassword.ts` already does. It is inert unless
   invoked with `FLIGHTS_DB_PATH` set, and its guards (§3.2) refuse a database
   that holds real data. *Falsified by*: any path where it could run implicitly
   — none exists; nothing imports it, and `index.js` never references it.
7. **Playwright browser download in CI** is a network dependency on every run
   (~40 s). A Microsoft CDN outage turns the e2e job red for reasons unrelated
   to the code. *Mitigation if it bites*: an `actions/cache` step keyed on the
   Playwright version, added then rather than pre-emptively.
8. **Wall-clock-derived rendering.** `formatDate` output depends on the runner's
   timezone. Fixture timestamps are fixed (§3.3), but a spec that asserts on a
   *formatted* date would still differ between a developer's TZ and the
   runner's UTC. *Mitigation*: §1.8 rule 4 — assert on idents, aircraft, counts
   and route strings, never on a rendered date; if a date assertion becomes
   necessary, set `TZ=UTC` in the `webServer` env and in the Vitest config, and
   record it as an amendment here.
9. **`webServer` / `globalSetup` ordering is assumed, not documented.** The
   prototypes (P5, P6) show Playwright 1.63 starting the `webServer` before
   `globalSetup` runs, but neither Playwright doc page states the order, and no
   reviewer without Playwright installed can reproduce it. *Mitigated, not
   merely noted*: §2.3's `waitForServer` loop makes `globalSetup` correct under
   either order, so the exposure is a slower failure message, not a broken
   suite. *Falsified by*: a `globalSetup` run where the readiness poll actually
   iterates — which T-005 is asked to observe and report either way. *If the
   order is ever reversed by a Playwright upgrade*: nothing changes; the poll
   absorbs it.
10. **Untracked-file copying cuts both ways** (§4.1 step 4). `--others` is what
    lets an uncommitted `src/testSeed.ts` reach the scratch tree, and it equally
    copies any other uncommitted file under `src/` or `client/` — a half-written
    module, a scratch script. That is the correct behaviour (the suite should
    test the working tree, not the last commit), but it means a failing e2e run
    can be caused by a file the developer forgot they had. *Mitigation*:
    `--exclude-standard` keeps everything `.gitignore`d out, and the scratch
    tree is left on disk after a run (§4.5) so `ls $SCRATCH/src` answers the
    question in one command.
