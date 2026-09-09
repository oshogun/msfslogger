# Intake — 2026-09-09-vitest-unit-tests

## Goal

Introduce Vitest as the project's unit test framework and write a first suite
covering the modules the user identified as highest-value:

- Flight manager: state transitions, pause detection, track-derived duration
  (`src/flightManager.ts`) — called out explicitly as deserving "a nasty test
  suite."
- ICAO parsing (`src/airports.ts`)
- Leg matching (`src/legMatcher.ts`)
- Planned-route matching (`src/plannedLegClose.ts`, and `src/lnmpln.ts` /
  `src/flightPlans.ts` to the extent they overlap with route matching)

Explicitly out of scope for this run: traffic filtering (`src/trafficStore.ts`),
SQLite persistence (`src/db.ts`), and ingest validation (`src/ingest.ts`). The
user asked for a broader-than-flight-manager first pass but scoped it to these
four areas in the clarifying round; the remaining three are good candidates for
a follow-up run.

## User-frozen decisions (verbatim from clarification)

- Override the "no test framework" policy in `CLAUDE.md` / `.claude/ENVIRONMENT.md`:
  **yes, add one.**
- Runner: **Vitest** (accepted the dependency cost over `node:test` for the
  better DX — watch mode, mocking, snapshots).
- Scope: **broader first pass** — "Flight manager plus ICAO parsing and
  leg/route matching — bigger, needs the full Plan/Design loop."

## Success criteria

- `vitest` is installed and runnable via an `npm test` (or `npm run test`)
  script, without touching the live server or `flights.db`.
- Unit tests exist for the four in-scope modules above, exercising the
  specific behaviors the user named for flight manager (state transitions,
  pause detection, track-derived duration) plus meaningful coverage of ICAO
  parsing and leg/route matching logic.
- Tests are deterministic, hermetic (no network, no live DB, no filesystem
  writes outside a scratch/tmp path), and fast enough to run on every change.
- `npx tsc` / `npm run build` still pass after the change.
- `CLAUDE.md` and `.claude/ENVIRONMENT.md` are amended to reflect the new
  verification story (test framework now exists) — done by the Orchestrator
  directly after the run ships, not by a sub-agent, since it's a doc/policy
  edit outside any `allowed_paths`.

## Tier and workflow

Full loop (tier 3). Reasons: multiple files across modules, introduces new
tooling (Vitest config, `package.json` scripts, a test-file convention) that
future runs will build on — that convention is the "contract" the Design step
exists for, even though there's no schema/endpoint change. Not a single-seam
change.

## Steps this run takes / skips

1. Intake — this file.
2. Plan — Planner, `plan.json`.
3. Design — **taken**, not skipped. The contract to freeze: Vitest config
   (test file location/naming, ts-node vs native ESM/CJS transform, coverage
   settings if any), and how flight-manager tests fake time/SimConnect input
   without a live agent or DB (fixtures vs hand-built objects). This shapes
   every dispatcher task that follows and is worth freezing once.
4. Implement — Dispatchers, batched by module per the plan's `allowed_paths`.
5. Review — every Dispatcher result reviewed before merge.
6. Ship — **taken**. This run touches `package.json` (new dependency, new
   script) which is build tooling.
7. Report — Orchestrator summary to the user, plus the CLAUDE.md/ENVIRONMENT.md
   amendment noted above.

## Non-negotiables restated

- Never touch the live server (port 3000) or live `flights.db`. Tests must not
  open the real database file; any DB-touching test uses `:memory:` or a
  scratch copy.
- No agent commits, pushes, or switches branches — Orchestrator does that.
- Every Dispatcher/DevOps result goes to Reviewer before merge.
