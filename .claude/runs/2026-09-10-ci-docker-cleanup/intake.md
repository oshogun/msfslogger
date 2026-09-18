# intake.md — run 2026-09-10-ci-docker-cleanup

## Tier

Tier 2 (`.claude/agents.md` § Cost discipline rule 6) — two single-seam
changes, no new contract, no schema change. One Dispatcher + one Reviewer.
`intake.md` is the only artifact; no `plan.json`, no `design.md`.

## Source

User reviewed the repo and listed several findings unprompted (not tied to any
existing run). Asked via AskUserQuestion which to act on now. Frozen decision,
verbatim from the two answers:

- Work on now: **"CI workflow"** and **"Docker Compose cleanups"**.
- Everything else in the list (frontend tests, README quick-start/screenshot,
  releases/changelog/contribution guide, ESLint/Prettier, large-file refactors,
  dangling `design.md` comment references) — **"Just log them, don't act now"**.
  These are noted below under Deferred and not otherwise acted on.

## Goal

1. Add a CI workflow that runs build, typecheck and the test suite on every
   commit — currently there is none, and the project has 183 tests that only
   run when someone remembers to run `npm test` locally.
2. Clean up `docker-compose.yml`: remove stale comments about remote
   SimConnect (`SIMCONNECT_HOST`/`SIMCONNECT_PORT`) — confirmed dead, `grep -rn
   "SIMCONNECT_HOST\|SIMCONNECT_PORT"` across `src/`, `client/`, `agent/`,
   `README.md` returns nothing outside the compose file itself, and
   `README.md` states the local Windows agent is the only supported connection
   method (`agent/README.md`, root `README.md` § Running with Docker,
   prerequisites list the agent, not a remote SimConnect host). And fix the
   bind-mount footgun: `./flights.db:/app/flights.db` — if `flights.db`
   doesn't exist on the host yet, Docker creates a directory at that path
   instead of failing, silently breaking the container's `better-sqlite3` open.

## Decision recorded: how the bind-mount footgun gets fixed

Not a named volume. `README.md` § "2. Persistent data" and the "WAL note for
Docker" paragraph document the bind mount as deliberate — a host-visible file
that survives rebuilds and that `npm run backup` and manual inspection can
reach directly. Switching to a named volume would contradict that documented,
working design and is a bigger change than this run's scope (single seam, no
architecture change).

The actual footgun is narrower than "wrong volume type": Compose creates a
directory when the bind-mount source file is missing. The fix is to make sure
the file exists before first `docker compose up`, not to change what kind of
mount it is. Concretely: add an explicit `touch flights.db` (and `mkdir -p
flight_plans`) step to `README.md`'s Docker quick start, immediately before
`docker compose up --build`, plus a one-line comment in `docker-compose.yml`
pointing at it. This is the standard fix for this known Compose gotcha and
changes nothing about the documented persistence model.

## Success criteria

**CI (`.github/workflows/ci.yml`):**
- Triggers on push and pull_request.
- Node 20 (matches `.nvmrc`, `.claude/ENVIRONMENT.md` — Node 26 default is
  wrong for `better-sqlite3`'s native binding).
- Installs root deps (`npm ci`) and client deps (`cd client && npm ci`) —
  confirmed both have their own `package-lock.json`.
- Runs `npm run build` (builds client then server, per `package.json`),
  `npm run test:types`, `npm test`.
- A workflow that would fail on the current tree is a defect — Dispatcher
  verifies each step's command locally (`nvm use 20`) before calling it done,
  not just that the YAML is well-formed.

**`docker-compose.yml` / `README.md`:**
- The `SIMCONNECT_HOST`/`SIMCONNECT_PORT` comment block and env lines are
  gone from `docker-compose.yml`.
- `README.md`'s Docker quick start gets the `touch flights.db` / `mkdir -p
  flight_plans` step before `docker compose up --build`, and a short note on
  why (Compose creates a directory instead of failing if the bind-mount source
  is missing).
- Nothing else in `docker-compose.yml` changes: `INGEST_TOKEN`, `TLS_CERT_FILE`,
  `TLS_KEY_FILE`, `ALLOW_PLAINTEXT_HTTP`, `SESSION_SECRET`, the `flight_plans`
  bind mount, `init: true`, the commented-out TLS cert mount — all untouched.

## Must not change

- No change to `Dockerfile`, application code, or the documented persistence
  model (bind mount stays a bind mount).
- No change to test behavior — CI runs the existing suite, doesn't add or
  modify tests.

## Deferred (logged, not acted on this run)

From the user's original list, explicitly deferred per the "Backlog" answer:
frontend tests, README screenshot/five-minute quick-start/compact feature
summary near the top, releases/changelog/contribution guide/issue templates/
compatibility matrix, ESLint/Prettier + dependency maintenance, large-file
refactors (`db.ts` ~1500 lines, `server.ts` ~1000, `lnmpln.ts` ~980,
`TripDetail.tsx` ~815), and source comments citing an uncommitted `design.md`/
numbered-sections/amendments spec. Candidates for future runs, not tracked
further here.

## Allowed paths

`.github/workflows/**`, `docker-compose.yml`, `README.md`

## Steps skipped and why

- **Plan** — skipped, tier 2 doesn't use `plan.json`; the two seams are stated
  directly above.
- **Design** — skipped, no schema/API/contract change.
- **Ship (DevOps)** — skipped as a separate step; this run's content *is*
  CI/deploy config, so the Dispatcher implements it directly and Review is the
  only gate, per the tier-2 path.
