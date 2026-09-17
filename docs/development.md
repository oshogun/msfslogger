# Development

## Repository layout

```
src/                  Express + TypeScript server
  routes/             One file per feature's HTTP routes
  db/                 One file per table; only place raw SQL is allowed to live
  auth/               Session, ingest-token, password, login-throttle logic
  inspect-*.ts        ts-node CLI inspectors for eyeballing behavior against real data
client/               React + Vite web app
  src/pages/          One component per route
  src/components/     Shared UI, including all Leaflet map components
  src/hooks/          useSession (auth), useStatus (live polling)
  src/utils/          api.ts (fetch wrapper), format.ts, geo.ts, downsample.ts
agent/                Standalone Node.js SimConnect agent (runs on Windows, separate from the server's own package.json)
tests/                Vitest suite — mirrors src/ for unit tests, tests/db/ for the db/ modules
samples/              Read-only fixtures (e.g. .lnmpln files) used by tests
docs/                 This documentation set
.claude/, .codex/, AGENTS.md, CLAUDE.md   Agentic-coding workflow config — not part of the runtime, see below
```

A Tauri/MCDU desktop client used to live in this repository at
`windows-client/`; it has moved to its own repository,
[`oshogun/msfslogger_mcdu`](https://github.com/oshogun/msfslogger_mcdu), and
isn't part of this tree.

## Setting up

See [setup.md](setup.md) for the full bootstrap. Short version:

```bash
nvm use
npm install && (cd client && npm install)
npm run build
npm run set-password
```

## Testing strategy

`npm test` (Vitest) covers pure/near-pure decision logic: flight state
transitions and pause/duration handling (`src/flightManager.ts`), leg
matching (`src/legMatcher.ts`), hand-close rules (`src/plannedLegClose.ts`),
`.lnmpln`/SimBrief/ICAO parsing, and most of `src/db/*.ts` (`tests/db/`
covers `connection`, `flights`, `trips`, `plannedLegs`, `settings`,
`acarsMessages`, and `schema`/migrations — `groundSessions.ts` has no
dedicated test file yet, only indirect coverage via
`tests/flightManager.ground.test.ts`). It never touches the real
`flights.db`, the network, or a live server:

- `tests/setup.ts` points `FLIGHTS_DB_PATH` at a tmpdir path before anything
  else runs, and silences `console.*` output.
- Most test files mock `./db`/`./airports` at the module boundary
  (`tests/helpers/index.ts` provides the mock objects and fixture builders);
  a smaller set of tests (the four CLI scripts, and `tests/db/*`) use a real
  scratch SQLite database instead (`tests/helpers/db.ts`), never the
  repository's own `flights.db`.
- `restoreMocks: true` in `vitest.config.ts` only restores `vi.spyOn()`
  spies, not plain `vi.fn()` mocks — call `resetMocks()` from the helpers in
  `beforeEach`/`afterEach` if a test needs a clean mock between cases.

```bash
npm test            # run once
npm run test:watch  # watch mode
npm run test:types  # typecheck src/ + tests/ together (npm run build only typechecks src/)
```

`src/db/groundSessions.ts` (see above) is the clearest gap; a reasonable
place to add a dedicated test file before changing that module's logic.

Beyond Vitest: `npx tsc --noEmit` for a fast typecheck, `curl` against a
locally-run scratch server (different port, scratch database — never the
real `flights.db` or the port your own instance runs on), direct
`better-sqlite3` queries, and the `src/inspect-*.ts` CLI scripts
(`ts-node src/inspect-<name>.ts`) for behavior that's easier to check
against a real fixture than to assert on in a unit test.

## CI

`.github/workflows/ci.yml` runs on every push and every pull request (no
branch filter), on Node 20 (from `.nvmrc`): `npm ci` (root and `client/`),
`npm run build`, `npm run test:types`, `npm test`. There's no separate lint
step and no coverage gate configured.

## Branching and review

This repository doesn't enforce a formal process (no `CONTRIBUTING.md`, no
PR template, no branch-protection config checked in). In practice, work
happens on short-lived branches prefixed by kind — `feat/...`, `fix/...`,
`docs/...` — merged into `main`, with CI required to pass. Treat that as a
convention to follow, not a hard rule this repo can enforce for you.

## Agentic coding workflow

If you're working in this repo via Claude Code or Codex, [`CLAUDE.md`](../CLAUDE.md)
(and its Codex mirror, [`AGENTS.md`](../AGENTS.md)) define an orchestrator/
sub-agent workflow with its own routing rules, run artifacts under
`.claude/runs/`, and cost-discipline conventions. That's tooling
configuration for AI-assisted development, not application behavior — this
page won't repeat it; start there directly if that's what you're looking
for.
