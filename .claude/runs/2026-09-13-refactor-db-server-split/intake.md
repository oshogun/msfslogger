# Intake — refactor-db-server-split

## Source
`user_stories/refactor.md` (verbatim spec, frozen by the user):

> ## Problem Statement
> Current technical debt is primarily structural (file size and responsibility creep), not algorithmic:
> - `db.ts` is approximately 1,400 lines.
> - `server.ts` is approximately 1,000 lines.
>
> ## Goal
> Reduce responsibility concentration in `db.ts` and `server.ts` while preserving the current simple architecture.
>
> ## Non-Goals
> - Do **not** introduce an ORM.
> - Do **not** introduce a complex/new architecture.
> - Do **not** change the role of `FlightManager` as domain/state-machine logic.
>
> ## Target Module Split
>
> ### Database Layer
> - `db/flights.ts`
> - `db/trips.ts`
> - `db/plannedLegs.ts`
> - `db/settings.ts`
>
> ### Routing Layer
> Routers for: flights, trips, plannedLegs, settings, exports
>
> ## Architectural Constraints
> - Keep `FlightManager` as the domain/state-machine layer.
> - Preserve existing behavior and API contracts.
> - Prefer straightforward file/module extraction over redesign.
>
> ## Acceptance Criteria
> 1. `db.ts` no longer contains all DB responsibilities; domain-specific DB logic is moved to the listed files.
> 2. `server.ts` no longer contains all route handlers; handlers are organized by router concern listed above.
> 3. `FlightManager` remains the domain/state-machine boundary.
> 4. No ORM added.
> 5. Application behavior remains functionally equivalent.

## Measured baseline (2026-09-13)
- `wc -l src/db.ts` → 1541 lines, ~50 exported functions/classes covering flights,
  trips, planned legs, auth/settings, and sessions.
- `wc -l src/server.ts` → 1148 lines, ~33 route registrations covering flights,
  trips, active-trip, flight-plan upload, simbrief settings, planned-legs
  (upload/simbrief/order/CRUD), planned-leg linking/status, PDF/KML export, and
  the SPA catch-all.

## Tier
**Full loop** (`.claude/agents.md` § Cost discipline rule 6). This restructures
~2,700 lines across two files into 9 new modules (`db/flights.ts`, `db/trips.ts`,
`db/plannedLegs.ts`, `db/settings.ts`, plus 5 routers) — several files,
cross-cutting, and it changes the shape of every future backend change in this
repo. Not a single-seam edit.

## Steps this run skips, and why
- **Design step is skipped.** Design exists for runs that *introduce* a
  contract (schema change, new endpoint, new shared type). This run introduces
  none: no schema change, no new/changed HTTP endpoints, no new shared types —
  acceptance criterion 5 requires functional equivalence. The module boundaries
  are also already frozen by the user in `user_stories/refactor.md` (§ Target
  Module Split), so there is no boundary decision left for a Designer to make.
  Splitting `db.ts`'s auth/session functions: the spec's DB list has no
  `db/auth.ts` or `db/sessions.ts` entry, so those functions land in
  `db/settings.ts` alongside the settings table they're adjacent to in the
  current file — this is a mechanical placement call, not a contract, so it's
  left to the Planner/implementer rather than escalated to Design.
- **Ship (DevOps) step is skipped** unless review surfaces a build/packaging
  impact. This is a pure module reorganization; `npm run build`/`tsc` output
  path and `dist/index.js` entrypoint are unaffected as long as `src/index.ts`
  still imports from the same public surface.

## Success criteria
1. `src/db.ts` is reduced to (at most) re-exports/wiring; DB logic for flights,
   trips, planned legs, and settings/auth/sessions lives in
   `src/db/flights.ts`, `src/db/trips.ts`, `src/db/plannedLegs.ts`,
   `src/db/settings.ts`.
2. `src/server.ts` is reduced to app wiring; route handlers are organized into
   routers for flights, trips, plannedLegs, settings, and exports.
3. `src/flightManager.ts` is untouched in role/behavior (domain/state-machine
   boundary).
4. No ORM or query-builder dependency added (`package.json` diff has no new
   runtime deps beyond what's already there — `express`, `better-sqlite3`, etc.).
5. Behavior is functionally equivalent:
   - `npm test` (Vitest) passes unchanged.
   - `npx tsc` / `npm run build` clean.
   - A scratch server (copy of `flights.db`, non-3000 port) smoke-tests the
     full route surface via `curl` and produces the same responses as
     `main` for the same inputs.
6. No agent touches the user's live server (port 3000) or live `flights.db`.

## Pre-run reference commit
`8fcf3638c9496dc284cca246e1da880d178e0f2b` (HEAD at run start, `git rev-parse
HEAD`). Tasks that need a behavioral reference tree (differential curl,
pristine `combineFlights` comparison) build a `git worktree` of this commit —
not of `HEAD` at task time, which will have moved once phase 1 lands.

Note: `git status` at run start shows only unrelated pre-existing modifications
under `.claude/runs/2026-09-11-tauri-windows-client/prototypes/*.png` (a prior
run's screenshots) — untouched by this run, not to be staged or reverted by
any agent here.

## Non-negotiables carried into this run
- Never touch the running server or live `flights.db` — scratch copies, other
  ports (`.claude/ENVIRONMENT.md`).
- Node 20 via nvm for every node/npm/tsc invocation.
- Commits are the Orchestrator's alone; sub-agents do not commit/push/switch
  branches.
- Every implementer and DevOps result goes through Reviewer before merge.
