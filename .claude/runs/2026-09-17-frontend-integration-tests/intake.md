# Intake — Frontend and Integration Test Coverage

Run id: `2026-09-17-frontend-integration-tests`
Source: `user_stories/frontend_testing.md` (functional requirement, pasted verbatim below)

## Goal (restated)

The project has strong backend unit coverage (`npm test`, Vitest, per
`.claude/ENVIRONMENT.md` § Verification) but zero coverage of `client/**` and
zero coverage of frontend↔backend integration. This run introduces both:

1. A frontend test framework for component/page-level behavior tests
   (`client/src/**`).
2. Browser-based integration/end-to-end tests (Playwright) covering key user
   journeys against a real (scratch) server + scratch database.
3. CI wiring so both suites run automatically and a regression in a covered
   scenario blocks merge.

## Success criteria (verbatim from `user_stories/frontend_testing.md`)

> ### Acceptance Criteria
> - A frontend test framework is configured and running in CI.
> - Playwright (or equivalent) integration tests execute against a test environment.
> - Critical user journeys are covered with passing automated tests.
> - Test reports are generated and visible in CI results.
> - Regression in covered frontend/integration scenarios blocks merge.
>
> ### Out of Scope
> - Replacing or reducing backend unit/integration tests.
> - Visual regression/perceptual testing unless explicitly added later.

> ### Scope
> - Frontend component and page-level behavior tests.
> - Integration/end-to-end tests for key user journeys, including:
> 	- Authentication flow.
> 	- Core data visualization and interaction flows.
> 	- Error handling and loading states.

## Ground truth gathered during intake

- `client/package.json` has no test tooling today (React 18 + Vite 5, no
  Vitest/RTL/Playwright installed).
- Root `package.json` already runs backend Vitest (`npm test`) — this run adds
  a sibling suite, does not touch it (Out of Scope above, confirmed by
  existing `npm test` config).
- Auth is session-cookie based: `src/auth/routes.ts`, `src/auth/middleware.ts`
  (`requireAuth`, `requireSameOrigin`), login page at `client/src/pages/Login.tsx`.
  "Authentication flow" journey = login page → session cookie → protected
  route; `requireSameOrigin` (see `.claude/ENVIRONMENT.md`) means Playwright
  must hit a same-origin scratch server, not a Vite dev server proxying to a
  different port.
- Candidate "core data visualization" journeys: `client/src/pages/Home.tsx`
  (live map, per `ai_traffic_map_shipped` prior work), `AllFlights.tsx`,
  `FlightDetail.tsx`, `TripDetail.tsx`.
- `.github/workflows/ci.yml` currently: checkout → setup-node (`.nvmrc`, i.e.
  Node 20) → `npm ci` (root) → `npm ci` (client) → `npm run build` → `npm run
  test:types` → `npm test`. This run adds jobs/steps here, not a new pipeline.
- Per `.claude/ENVIRONMENT.md`, the user's dev server on port 3000 and
  `flights.db` are live and off-limits for every part of this run, in CI *and*
  locally — Playwright's target must be a scratch server on another port
  against a scratch/seeded database, exactly like the existing manual
  verification pattern for client changes.

## Decisions frozen by the user

None beyond routing: user selected "kick off the full loop" when asked how to
proceed with this user story (no scope narrowing, no tooling choice made yet
— Playwright is the story's own suggestion, not yet confirmed as final).

## Steps this run takes / skips

- **Plan** — not skipped. Delegating to `planner`.
- **Design** — **not skipped.** This run introduces a shared contract that
  every future frontend PR will live inside: the test directory/tooling
  layout, how Playwright authenticates a test user without touching real
  credentials, how the scratch server + scratch DB are provisioned for CI
  (fixture/seed data for "core data visualization" journeys), and the CI job
  shape (parallel jobs vs. one job, report artifact format). Freezing this
  before implementation avoids two implementer agents inventing incompatible
  test-server bootstraps.
- **Implement** — `frontend_sr` for the framework setup + component tests +
  Playwright specs (new pages/tooling, not a single-seam change); possibly a
  narrow `backend_sr`/`backend_jr` task only if the Designer decides the
  scratch-server-for-CI needs a small server-side seed/reset hook (e.g. a
  test-only route or CLI to seed deterministic flight data) — to be confirmed
  at Design.
- **Review** — not skipped, every implementer/DevOps result gated.
- **Ship** — **not skipped.** This run touches CI (`.github/workflows/ci.yml`)
  by definition of its acceptance criteria ("configured and running in CI",
  "blocks merge"). `devops` runs once implementation is approved.
- **Report** — not skipped.

## Non-negotiables carried into every task envelope

- Never touch the running dev server (port 3000) or live `flights.db` — CI and
  local Playwright runs use a scratch server on another port + scratch DB,
  per `.claude/ENVIRONMENT.md`.
- `npm run build` / `vite build` must never run against this checkout directly
  for verification — scratch copy of the tree only.
- Node 20 via nvm for every command.
